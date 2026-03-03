/**
 * aap-otel-logger — OpenClaw Hook Handler
 *
 * AAP-compliant OpenTelemetry observability for OpenClaw.
 * Intercepts gateway lifecycle events and exports them as OTLP spans.
 *
 * Follows:
 *   - AAP v0.1.0 Trace primitive (W3C Trace Context semantics)
 *   - OpenTelemetry Semantic Conventions v1.25+
 *   - OpenClaw hook handler contract (event-driven, async)
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import {
  trace,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";

// ---------------------------------------------------------------------------
// Config (from env, mapped from AAP inputs)
// ---------------------------------------------------------------------------

const config = {
  endpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318/v1/traces",
  serviceName: process.env.OTEL_SERVICE_NAME || "openclaw-agent",
  logLevel: (process.env.AAP_LOG_LEVEL || "standard") as
    | "minimal"
    | "standard"
    | "verbose",
  sampleRate: parseFloat(process.env.AAP_SAMPLE_RATE || "1.0"),
};

// ---------------------------------------------------------------------------
// Log level gating
// ---------------------------------------------------------------------------

const LOG_LEVELS = { minimal: 0, standard: 1, verbose: 2 } as const;

function shouldLog(requiredLevel: keyof typeof LOG_LEVELS): boolean {
  return LOG_LEVELS[config.logLevel] >= LOG_LEVELS[requiredLevel];
}

// ---------------------------------------------------------------------------
// OTel SDK initialization
// ---------------------------------------------------------------------------

const exporter = new OTLPTraceExporter({ url: config.endpoint });

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
    [ATTR_SERVICE_VERSION]: "1.0.0",
    "aap.spec.version": "0.1.0",
    "aap.action.name": "openclaw-otel-logger",
    "aap.action.version": "1.0.0",
  }),
  spanProcessors: [
    new BatchSpanProcessor(exporter),
    // Fallback: also log to console if verbose
    ...(config.logLevel === "verbose"
      ? [new BatchSpanProcessor(new ConsoleSpanExporter())]
      : []),
  ],
});

sdk.start();

const tracer: Tracer = trace.getTracer("aap-otel-logger", "1.0.0");

// Metrics
let spansExported = 0;
let lastExportAt: string | null = null;

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

function setCommonAttributes(span: Span, event: OpenClawEvent): void {
  span.setAttribute("aap.spec.version", "0.1.0");
  span.setAttribute("aap.hook.type", "observe");

  if (event.sessionKey) {
    span.setAttribute("openclaw.session.key", event.sessionKey);
  }
  if (event.channel) {
    span.setAttribute("openclaw.channel", event.channel);
  }
  if (event.timestamp) {
    span.setAttribute("openclaw.event.timestamp", event.timestamp);
  }
}

function recordSpan(name: string, event: OpenClawEvent, fn: (span: Span) => void): void {
  const span = tracer.startSpan(name);
  setCommonAttributes(span, event);
  try {
    fn(span);
  } catch (err) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
  } finally {
    span.end();
    spansExported++;
    lastExportAt = new Date().toISOString();
  }
}

// ---------------------------------------------------------------------------
// Event type (OpenClaw hook event shape)
// ---------------------------------------------------------------------------

interface OpenClawEvent {
  type: string;
  action?: string;
  sessionKey?: string;
  channel?: string;
  timestamp?: string;
  // Tool events
  toolName?: string;
  exitCode?: number;
  duration_ms?: number;
  stderr?: string;
  stdout?: string;
  resultSize?: number;
  // Session events
  model?: string;
  tokensUsed?: number;
  cost_usd?: number;
  thinkingLevel?: string;
  // Bootstrap events
  bootstrapFiles?: string[];
  workspace?: string;
  // Error events
  error?: {
    type: string;
    message: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Event handlers — one per AAP hook definition
// ---------------------------------------------------------------------------

function handleCommand(event: OpenClawEvent): void {
  if (!shouldLog("minimal")) return;

  recordSpan(`openclaw.command.${event.action || "unknown"}`, event, (span) => {
    span.setAttribute("openclaw.command.action", event.action || "unknown");
  });
}

function handleToolExecution(event: OpenClawEvent): void {
  if (!shouldLog("standard")) return;

  recordSpan(`openclaw.tool.${event.toolName || "unknown"}`, event, (span) => {
    span.setAttribute("openclaw.tool.name", event.toolName || "unknown");
    if (event.exitCode !== undefined) {
      span.setAttribute("openclaw.tool.exit_code", event.exitCode);
    }
    if (event.duration_ms !== undefined) {
      span.setAttribute("openclaw.tool.duration_ms", event.duration_ms);
    }
    if (event.exitCode !== 0) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `Tool ${event.toolName} exited with code ${event.exitCode}`,
      });
    }
    // Verbose: capture stderr
    if (shouldLog("verbose") && event.stderr) {
      span.addEvent("tool.stderr", { "openclaw.tool.stderr": event.stderr });
    }
  });
}

function handleToolPersist(event: OpenClawEvent): void {
  if (!shouldLog("standard")) return;

  recordSpan("openclaw.tool.persist", event, (span) => {
    if (event.toolName) {
      span.setAttribute("openclaw.tool.name", event.toolName);
    }
    if (event.resultSize !== undefined) {
      span.setAttribute("openclaw.tool.result_size_bytes", event.resultSize);
    }
  });
}

function handleBootstrap(event: OpenClawEvent): void {
  if (!shouldLog("standard")) return;

  recordSpan("openclaw.agent.bootstrap", event, (span) => {
    if (event.workspace) {
      span.setAttribute("openclaw.workspace", event.workspace);
    }
    if (event.bootstrapFiles) {
      span.setAttribute(
        "openclaw.bootstrap.file_count",
        event.bootstrapFiles.length,
      );
      if (shouldLog("verbose")) {
        span.addEvent("bootstrap.files", {
          "openclaw.bootstrap.files": JSON.stringify(event.bootstrapFiles),
        });
      }
    }
  });
}

function handleSessionEvent(event: OpenClawEvent): void {
  if (!shouldLog("minimal")) return;

  recordSpan(`openclaw.session.${event.type}`, event, (span) => {
    span.setAttribute("openclaw.session.event", event.type);
    if (event.model) {
      span.setAttribute("openclaw.session.model", event.model);
    }
    if (event.tokensUsed !== undefined) {
      span.setAttribute("aap.resources.tokens_used", event.tokensUsed);
    }
    if (event.cost_usd !== undefined) {
      span.setAttribute("aap.resources.cost_usd", event.cost_usd);
    }
    if (shouldLog("verbose") && event.thinkingLevel) {
      span.setAttribute("openclaw.session.thinking_level", event.thinkingLevel);
    }
  });
}

function handleError(event: OpenClawEvent): void {
  // Errors always logged regardless of level
  recordSpan("openclaw.error", event, (span) => {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (event.error) {
      span.setAttribute("openclaw.error.type", event.error.type);
      span.setAttribute("openclaw.error.message", event.error.message);
      if (event.error.stack) {
        span.addEvent("error.stack", {
          "exception.stacktrace": event.error.stack,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Router — maps OpenClaw events to handlers
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: Record<string, (event: OpenClawEvent) => void> = {
  // Slash commands
  "command:new": handleCommand,
  "command:reset": handleCommand,
  "command:stop": handleCommand,
  "command:compact": handleCommand,
  "command:think": handleCommand,
  "command:verbose": handleCommand,
  "command:usage": handleCommand,
  "command:restart": handleCommand,
  // Tool events
  tool_result: handleToolExecution,
  tool_result_persist: handleToolPersist,
  // Bootstrap
  "agent:bootstrap": handleBootstrap,
  // Session
  "session:start": handleSessionEvent,
  "session:end": handleSessionEvent,
  "session:compact": handleSessionEvent,
  // Errors
  error: handleError,
};

// ---------------------------------------------------------------------------
// Main handler — OpenClaw calls this
// ---------------------------------------------------------------------------

const handler = async (event: OpenClawEvent): Promise<void> => {
  // Sampling
  if (config.sampleRate < 1.0 && Math.random() > config.sampleRate) {
    return;
  }

  // Route to specific handler
  const eventKey = event.type === "command" ? `command:${event.action}` : event.type;
  const fn = EVENT_HANDLERS[eventKey];

  if (fn) {
    fn(event);
  } else if (shouldLog("verbose")) {
    // In verbose mode, log unrecognized events as generic spans
    recordSpan(`openclaw.event.${event.type}`, event, (span) => {
      span.setAttribute("openclaw.event.type", event.type);
      span.addEvent("unhandled_event", {
        "openclaw.event.raw": JSON.stringify(event),
      });
    });
  }
};

export default handler;

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", async () => {
  await sdk.shutdown();
});

process.on("SIGINT", async () => {
  await sdk.shutdown();
});

// ---------------------------------------------------------------------------
// Status endpoint (for AAP contract output)
// ---------------------------------------------------------------------------

export function getStatus() {
  return {
    status: "active" as const,
    spans_exported: spansExported,
    last_export_at: lastExportAt,
  };
}
