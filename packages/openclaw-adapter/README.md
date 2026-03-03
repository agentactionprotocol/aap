# @aap/openclaw-adapter

AAP runtime adapter for OpenClaw. Wraps any OpenClaw hook handler with AAP manifest parsing, contract validation, and runtime context injection.

## What it does

- **Loads** `action.aap.yaml`, `contract.aap.yaml`, `hooks.aap.yaml` at startup
- **Validates** manifests and warns on structural violations
- **Validates** event inputs against the contract schema before handler execution
- **Validates** status outputs against the contract schema on `getStatus()`
- **Injects** `runtime_context` (session, channel, model, workspace) into the event
- **Never aborts** — all violations are warnings logged to `console.warn` (or your custom handler)

## Install

```bash
npm install @aap/openclaw-adapter yaml
```

## Usage

Wrap your existing handler with `createAAPAdapter`:

```typescript
import { createAAPAdapter, validateHandlerStatus } from "@aap/openclaw-adapter";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Your existing inner handler
const innerHandler = async (event) => {
  // ... your logic
};

// Wrap it
const { handler, manifests } = createAAPAdapter(innerHandler, {
  hookDir: __dirname,           // where your .aap.yaml files live
  onWarning: console.warn,      // optional — defaults to console.warn
});

export default handler;

// Validate status outputs against contract
export function getStatus() {
  const status = { status: "active", spans_exported: 0, last_export_at: null };
  validateHandlerStatus(manifests, status);
  return status;
}
```

## What changes in OpenClaw

Nothing. The adapter wraps the handler — OpenClaw sees an identical async function signature. AAP enforcement is additive.

## Startup output

```
[aap] Loaded action: openclaw-otel-logger@1.0.0
[aap] Registered 6 AAP hook(s):
  • otel-trace-bootstrap (observe) → before_execute
  • otel-trace-commands (observe) → after_execute
  • otel-trace-tool-execution (observe) → after_execute
  • otel-trace-tool-persist (observe) → after_execute
  • otel-trace-errors (observe) → on_error
  • otel-trace-session (observe) → after_execute
```

## Warning examples

```
[aap] contract.for="openclaw-otel-logger@1.0.0" does not match action "openclaw-otel-logger@1.1.0"
[aap:input] [aap] output.status: value "unknown" not in allowed values [active, degraded, failed]
[aap] invariant violated: "output.spans_exported >= 0"
```

## Project layout

```
src/
  index.ts      — createAAPAdapter() factory, main entry
  loader.ts     — YAML manifest loader + structural validators
  validator.ts  — contract I/O schema + invariant checker
  context.ts    — runtime_context resolver
handler.ts      — example: updated otel-logger using the adapter
```

## What's not yet enforced

Per v0.1 scope: permissions, resource limits (cost/tokens/latency), hook auto-wiring from YAML. Those are the next layer.
