# AAP Cost Guard

**Session-level cost and token budget enforcement for AI agents.**

Tracks cumulative spend across all actions in a session. Warns when approaching a budget threshold. Blocks execution when the cap is exceeded.

Zero dependencies. Pure Node.js. Drop it into any AAP-compatible runtime.

---

## The Problem

AI agents can burn through tokens and budget with nothing to stop them. A runaway loop, an unexpectedly expensive model call, an agent that just keeps going — these are real production problems with no standard solution.

AAP's `guard` hook primitive exists exactly for this. The cost guard is a reference implementation that shows what enforcement looks like when it's a first-class part of the action protocol.

---

## AAP Primitives Demonstrated

| Primitive | File | What It Shows |
|-----------|------|---------------|
| **Action** | `action.aap.yaml` | Declarative manifest — inputs are budget config, outputs are spend status |
| **Contract** | `contract.aap.yaml` | Typed I/O schema with invariants (`total_cost_usd >= 0`, etc.) |
| **Guard hook** | `hooks.aap.yaml` | `before_execute` hook that blocks over-budget actions |
| **Observe hook** | `hooks.aap.yaml` | `after_execute` hook that records cost into session state |
| **State** | `action.aap.yaml` | `context_keys` tracking running totals without a database |
| **Permissions** | `action.aap.yaml` | Minimal: `env:read:AAP_*` only — no network, no filesystem |
| **Resources** | `action.aap.yaml` | `max_cost_usd: 0.00` — the guard itself costs nothing |

---

## How It Works

Two AAP hooks, fired in sequence around every action:

```
Agent wants to run an action
        │
        ▼
┌───────────────────┐
│  cost-budget-gate  │  ← guard hook (before_execute)
│                   │
│  Is total spend   │  YES → enforce: ABORT
│  over budget?  ──▶│  YES → warn_only: WARN, allow
│                   │  YES → log_only: silent, allow
│                   │  NO + near limit → WARN
│                   │  NO → CONTINUE
└────────┬──────────┘
         │ (if not aborted)
         ▼
   [ Action runs ]
         │
         ▼
┌───────────────────┐
│  cost-recorder    │  ← observe hook (after_execute)
│                   │
│  Extract tokens + │
│  cost from trace  │
│  → update totals  │
└───────────────────┘
```

**Key design choice:** The guard checks cumulative spend *so far*, not the cost of the upcoming action (which is unknowable before it runs). This means the guard blocks the action *after* the one that exceeded the budget. This is intentional and correct — you can't enforce a cost cap you can't predict.

---

## Configuration

Set via environment variables (or mapped from AAP inputs by the runtime):

| Variable | Default | Description |
|----------|---------|-------------|
| `AAP_MAX_COST_USD` | `1.00` | Maximum total cost in USD |
| `AAP_MAX_TOKENS` | `100000` | Maximum total tokens |
| `AAP_WARN_THRESHOLD` | `0.8` | Fraction of budget at which to warn (0.8 = 80%) |
| `AAP_ENFORCEMENT` | `enforce` | `enforce` / `warn_only` / `log_only` |

---

## Example Output

**Normal operation (under budget):**
```
[aap:cost-guard] initialized — budget: $1.00 / 100,000 tokens | warn at 80% | enforcement: enforce
[aap:cost-guard] OK | $0.0124/$1.00 | 1,847/100,000 tokens | action #1 (+$0.0124)
[aap:cost-guard] OK | $0.0287/$1.00 | 3,921/100,000 tokens | action #2 (+$0.0163)
```

**Approaching limit (warn threshold):**
```
[aap:cost-guard] WARNING — Approaching budget limit — $0.1823 and 18,230 tokens remaining.
[aap:cost-guard] WARNING | $0.8177/$1.00 | 81,770/100,000 tokens | action #23 (+$0.0341)
```

**Budget exceeded (enforce mode):**
```
[aap:cost-guard] BLOCKED — Budget exceeded (cost $1.0043 >= limit $1.00). 31 actions ran this session.
```

---

## Install

```bash
# Copy to your hooks directory
cp -r . ~/.openclaw/hooks/aap-cost-guard/

# Install dev dependencies (TypeScript only — no runtime deps)
cd ~/.openclaw/hooks/aap-cost-guard && npm install

# Build
npm run build

# Enable
openclaw hooks enable aap-cost-guard
```

---

## What This Means for AAP

The OTel logger showed that AAP hooks can *observe*. The cost guard shows they can *enforce*.

This is the distinction that separates AAP from a pure observability solution. A guard hook can inspect state before execution and return an abort signal — the runtime honors it, the action doesn't run. No custom runtime code needed. The policy lives in the AAP manifest and the handler, portable across any AAP-compatible runtime.

Run the cost guard alongside the OTel logger and you get both enforcement and full observability — two independent hooks, composing cleanly, with no coupling between them.

---

## License

MIT
