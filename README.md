# AAP: Agent Action Protocol

### A portable, composable specification for AI agents taking action in the world.

> **Status:** Draft v0.1 | **License:** MIT

---

## The Problem

AI agents are taking real actions — creating tickets, sending emails, deploying code, moving money. Every week the scope of what agents can do gets wider and the stakes get higher.

The infrastructure beneath them hasn't kept up.

[MCP](https://modelcontextprotocol.io/) was a significant step forward. It standardized how agents discover and call tools — the transport layer. But transport is only one piece of the puzzle. MCP doesn't define what an action *is*, how actions compose into pipelines, how they're authorized, how they checkpoint and resume, how they roll back when things go wrong, or how they're observed across runtimes.

The industry is stretching MCP beyond its design because nothing better exists for the layers above it.

AAP is that missing layer.

## Where MCP Falls Short

This isn't a criticism of MCP — it's an acknowledgment that MCP solved a different (and important) problem. AAP addresses what MCP was never designed to handle:

| Gap | What's Missing |
|-----|---------------|
| **Action identity** | No standard way to define what a capability *is* — its inputs, outputs, version, author, or resource requirements |
| **Contracts** | No typed I/O schemas with invariants that can be validated before execution |
| **Lifecycle hooks** | No standard interception points for auth injection, human review gates, cost guards, or observability |
| **Permissions** | No capability-based permission model — actions can't declare what they need, runtimes can't enforce what they allow |
| **Auth beyond transport** | MCP ties auth to the transport layer. Local dev, CLI execution, and multi-runtime portability suffer |
| **Composability** | No way to declare action pipelines as DAGs with dependency resolution and budget propagation |
| **State & checkpointing** | No resumable execution, no crash recovery, no context sharing across action invocations |
| **Cost controls** | No resource budgets — token limits, cost caps, latency bounds — as first-class primitives |
| **Observability** | No trace context propagation built into the action model itself |

AAP sits **above** transport protocols. MCP is a valid execution backend — so are function calling, REST, and CLI. AAP defines the *what*. Transport protocols define the *how*.

```
+-------------------------------------------+
|              Registry                      |  Discovery, versioning, trust
+-------------------------------------------+
|            Composition                     |  Actions that orchestrate actions
+-----------+-------------------------------+
|  Hooks    |  Contract                      |  Lifecycle | I/O guarantees
+-----------+-------------------------------+
|  State    |  Permissions                   |  Checkpoints | Capability + role
+-----------+-------------------------------+
|  Auth     |  Trace                         |  Identity | Observability
+-----------+-------------------------------+
|              Action                        |  The atomic unit
+-------------------------------------------+
|    MCP / Function Calling / REST / CLI     |  Transport (not AAP's concern)
+-------------------------------------------+
```

## What AAP Is

AAP is the **package.json for agent actions**. It's a declarative specification that defines the full lifecycle of an agent taking action in the world — from discovery and authorization through execution, observation, and recovery.

An AAP action is a YAML manifest. Not code, not a prompt, not an API endpoint. It describes *what* a capability does, *what* it needs, *what* it produces, *what* it's allowed to touch, and *how much* it can cost. Any runtime that understands AAP can execute it.

## The Eight Primitives

| Primitive | What It Does |
|-----------|-------------|
| **Action** | The atomic unit of agent capability. A declarative manifest defining inputs, outputs, permissions, resources, and execution type. |
| **Contract** | Typed I/O schema with invariants and resource limits. Enables static validation before execution. |
| **Hooks** | Lifecycle interceptors — auth injection, human review gates, cost guards, observability, error recovery. Eight built-in types. |
| **Permissions** | Capability-based dual model. Actions declare what they need. Runtimes assign roles that grant or deny. Deny by default. |
| **Auth** | Pluggable auth providers injected by hooks at execution time. OAuth2, API keys, ambient credentials, mTLS. Auth is a hook concern, not a transport concern. |
| **State** | Checkpointing and context persistence. Resumable execution, crash recovery, context sharing across compositions. |
| **Trace** | W3C Trace Context semantics extended for action compositions. Every execution produces a trace. OTLP export built in. |
| **Composition** | Declarative DAGs of actions with dependency resolution, parallel execution, and budget propagation. |

Plus a **Registry** for discovery, versioning, signatures, attestation, and dependency auditing.

## A Note on Authorship

I'm probably not the right person to create this standard. I don't work at an AI lab or a standards body. But I've been building agent systems in production, and I keep hitting the same walls — no standard way to define actions, no lifecycle management, no composability, no cost controls.

I haven't seen anyone else attack this problem at this layer, so I'm giving it a first pass.

This spec **will** need significant changes. It needs input from runtime implementors (Anthropic, OpenAI, Vercel, LangChain, and others), from infrastructure teams running agents in production, and from the MCP community whose work AAP builds on top of. The current draft is a starting point, not a destination.

If this resonates, I'd rather have ten people tell me what's wrong with it than build it alone.

## Values

These are the principles AAP is designed around:

1. **Declarative over imperative.** Actions describe *what*, not *how*.
2. **Portable by default.** No action should be locked to a single runtime.
3. **Transport-agnostic.** MCP, function calling, REST, CLI — all valid backends.
4. **Trust is non-negotiable.** Signed, attested, auditable. Permissions visible before install.
5. **Cost-aware.** Resource budgets are first-class. Agents don't get blank checks.
6. **Fail safely.** Checkpoint, resume, compensate. The real world doesn't have undo.
7. **Composable at every layer.** Actions, hooks, contracts, auth — all reusable units.
8. **Observable by default.** Every execution produces a trace. No opt-in required.
9. **Auth is a hook, not a transport concern.** Credentials are injected, never hardcoded.
10. **Convention over configuration.** Sensible defaults. Zero config for simple actions.

## Repo Structure

```
spec/
  aap-spec.md              # The full specification (draft v0.1)

packages/
  openclaw-adapter/         # Reusable AAP adapter for OpenClaw runtimes
    src/                    #   Manifest loader, contract validator, context injector
    handler.ts              #   Example: OTel logger wrapped with the adapter

examples/
  openclaw-otel-logger/     # Reference implementation: AAP + OpenClaw + OpenTelemetry
    action.aap.yaml         #   AAP Action manifest
    contract.aap.yaml       #   AAP Contract definition
    hooks.aap.yaml          #   Six AAP observe hooks
    handler.ts              #   Standalone OTel hook handler
```

## Read the Spec

The full specification is at [`spec/aap-spec.md`](spec/aap-spec.md). It covers all eight primitives, execution types (runtime, MCP, CLI, HTTP), composition, the registry model, and includes pseudocode for Claude and CLI runtime adapters.

## Quick Example

An AAP action manifest:

```yaml
aap: 0.1.0
kind: Action

metadata:
  name: summarize-document
  version: 1.2.0
  author: acme-corp
  runtime_compatibility:
    - claude@4.*
    - openai@gpt-4*

inputs:
  depth:
    type: enum
    values: [executive, detailed, comprehensive]
    default: executive

outputs:
  summary:
    type: string
  confidence:
    type: float
    range: [0, 1]

permissions:
  capabilities:
    - file:read

resources:
  max_tokens: 4096
  max_cost_usd: 0.05

hooks:
  before_execute: validate-document-format
  on_approval: human-review-gate
  on_error: fallback-to-simple-summary
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This is early-stage — all feedback is welcome, nothing is sacred.

## License

[MIT](LICENSE)
