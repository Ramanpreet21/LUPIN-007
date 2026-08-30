# 007 Incident Command Deck — Architecture

## Overview

007 is a local control plane that wires TrueForge (the agent runtime harness) into a real-time incident-response dashboard. When an alert fires (AlertManager, PagerDuty, or canonical webhook), the control plane routes it to a TrueForge agent session that diagnoses the issue and halts before any tool execution pending human approval. The operator sees proposed commands and safety badges in the dashboard, then approves or rejects — the decision flows back to TrueForge, which either resumes the turn or cancels it.

The dashboard is a React/Electron app that communicates with the control plane over HTTP (REST) and WebSocket (live event stream). Qodo runs as a pre-PR gate on the `claude` agent, enforcing review before every `git push`.

## Architecture Diagram

```mermaid
flowchart TD
    subgraph External
        AM[AlertManager]
        PD[PagerDuty]
        WH[Webhook]
    end

    subgraph "007 Control Plane  (port 3000/3001)"
        EP[Express HTTP Server]
        WS[WebSocket Server /ws]
        IR[Incident Router /alerts]
        AR[Approval Router /api/approvals]
        SR[Sandbox Router]
        SRouter[Settings Router]
        FR[Fleet Router]
        DB[(SQLite DB)]
        IP["Incident Plane
        (runDiagnosis /
        resumeApproval)"]
    end

    subgraph TrueForge Harness  (port 8790)
        TF[TrueForge Server]
        Agent[Agent Session]
        Sandbox[Sandbox Runtime]
        MCP["MCP Host
        (tool providers)"]
    end

    subgraph Dashboard
        React[React SPA]
        Elec[Electron Shell]
    end

    AM --> EP
    PD --> EP
    WH --> EP
    EP --> IR
    IR --> IP
    IP --> TF
    TF --> Agent
    Agent -->|tool.approval_required| IP
    IP --> WS
    WS --> React
    AR --> IP
    IP -->|approval decision| TF
    EP --> SR
    EP --> SRouter
    EP --> FR
    SRouter -->|syncModelProvider| TF
    SR --> Sandbox
    TF --> Sandbox
    React --> Elec
    EP --> DB
    IP --> DB
```

## Components

### Control Plane Entry Point (`src/index.ts`)

**Purpose**: CLI bootstrap — parses args, wires all routers, starts the HTTP server.

**Location**: `src/index.ts`

**Key symbols**:
- `main()` — reads `TRUEFORGE_BASE_URL` / `TRUEFORGE_TOKEN` / `TRUEFORGE_MODEL` from env; calls `initTrueForge`, `initDb`, `startServer`
- `parseArgs()` — handles `--port`, `--host`, `--help`

**Interactions**:
- Receives CLI args → drives config, starts server
- Wires all routers via `registerRoutes` callback on `startServer`

---

### TrueForge Harness Integration (`src/trueforge.ts`)

**Purpose**: SDK lifecycle management — constructs the `TrueForge` client against a configured base URL, returns a typed status.

**Location**: `src/trueforge.ts`

**Key symbols**:
- `TrueForgeInitOptions` — `{ baseUrl?, token?, timeoutInSeconds?, maxRetries? }`
- `TrueForgeStatus` — `{ state: "ready" | "unconfigured" | "failed", ... }`
- `initTrueForge(opts, logger)` — constructs `new TrueForge(...)`, no live connectivity probe at this stage

**Interactions**:
- Output feeds every router that calls TrueForge SDK: `createIncidentRouter`, `createSessionsRouter`, `createSandboxRouter`, `createSettingsRouter`
- The `TrueForgeHandle { client, status }` is obtained via `getTf()` closures injected per-router

**TrueForge Configuration** (`src/trueforge-config.ts`):
- `INCIDENT_RESPONDER_PROMPT` — SRE persona, JSON output schema, safety-first guidelines
- `CONVERSATIONAL_ASSISTANT_PROMPT` — LUPIN operator assistant, markdown responses
- `SAFETY_POLICY` — three regex rules: `destructive` (block `rm *`), `privilege-escalation` (block `sudo rm` / `chmod +777`), `eval` (block `eval`, `source`, `$()`)

---

### Incident Plane (`src/incident-plane.ts`)

**Purpose**: Core orchestration — alert ingestion, diagnosis turn, approval gate, state machine.

**Location**: `src/incident-plane.ts`

**Key symbols**:
- `createIncidentRouter(opts)` — returns Express Router with all incident routes
- `runDiagnosis(alert, incidentId)` — async, fires after `POST /alerts` returns 202; streams `createTurnStream`, halts at `tool.approval_required`
- `resumeApproval(incidentId, decision)` — async; resumes a halted turn with `user.tool_approval` inputs; auto-cancels session on reject
- `computeGateBadges(commands)` — runs `SAFETY_POLICY` regexes + dynamic policy rules against command list; returns `SafetyBadge[]`
- `WsEnvelope` — discriminated union of all WebSocket event shapes (`incident_created`, `agent_thinking`, `pending_approval`, `execution_complete`, `sandbox_started`)

**Incident State Machine** (`src/incidents.ts`):

```
diagnosing → awaiting_approval → approved → completed
                  ↓
              rejected → failed
```

**Key functions** (`src/incidents.ts`):
- `createIncident(alert)` — inserts into in-memory `Map`, evicts oldest-terminal on `INCIDENT_MAX` (1000)
- `patchIncident(id, patch)` — partial update of incident fields
- `setIncidentStatus(id, status)` — transitions status
- `normalizeWebhooks(raw)` — handles AlertManager v4, PagerDuty Events API v2, PagerDuty v3, canonical `{ service_name, target_host }`; returns one result per alert so batches don't silently drop entries

**Interactions**:
- `POST /alerts` → `normalizeWebhooks` → `createIncident` → `runDiagnosis` (fire-and-forget via `void`)
- `POST /api/approvals` → `resumeApproval` → `client.sessions.createTurnStream` with `user.tool_approval` inputs
- Streams events via `broadcast` → Express → WebSocket → React dashboard

---

### Safety Gate (`src/command-scope.ts`, `src/incident-plane.ts`)

**Purpose**: Local command-risk analysis and blast-radius annotation, shown alongside TrueForge's own tool-approval gate.

**Location**: `src/command-scope.ts` (scope analysis), `src/incident-plane.ts` (badges + gate integration)

**Key symbols** (`src/command-scope.ts`):
- `CommandScope` — `{ command, executable, files[], sockets[], services[], ports[], riskLevel, impactSummary }`
- `formatScopedDiff(commands)` — produces human-readable diff annotating which files/services/ports a command touches
- `KNOWN_SERVICE_PORTS` — maps service names (nginx, postgresql, sshd, k3s, redis, lupin-relay) to their ports, sockets, and config files
- `effectiveCommand(statement)` — peels env assignments (`FOO=bar`), wrapper words (`sudo`, `env`, `nohup`, `time`, `exec`, `nice`, `sh -c`), returns the actual executable; ensures SAFETY_POLICY regexes are anchored to the real binary name

**Key symbols** (`src/incident-plane.ts`):
- `splitShellStatements(command)` — quote-aware split on `\n`, `;`, `&`, `|`; does not split inside single/double quotes
- `shellWords(input)` — quote-aware tokenizer producing `{ word, start }` tokens; strips quotes from word values
- `toolCommandString(tool)` — unwraps `{"command": "..."}` JSON from a tool call's `arguments` field so approval panel sees the real shell command

**Interactions**:
- `tool.approval_required` event → `computeGateBadges(commands)` → `safetyBadges[]` persisted on incident + broadcast as `pending_approval`
- `commandDiff(commands)` → `formatScopedDiff` → `diff` field on `pending_approval` broadcast

---

### Multi-Runtime Sandbox (`src/sandboxes/`)

**Purpose**: Pluggable sandbox execution backends — the active runtime is selected at startup from the probe order: Daytona → isolated-process → container (Podman/Docker).

**Location**: `src/sandboxes/manager.ts`

**Key symbols**:
- `SandboxManager` — `probeAll()`, `getRunner(type)`, `execInActive(command, opts)`
- `DaytonaRunner` (`src/sandboxes/daytona-runner.ts`) — uses TrueForge's built-in sandbox (`sandbox: { enabled: true }` on agent spec); TrueForge issues `SandboxCreatedEvent` which `runDiagnosis` relays as `sandbox_started`
- `IsolatedProcessRunner` (`src/sandboxes/isolated-process-runner.ts`) — `node:child_process` `spawn` with `uid/gid` isolation, CPU + memory limits, read-only filesystem overlay
- `ContainerRunner` (`src/sandboxes/container-runners.ts`) — Podman socket probe via Unix socket; `docker/podman run --rm --read-only` with network/cgroup isolation

**Interactions**:
- `POST /api/settings/sandbox` (via `createSandboxRouter`) → `updateSandboxSettings(client.settings.sandboxProviders, apiKey, serverUrl)` → TrueForge server-side sandbox config
- `POST /api/sandboxes/probes` → `manager.probeAll()` → returns per-runner `{ type, status, latency_ms }`

---

### Settings & Model Provider Sync (`src/routes/settings.ts`)

**Purpose**: Per-provider LLM API key validation (live probe) and TrueForge model provider registration.

**Location**: `src/routes/settings.ts`

**Key symbols**:
- `WELL_KNOWN_MODELS` — maps provider (`google-gemini`, `anthropic`, `openai`, `fireworks`, `alibaba`, `zai`, `moonshot`) to array of `{ modelId, name }`
- `validateProviderApiKey(provider, apiKey, baseUrl?)` — live HTTP probe to provider's `/models` endpoint; throws on non-2xx or network failure; skips for test keys (`ai_test_*`, `valid-key-for-testing`)
- `syncModelProviderToTrueForge(client, providerType, apiKey, baseUrl?)` → `client.settings.modelProviders.createOrUpdate({ manifest })` — upserts provider into TrueForge's model catalog

**Interactions**:
- `PUT /api/settings` → validates every non-empty `*_api_key` field → syncs to TrueForge → upserts into SQLite `settings` table
- TrueForge server uses these provider credentials to route LLM inference

---

### HTTP Server & WebSocket (`src/server.ts`)

**Purpose**: Express app + WebSocket server; CORS-open; health endpoint with live TrueForge status.

**Location**: `src/server.ts`

**Key symbols**:
- `startServer(opts)` → `Promise<ServerHandle { httpServer, wss, port, broadcast, close }>`
- `broadcast(message)` → JSON-serializes and sends to all `WebSocket.OPEN` clients
- `GET /health` + `GET /api/health-summary` → aggregate status from TrueForge + incident stats (active count, critical alert list, error budget)

**Interactions**:
- WebSocket upgrade on `/ws` path only; all other upgrade requests get `socket.destroy()`
- `registerRoutes` callback pattern lets `index.ts` mount all sub-routers while keeping `broadcast` centralized

---

### Dashboard Control Plane API Hooks (`dashboard/client/src/hooks/useControlPlane.ts`)

**Purpose**: React hooks that call the control plane REST API and subscribe to the WebSocket stream for live UI updates.

**Key symbols**:
- `useControlPlane()` — fetches `/health`, exposes `{ status, incidents, trueforgeState }`
- `useControlPlaneTerminalStream()` — connects WebSocket `/ws`, maps `WsEnvelope` events to React state
- `useHealth()` — polls `/api/health-summary` every 30s
- `useIncidentArchive()` — fetches `/incidents?status=resolved`

**Interactions**:
- Reads from control plane HTTP API
- Writes to `/api/approvals` (approve/reject buttons)
- Subscribes to `/ws` for real-time incident state transitions

---

### Qodo Pre-PR Gate (Claude Agent)

**Purpose**: Enforces review before `git push` advances a PR head.

**Location**: `~/.claude/settings.local.json` (agent-side hook configuration)

**Integration**:
```json
"PreToolUse": [{
  "matcher": "Bash(git push*)",
  "hooks": [{
    "type": "command",
    "command": "qodo review ...",
    "timeout": 10,
    "statusMessage": "qodo pre-PR gate"
  }]
}]
```

The hook fires only when the `claude` agent runs `Bash` with a `git push*` command. It calls `qodo review` (with session context from `.qodo/session-context.json`) and blocks the push until findings are addressed. Findings are stored in `.qodo/review.result.json` (JSON) and `.qodo/review.progress.ndjson` (NDJSON stream). Qodo is configured to run with category filter `Reliability` on this worktree.

**qodo.show integration point**: When TrueForge runs sessions with a dashboard UI, `qodo.show` can display session context, review findings, and incident state in a unified view. Current call sites: none yet — `qodo.show` is a future integration target for surfacing Qodo's review session inside the dashboard.

---

### Database Schema (`src/db.ts`)

**Location**: `src/db.ts` — `better-sqlite3` SQLite at `{dataDir}/incident-command-deck.db`

| Table | Key columns | Purpose |
|---|---|---|
| `incidents` | `id TEXT PK`, `status`, `alert_json`, `session_id`, `tool_call_ids`, `proposed_commands`, `safety_badges` | Durable incident archive (in-memory Map is primary; DB is written on `sandbox_started` and session insert) |
| `sessions` | `id PK`, `thread_id`, `incident_id`, `summary`, `created_at` | TrueForge session registry |
| `session_messages` | `id PK`, `session_id FK`, `role`, `label`, `content` | Message log per session |
| `settings` | `key PK`, `value` | Key-value config: `model`, `enforcement_mode`, `sandbox_provider`, API keys (hashed), `setup_completed` |
| `fleet_hosts` | `id PK`, `hostname`, `ip`, `port`, `ssh_user`, `podman_socket`, `last_probe_status` | Managed fleet inventory |
| `policy_rules` | `id PK`, `name`, `regex`, `category`, `severity`, `enabled` | Dynamic safety rules |
| `policy_profiles` | `name PK`, `is_active`, `rule_ids` | Named rule profiles |

---

### Demo Stack (`src/demo/compose-orchestrator.ts`)

**Purpose**: Spins up a local Docker/Podman compose stack with 5 nodes (tf-server/gateway + 4 clients) for the demo scenario.

**Key symbols**:
- `detectComposeEngine()` — Podman socket → `podman compose` → Docker → `docker-compose` fallback chain
- `startDemoStack(broadcast?, workspaceRoot)` — runs `compose up -d`, polls port 2222 for SSH readiness, auto-registers 5 fleet hosts into SQLite, broadcasts `fleet_updated`
- `triggerDemoPrometheusAlert(controlPlanePort, alertOverride?)` — fires `POST /alerts` with an AlertManager-shaped payload from `DEMO_ALERT_PRESETS`

---

### Policy Engine (`src/policy.ts`, `src/routes/policy.ts`)

**Purpose**: Dynamic rule management — CRUD for safety rules stored in SQLite, evaluated at the approval gate alongside the static `SAFETY_POLICY`.

**Key symbols** (`src/policy.ts`):
- `listPolicyRules()` — reads all `enabled=1` rules from SQLite
- `computeGateBadges()` in `incident-plane.ts` fuses static and dynamic rules; dynamic rule names de-duplicate against static names

---

## Data Flow

### Alert → Incident → Diagnosis

```
AlertManager / PagerDuty / Webhook
        ↓
POST /alerts  (Express)
        ↓
normalizeWebhooks()  →  one NormalizedAlert per input entry
        ↓
createIncident()  →  in-memory Map + 202 response with incident_id
        ↓ (fire-and-forget via void)
runDiagnosis(alert, incidentId)
        ↓
captureTargetState(target_host, service_name)  →  formatCapturedState() block
        ↓
client.sessions.create({ agent: { spec: { model, instructions: INCIDENT_RESPONDER_PROMPT, config: { sandbox: { enabled: false } } } } })
        ↓
client.sessions.createTurnStream(sessionId, { input: [{ type: "user.message", content: incidentMessage(...) }] })
        ↓
for await (ev of stream):
  turn.created       →  persist turnId on incident
  model.message      →  broadcast { type: "agent_thinking", content, step }
  tool.approval_required →  computeGateBadges(commands)
                            →  patchIncident({ proposedCommands, safetyBadges })
                            →  setIncidentStatus("awaiting_approval")
                            →  broadcast { type: "pending_approval", proposed_command, safety_badges, diff }
                            →  return  ← HALTS; resumes on /api/approvals
  turn.done          →  setIncidentStatus("completed" | "failed")
                        broadcast { type: "execution_complete", status }
```

### Approval → Execution

```
POST /api/approvals  { incident_id, decision: "approved" | "rejected" }
        ↓
resumeApproval(incidentId, decision)
        ↓
For each tool call id in incident.toolCallIds:
  client.sessions.createTurnStream(sessionId, {
    previousTurnId: incident.turnId,
    input: [{ type: "user.tool_approval", toolCallId, threadId, approval: { status: "allow" | "deny" } }]
  })
        ↓
For reject:  drain stream → cancel session → status = "rejected"
For approve: stream continues; any further tool.approval_required re-enters awaiting_approval
        ↓
turn.done → status = "completed" | "failed"
```

### Settings → TrueForge Model Provider

```
PUT /api/settings  { model_provider, model_api_key, model_base_url }
        ↓
validateProviderApiKey(provider, apiKey, baseUrl)  →  live HTTP probe
        ↓ (on success)
syncModelProviderToTrueForge(client, provider, apiKey, baseUrl)
        ↓
client.settings.modelProviders.createOrUpdate({ manifest: { type, auth: { apiKey }, models: [...] } })
        ↓
Upsert into SQLite settings table
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `TRUEFORGE_BASE_URL` | — | TrueForge server URL (required) |
| `TRUEFORGE_TOKEN` | — | Bearer token for authed servers |
| `TRUEFORGE_MODEL` | `anthropic/claude-sonnet-5` | Default model FQN for incident sessions |
| `PORT` | `3000` | Control plane HTTP listen port |
| `HOST` | `127.0.0.1` | Control plane bind address |
| `LOG_LEVEL` | `info` | Pino log level |
| `DATA_DIR` | `data/` | SQLite DB directory |

**Enforcement modes** (stored in SQLite `settings` key `enforcement_mode`):
- `STRICT_GATED` — default; halts at first `tool.approval_required` for human decision
- `DRY_RUN` — auto-denies all gates, logs, does not execute
- `AUTONOMOUS` — auto-approves all gates; no human in the loop

## Code References

| Component | File | Key Symbols |
|---|---|---|
| CLI + bootstrap | `src/index.ts` | `main()`, `parseArgs()` |
| TrueForge SDK init | `src/trueforge.ts` | `initTrueForge()`, `TrueForgeHandle` |
| Prompts + safety rules | `src/trueforge-config.ts` | `INCIDENT_RESPONDER_PROMPT`, `SAFETY_POLICY`, `CONVERSATIONAL_ASSISTANT_PROMPT` |
| Incident orchestration | `src/incident-plane.ts` | `createIncidentRouter()`, `runDiagnosis()`, `resumeApproval()`, `computeGateBadges()`, `WsEnvelope` |
| Incident store | `src/incidents.ts` | `createIncident()`, `patchIncident()`, `setIncidentStatus()`, `normalizeWebhooks()` |
| Safety gate | `src/incident-plane.ts` | `splitShellStatements()`, `shellWords()`, `effectiveCommand()`, `toolCommandString()` |
| Command scope analysis | `src/command-scope.ts` | `formatScopedDiff()`, `CommandScope`, `KNOWN_SERVICE_PORTS` |
| Policy engine | `src/policy.ts` | `listPolicyRules()` |
| Sandbox multi-runtime | `src/sandboxes/manager.ts` | `SandboxManager`, `probeAll()`, `execInActive()` |
| Daytona runner | `src/sandboxes/daytona-runner.ts` | `DaytonaRunner` |
| Isolated process runner | `src/sandboxes/isolated-process-runner.ts` | `IsolatedProcessRunner` |
| Settings + provider sync | `src/routes/settings.ts` | `validateProviderApiKey()`, `syncModelProviderToTrueForge()`, `WELL_KNOWN_MODELS` |
| Sandbox routes | `src/routes/sandbox.ts` | `createSandboxRouter()` |
| Fleet routes | `src/routes/fleet.ts` | `createFleetRouter()` |
| Sessions routes | `src/routes/sessions.ts` | `createSessionsRouter()` |
| HTTP + WebSocket | `src/server.ts` | `startServer()`, `broadcast()` |
| SQLite schema | `src/db.ts` | `initDb()`, `getDb()`, schema constants |
| Demo orchestration | `src/demo/compose-orchestrator.ts` | `startDemoStack()`, `triggerDemoPrometheusAlert()`, `DEMO_ALERT_PRESETS` |
| Dashboard hooks | `dashboard/client/src/hooks/useControlPlane.ts` | `useControlPlane()`, `useControlPlaneTerminalStream()` |

## Glossary

| Term | Definition |
|---|---|
| **HITL** | Human-in-the-Loop — a safety pattern where an AI halts before a sensitive action and awaits human approval |
| **TrueForge Harness** | The `@truefoundry/trueforge-sdk` runtime that owns LLM inference, MCP orchestration, sandbox execution, and event streaming |
| **Tool Approval Gate** | TrueForge's `tool.approval_required` event that halts a turn; our control plane surfaces this to the dashboard and resumes on operator decision |
| **SandboxCreatedEvent** | TrueForge event fired when a sandboxed tool execution environment is provisioned; relayed as `sandbox_started` to the dashboard |
| **Safety Badge** | A named pass/fail label (`destructive`, `privilege-escalation`, `eval`) computed by our local SAFETY_POLICY against the proposed command |
| **Blast Radius** | The set of files, services, ports, and sockets a command would affect if executed |
| **effectiveCommand** | The resolved executable after peeling wrapper words (`sudo`, `env`, `sh -c`, etc.) so SAFETY_POLICY regexes match the real binary |
| **Qodo** | A code review agent that runs on the `claude` agent; fires pre-PR via a `PreToolUse` hook on `git push*` commands |
| **LUPIN** | The conversational operator assistant persona (`CONVERSATIONAL_ASSISTANT_PROMPT`) — markdown-first, non-JSON by default |
| **Daytona** | A TrueForge-managed sandbox runtime; enabled by setting `sandbox: { enabled: true }` on the agent spec |
| **INCIDENT_MAX** | Hard cap of 1000 incidents in the in-memory store; oldest-terminal incidents are evicted first on capacity pressure |
