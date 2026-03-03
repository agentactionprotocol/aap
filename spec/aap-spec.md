# AAP: Agent Action Protocol

### A portable, composable specification for AI agents taking action in the world.

> **Status:** Draft v0.1  
> **Date:** March 2026  
> **License:** Apache 2.0

---

## Why This Exists

AI agents are taking real actions — creating tickets, sending emails, deploying code, moving money. The infrastructure beneath them is fragmented and inadequate.

MCP solved tool-calling transport. It did not solve what an action *is*, how actions compose, how they're authorized, how they checkpoint, how they roll back, or how they're observed across runtimes. The industry is stretching MCP beyond its design because nothing better exists.

AAP is the missing layer. It sits **above** transport protocols (MCP, function calling, REST, CLI) and defines the full lifecycle of an agent taking action in the world.

| Layer | Analogy | AI Equivalent |
|-------|---------|---------------|
| Action format | `package.json` | **AAP ← this spec** |
| Action registry | npm | AAP Registry |
| Runtime | Node.js | Claude, Codex, GPT, etc. |
| Transport | HTTP | MCP, function calling, CLI, etc. |

AAP does not replace MCP. MCP is a valid transport backend. AAP defines the *what*. MCP, function calling, and CLI define the *how*.

---

## Core Primitives

AAP defines **eight** primitives:

```
┌─────────────────────────────────────────┐
│              Registry                   │  Discovery, versioning, trust
├─────────────────────────────────────────┤
│            Composition                  │  Actions that orchestrate actions
├──────────┬──────────────────────────────┤
│  Hooks   │  Contract                    │  Lifecycle │ I/O guarantees
├──────────┼──────────────────────────────┤
│  State   │  Permissions                 │  Checkpoints │ Capability + role
├──────────┼──────────────────────────────┤
│  Auth    │  Trace                       │  Identity │ Observability
├──────────┴──────────────────────────────┤
│              Action                     │  The atomic unit
└─────────────────────────────────────────┘
```

---

## 1. Action

The atomic unit of agent capability. An action is a **declarative definition** — not code, not a prompt, not an API endpoint. It describes *what* a capability does, *what* it needs, *what* it produces, *what* it's allowed to touch, and *how much* it can cost.

### Action Manifest (`action.aap.yaml`)

```yaml
aap: 0.1.0
kind: Action

metadata:
  name: summarize-document
  version: 1.2.0
  author: acme-corp
  license: MIT
  description: >
    Summarizes any document into structured output
    with configurable depth and audience targeting.
  tags: [nlp, summarization, documents]
  runtime_compatibility:
    - claude@4.*
    - openai@gpt-4*
    - vercel-ai-sdk@3.*
    - cli@*

context:
  required:
    - type: document
      formats: [pdf, md, txt, docx]
      max_size: 50MB
  optional:
    - type: conversation_history
      max_turns: 10
    - type: runtime_context
      description: >
        Live agent runtime environment — session metadata, gateway config,
        channel info. Provided automatically by the runtime; not user-supplied.
        Used primarily by observe hooks for span enrichment.

inputs:
  depth:
    type: enum
    values: [executive, detailed, comprehensive]
    default: executive
    description: Level of detail in the summary
  audience:
    type: string
    default: "general"
    description: Target audience for tone calibration
  max_length:
    type: integer
    default: 500
    unit: words

outputs:
  summary:
    type: string
    description: The generated summary
  key_points:
    type: array
    items: string
    description: Extracted key points
  confidence:
    type: float
    range: [0, 1]
    description: Model confidence in summary quality

execution:
  type: runtime  # runtime | mcp | cli
  # See §8 Execution Types for full options

permissions:
  capabilities:
    - file:read
  roles: []

resources:
  max_tokens: 4096
  max_latency_ms: 30000
  max_cost_usd: 0.05

hooks:
  before_execute: validate-document-format
  after_execute: log-to-analytics
  on_error: fallback-to-simple-summary
  on_approval: human-review-gate

state:
  checkpoint: true
  context_keys: [document_hash, last_summary_version]
```

### Context Types

The `context` block declares what ambient data an action may read. Context is distinct from `inputs` — it is not passed by the caller, it is resolved by the runtime from the execution environment.

| Type | Provided By | Description |
|------|-------------|-------------|
| `document` | User/caller | Files, PDFs, markdown, docs |
| `conversation_history` | Runtime | Prior turns in the agent session |
| `runtime_context` | Runtime | Session metadata, gateway config, channel, model — primarily used by `observe` hooks for span enrichment |
| `secret` | Secret store | Credentials resolved via AuthProvider — never user-supplied |
| `composition_context` | Composition engine | Outputs from upstream actions in a composition |

**`runtime_context` fields** (populated by the runtime when available):

```yaml
context:
  optional:
    - type: runtime_context
      fields:
        session_key: string       # Active session identifier
        channel: string           # Delivery channel (cli, whatsapp, slack, etc.)
        model: string             # Model currently executing
        gateway_config: object    # Runtime gateway configuration
        workspace: string         # Working directory or project root
```

`required: []` is valid for actions that operate solely on inputs (e.g., pure observers, transformers). Runtimes MUST NOT fail if optional context types are unavailable — they silently omit the fields.

---

### What This Gets You

- **Any runtime** can read this manifest and execute the action using its native capabilities
- **No vendor lock-in** — the action definition is portable
- **Composable** — other actions can depend on `summarize-document@1.2.0`
- **Testable** — inputs and outputs are fully typed contracts
- **Cost-bounded** — resource limits enforced before execution
- **Permission-scoped** — capabilities declared, runtime grants or denies
- **Observable** — trace context propagated automatically
- **Resumable** — checkpointing enables recovery from interruption

---

## 2. Contract

A contract defines the **interface guarantee** between an action and its consumers. Strongly typed, version-bound, validatable, with resource constraints.

```yaml
aap: 0.1.0
kind: Contract

for: summarize-document@1.2.0

input_schema:
  type: object
  required: [depth]
  properties:
    depth:
      type: string
      enum: [executive, detailed, comprehensive]
    audience:
      type: string
    max_length:
      type: integer
      minimum: 50
      maximum: 10000

output_schema:
  type: object
  required: [summary, key_points, confidence]
  properties:
    summary:
      type: string
      minLength: 1
    key_points:
      type: array
      items:
        type: string
      minItems: 1
    confidence:
      type: number
      minimum: 0
      maximum: 1

invariants:
  - output.summary.word_count <= input.max_length
  - output.key_points.length >= 1
  - output.confidence >= 0.0

resource_limits:
  max_tokens: 4096
  max_latency_ms: 30000
  max_cost_usd: 0.05
  max_retries: 3
```

Contracts enable **static validation before execution**. A runtime can verify that an action composition is valid — including resource budgets — without running anything.

---

## 3. Hooks

Hooks are **lifecycle interceptors** that fire at defined points during action execution. They enable orchestration, observability, human-in-the-loop patterns, error recovery, auth injection, and policy enforcement — without polluting the action definition.

Hooks are inspired by the [MCP Interceptors proposal](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1763), elevated to a first-class primitive with a defined schema.

```
  ┌──────────┐
  │ Trigger  │
  └────┬─────┘
       │
  ┌────▼─────┐    ┌─────────────┐
  │ before   │───▶│  Validation  │──── abort?
  └────┬─────┘    │  Auth inject │
       │          │  Rate limit  │
       │          └─────────────┘
  ┌────▼─────┐
  │ execute  │    (the action runs)
  └────┬─────┘
       │
  ┌────▼─────┐    ┌─────────────┐
  │on_approval│──▶│ Human Gate   │──── reject?
  └────┬─────┘    └─────────────┘
       │
  ┌────▼─────┐    ┌─────────────┐
  │  after   │───▶│  Logging     │
  └────┬─────┘    │  Transform   │
       │          │  Checkpoint  │
       │          └─────────────┘
  ┌────▼─────┐
  │  Done    │
  └──────────┘
       │
  (on failure at any stage)
       │
  ┌────▼─────┐
  │ on_error │───▶ Retry / Fallback / Compensate / Alert
  └──────────┘
```

### Hook Definition

```yaml
aap: 0.1.0
kind: Hook

metadata:
  name: human-review-gate
  version: 1.0.0
  type: approval

trigger:
  event: on_approval
  condition: output.confidence < 0.8

action:
  type: human_in_the_loop
  config:
    channel: slack
    reviewers: ["@content-team"]
    timeout: 30m
    on_timeout: reject

  approve:
    action: continue
  reject:
    action: fallback
    fallback_action: summarize-document-simple@1.0.0
```

### Hook for Auth Injection

```yaml
aap: 0.1.0
kind: Hook

metadata:
  name: inject-oauth-token
  version: 1.0.0
  type: auth

trigger:
  event: before_execute
  condition: action.auth_provider != null

action:
  type: auth_inject
  config:
    provider: $action.auth_provider
    strategy: oauth2_refresh
    token_placement: header
    header_name: Authorization
    header_format: "Bearer {token}"
    on_failure: abort
```

### Hook for Cost Enforcement

```yaml
aap: 0.1.0
kind: Hook

metadata:
  name: cost-guard
  version: 1.0.0
  type: guard

trigger:
  event: before_execute
  condition: always

action:
  type: resource_check
  config:
    check: estimated_cost <= action.resources.max_cost_usd
    on_exceed: abort
    message: "Estimated cost ${estimated_cost} exceeds limit ${action.resources.max_cost_usd}"
```

### Built-in Hook Types

| Type | Purpose | Example |
|------|---------|---------|
| `validation` | Pre-flight checks | Input format, schema validation |
| `auth` | Credential injection | OAuth refresh, API key rotation, ambient creds |
| `transform` | Mutate input or output | PII redaction, format conversion |
| `approval` | Human-in-the-loop gate | Review before publish |
| `observe` | Logging, metrics, audit | Analytics, compliance trail, OTel tracing |
| `error` | Failure handling | Retry, fallback, compensate, alert |
| `guard` | Safety/policy enforcement | Content filtering, cost caps, rate limits |
| `state` | Checkpoint management | Save/restore execution state |

---

### Hook: `observe`

The `observe` hook type is a **read-only lifecycle interceptor** for observability. It fires at any lifecycle event, captures span data, and exports to any OTLP-compatible backend. It MUST NOT mutate inputs, outputs, or execution state — side effects are limited to external trace/metric systems.

```yaml
aap: 0.1.0
kind: Hook

metadata:
  name: otel-trace-tool-execution
  version: 1.0.0
  type: observe

trigger:
  event: after_execute
  condition: event.type == "tool_result"

action:
  type: observe
  config:
    # Span name. Supports template interpolation from event fields.
    span_name: "openclaw.tool.${event.toolName}"

    # OTel span status. Defaults to OK. Set ERROR for error hooks.
    span_status: OK  # OK | ERROR | UNSET

    # Static and dynamic attributes attached to every span.
    attributes:
      aap.hook.type: observe
      openclaw.tool.name: "${event.toolName}"
      openclaw.tool.status: "${event.exitCode}"
      openclaw.session.key: "${event.sessionKey}"

    # Fields from the event payload to capture as span attributes or events.
    # Use dot notation to reference nested fields.
    capture:
      - event.duration_ms
      - event.exitCode
      - event.stderr      # capture conditionally using log_level in the action config

    # OTLP export target. Defaults to runtime trace config if omitted.
    export:
      endpoint: "${env.OTEL_EXPORTER_OTLP_ENDPOINT}"
      protocol: http  # http | grpc
```

#### Observe Hook Constraints

Runtimes MUST enforce these constraints on `observe` hooks:

- **No mutation.** `observe` hooks cannot modify `inputs`, `outputs`, or `context`. Any attempt to write these fields MUST be rejected at runtime.
- **Non-blocking.** Observe hooks run asynchronously by default. A failed observe hook MUST NOT abort or fail the parent action.
- **Sampling-aware.** Observe hooks SHOULD respect `sample_rate` if defined on the parent action or runtime config.
- **Always fires on error.** Observe hooks with `trigger.event: on_error` fire regardless of log level — errors are always observable.

#### Observe Hook with Log Level Gating

Actions can expose a `log_level` input that observe hooks reference to control verbosity:

```yaml
# In action.aap.yaml inputs:
log_level:
  type: enum
  values: [minimal, standard, verbose]
  default: standard

# Observe hooks reference it via condition:
trigger:
  event: after_execute
  condition: event.type == "tool_result" and inputs.log_level in ["standard", "verbose"]
```

| Log Level | What fires |
|-----------|-----------|
| `minimal` | Commands, session lifecycle, errors |
| `standard` | + tool executions, bootstrap, tool persistence |
| `verbose` | + token usage, model selection, stderr, context mutations |

#### Standard Observe Span Attributes

All `observe` spans SHOULD include these attributes in addition to action-level trace attributes (§7):

| Attribute | Source | Description |
|-----------|--------|-------------|
| `aap.hook.type` | always `observe` | Identifies the hook primitive type |
| `aap.spec.version` | runtime | AAP spec version |
| `openclaw.session.key` | `event.sessionKey` | Agent session identifier |
| `openclaw.channel` | `event.channel` | Delivery channel (whatsapp, slack, cli, etc.) |
| `openclaw.event.timestamp` | `event.timestamp` | ISO timestamp of the originating event |

#### Reference Implementation

The canonical `observe` hook implementation is `openclaw-otel-logger`, which:

- Defines six `observe` hooks covering all OpenClaw lifecycle events
- Exports W3C Trace Context spans via OTLP HTTP to any collector
- Demonstrates log level gating, error-always semantics, and span templating
- Serves as the reference for any runtime implementing AAP observe hooks

See [`examples/openclaw-otel-logger`](https://github.com/agentactionprotocol/aap-spec/tree/main/examples/openclaw-otel-logger) for the full implementation.

---

## 4. Permissions

Actions declare **capabilities** they require. Runtimes assign **roles** that grant or deny those capabilities. This is a dual model: actions say what they need, operators say what they're allowed to have.

### Capability Declarations (Action-Side)

Capabilities are declared in the action manifest under `permissions.capabilities`. They follow a `resource:operation` format.

```yaml
permissions:
  capabilities:
    - file:read
    - file:write
    - network:outbound
    - network:outbound:*.slack.com    # scoped to domain
    - exec:subprocess                  # can spawn child processes
    - secret:read:OPENAI_API_KEY       # specific secret access
    - mcp:atlassian:create_issue       # specific MCP tool access
  roles: []                            # assigned by runtime, not by action
```

### Standard Capability Taxonomy

| Namespace | Operations | Description |
|-----------|-----------|-------------|
| `file` | `read`, `write`, `delete`, `list` | Filesystem access |
| `network` | `outbound`, `inbound`, `listen` | Network operations (scopeable to domains) |
| `exec` | `subprocess`, `shell`, `eval` | Code/process execution |
| `secret` | `read`, `list` | Secret/credential access (scopeable to key names) |
| `mcp` | `{server}:{tool}` | MCP tool invocation |
| `env` | `read`, `write` | Environment variable access |
| `human` | `prompt`, `approve` | Human interaction |
| `cost` | `incur:{max_usd}` | Monetary cost authorization |

### Role Assignments (Runtime/Operator-Side)

Roles are defined in runtime configuration, not in action manifests. An action never grants itself permissions.

```yaml
# runtime-config.aap.yaml
aap: 0.1.0
kind: RuntimeConfig

roles:
  reader:
    capabilities:
      - file:read
      - network:outbound:*.internal.com
      - secret:read:INTERNAL_API_KEY

  writer:
    extends: reader
    capabilities:
      - file:write
      - mcp:atlassian:*
      - cost:incur:0.50

  admin:
    extends: writer
    capabilities:
      - exec:subprocess
      - secret:read:*
      - network:outbound:*
      - cost:incur:10.00

action_roles:
  summarize-document@1.*: reader
  create-jira-ticket@1.*: writer
  deploy-service@1.*: admin
```

### Permission Resolution

```
Action declares:    capabilities: [file:read, network:outbound:*.slack.com]
Runtime assigns:    role: reader → grants [file:read, network:outbound:*.internal.com]

Resolution:
  file:read             → GRANTED (exact match)
  network:outbound:*.slack.com → DENIED (role only grants *.internal.com)

Result: Execution blocked. Runtime returns PermissionDenied error with specifics.
```

Runtimes MUST deny by default. Undeclared capabilities are never available.

---

## 5. Auth Provider

Auth is not embedded in the action. Auth is a **pluggable primitive** that hooks inject at execution time. This keeps action definitions portable while allowing operators to manage credentials their way.

### AuthProvider Definition

```yaml
aap: 0.1.0
kind: AuthProvider

metadata:
  name: github-oauth
  version: 1.0.0

strategy: oauth2

config:
  grant_type: authorization_code
  auth_url: https://github.com/login/oauth/authorize
  token_url: https://github.com/login/oauth/access_token
  scopes: [repo, read:org]
  refresh: true
  token_ttl: 3600

  # Where to place the resolved credential
  injection:
    type: header
    name: Authorization
    format: "Bearer {access_token}"

  # Fallback if refresh fails
  on_failure:
    action: abort
    message: "GitHub OAuth token refresh failed"
```

### Supported Strategies

| Strategy | Description | TLS Required? |
|----------|------------|--------------|
| `oauth2` | Full OAuth2 flow (auth code, client creds, refresh) | Yes for token exchange |
| `api_key` | Static key injection from secret store | No |
| `ambient` | Inherited from runtime environment (e.g., GCP metadata, AWS IAM) | No |
| `mtls` | Mutual TLS client certificate | N/A (is TLS) |
| `hook` | Delegated entirely to a custom hook | Depends on hook |

### Why This Matters

MCP currently requires TLS termination and hands auth to the transport layer. This creates friction for local development, CLI execution, and lightweight integrations.

AAP's model: **auth is a hook concern, not a transport concern**. A `before_execute` hook resolves credentials via the configured AuthProvider strategy and injects them into the execution context. The action itself never sees raw credentials. The transport layer (MCP, HTTP, CLI) receives pre-authenticated requests.

```
Action needs auth → before_execute hook fires → AuthProvider resolves credential
  → credential injected into execution context → transport sends authenticated request
```

This means:
- Local CLI execution can use `ambient` or `api_key` with no TLS
- Cloud execution can use `oauth2` with full refresh flows
- Same action definition works in both contexts

---

## 6. State

Actions that interact with the real world need **checkpointing** and **context persistence**. State enables resumable execution, crash recovery, and context sharing across action invocations within a composition.

### State Model

AAP's state model is intentionally lightweight: checkpoints and context. No distributed transactions, no saga orchestration (those belong in a future version or runtime-specific extensions).

```yaml
aap: 0.1.0
kind: Action

metadata:
  name: multi-step-migration
  version: 1.0.0

state:
  # Enable automatic checkpointing
  checkpoint: true
  checkpoint_strategy: after_each_step  # after_each_step | on_completion | manual

  # Named context keys persisted across invocations
  context_keys:
    - migration_batch_id
    - last_processed_index
    - error_log

  # TTL for persisted state
  ttl: 24h

  # What to do if resumed from checkpoint
  on_resume: continue_from_last  # continue_from_last | restart | ask_human
```

### Checkpoint Schema

Runtimes persist checkpoints in a standard format:

```json
{
  "aap_version": "0.1.0",
  "action": "multi-step-migration@1.0.0",
  "composition": "quarterly-migration@1.0.0",
  "checkpoint_id": "chk_a1b2c3d4",
  "created_at": "2026-03-01T12:34:56Z",
  "step": "process-batch",
  "step_index": 3,
  "status": "interrupted",
  "context": {
    "migration_batch_id": "batch_xyz",
    "last_processed_index": 247,
    "error_log": []
  },
  "inputs_snapshot": { "...": "..." },
  "partial_outputs": { "...": "..." },
  "trace_id": "tr_e5f6g7h8",
  "ttl_expires": "2026-03-02T12:34:56Z"
}
```

### State Hooks

```yaml
aap: 0.1.0
kind: Hook

metadata:
  name: auto-checkpoint
  version: 1.0.0
  type: state

trigger:
  event: after_execute
  condition: action.state.checkpoint == true

action:
  type: checkpoint_save
  config:
    storage: runtime_default  # runtime_default | s3 | redis | filesystem
    include_outputs: true
    include_trace: true
```

### Resume Flow

```
Runtime detects incomplete execution
  → Loads latest checkpoint for (action, composition, trace_id)
  → Checks on_resume policy
  → Restores context + partial outputs
  → Re-enters execution at checkpoint step
  → Continues with fresh trace span linked to original trace_id
```

---

## 7. Trace

Every action execution carries a **trace context** for end-to-end observability. AAP adopts [W3C Trace Context](https://www.w3.org/TR/trace-context/) semantics, extended for action compositions.

### Trace Propagation

```
Composition: research-and-brief
  trace_id: tr_a1b2c3d4

  ├─ span: search          (span_id: sp_1111, parent: root)
  │   ├─ span: mcp_call    (span_id: sp_1112, parent: sp_1111)
  │   └─ span: hook:after  (span_id: sp_1113, parent: sp_1111)
  │
  ├─ span: analyze         (span_id: sp_2222, parent: root)
  │   └─ span: hook:guard  (span_id: sp_2223, parent: sp_2222)
  │
  ├─ span: summarize       (span_id: sp_3333, parent: root)
  │   ├─ span: runtime_exec (span_id: sp_3334, parent: sp_3333)
  │   └─ span: hook:approval (span_id: sp_3335, parent: sp_3333)
  │
  └─ span: format          (span_id: sp_4444, parent: root)
```

### Trace Context Object

Every hook, action, and composition receives a `trace` in its execution context:

```json
{
  "trace_id": "tr_a1b2c3d4",
  "span_id": "sp_3333",
  "parent_span_id": "root",
  "action": "summarize-document@1.2.0",
  "composition": "research-and-brief@1.0.0",
  "started_at": "2026-03-01T12:34:56.789Z",
  "attributes": {
    "aap.action.name": "summarize-document",
    "aap.action.version": "1.2.0",
    "aap.runtime": "claude@4.5",
    "aap.execution.type": "runtime",
    "aap.resources.tokens_used": 1847,
    "aap.resources.cost_usd": 0.012,
    "aap.resources.latency_ms": 2340
  }
}
```

### Standard Trace Attributes

| Attribute | Description |
|-----------|------------|
| `aap.action.name` | Action name |
| `aap.action.version` | Action version |
| `aap.runtime` | Executing runtime and version |
| `aap.execution.type` | `runtime`, `mcp`, `cli` |
| `aap.composition.name` | Parent composition (if any) |
| `aap.hook.type` | Hook type (if trace is from a hook) |
| `aap.permissions.role` | Assigned role |
| `aap.permissions.denied` | Any denied capabilities |
| `aap.resources.tokens_used` | Tokens consumed |
| `aap.resources.cost_usd` | Monetary cost incurred |
| `aap.resources.latency_ms` | Wall clock time |
| `aap.state.checkpoint_id` | Active checkpoint (if any) |
| `aap.state.resumed` | Whether execution was resumed |
| `aap.auth.strategy` | Auth strategy used |
| `aap.auth.provider` | AuthProvider name |

### Exporting Traces

Runtimes SHOULD support exporting traces in [OTLP](https://opentelemetry.io/docs/specs/otlp/) format. This enables direct integration with Jaeger, Datadog, Honeycomb, Grafana Tempo, etc.

```yaml
# runtime-config.aap.yaml (partial)
trace:
  export:
    format: otlp
    endpoint: https://otel-collector.internal:4318
    headers:
      Authorization: "Bearer ${OTEL_TOKEN}"
  sampling:
    strategy: always_on  # always_on | probabilistic | rate_limited
    rate: 1.0
```

---

## 8. Execution Types

AAP is transport-agnostic. An action's `execution` block declares *how* it should be invoked. Runtimes use this to dispatch appropriately.

### Runtime Execution (Default)

The action is executed natively by the AI runtime. The runtime interprets the action manifest, builds the appropriate prompt/tool calls, and produces output conforming to the contract.

```yaml
execution:
  type: runtime
```

No additional configuration needed. The runtime uses `metadata.runtime_compatibility` to determine model selection.

### MCP Execution

The action delegates to an MCP server. AAP wraps MCP with its full lifecycle (hooks, permissions, state, trace).

```yaml
execution:
  type: mcp
  server: https://mcp.atlassian.com/v1/mcp
  tool: create_issue
  
  # Optional: map AAP inputs to MCP tool parameters
  input_mapping:
    project: $inputs.project_key
    summary: $inputs.title
    description: $inputs.body
    priority: 
      name: $inputs.priority

  # Optional: map MCP response to AAP outputs
  output_mapping:
    issue_key: $.key
    url: $.self
```

### CLI Execution

The action is executed as a local command-line process. This enables integration with existing tooling, scripts, and non-AI systems.

```yaml
execution:
  type: cli
  command: python
  args: ["./scripts/summarize.py", "--depth", "$inputs.depth"]
  
  # I/O contract for CLI
  stdin: 
    format: json  # json | text | binary
    source: $context.document
  stdout:
    format: json
    mapping:
      summary: $.result.summary
      key_points: $.result.key_points
      confidence: $.result.score
  stderr:
    capture: true
    on_output: log  # log | warn | error
  
  # Exit code semantics
  exit_codes:
    0: success
    1: error
    2: retry
    3: human_review_needed

  # Environment
  env:
    MODEL_NAME: "$runtime.model"
    API_KEY: "$secrets.OPENAI_API_KEY"  # resolved via AuthProvider/Permissions
  
  # Process constraints
  timeout_ms: 60000
  working_dir: ./
  
  # Resource isolation
  sandbox: true  # runtime should sandbox if possible
```

### HTTP Execution

Direct HTTP call to an external API without MCP wrapping.

```yaml
execution:
  type: http
  method: POST
  url: https://api.example.com/v1/summarize
  
  headers:
    Content-Type: application/json
    # Auth injected by hook, not hardcoded
  
  body:
    format: json
    mapping:
      text: $inputs.document_text
      options:
        length: $inputs.max_length
  
  response:
    format: json
    output_mapping:
      summary: $.data.summary
      key_points: $.data.highlights
      confidence: $.data.confidence_score
  
  # HTTP-specific
  retry:
    on: [429, 500, 502, 503]
    max_attempts: 3
    backoff: exponential
    base_delay_ms: 1000
```

---

## 9. Composition

Actions can depend on and orchestrate other actions. Composition is **declarative** — you define the DAG, the runtime resolves execution order, parallelism, and resource budgets.

### Compose Manifest (`compose.aap.yaml`)

```yaml
aap: 0.1.0
kind: Composition

metadata:
  name: research-and-brief
  version: 1.0.0
  description: >
    End-to-end research pipeline: search, analyze, summarize, format.

# Composition-level resource budget
resources:
  max_total_cost_usd: 0.50
  max_total_latency_ms: 120000
  max_total_tokens: 20000

# Composition-level permissions (union of all action permissions)
permissions:
  role: writer

actions:
  search:
    ref: web-search@2.1.0
    inputs:
      query: $trigger.query
      max_results: 10

  analyze:
    ref: analyze-sources@1.3.0
    depends_on: [search]
    inputs:
      sources: $search.outputs.results
      focus: $trigger.focus_area

  summarize:
    ref: summarize-document@1.2.0
    depends_on: [analyze]
    inputs:
      context: $analyze.outputs.analysis
      depth: executive
      audience: $trigger.audience

  format:
    ref: format-brief@1.0.0
    depends_on: [summarize]
    inputs:
      content: $summarize.outputs.summary
      key_points: $summarize.outputs.key_points
      template: $trigger.template

hooks:
  before_execute: validate-research-scope
  after_execute: cache-result
  on_error: notify-ops

state:
  checkpoint: true
  checkpoint_strategy: after_each_step
  on_resume: continue_from_last

outputs:
  brief: $format.outputs.document
  sources: $search.outputs.results
  confidence: $summarize.outputs.confidence
```

### Execution DAG

```
trigger
  │
  ▼
search ──▶ analyze ──▶ summarize ──▶ format ──▶ output
```

### Parallel Execution

Parallel execution is automatic when dependencies allow:

```yaml
actions:
  search_web:
    ref: web-search@2.1.0
    inputs: { query: $trigger.query }

  search_internal:
    ref: internal-search@1.0.0
    inputs: { query: $trigger.query }

  merge:
    ref: merge-results@1.0.0
    depends_on: [search_web, search_internal]
    inputs:
      web: $search_web.outputs.results
      internal: $search_internal.outputs.results
```

```
          ┌── search_web ────┐
trigger ──┤                  ├──▶ merge ──▶ output
          └── search_internal┘
```

### Resource Budget Propagation

Composition-level budgets are split across actions. Runtimes MUST track cumulative usage and abort if composition-level limits are exceeded.

```
Composition budget: $0.50, 20k tokens
  search:      $0.02 used,  1.2k tokens  → remaining: $0.48, 18.8k tokens
  analyze:     $0.08 used,  3.1k tokens  → remaining: $0.40, 15.7k tokens
  summarize:   $0.03 used,  1.8k tokens  → remaining: $0.37, 13.9k tokens
  format:      $0.01 used,  0.4k tokens  → remaining: $0.36, 13.5k tokens
  TOTAL:       $0.14 used,  6.5k tokens  ✓ within budget
```

---

## 10. Registry

A registry provides **discovery, versioning, trust, and distribution** for actions.

### Registry Operations

```bash
aap publish                       # Publish an action to registry
aap install acme/summarize@1.2    # Install an action
aap search "summarization"        # Discover actions
aap verify acme/summarize@1.2     # Verify signature + attestation
aap audit                         # List dependencies + vulnerabilities
```

### Registry Entry

```yaml
name: acme/summarize-document
version: 1.2.0
published: 2026-03-01T00:00:00Z
checksum: sha256:a1b2c3d4...
signature: acme-corp.sig

attestation:
  tested_on: [claude-4, gpt-4o, vercel-ai-sdk-3]
  test_results: https://registry.aap.dev/acme/summarize/1.2.0/tests
  coverage: 94%

permissions_required:
  capabilities: [file:read]
  min_role: reader

downloads: 12430

dependencies:
  - validate-document-format@1.0.0
  - log-to-analytics@2.1.0

deprecation:
  superseded_by: null
  eol_date: null
  migration_guide: null
```

### Trust Model

Actions are **signed and attested**. The registry enforces:

- **Author verification** — cryptographic identity (GPG or Sigstore)
- **Runtime attestation** — tested on which runtimes, with results
- **Dependency audit** — transitive dependency scanning
- **Permission review** — capabilities are visible before install
- **Deprecation policy** — semver-enforced breaking change notifications
- **Migration guides** — required for major version bumps

### Versioning and Migration

Major version bumps MUST include a migration section:

```yaml
name: acme/summarize-document
version: 2.0.0

migration:
  from: 1.*
  breaking_changes:
    - "input 'depth' renamed to 'detail_level'"
    - "output 'key_points' now returns objects instead of strings"
  
  # Optional: automated migration hook
  migrate_hook: acme/summarize-v1-to-v2-migrator@1.0.0
  
  # Compatibility shim (allows v1 consumers to use v2)
  shim:
    ref: acme/summarize-v1-compat@1.0.0
    ttl: 6m  # shim supported for 6 months
```

---

## Runtime Adapters

AAP doesn't execute anything. Runtimes do. An adapter translates AAP manifests into native execution, enforces permissions, manages state, propagates traces, and runs hooks.

### Pseudocode: Claude Adapter

```python
class ClaudeAdapter(AAPRuntime):
    """Translates AAP actions into Claude-native execution."""

    def execute(self, action: AAPAction, inputs: dict, trace: TraceContext) -> AAPOutput:
        # 0. Check permissions
        granted = self.resolve_permissions(action.permissions, self.config.roles)
        if not granted.all_satisfied:
            return AAPOutput(error=PermissionDenied(granted.denied))

        # 1. Check resource budget
        if not self.budget.can_afford(action.resources):
            return AAPOutput(error=ResourceExceeded(action.resources))

        # 2. Restore state if resuming
        checkpoint = None
        if action.state.checkpoint:
            checkpoint = self.state_store.load(action, trace.trace_id)
            if checkpoint and action.state.on_resume == "continue_from_last":
                inputs = checkpoint.restore(inputs)

        # 3. Run before hooks (incl. auth injection)
        span = trace.start_span("hooks:before")
        for hook in action.hooks.get("before_execute", []):
            result = self.run_hook(hook, inputs, trace=span)
            if result.abort:
                return AAPOutput(error=result.reason)
        span.end()

        # 4. Build Claude-native request
        system_prompt = self.build_system_prompt(action)
        messages = self.build_messages(action, inputs)
        tools = self.map_to_claude_tools(action.dependencies)

        # 5. Execute via Claude API
        span = trace.start_span("runtime:execute")
        response = claude.messages.create(
            model=action.metadata.runtime_compatibility.best_match("claude"),
            system=system_prompt,
            messages=messages,
            tools=tools
        )
        span.set_attributes({
            "aap.resources.tokens_used": response.usage.total_tokens,
            "aap.resources.cost_usd": self.calculate_cost(response.usage)
        })
        span.end()

        # 6. Update budget
        self.budget.record(response.usage)

        # 7. Parse output against contract
        output = self.parse_output(response, action.contract)

        # 8. Run approval hooks if defined
        if action.hooks.get("on_approval"):
            span = trace.start_span("hooks:approval")
            approval = self.run_approval_gate(action, output, trace=span)
            if not approval.approved:
                return self.handle_rejection(action, approval)
            span.end()

        # 9. Checkpoint if enabled
        if action.state.checkpoint:
            self.state_store.save(action, trace.trace_id, inputs, output)

        # 10. Run after hooks
        span = trace.start_span("hooks:after")
        for hook in action.hooks.get("after_execute", []):
            output = self.run_hook(hook, output, trace=span)
        span.end()

        # 11. Validate output against contract invariants
        self.validate_contract(action.contract, inputs, output)

        return output
```

### Pseudocode: CLI Adapter

```python
class CLIAdapter(AAPRuntime):
    """Executes AAP actions as local CLI processes."""

    def execute(self, action: AAPAction, inputs: dict, trace: TraceContext) -> AAPOutput:
        cli = action.execution  # type: cli config
        
        # 0. Check permissions
        granted = self.resolve_permissions(action.permissions, self.config.roles)
        if not granted.all_satisfied:
            return AAPOutput(error=PermissionDenied(granted.denied))

        # 1. Run before hooks
        for hook in action.hooks.get("before_execute", []):
            result = self.run_hook(hook, inputs, trace=trace)
            if result.abort:
                return AAPOutput(error=result.reason)

        # 2. Resolve environment (including secrets via AuthProvider)
        env = self.resolve_env(cli.env, action.permissions)

        # 3. Build command
        args = self.interpolate_args(cli.args, inputs)
        stdin_data = self.prepare_stdin(cli.stdin, inputs)

        # 4. Execute process
        span = trace.start_span("cli:execute")
        proc = subprocess.run(
            [cli.command] + args,
            input=stdin_data,
            env=env,
            capture_output=True,
            timeout=cli.timeout_ms / 1000,
            cwd=cli.working_dir
        )
        span.end()

        # 5. Handle exit code
        exit_semantic = cli.exit_codes.get(proc.returncode, "error")
        if exit_semantic == "retry":
            return self.retry(action, inputs, trace)
        elif exit_semantic == "human_review_needed":
            return self.escalate_to_human(action, proc, trace)
        elif exit_semantic == "error":
            return self.handle_error(action, proc, trace)

        # 6. Parse stdout against output mapping
        output = self.parse_cli_output(proc.stdout, cli.stdout)

        # 7. Validate against contract
        self.validate_contract(action.contract, inputs, output)

        return output
```

---

## MCP Interop

AAP does not replace MCP. MCP is a **transport backend** — one of several execution types. AAP wraps MCP calls with the full lifecycle: permissions, auth, hooks, state, traces.

```yaml
aap: 0.1.0
kind: Action

metadata:
  name: create-jira-ticket
  version: 1.0.0

execution:
  type: mcp
  server: https://mcp.atlassian.com/v1/mcp
  tool: create_issue

permissions:
  capabilities:
    - mcp:atlassian:create_issue
    - network:outbound:*.atlassian.com
  roles: []

auth:
  provider: atlassian-oauth@1.0.0

inputs:
  project:
    type: string
  title:
    type: string
  description:
    type: string
  priority:
    type: enum
    values: [low, medium, high, critical]

outputs:
  issue_key:
    type: string
  url:
    type: string

resources:
  max_latency_ms: 10000
  max_cost_usd: 0.00
  max_retries: 2
```

---

## CLI Reference

```bash
# Initialize a new action
aap init my-action

# Validate an action manifest
aap validate action.aap.yaml

# Test locally against a runtime
aap test --runtime claude --input '{"depth": "executive"}'

# Test CLI execution locally
aap test --runtime cli --input '{"depth": "executive"}'

# Publish to registry
aap publish --registry https://registry.aap.dev

# Install an action
aap install acme/summarize-document@1.2.0

# Compose and validate a pipeline
aap compose compose.aap.yaml --validate

# Compose and validate with resource budget check
aap compose compose.aap.yaml --validate --check-budget

# Generate runtime adapter code
aap codegen --runtime vercel --output ./adapters/

# Audit dependencies and permissions
aap audit --depth full

# Inspect permissions required by an action
aap permissions acme/summarize-document@1.2.0

# Resume an interrupted composition
aap resume --trace-id tr_a1b2c3d4

# View trace for a completed execution
aap trace tr_a1b2c3d4 --format json
```

---

## Quick Start

### 1. Define an action

```bash
aap init summarize
# Edit action.aap.yaml
```

### 2. Test it

```bash
aap test --runtime claude \
  --context ./test-doc.pdf \
  --input '{"depth": "executive", "audience": "board"}'
```

### 3. Publish it

```bash
aap publish --registry https://registry.aap.dev
```

### 4. Use it in a composition

```yaml
actions:
  summarize:
    ref: your-org/summarize@1.0.0
    inputs:
      depth: detailed
```

### 5. Run the composition

```bash
aap run compose.aap.yaml --input '{"query": "Q3 results"}'
```

---

## Design Principles

1. **Declarative over imperative.** Actions describe *what*, not *how*.
2. **Portable by default.** No action should be locked to a single runtime.
3. **Composable at every layer.** Actions, hooks, contracts, and auth are all reusable units.
4. **Transport-agnostic.** MCP, function calling, REST, CLI — all valid execution backends.
5. **Trust is non-negotiable.** Signed, attested, auditable. Permissions visible before install.
6. **Convention over configuration.** Sensible defaults. Zero config for simple actions.
7. **Auth is a hook, not a transport concern.** Credentials are injected, never hardcoded, never transport-bound.
8. **Observable by default.** Every execution produces a trace. No opt-in required.
9. **Cost-aware.** Resource budgets are first-class. Agents don't get blank checks.
10. **Fail safely.** Checkpoint, resume, compensate. The real world doesn't have undo, but agents should try.

---

## What's Next

- [ ] Formal JSON Schema for all AAP manifest types (Action, Contract, Hook, Composition, AuthProvider, RuntimeConfig)
- [ ] Reference adapter implementations (Claude, OpenAI, Vercel, CLI)
- [ ] Registry API specification
- [ ] Composition execution engine reference implementation
- [ ] Security model and threat analysis
- [ ] Permission capability taxonomy — full standard
- [ ] Trace exporter reference (OTLP)
- [ ] State store reference implementations (filesystem, S3, Redis)
- [ ] Migration tooling (`aap migrate`)
- [ ] Community RFC process
- [ ] Three reference actions with real-world usage

---

## Contributing

This is a draft. It's meant to be challenged, broken, and rebuilt.

Open an issue. Submit a PR. Tell us what's wrong.

```
https://github.com/agentactionprotocol/aap-spec
```

---

*AAP is not affiliated with Anthropic, OpenAI, Vercel, or any AI runtime provider. It is an open specification for the community.*
