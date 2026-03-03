/**
 * aap-cost-guard — OpenClaw Hook Handler
 *
 * AAP-compliant session budget enforcement for AI agents.
 * Tracks cumulative cost and token usage across a session.
 * Warns at a configurable threshold. Blocks when budget is exceeded.
 *
 * Follows:
 *   - AAP v0.1.0 Guard hook primitive
 *   - AAP v0.1.0 State primitive (in-memory context keys)
 *   - OpenClaw hook handler contract (event-driven, async)
 *
 * Zero runtime dependencies — pure Node.js.
 */

// ---------------------------------------------------------------------------
// Config (from env, mapped from AAP inputs by the runtime)
// ---------------------------------------------------------------------------

const config = {
  maxCostUsd: parseFloat(process.env.AAP_MAX_COST_USD || "1.00"),
  maxTokens: parseInt(process.env.AAP_MAX_TOKENS || "100000", 10),
  warnThreshold: parseFloat(process.env.AAP_WARN_THRESHOLD || "0.8"),
  enforcement: (process.env.AAP_ENFORCEMENT || "enforce") as
    | "enforce"
    | "warn_only"
    | "log_only",
};

// ---------------------------------------------------------------------------
// Session state (AAP state primitive — context_keys)
// These are the values declared in action.aap.yaml state.context_keys
// ---------------------------------------------------------------------------

let totalCostUsd = 0;
let totalTokens = 0;
let actionCount = 0;
let warningsIssued = 0;
let lastActionCost = 0;

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function fmt(color: string, msg: string): string {
  return `${color}${msg}${RESET}`;
}

function prefix(): string {
  return fmt(BOLD, "[aap:cost-guard]");
}

// ---------------------------------------------------------------------------
// Budget check — AAP guard hook (before_execute)
// ---------------------------------------------------------------------------

type GuardResult =
  | { action: "continue" }
  | { action: "warn"; message: string }
  | { action: "abort"; message: string };

function checkBudget(): GuardResult {
  const costExceeded = totalCostUsd >= config.maxCostUsd;
  const tokensExceeded = totalTokens >= config.maxTokens;
  const exceeded = costExceeded || tokensExceeded;

  const costPct = config.maxCostUsd > 0 ? totalCostUsd / config.maxCostUsd : 1;
  const tokenPct = config.maxTokens > 0 ? totalTokens / config.maxTokens : 1;
  const nearLimit = costPct >= config.warnThreshold || tokenPct >= config.warnThreshold;

  if (exceeded) {
    const reason = costExceeded
      ? `cost $${totalCostUsd.toFixed(4)} >= limit $${config.maxCostUsd.toFixed(2)}`
      : `tokens ${totalTokens.toLocaleString()} >= limit ${config.maxTokens.toLocaleString()}`;

    const message = `Budget exceeded (${reason}). ${actionCount} actions ran this session.`;

    if (config.enforcement === "enforce") {
      return { action: "abort", message };
    }
    if (config.enforcement === "warn_only") {
      return { action: "warn", message };
    }
    // log_only: never block
    return { action: "continue" };
  }

  if (nearLimit && config.enforcement !== "log_only") {
    const costRemaining = (config.maxCostUsd - totalCostUsd).toFixed(4);
    const tokensRemaining = (config.maxTokens - totalTokens).toLocaleString();
    return {
      action: "warn",
      message: `Approaching budget limit — $${costRemaining} and ${tokensRemaining} tokens remaining.`,
    };
  }

  return { action: "continue" };
}

// ---------------------------------------------------------------------------
// Cost recorder — AAP observe hook (after_execute)
// ---------------------------------------------------------------------------

interface CostEvent {
  type: string;
  tokensUsed?: number;
  cost_usd?: number;
  // Alternate field names runtimes might use
  tokens_used?: number;
  usage?: {
    total_tokens?: number;
    cost_usd?: number;
  };
}

function recordCost(event: CostEvent): void {
  // Normalize across different runtime field names
  const tokens =
    event.tokensUsed ??
    event.tokens_used ??
    event.usage?.total_tokens ??
    0;

  const cost =
    event.cost_usd ??
    event.usage?.cost_usd ??
    0;

  totalTokens += tokens;
  totalCostUsd += cost;
  actionCount++;
  lastActionCost = cost;

  if (config.enforcement === "log_only") return;

  // Log a status line after each action
  const status = getStatus();
  const statusColor =
    status.status === "blocked" ? RED :
    status.status === "warning" ? YELLOW :
    GREEN;

  console.log(
    `${prefix()} ${fmt(statusColor, status.status.toUpperCase())} ` +
    `| $${totalCostUsd.toFixed(4)}/$${config.maxCostUsd.toFixed(2)} ` +
    `| ${totalTokens.toLocaleString()}/${config.maxTokens.toLocaleString()} tokens ` +
    `| action #${actionCount}` +
    (cost > 0 ? ` (+$${cost.toFixed(4)})` : "")
  );
}

// ---------------------------------------------------------------------------
// Status — used by getStatus() and reported as AAP contract outputs
// ---------------------------------------------------------------------------

function getStatus() {
  const costExceeded = totalCostUsd >= config.maxCostUsd;
  const tokensExceeded = totalTokens >= config.maxTokens;
  const nearLimit =
    (config.maxCostUsd > 0 ? totalCostUsd / config.maxCostUsd : 1) >= config.warnThreshold ||
    (config.maxTokens > 0 ? totalTokens / config.maxTokens : 1) >= config.warnThreshold;

  return {
    status: (costExceeded || tokensExceeded ? "blocked" : nearLimit ? "warning" : "ok") as
      "ok" | "warning" | "blocked",
    total_cost_usd: totalCostUsd,
    total_tokens: totalTokens,
    remaining_cost_usd: Math.max(0, config.maxCostUsd - totalCostUsd),
    remaining_tokens: Math.max(0, config.maxTokens - totalTokens),
    action_count: actionCount,
    warnings_issued: warningsIssued,
  };
}

// ---------------------------------------------------------------------------
// OpenClaw event shape
// ---------------------------------------------------------------------------

interface OpenClawEvent {
  type: string;
  action?: string;
  sessionKey?: string;
  tokensUsed?: number;
  tokens_used?: number;
  cost_usd?: number;
  usage?: { total_tokens?: number; cost_usd?: number };
}

// ---------------------------------------------------------------------------
// Router — maps OpenClaw events to the two AAP hooks
// ---------------------------------------------------------------------------

const handler = async (event: OpenClawEvent): Promise<void> => {
  // before_execute equivalent: check budget before command/action starts
  if (
    event.type === "command:new" ||
    event.type === "before_execute"
  ) {
    const result = checkBudget();

    if (result.action === "abort") {
      console.error(`${prefix()} ${fmt(RED, "BLOCKED")} — ${result.message}`);
      // Signal to the runtime that execution should be aborted.
      // In OpenClaw, throwing causes the gateway to halt the action.
      throw new Error(`[aap:cost-guard] ${result.message}`);
    }

    if (result.action === "warn") {
      console.warn(`${prefix()} ${fmt(YELLOW, "WARNING")} — ${result.message}`);
      warningsIssued++;
    }

    return;
  }

  // after_execute equivalent: record cost after action completes
  // Only record from events that represent actual cost-bearing work.
  // session:end and session:compact are lifecycle signals, not cost events.
  if (
    event.type === "tool_result" ||
    event.type === "after_execute"
  ) {
    recordCost(event as CostEvent);
    return;
  }
};

export default handler;

// ---------------------------------------------------------------------------
// Status endpoint — AAP contract outputs
// ---------------------------------------------------------------------------

export { getStatus };

// ---------------------------------------------------------------------------
// Startup log
// ---------------------------------------------------------------------------

console.log(
  `${prefix()} initialized — ` +
  `budget: $${config.maxCostUsd.toFixed(2)} / ${config.maxTokens.toLocaleString()} tokens ` +
  `| warn at ${(config.warnThreshold * 100).toFixed(0)}% ` +
  `| enforcement: ${config.enforcement}`
);
