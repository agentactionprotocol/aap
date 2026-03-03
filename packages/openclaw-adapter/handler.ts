/**
 * aap-otel-logger — OpenClaw Hook Handler
 *
 * AAP-compliant OpenTelemetry observability for OpenClaw.
 * Wraps the inner handler with the AAP OpenClaw adapter for
 * manifest validation, contract enforcement, and context injection.
 */

import { createAAPAdapter, validateHandlerStatus } from "./src/index.js";
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
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
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

const LOG_LEVELS = { minimal: 0, standard: 1, verbose: 2 } as const;
function shouldLog(requiredLevel: keyof typeof LOG_LEVELS): boolean {
  return LOG_LEVELS[config.logLevel] >= LOG_LEVELS[requiredLevel];
}

// ---------------------------------------------------------------------------
// OTel SDK
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
    ...(config.logLevel === "verbose"
      ? [new BatchSpanProcessor(new ConsoleSpanExporter())]
      : []),
  ],
});

sdk.start();

const tracer: Tracer = trace.getTracer("aap-otel-logger", "1.0.0");
let spansExported = 0;
let lastExportAt: string | null = null;

// ---------------------------------------------------------------------------
// Event type
// ---------------------------------------------------------------------------

interface OpenClawEvent {
  type: string;
  action?: string;
  sessionKey?: string;
  channel?: string;
  timestamp?: string;
  toolName?: string;
  exitCode?: number;
  duration_ms?: number;
  stderr?: string;
  stdout?: string;
  resultSize?: number;
  model?: string;
  tokensUsed?: number;
  cost_usd?: number;
  thinkingLevel?: string;
  bootstrapFiles?: string[];
  workspace?: string;
  error?: {
    type: string;
    message: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
  // Injected by AAP adapter
  __aap_runtime_context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

function setCommonAttributes(span: Span, event: OpenClawEvent): void {
  span.setAttribute("aap.spec.version", "0.1.0");
  span.setAttribute("aap.hook.type", "observe");
  if (event.sessionKey) span.setAttribute("openclaw.session.key", event.sessionKey);
  if (event.channel) span.setAttribute("openclaw.channel", event.channel);
  if (event.timestamp) span.setAttribute("openclaw.event.timestamp", event.timestamp);
}

function recordSpan(
  name: string,
  event: OpenClawEvent,
  fn: (span: Span) => void
): void {
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
// Event handlers
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
    if (event.exitCode !== undefined) span.setAttribute("openclaw.tool.exit_code", event.exitCode);
    if (event.duration_ms !== undefined) span.setAttribute("openclaw.tool.duration_ms", event.duration_ms);
    if (event.exitCode !== 0) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `Tool ${event.toolName} exited with code ${event.exitCode}` });
    }
    if (shouldLog("verbose") && event.stderr) {
      span.addEvent("tool.stderr", { "openclaw.tool.stderr": event.stderr });
    }
  });
}

function handleToolPersist(event: OpenClawEvent): void {
  if (!shouldLog("standard")) return;
  recordSpan("openclaw.tool.persist", event, (span) => {
    if (event.toolName) span.setAttribute("openclaw.tool.name", event.toolName);
    if (event.resultSize !== undefined) span.setAttribute("openclaw.tool.result_size_bytes", event.resultSize);
  });
}

function handleBootstrap(event: OpenClawEvent): void {
  if (!shouldLog("standard")) return;
  recordSpan("openclaw.agent.bootstrap", event, (span) => {
    if (event.workspace) span.setAttribute("openclaw.workspace", event.workspace);
    if (event.bootstrapFiles) {
      span.setAttribute("openclaw.bootstrap.file_count", event.bootstrapFiles.length);
      if (shouldLog("verbose")) {
        span.addEvent("bootstrap.files", { "openclaw.bootstrap.files": JSON.stringify(event.bootstrapFiles) });
      }
    }
  });
}

function handleSessionEvent(event: OpenClawEvent): void {
  if (!shouldLog("minimal")) return;
  recordSpan(`openclaw.session.${event.type}`, event, (span) => {
    span.setAttribute("openclaw.session.event", event.type);
    if (event.model) span.setAttribute("openclaw.session.model", event.model);
    if (event.tokensUsed !== undefined) span.setAttribute("aap.resources.tokens_used", event.tokensUsed);
    if (event.cost_usd !== undefined) span.setAttribute("aap.resources.cost_usd", event.cost_usd);
    if (shouldLog("verbose") && event.thinkingLevel) {
      span.setAttribute("openclaw.session.thinking_level", event.thinkingLevel);
    }
  });
}

function handleError(event: OpenClawEvent): void {
  recordSpan("openclaw.error", event, (span) => {
    span.setStatus({ code: SpanStatusCode.ERROR });
    if (event.error) {
      span.setAttribute("openclaw.error.type", event.error.type);
      span.setAttribute("openclaw.error.message", event.error.message);
      if (event.error.stack) {
        span.addEvent("error.stack", { "exception.stacktrace": event.error.stack });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const EVENT_HANDLERS: Record<string, (event: OpenClawEvent) => void> = {
  "command:new": handleCommand,
  "command:reset": handleCommand,
  "command:stop": handleCommand,
  "command:compact": handleCommand,
  "command:think": handleCommand,
  "command:verbose": handleCommand,
  "command:usage": handleCommand,
  "command:restart": handleCommand,
  tool_result: handleToolExecution,
  tool_result_persist: handleToolPersist,
  "agent:bootstrap": handleBootstrap,
  "session:start": handleSessionEvent,
  "session:end": handleSessionEvent,
  "session:compact": handleSessionEvent,
  error: handleError,
};

// ---------------------------------------------------------------------------
// Inner handler
// ---------------------------------------------------------------------------

const innerHandler = async (event: Record<string, unknown>): Promise<void> => {
  const ocEvent = event as OpenClawEvent;

  if (config.sampleRate < 1.0 && Math.random() > config.sampleRate) return;

  const eventKey = ocEvent.type === "command" ? `command:${ocEvent.action}` : ocEvent.type;
  const fn = EVENT_HANDLERS[eventKey];

  if (fn) {
    fn(ocEvent);
  } else if (shouldLog("verbose")) {
    recordSpan(`openclaw.event.${ocEvent.type}`, ocEvent, (span) => {
      span.setAttribute("openclaw.event.type", ocEvent.type);
      span.addEvent("unhandled_event", { "openclaw.event.raw": JSON.stringify(event) });
    });
  }
};

// ---------------------------------------------------------------------------
// Wrap with AAP adapter — this is the only change from the original handler
// ---------------------------------------------------------------------------

const { handler: wrappedHandler, manifests } = createAAPAdapter(innerHandler, {
  hookDir: __dirname,
});

export default wrappedHandler;

// ---------------------------------------------------------------------------
// Status endpoint — validated against contract on export
// ---------------------------------------------------------------------------

export function getStatus() {
  const status = {
    status: "active" as const,
    spans_exported: spansExported,
    last_export_at: lastExportAt,
  };

  // Validate output shape against contract
  validateHandlerStatus(manifests, status as unknown as Record<string, unknown>);

  return status;
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on("SIGTERM", async () => { await sdk.shutdown(); });
process.on("SIGINT", async () => { await sdk.shutdown(); });
