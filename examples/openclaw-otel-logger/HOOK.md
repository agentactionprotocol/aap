---
name: aap-otel-logger
description: "AAP-compliant OpenTelemetry logger. Traces every agent action, tool call, command, session event, and error to any OTLP-compatible backend."
homepage: https://github.com/agentactionprotocol/aap-spec/tree/main/examples/openclaw-otel-logger
metadata:
  openclaw:
    emoji: "📡"
    events:
      - "command:new"
      - "command:reset"
      - "command:stop"
      - "command:compact"
      - "command:think"
      - "command:verbose"
      - "command:usage"
      - "command:restart"
      - "agent:bootstrap"
      - "tool_result_persist"
    requires:
      bins: ["node"]
---

# AAP OpenTelemetry Logger for OpenClaw

Comprehensive observability hook built on the AAP (Agent Action Protocol) spec.

## What it traces

| Event Category | Span Name Pattern | Log Level |
|---------------|-------------------|-----------|
| Slash commands | `openclaw.command.{action}` | minimal |
| Tool executions | `openclaw.tool.{toolName}` | standard |
| Tool result persistence | `openclaw.tool.persist` | standard |
| Session lifecycle | `openclaw.session.{start\|end\|compact}` | minimal |
| Agent bootstrap | `openclaw.agent.bootstrap` | standard |
| Errors | `openclaw.error` | minimal |
| Model selection | `openclaw.model.select` | verbose |
| Token usage | `openclaw.usage` | verbose |

## Setup

1. Set env vars in your `openclaw.json` or `.env`:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=my-openclaw-agent
AAP_LOG_LEVEL=standard  # minimal | standard | verbose
```

2. Enable the hook:

```bash
openclaw hooks enable aap-otel-logger
```

3. Restart your gateway.

## OTel Semantic Conventions

All spans follow [OTel semantic conventions](https://opentelemetry.io/docs/specs/semconv/) with AAP extensions:

- `aap.action.name` — AAP action that produced the span
- `aap.hook.type` — AAP hook type (observe)
- `openclaw.session.key` — OpenClaw session identifier
- `openclaw.channel` — Messaging channel (whatsapp, telegram, etc.)
- `openclaw.tool.name` — Tool that was executed
- `service.name` — Configurable, defaults to `openclaw-agent`
