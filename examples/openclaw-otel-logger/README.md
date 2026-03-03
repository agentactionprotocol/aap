# AAP × OpenClaw × OpenTelemetry

**First reference implementation of AAP (Agent Action Protocol) in a production agent runtime.**

This example demonstrates AAP's core value: wrapping a real agent system (OpenClaw) with declarative action definitions, typed contracts, lifecycle hooks, and standardized observability — all exportable as OpenTelemetry traces.

## What This Proves

AAP isn't theoretical. This package:

1. **Defines an AAP Action** (`action.aap.yaml`) — declarative manifest for the OTel logger capability
2. **Defines an AAP Contract** (`contract.aap.yaml`) — typed I/O schema with invariants
3. **Defines AAP Hooks** (`hooks.aap.yaml`) — six lifecycle interceptors mapped to OpenClaw events
4. **Implements an OpenClaw Hook** (`handler.ts`) — real TypeScript that runs in OpenClaw's gateway
5. **Exports OTLP traces** — every agent action, tool call, command, and error as OTel spans

## Architecture

```
OpenClaw Gateway
  │
  ├─ command:new ──────────┐
  ├─ command:reset ─────────┤
  ├─ agent:bootstrap ───────┤
  ├─ tool_result ───────────┤    AAP Hook Layer
  ├─ tool_result_persist ───┤    (handler.ts)
  ├─ session:start ─────────┤         │
  ├─ session:end ───────────┤         ▼
  ├─ session:compact ───────┤    OTel SDK
  └─ error ─────────────────┘         │
                                      ▼
                               OTLP Exporter
                                      │
                          ┌───────────┴───────────┐
                          │                       │
                       Jaeger              Datadog / Honeycomb /
                       (local)             Grafana Tempo (cloud)
```

## AAP Primitives Demonstrated

| Primitive | File | What It Shows |
|-----------|------|---------------|
| Action | `action.aap.yaml` | Declarative capability definition with permissions, resources, hooks |
| Contract | `contract.aap.yaml` | Typed I/O schema with invariants and resource limits |
| Hooks | `hooks.aap.yaml` | Six `observe` hooks mapped to OpenClaw lifecycle events |
| Trace | `handler.ts` | W3C Trace Context spans with AAP + OTel attributes |
| Permissions | `action.aap.yaml` | `network:outbound:*`, `env:read:OTEL_*`, `file:read` |
| State | `action.aap.yaml` | Context keys for spans_exported, exporter_status |

## Install

```bash
# Copy to OpenClaw managed hooks directory
cp -r . ~/.openclaw/hooks/aap-otel-logger/

# Install dependencies
cd ~/.openclaw/hooks/aap-otel-logger && npm install

# Enable
openclaw hooks enable aap-otel-logger

# Restart gateway
openclaw gateway restart
```

## Configure

Environment variables (set in `~/.openclaw/openclaw.json` or `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318/v1/traces` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | `openclaw-agent` | Service name in traces |
| `AAP_LOG_LEVEL` | `standard` | `minimal` / `standard` / `verbose` |
| `AAP_SAMPLE_RATE` | `1.0` | Trace sampling rate (0.0–1.0) |

## Quick Test with Jaeger

```bash
# Start Jaeger all-in-one
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Enable the hook and restart OpenClaw
openclaw hooks enable aap-otel-logger
# (restart your gateway)

# Send a message via any channel, then:
open http://localhost:16686
# Search for service: openclaw-agent
```

## Span Examples

### Command Span
```json
{
  "name": "openclaw.command.new",
  "attributes": {
    "aap.spec.version": "0.1.0",
    "aap.hook.type": "observe",
    "openclaw.command.action": "new",
    "openclaw.session.key": "main",
    "openclaw.channel": "whatsapp"
  }
}
```

### Tool Execution Span
```json
{
  "name": "openclaw.tool.bash",
  "attributes": {
    "aap.spec.version": "0.1.0",
    "openclaw.tool.name": "bash",
    "openclaw.tool.exit_code": 0,
    "openclaw.tool.duration_ms": 1247,
    "openclaw.session.key": "main"
  }
}
```

### Error Span
```json
{
  "name": "openclaw.error",
  "status": { "code": "ERROR" },
  "attributes": {
    "openclaw.error.type": "ToolTimeout",
    "openclaw.error.message": "bash tool exceeded 60s timeout"
  },
  "events": [
    { "name": "error.stack", "attributes": { "exception.stacktrace": "..." } }
  ]
}
```

## What This Means for AAP

This example validates that AAP's primitives compose cleanly with a real-world agent runtime. The hook definitions in `hooks.aap.yaml` are portable — a different runtime (Claude Code, Codex, a custom agent) could implement the same AAP hooks with its own handler, and the trace output would be structurally identical. That's the point.

## License

MIT
