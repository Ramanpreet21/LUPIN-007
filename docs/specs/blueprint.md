# Incident Command Deck — TrueForge-Native Execution Blueprint

## Executive Summary
By leveraging TrueForge's native capabilities (MCP orchestration, sandbox execution, policy gating, telemetry streaming), the Incident Command Deck project reduces from an 8-PR infrastructure-heavy build to a **6-PR delivery**: 4 PRs for the demo-critical core, 1 optional PR for the operator console, and 1 for packaging.

**Net Effect:**
- **80% less custom code** (no Docker socket handlers, AST parsers, custom cron engines, sandbox orchestrators)
- **TrueForge owns the engine** — LLM reasoning, MCP host, HITL approval gate, event streaming, and sandbox execution all run in the TrueForge server. Our code is the control plane: alert routing, event relay, and operator UX.
- **Demo-safe scoping** — the core incident-response loop (alert → diagnosis → approval → execution) works at PR #3. The operator console and npm packaging are independent follow-ons. Push automation (drift detection) is a separate project entirely — not part of this repo.
- **Qodo runs live on every PR** — no dedicated audit PR; findings are addressed as they arrive.

---

## 1. Capability Mapping: What TrueForge Owns vs. What We Build

| **Capability** | **TrueForge Native** | **Our Build** |
|---|---|---|
| **LLM-powered agent reasoning** | ✅ Built-in (Claude Sonnet via AI SDK) | — |
| **MCP client/server host** | ✅ Built-in (`client.mcpServers.list()`, `client.mcpServers.listTools()`) | Configure MCP connector endpoints on the server; wire `requireApprovalForTools` per tool |
| **Ephemeral sandbox execution** | ✅ Built-in (`@anthropic-ai/sandbox-runtime` + Daytona; `SandboxCreatedEvent` streams via `createTurnStream`) | Enable sandbox on the server; relay `SandboxCreatedEvent` to dashboard |
| **HITL approval gating** | ✅ Built-in (`ToolApprovalRequiredEvent` + `ApprovalDecision` via `createTurnStream`) | Map events → WebSocket; POST `ApprovalDecision` back via turn resume |
| **Real-time event streaming** | ✅ Built-in (SSE via `createTurnStream` / `subscribeToTurn`) | Express → WebSocket bridge to React dashboard |
| **Built-in operator UI** | ✅ Built-in (`dist/_frontend/index.html` at port 8790; Monaco editor, session viewer) | Custom Electron incident console as a separate app |
| **Scheduling / cron** | ❌ Not built-in | Not part of this project. Push automation is a separate concern with no shared code path to the incident loop. |
| **GitHub / Git PR generation** | ❌ Not built-in | — (cut entirely) |
| **Custom operator console** | ❌ Not built-in | Separate Electron app; not part of numbered PR sequence |
| **CLI entrypoint** | ❌ Not built-in | Node.js `incident-agent serve` command + TrueForge SDK initialization |

**Key Insight:** We are not reimplementing orchestration; we are **configuring and presenting** orchestration that TrueForge already provides. TrueForge owns: LLM, MCP host, sandbox, HITL gate, event stream, built-in UI. We own: alert routing, event relay, and a purpose-built operator console.

---

## 2. TrueForge Server — Runtime Dependency

The TrueForge server (`@truefoundry/trueforge`) is a **runtime dependency**, not built by this project. It must be started separately before `incident-agent serve` can do anything useful.

### Running the Server

```bash
npx @truefoundry/trueforge --port 8790
```

Defaults: standalone SQLite mode (no Postgres, no Redis). Not production-safe — local use only. The server ships a built-in operator UI at `http://localhost:8790` (Monaco editor, session viewer).

**Production mode** (multi-replica):
```bash
STANDALONE=false POSTGRES_HOST=... POSTGRES_PASSWORD=... REDIS_URL=redis://... \
  npx @truefoundry/trueforge --port 8790
```

**Server env vars** (from `npx @truefoundry/trueforge --help`):
```
PORT                  HTTP port (default: 8790)
STANDALONE            false = require Postgres + Redis
SQLITE_PATH           SQLite database path (standalone mode)
POSTGRES_*            Postgres connection settings (STANDALONE=false)
REDIS_URL             Redis URL (STANDALONE=false)
FRONTEND_DIR          Override built-in UI directory
```

---

### Two Integration Models

**Model A — Admin pre-configures the server (simpler)**

Someone configures the TrueForge server once via its built-in UI at `:8790` or via its REST API (`/api/v1/settings/*`):

1. Add an MCP connector (Settings → Connectors) — this is the tool provider the incident-responder agent uses
2. Set `requireApprovalForTools: ["@write", "@destructive"]` on the connector — so `tool.approval_required` events fire
3. Optionally enable sandbox for `sandbox.created` events

`incident-agent` then only uses the SDK client — it never touches server config. Zero extra code in `incident-agent` for platform setup. **This is the current worktree approach.**

**Model B — incident-agent configures the server at startup (fully automated)**

`incident-agent` calls the server's REST API to set up its own MCP connector and approval policy on first run, then uses the SDK as normal. More implementation work, but the TrueForge server becomes a pure dependency rather than a manually managed component.

```typescript
// src/trueforge-setup.ts — run once at startup
async function ensureServerConfig(baseUrl: string, token: string) {
  const res = await fetch(`${baseUrl}/api/v1/settings/mcp-servers`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const { data: servers } = await res.json();
  if (servers?.find((s: any) => s.name === 'incident-responder')) return; // already set up

  // Create remote MCP connector via the server's REST API
  // Note: only "remote" MCP servers are supported (no stdio)
  await fetch(`${baseUrl}/api/v1/settings/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      manifest: {
        type: 'remote',
        name: 'incident-responder',
        url: 'https://your-mcp-server.example.com/mcp',
        description: 'Incident response tool suite',
      },
    }),
  });
}
```

---

### Platform Prerequisites (Model A) — What Must Exist Before incident-agent Works

These are **server-side settings** — zero lines of incident-agent code. The TrueForge server must be running at `:8790` before any of these commands will work.

**1. Configure a model provider**

Without this, `POST /api/v1/sessions` returns 400. You need at least one model configured:

```bash
# Check what model providers are available in the catalog
curl http://localhost:8790/api/v1/catalogs/model-providers

# Configure Anthropic as a model provider
curl -X PUT http://localhost:8790/api/v1/settings/model-providers \
  -H 'Content-Type: application/json' \
  -d '{
    "manifest": {
      "type": "anthropic",
      "auth": { "api_key": "sk-ant-..." },
      "models": [
        {
          "model_id": "claude-sonnet-4-20250514",
          "name": "sonnet",
          "properties": {}
        }
      ]
    }
  }'

# Or check what's currently configured
curl http://localhost:8790/api/v1/settings/model-providers
```

> **Note:** `model_id` is the provider-specific string sent to the API (e.g. `claude-sonnet-4-20250514` for Anthropic, `gpt-4o` for OpenAI). The `name` field is a TrueForge-internal identifier matching pattern `^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$`.

**2. Configure an MCP connector**

Without this, the agent has no tools. The MCP server must be a **remote HTTP endpoint** (type: `"remote"`) — there is no stdio support:

```bash
# Check available MCP servers in the catalog
curl http://localhost:8790/api/v1/catalogs/mcp-servers

# Add a remote MCP server (type must be "remote")
curl -X POST http://localhost:8790/api/v1/settings/mcp-servers \
  -H 'Content-Type: application/json' \
  -d '{
    "manifest": {
      "type": "remote",
      "name": "incident-tools",
      "url": "https://your-mcp-server.example.com/mcp",
      "description": "Incident response tool suite"
    }
  }'

# List configured MCP servers
curl http://localhost:8790/api/v1/settings/mcp-servers
```

> **Limitation:** `MCPServerManifest.type` is `"remote"` only. You cannot configure a local stdio-based MCP server (e.g. `npx @modelcontextprotocol/server-filesystem`) through this API. The MCP server must be an already-running HTTP server with an MCP-compatible endpoint.

**3. Authorize the MCP connector (if auth is required)**

```bash
# Start OAuth flow for the MCP server
curl http://localhost:8790/api/v1/mcp-servers/incident-tools/authorize

# Or check if it's already authorized
curl http://localhost:8790/api/v1/settings/mcp-servers/incident-tools
```

**4. Verify readiness**

```bash
curl http://localhost:8790/api/v1/capabilities
# → { "data": { "sandbox": { "enabled": false }, "settings": { "enabled": true }, "skill": { ... } } }

# If model and MCP are configured, session creation should work:
curl -X POST http://localhost:8790/api/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{ "agent": { "spec": { "model": { "name": "anthropic/sonnet" } } } }'
# → { "id": "...", "status": "created" }
```

---

### Platform Prerequisites — Quick Checklist

Run these after starting the TrueForge server to confirm it's ready for incident-agent:

```bash
# Must return non-empty data for model-providers
curl http://localhost:8790/api/v1/settings/model-providers

# Must return non-empty data for mcp-servers
curl http://localhost:8790/api/v1/settings/mcp-servers

# capabilities.settings.enabled must be true
curl http://localhost:8790/api/v1/capabilities
```

If any of these are empty, incident-agent will fail at `client.sessions.create()` with an error from the TrueForge server.

---

### What incident-agent Does vs. What TrueForge Does

| Concern | Where it lives |
|---|---|
| Which MCP server, auth, `requireApprovalForTools` | **TrueForge server** (Model A: admin config; Model B: setup script) |
| Sandbox enable/disable | **TrueForge server** (session `RuntimeConfig` or server-wide settings) |
| Model selection | **TrueForge server** |
| `INCIDENT_RESPONDER_PROMPT` + `SAFETY_POLICY` | **incident-agent** (`src/trueforge-config.ts`) — our custom layer, not server config |
| `normalizeAlert()`, canonical shape validation | **incident-agent** (`src/incidents.ts`) |
| Session lifecycle, turn stream iteration | **incident-agent** (`src/incident-plane.ts`) via `@truefoundry/trueforge-sdk` |
| Approval gate (approve/reject UI decision → SDK call) | **incident-agent** (`POST /api/approvals`) |
| WebSocket relay to operator console | **incident-agent** (our own Express WebSocket server on `:3000`) |

incident-agent **never builds or ships** the TrueForge server. It is a consumer of the server's API via the SDK client.

---

## 3. Architecture

Two separate applications, developed independently:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                 TRUEFORGE SERVER (runs separately)                       │
│  npx @truefoundry/trueforge --port 8790                                 │
│  ├─ Built-in operator UI at :8790 (Monaco editor, session viewer)       │
│  ├─ LLM reasoning (AI SDK, Claude via Anthropic)                        │
│  ├─ MCP host (SSH, CLI, filesystem connectors)                           │
│  ├─ Sandbox runtime (Anthropic sandbox runtime + Daytona)                 │
│  ├─ HITL approval gate (ToolApprovalRequiredEvent)                       │
│  └─ SSE event stream (createTurnStream)                                  │
└───────────────────────────────────────┬──────────────────────────────────┘
                                        │ SSE / HTTP
                                        │ (SDK client: sessions.createTurnStream)
┌───────────────────────────────────────┴──────────────────────────────────┐
│     INCIDENT CONTROL PLANE — Node.js Express (port 3000, this repo)       │
│  - POST /alerts            → TrueForge session + turn stream             │
│  - POST /api/approvals    → resume turn with ApprovalDecision           │
│  - GET  /health           → TrueForge server status                      │
│  - WebSocket /ws          → broadcast TrueForge events to operator console│
└───────────────────────────────────────┬──────────────────────────────────┘
                                        │ WebSocket
                                        │ (JSON events: incident_created, agent_thinking,
                                        │  pending_approval, execution_complete)
┌───────────────────────────────────────┴──────────────────────────────────┐
│      INCIDENT OPERATOR CONSOLE — Electron app (separate repo, not numbered)  │
│  - Electron shell with Chromium renderer                                 │
│  - Custom incident tooling: incident queue, approval interceptor,         │
│    safety badge display, timeline view                                    │
│  - Connects to control plane WebSocket at ws://localhost:3000/ws          │
│  - NOT a Next.js dashboard; no shared state with TrueForge UI             │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Operator opens Electron app → connects ws://localhost:3000/ws
   (TrueForge built-in UI also accessible at :8790 independently)

2. Alert webhook arrives at POST /alerts
   ↓
3. Control plane creates TrueForge session + turn stream
   - client.sessions.create({ agent: { name: "incident-responder" } })
   - client.sessions.createTurnStream(sessionId, { input: [...] })
   ↓
4. SSE events stream back over the SDK call:
   - turn.created           → synthesize incident_created
   - model.message          → synthesize agent_thinking (reasoningContent)
   - tool.approval_required → synthesize pending_approval (show in Electron)
   - turn.done              → synthesize execution_complete
   ↓
5. Control plane relays events over WebSocket to Electron console
   ↓
6. Operator reviews in Electron app → clicks APPROVE or REJECT
   ↓
7. POST /api/approvals { incident_id, decision }
   ↓
8. Control plane calls createTurnStream with user.tool_approval inputs:
   - APPROVED: status: "allow"  → TrueForge executes tool, streams result
   - REJECTED: status: "deny"  → TrueForge cancels session, no tool runs
   ↓
9. Session ends (turn.done), incident closed
```

---

## 4. Control Plane PR Sequence

The control plane PRs form a linear sequence. Once PR #3 is merged, the core incident loop (alert → diagnosis → approval → execution) works end-to-end.

| # | Name | Scope | Status |
|---|---|---|---|
| 1 | `feat/local-control-plane` | TrueForge SDK client, Express server, WebSocket relay | **Already merged** |
| 3 | `feat/approval-gate-wiring` | Alert webhook → `createTurnStream` → `ToolApprovalRequiredEvent` → `ApprovalDecision` → WebSocket relay | **Already merged** |
| 4 | `feat/live-wiring` | Sandbox relay + live health polling + ops views wiring + QA coverage | Pending |
| 5 | `build/npm-packaging` | tsup bundle, npm publish, GitHub Actions CI/CD | Pending |

**Drift detection** (push automation via `node-cron`) is **not a project deliverable**. It is a completely separate concern — schedule-based state comparison against a manifest — that has no bearing on whether the core incident loop is done. Do not work on it until the project is fully shipped. It is not on the roadmap, not numbered, and not part of the demo.

---

**Operator console (Electron app): not numbered.**

The Electron operator console is **not part of the numbered PR sequence**. It is developed in a separate repo, wires at the end once the WebSocket contract is stable, and is only attempted if time allows after the control plane is complete. Do not assign it a PR number until the Electron work is explicitly prioritized.

If attempted, it connects to `ws://localhost:3000/ws` and consumes the same JSON events the control plane emits. It does not share process, state, or build system with this repo.

---

### PR #3: `feat/approval-gate-wiring` *(already merged)*

**Goal:** Wire alert ingestion → TrueForge session → human approval → WebSocket events. **Already merged.** Implementation spans three files: `src/incidents.ts`, `src/trueforge-config.ts`, `src/incident-plane.ts`. The steps below are the clean development order.

---

**Step 1 — `src/incidents.ts` (incident store, no external dependencies)**

Purpose: durable in-memory record of every active and terminal incident.

```typescript
// src/incidents.ts

export const MAX_INCIDENTS = 1000;
export const INCIDENT_TTL_MS = 60 * 60 * 1000; // 1 hour for terminal incidents

export interface Incident {
  id: string;
  service_name: string;
  target_host: string;
  severity: string;
  alert_summary: string;
  status: "active" | "diagnosing" | "awaiting_approval" | "completed" | "denied";
  session_id?: string;
  created_at: number;
  updated_at: number;
}

// Canonical alert shape accepted by POST /alerts
export interface CanonicalAlert {
  service_name: string;
  target_host: string;
  severity: "critical" | "warning" | "info";
  alert_summary: string;
}

// validate and normalise — reject fields that are too long before they reach the LLM
export function normalizeAlert(raw: unknown): CanonicalAlert {
  if (!raw || typeof raw !== "object") throw new Error("alert must be an object");
  const r = raw as Record<string, unknown>;
  const service = String(r.service_name ?? "").slice(0, 128);
  const host = String(r.target_host ?? "").slice(0, 256);
  const summary = String(r.alert_summary ?? "").slice(0, 512);
  const severity = ["critical","warning","info"].includes(String(r.severity ?? ""))
    ? String(r.severity) : "warning";
  if (!service || !host || !summary) throw new Error("service_name, target_host, alert_summary are required");
  return { service_name: service, target_host: host, severity, alert_summary: summary };
}
```

Deliverable: in-memory `Map<string, Incident>` with `MAX_INCIDENTS` cap and TTL eviction of terminal incidents. No TrueForge SDK calls.

---

**Step 2 — `src/trueforge-config.ts` (prompts and safety policy, no SDK calls)**

Purpose: compose the `INCIDENT_RESPONDER_PROMPT` and `SAFETY_POLICY` string used when creating a TrueForge session. These are plain strings — the LLM reads them as system-level instructions.

```typescript
// src/trueforge-config.ts

export const INCIDENT_RESPONDER_PROMPT = `You are an SRE incident responder.

When an alert arrives, you MUST:
1. Identify the affected service and host from the alert payload.
2. Run diagnostic commands to determine the root cause. Propose ONE command at a time.
3. Wait for human approval before executing ANY command that modifies live infrastructure (write, delete, restart, kill, chmod, etc.).
4. After each approved command, report the output and continue diagnosing.
5. Once the incident is resolved, report a summary.

You have access to an MCP server representing the target infrastructure.
When a tool requires approval you will receive a \`tool_approval_required\` event.
Do NOT proceed without approval.`;

export const SAFETY_POLICY = `\
REJECT immediately if the proposed command:
- Contains "rm -rf /" or "rm -rf /*" or recursive deletion on a system directory
- Contains "chmod 777" or "chmod -R 777"
- Contains "--force" on a database migration or destructive DB operation
- Targets a production database without a backup confirmation in the same session
- Contains "kill -9" targeting PID 1 or any system critical process

WARN and pause if:
- The command targets a production host (prod-*, db-*, core-*)
- The command involves a restart, reboot, or service disable
- More than 3 destructive commands are queued in the same session

These checks are for display purposes only. Server-side enforcement is configured via MCP requireApprovalForTools.`;
```

> **Note:** `SAFETY_POLICY` here is our local layer — it renders the safety badges shown at the approval gate. It does not enforce anything server-side. Server-side enforcement is the MCP connector's `requireApprovalForTools` setting on the TrueForge server.

---

**Step 3 — `src/incident-plane.ts` (orchestration — alert handler, session lifecycle, stream iterator, approval gate)**

This is the main file. Build it in this order:

**3a — Types and broadcast infrastructure**

```typescript
// src/incident-plane.ts — imports + types
import { TrueForge } from "@truefoundry/trueforge-sdk";
import { normalizeAlert, CanonicalAlert } from "./incidents.js";
import { INCIDENT_RESPONDER_PROMPT, SAFETY_POLICY } from "./trueforge-config.js";

// All event shapes we send over WebSocket
export type WsEnvelope =
  | { type: "incident_created";    incident: Incident }
  | { type: "agent_thinking";       incident_id: string; content: string }
  | { type: "pending_approval";    incident_id: string; tool_name: string;
      tool_args: Record<string, unknown>; safety_badges: SafetyBadge[] }
  | { type: "execution_complete";   incident_id: string; output: string }
  | { type: "execution_denied";     incident_id: string }
  | { type: "error";               incident_id: string; message: string };

export interface SafetyBadge {
  name: string;
  status: "passed" | "warned" | "blocked";
  reason?: string;
}
```

**3b — `computeGateBadges(toolName: string, args: Record<string, unknown>): SafetyBadge[]`**

Parse the tool call and run the `SAFETY_POLICY` checks against the command string. Returns an array of badges for the operator to see.

```typescript
function toolCommandString(name: string, args: Record<string, unknown>): string {
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");
  return `${name} ${argsStr}`.trim();
}

function computeGateBadges(
  toolName: string,
  args: Record<string, unknown>
): SafetyBadge[] {
  const cmd = toolCommandString(toolName, args);
  const badges: SafetyBadge[] = [];

  // BLOCK rules — scan for毁灭性 patterns
  const blockPatterns = [
    /rm\s+-rf\s+\//, /rm\s+-rf\s+\/\*/,
    /chmod\s+777/, /chmod\s+-R\s+777/,
    /kill\s+-9\s+1/, /kill\s+-9\s+(init|pid\s*1)/i,
    /DROP\s+TABLE/i,
  ];
  for (const pat of blockPatterns) {
    if (pat.test(cmd)) {
      badges.push({ name: pat.source, status: "blocked", reason: "blocked pattern detected" });
    }
  }

  // WARN rules
  const warnPatterns = [
    /prod-/i, /db-/i, /core-/i,
    /\brestart\b/i, /\breboot\b/i, /\bservice\s+disable\b/i,
  ];
  for (const pat of warnPatterns) {
    if (pat.test(cmd)) {
      badges.push({ name: pat.source, status: "warned", reason: "production target" });
    }
  }

  if (badges.length === 0) {
    badges.push({ name: "all-clear", status: "passed" });
  }
  return badges;
}
```

**3c — `handleAlert(alert: CanonicalAlert, client: TrueForge): Promise<Incident>`**

Create incident record, start TrueForge session, kick off stream iterator:

```typescript
export async function handleAlert(
  alert: CanonicalAlert,
  client: TrueForge
): Promise<Incident> {
  const incident: Incident = {
    id: crypto.randomUUID(),
    ...alert,
    status: "diagnosing",
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  incidents.set(incident.id, incident);
  broadcast({ type: "incident_created", incident });

  // Kick off TrueForge session — non-blocking
  runIncidentSession(incident, client).catch((err) => {
    incident.status = "active";
    incident.updated_at = Date.now();
    broadcast({ type: "error", incident_id: incident.id, message: String(err) });
  });

  return incident;
}
```

**3d — `runIncidentSession(incident: Incident, client: TrueForge): Promise<void>`**

The session lifecycle — create session, build turn stream, iterate events:

```typescript
async function runIncidentSession(
  incident: Incident,
  client: TrueForge
): Promise<void> {
  const agent: CreateSessionAgent = {
    name: "incident-responder",
    description: "SRE incident responder",
    systemPrompt: `${INCIDENT_RESPONDER_PROMPT}\n\n${SAFETY_POLICY}`,
    mcpTools: [], // restrict to whatever MCP is configured server-side
  };

  const session = await client.sessions.create({ agent });
  incident.session_id = session.id;
  incident.updated_at = Date.now();

  const stream = client.sessions.createTurnStream(session.id);

  for await (const event of stream) {
    switch (event.event) {
      case "model.message": {
        // Accumulate reasoning content
        const text = extractText(event.message);
        if (text) {
          broadcast({ type: "agent_thinking", incident_id: incident.id, content: text });
        }
        break;
      }
      case "tool.approval_required": {
        incident.status = "awaiting_approval";
        incident.updated_at = Date.now();
        const badges = computeGateBadges(event.toolName, event.toolArguments);
        broadcast({
          type: "pending_approval",
          incident_id: incident.id,
          tool_name: event.toolName,
          tool_args: event.toolArguments,
          safety_badges: badges,
        });
        // Store pending approval so the /api/approvals handler can find it
        pendingApprovals.set(incident.id, {
          sessionId: session.id,
          toolCallId: event.toolCallId,
          incidentId: incident.id,
          status: "pending",
        });
        break;
      }
      case "turn.done": {
        incident.status = "completed";
        incident.updated_at = Date.now();
        broadcast({
          type: "execution_complete",
          incident_id: incident.id,
          output: event.summary ?? "Incident resolved.",
        });
        return;
      }
    }
  }
}
```

**3e — `POST /api/approvals` handler (Express)**

Resumes the pending turn with the operator's decision:

```typescript
app.post("/api/approvals", async (req, res) => {
  const { incident_id, decision } = req.body as {
    incident_id: string;
    decision: "approved" | "denied";
  };
  const pending = pendingApprovals.get(incident_id);
  if (!pending) return res.status(404).json({ error: "no pending approval" });

  pendingApprovals.delete(incident_id);

  if (decision === "denied") {
    // Abort the turn — no more tool calls
    await client.sessions.cancel(pending.sessionId);
    const incident = incidents.get(incident_id);
    if (incident) {
      incident.status = "denied";
      incident.updated_at = Date.now();
      broadcast({ type: "execution_denied", incident_id: incident.id });
    }
    return res.json({ ok: true });
  }

  // Resume with approval
  await client.sessions.resumeTurn(pending.sessionId, {
    toolApprovals: [{ toolCallId: pending.toolCallId, status: "allow" }],
  });
  res.json({ ok: true });
});
```

**3f — Multi-call gate handling**

If a second `tool.approval_required` arrives while the first tool is still executing, `pendingApprovals` already has an entry for this incident. The stream iterator re-enters `awaiting_approval` state (the switch case handles this naturally — the new event overwrites the pending entry). No special code needed.

**Files created:**
- `src/incidents.ts` — canonical alert shape, normalizer, in-memory store
- `src/trueforge-config.ts` — `INCIDENT_RESPONDER_PROMPT`, `SAFETY_POLICY`
- `src/incident-plane.ts` — all orchestration: Express routes, TrueForge session, stream iterator, approval handler

**Out of scope (deferred):**
- Sandbox event relay → PR #4
- Drift detection scheduler → post-hackathon follow-on (not numbered)
- GitHub PR generation → cut entirely

---

### `feat/live-wiring` *(PR #4)*

**Goal:** Four self-contained improvements built in any order on top of the merged PRs #1–3: sandbox event relay, live health summary, ops views wiring, and QA coverage. Each is independently mergeable.

---

#### 4a — Sandbox Event Relay

Forward `SandboxCreatedEvent` from the TrueForge turn stream to WebSocket clients. Sandbox is a server-side configuration — when enabled, the event appears in `createTurnStream` automatically. This PR adds one case to the stream iterator's event switch and extends the WebSocket envelope type.

**Step 1 — Extend `WsEnvelope` type**

```typescript
// Add to the WsEnvelope union in src/incident-plane.ts
export type WsEnvelope =
  // ... existing variants ...
  | { type: "sandbox_started"; incident_id: string; sandbox_id: string };
```

**Step 2 — Add `sandbox.created` case to the stream iterator**

In `runIncidentSession`, inside the `for await (const event of stream)` loop, add:

```typescript
case "sandbox.created": {
  broadcast({
    type: "sandbox_started",
    incident_id: incident.id,
    sandbox_id: (event as { sandboxId: string }).sandboxId,
  });
  break;
}
```

Cast `(event as { sandboxId: string })` — the `SandboxCreatedEvent` type from the SDK has a `sandboxId` field. Import it: `import type { SandboxCreatedEvent } from "@truefoundry/trueforge-sdk";`

**Scope:** ~30 lines.

---

#### 4b — Live Health Summary

Wire `HealthSummaryCard` (currently `mockHealthData.HEALTHY`) to a polled `/health` endpoint that returns real `uptime` and `trueforge_ready`.

**What exists:** `GET /health` already returns `ok: true`. It needs to return real data.

**Step 1 — Extend the health response**

In `src/server.ts`, augment the `/health` handler to include:

```typescript
// GET /health response shape
interface HealthResponse {
  ok: boolean;
  uptime_ms: number;
  trueforge_ready: boolean;
  incidents_active: number;
  incidents_total: number;
}
```

Read process `performance.now()` or `process.hrtime.bigint()` for uptime. Check TrueForge connectivity by attempting `client.server.getCapabilities()` — if it throws or times out, `trueforge_ready = false`.

**Step 2 — Frontend polling**

In the dashboard, replace `mockHealthData.HEALTHY` with a `useHealth` hook that polls `GET /health` every 10 seconds. `HealthSummaryCard` consumes the real data.

**Scope:** ~40 lines server-side + ~30 lines frontend hook.

---

#### 4c — Ops Views Wiring

Feed the four mocked dashboard views from real control-plane data instead of static mocks. Each view has a corresponding data source already in the control plane:

| Dashboard view | Data source | REST addition needed |
|---|---|---|
| `useFleetManager` | `incidents.ts` active incident list | `GET /incidents?status=active` |
| `usePolicyEngine` | Incidents by severity + service | `GET /incidents?summary=true` (aggregated counts) |
| `useIncidentArchive` | Resolved incidents | `GET /incidents?status=resolved&limit=N` |
| `useJobScheduler` | Session activity log | Already in WS events — stream to the view |

**Step 1 — Add REST endpoints**

In `src/incident-plane.ts`, add to the router:

```typescript
// GET /incidents — query by status, limit
router.get("/incidents", (req, res) => {
  const { status, limit = "50" } = req.query;
  const incidents = Array.from(incidents.values())
    .filter(i => !status || i.status === status)
    .slice(-Number(limit));
  res.json({ data: incidents });
});

// GET /incidents/summary — aggregated counts by severity and status
router.get("/incidents/summary", (_req, res) => {
  const all = Array.from(incidents.values());
  res.json({
    total: all.length,
    by_status: Object.groupBy(all, i => i.status),
    by_severity: Object.groupBy(all, i => i.severity),
  });
});
```

**Step 2 — Wire the dashboard hooks**

Each `use*` hook in `dashboard/client/src/hooks/` replaces the mock with a `fetch` call to the new REST endpoints. `useJobScheduler` additionally subscribes to WebSocket events and renders session lifecycle events.

**Scope:** ~50 lines server-side + ~80 lines across four frontend hooks.

---

#### 4d — Pipeline Hardening / QA

Improve failure-path coverage and demo ergonomics before the final demo.

**Failure paths to cover:**

| Scenario | Expected behavior | Test |
|---|---|---|
| `POST /alerts` with missing required field | 400 + descriptive error | New in `incidents.test.ts` |
| `POST /alerts` when incident store is at cap and all incidents are live | 503 `incident_store_full` | New in `incidents.test.ts` |
| `POST /api/approvals` for unknown `incident_id` | 404 | New in `incident-plane.test.ts` |
| `POST /api/approvals` after session already ended | Graceful — 200 or 404, no crash | New in `incident-plane.test.ts` |
| TrueForge session create fails (network) | `incident_created` emitted, then `error` with message | New in `incident-plane.test.ts` |
| WebSocket client disconnects mid-session | No crash — broadcast is fire-and-forget | Manual verification |

**Demo ergonomics:**

- `npm run dev` starts both control plane and (if `dashboard/` exists) the dashboard dev server with a concurrently script
- A `demo/` folder with a `curl` script that fires a sample alert and watches the WS events:

```bash
# demo/smoke.sh
WS_URL="ws://localhost:3000/ws"
ALERT='{"service_name":"test-svc","target_host":"test-host","alert_summary":"CPU > 90%","severity":"critical"}'

# Start WS monitor in background
node -e "
const ws = new WebSocket('$WS_URL');
ws.onmessage = m => console.log('WS:', m.data);
ws.onerror = e => console.error('WS ERR:', e);
" &
WS_PID=$!

# Fire alert
curl -s -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d "$ALERT"

# Wait for events
sleep 5

# Approve
INCIDENT_ID=$(some way to get it — or use a fixed test alert)
curl -X POST http://localhost:3000/api/approvals \
  -H "Content-Type: application/json" \
  -d "{\"incident_id\":\"$INCIDENT_ID\",\"decision\":\"approved\"}"

kill $WS_PID 2>/dev/null
```

**Scope:** ~150 lines of new tests + demo script.

---

**Out of scope (not part of this PR):**
- Drift detection scheduler — separate project, not in this repo
- GitHub PR generation — cut entirely
- Sandbox + drift automation from the old roadmap — gone

---

**Success Criteria for PR #4:**
- All 4 components (4a–4d) independently mergeable within the same branch
- `npm run typecheck` clean
- `npm test` — all suites including new failure-path coverage green
- Live smoke test: `npm run dev` → `curl POST /alerts` → WS events flow → `POST /api/approvals` → `execution_complete`


**Deliverables:**
- [ ] Build script (tsup):
  ```bash
  npm run build
  # Output: dist/incident-agent.js (bundled + minified)
  ```
- [ ] `package.json`:
  ```json
  {
    "name": "@incident-agent/cli",
    "version": "1.0.0",
    "bin": { "incident-agent": "./dist/incident-agent.js" },
    "scripts": {
      "serve": "node dist/index.js serve",
      "build": "tsup src/index.ts --format esm,cjs --outDir dist"
    }
  }
  ```
- [ ] One-liner installer:
  ```bash
  curl -fsSL https://get.incident-agent.io/install.sh | bash
  ```
- [ ] GitHub Actions CI/CD:
  - Build on every push to main
  - Run test suite
  - Publish to npm on tag

**Scope:** ~100 lines of build config + shell script
**Success Criteria:**
- `npm install -g @incident-agent/cli`
- `incident-agent serve` works globally
- GitHub Actions CI passes

---

## 5. Control Plane: What Each PR Enables

| **PR** | **What It Unlocks** | **Demo-Ready Proof** |
|---|---|---|
| #1 | TrueForge SDK client, WebSocket relay | `incident-agent serve` → health check passes |
| #3 | Alert → approval gate (end-to-end) | Webhook → `createTurnStream` → `ToolApprovalRequiredEvent` → `ApprovalDecision` → session completes |
| #4 | Sandbox event relay | `SandboxCreatedEvent` forwarded as `sandbox_started` over WebSocket |
| #5 | Distribution + one-liner setup | `npm i -g @incident-agent/cli && incident-agent serve` works globally |

**Operator console (Electron): not numbered.** Wires at the end if time allows. Consumes the same WebSocket events; does not change the control plane.

**Drift detection: not numbered.** Post-hackathon follow-on. Uses `node-cron`; not a TrueForge primitive.

**Qodo runs live on every PR** — no dedicated audit PR. Findings surface in PR comments and are addressed before merge.

---

## 6. Technical Deep-Dives (By PR)

### PR #1: TrueForge SDK Client Initialization & Express Harness

**Already merged.** Key patterns from the implementation:

```typescript
// src/trueforge.ts
import { TrueForge } from "@truefoundry/trueforge-sdk";

export function createTrueForgeClient(): TrueForge {
  return new TrueForge({
    baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
    token: process.env.TRUEFORGE_API_TOKEN ?? "changeme",
    fetchOptions: { signal },
  });
}

export interface TrueForgeStatus {
  serverReady: boolean;
  sandboxEnabled: boolean;
  version: string;
}

// src/server.ts — GET /health
app.get("/health", async (req, res) => {
  try {
    const client = createTrueForgeClient();
    const caps = await client.server.getCapabilities();
    res.json({
      status: "ok",
      serverReady: true,
      sandboxEnabled: caps.sandbox?.enabled ?? false,
      version: "0.1.4",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({ status: "error", serverReady: false });
  }
});
```

**What to configure on the TrueForge server (not in this repo):**
- MCP connectors: SSH, CLI, filesystem — configured at `:8790` → Settings → Connectors
- `requireApprovalForTools` per MCP: set to `["@write", "@destructive"]` for MCPs that should gate behind the approval flow
- Sandbox provider: set via Settings → Sandbox (Anthropic sandbox runtime or Daytona)
- Auth token: generate at `:8790` → Settings → API Tokens

---

### PR #3: Alert Webhook & TrueForge Orchestration

**Already merged — implementation in `src/incident-plane.ts`, `src/incidents.ts`, `src/trueforge-config.ts`.**

The reference implementation in the worktree uses the real SDK:

```typescript
// Simplified from src/incident-plane.ts
const client = createTrueForgeClient();
const session = await client.sessions.create({
  agent: { name: "incident-responder" },
});

const stream = client.sessions.createTurnStream(session.id, {
  input: [{ role: "user", content: { story: alertMessage } }],
});

for await (const event of stream) {
  switch (event.event) {
    case "model.message":
      broadcast({ type: "agent_thinking", content: event.data.reasoningContent });
      break;
    case "tool.approval_required": {
      const badges = computeGateBadges(event.data.toolCalls);
      broadcast({ type: "pending_approval", incident_id, tool_calls: event.data.toolCalls, safety_badges: badges });
      incident.state = "awaiting_approval";
      break;
    }
    case "turn.done":
      broadcast({ type: "execution_complete", incident_id, status: "done" });
      break;
  }
}
```

Approval resume (from POST `/api/approvals`):
```typescript
// Resume the turn stream with the operator's decision
const decision = req.body.decision === "approved"
  ? { status: "allow", toolCallIds: toolCalls.map(t => t.id) }
  : { status: "deny", reason: "Operator rejected" };

// Feed decision back into the stream via createTurnStream
const resumeStream = client.sessions.createTurnStream(session.id, {
  input: [{ role: "user", content: { toolApproval: decision } }],
});
```

---

### PR #4: Sandbox Event Relay

~30 lines. Adds one case to the `createTurnStream` event switch in `incident-plane.ts`:

```typescript
case "sandbox.created": {
  broadcast({ type: "sandbox_started", incident_id, sandbox_id: event.sandboxId });
  break;
}
```

Sandbox is server-configured. When enabled, `sandbox.created` appears automatically in `createTurnStream`. There is no per-run mode selection.

---

## 7. Operator Console Wiring (Informational)

The Electron operator console is **not a numbered PR**. This section is for reference only — it describes how the console wires to the control plane WebSocket, for use if/when that work is explicitly prioritized.

The console connects to `ws://localhost:3000/ws` and consumes the same JSON events the control plane emits. It does not share process, state, or build system with this repo.

```javascript
// main process — Electron main.ts
const ws = new WebSocket("ws://localhost:3000/ws");

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  mainWindow.webContents.send("tf-event", msg);
});

// renderer — React component
ipcRenderer.on("tf-event", (event, msg) => {
  switch (msg.type) {
    case "pending_approval":
      setPendingApproval(msg);
      break;
    case "agent_thinking":
      appendThinking(msg.content);
      break;
    case "execution_complete":
      setPendingApproval(null);
      break;
  }
});
```

Approval buttons POST directly to the control plane:
```javascript
async function handleApproval(incidentId, decision) {
  await fetch("http://localhost:3000/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incident_id: incidentId, decision }),
  });
}
```

The TrueForge built-in UI at `:8790` runs independently. Both can be open simultaneously.

---

## 8. Execution Timeline

| **Week** | **PRs** | **Milestone** |
|---|---|---|
| **Week 1** | #4 | Sandbox event relay (~30 lines) — last remaining control plane piece |
| **Week 2** | #5 | npm packaging + GitHub Actions CI/CD |
| **Week 3** | — | Integration testing; verify full end-to-end loop with TrueForge server |
| **Post-hackathon** | — | Electron operator console (only if time allows); drift detection never (separate project) |

---

## 9. Hackathon Scoring Strategy

| **Criterion** | **Our Strength** | **Scoring Tactic** |
|---|---|---|
| **Sponsor Tools Integration (04)** | Deep TrueForge usage: `createTurnStream`, `ToolApprovalRequiredEvent`, MCP connectors, sandbox events | Show real SDK call in the demo; highlight that the approval gate is TrueForge-native |
| **Technical Execution (01)** | Clean, well-tested codebase using the real `@truefoundry/trueforge-sdk` API | Show test suite passing; highlight that the implementation uses actual SDK types |
| **Innovation (02)** | Human-in-the-Loop SRE automation | Demo: alert → reasoning visible → operator approves → execution — all in <2 min |
| **Presentation (05)** | TrueForge built-in UI at `:8790` running in parallel | Show TrueForge UI + our control plane working together |
| **Completeness (03)** | PRs #1, #3, #4, #5 shipped | Show working `incident-agent serve`, full approval loop, CI/CD green |

---

## 10. Success Criteria & Done Definition

### By End of Hackathon:

- [ ] **PR #3 Merged:** `incident-plane.ts` alert → `createTurnStream` → `ToolApprovalRequiredEvent` → `ApprovalDecision` → `cancel()` on reject. All tests pass.
- [ ] **PR #4 Merged:** `SandboxCreatedEvent` forwarded as `sandbox_started` over WebSocket. `WsEnvelope` type updated.
- [ ] **PR #5 Merged:** `npm install -g @incident-agent/cli && incident-agent serve` works globally; GitHub Actions CI green
- [ ] **Live Demo:** `curl -X POST :3000/alerts -d '{...}'` → TrueForge UI at `:8790` shows reasoning → approve or reject via `curl -X POST :3000/api/approvals` → session completes. No custom UI required for the demo to succeed.
- [ ] **Documentation:** README with quick-start (TrueForge server on `:8790`, control plane on `:3000`)
- [ ] **GitHub Actions:** Build + test pipeline green on all merged PRs

### Post-hackathon follow-ons (not required for demo):

- **Electron operator console:** connects to `ws://localhost:3000/ws`, renders incident queue and approval interceptor
- **Push automation:** entirely separate project; not a follow-on, not part of this repo

---

## 11. Risk Mitigation

| **Risk** | **Mitigation** |
|---|---|
| TrueForge server not reachable | `/health` endpoint returns 503; Electron app shows "disconnected" state |
| `ToolApprovalRequiredEvent` doesn't fire in demo (MCP tools not configured on server) | Demo uses a mock MCP that always triggers approval; document that production requires `requireApprovalForTools` config on the server |
| Electron app wiring takes too long | Fall back to `wscat` or browser JS console as the WebSocket consumer — the approval loop works without any custom UI |
| Sandbox events don't appear (server sandbox not configured) | Document server-side config requirement; accept that `sandbox_started` won't fire without sandbox provider setup |

---

## 12. Quick-Start for Execution

1. **Start TrueForge server:**
   ```bash
   npx @truefoundry/trueforge --port 8790
   # Opens: http://localhost:8790 (built-in UI)
   # Configure MCP connectors at :8790 → Settings → Connectors
   ```

2. **Start the control plane:**
   ```bash
   npm run build && npm run serve
   # WebSocket: ws://localhost:3000/ws
   ```

3. **Start the operator console (optional, not part of numbered sequence):**
   ```bash
   cd ../incident-operator-console  # separate repo
   npm run start
   # Connects to ws://localhost:3000/ws
   ```

4. **Send a test alert:**
   ```bash
   curl -X POST http://localhost:3000/alerts \
     -H "Content-Type: application/json" \
     -d '{"service_name": "postgres", "target_host": "prod-db-01", "alert_summary": "CPU > 80%", "severity": "warning"}'
   ```

5. **Approve or reject:**
   ```bash
   curl -X POST http://localhost:3000/api/approvals \
     -H "Content-Type: application/json" \
     -d '{"incident_id": "<id>", "decision": "approved"}'
   ```

---

## Summary

**What this repo is:** a control plane that routes alert webhooks into TrueForge sessions and relays TrueForge events to a custom operator console. TrueForge (server) owns the engine: LLM, MCP, sandbox, HITL gate, and event stream. This repo owns the control surface: alert routing, event relay, and incident-specific UX.

**What TrueForge owns:** LLM reasoning, MCP orchestration, `ToolApprovalRequiredEvent`, `SandboxCreatedEvent`, SSE event stream via `createTurnStream`.

**What this repo owns:** Express webhook endpoint, `createTurnStream` async iterator, event-to-WebSocket relay, in-memory incident store, `computeGateBadges()` safety display, approval callback.

**What was cut:** PR #2 (numbered React/Electron dashboard — not part of the numbered sequence; Electron app is a possible future addition only if time allows), PR #6 (GitHub PR generation — entirely), PR #7 (Qodo dedicated audit PR — Qodo runs live on every PR), push automation (drift detection — separate project, not part of this repo), all fabricated SDK methods (`TrueForge.run()`, `trueforge.sandbox()`, `trueforge.resolveApproval()`, `trueforge.mcp().exec()`), and the "built-in cron" claim (TrueForge has no scheduler).

**The plan in 5 numbered PRs:** PRs #1 and #3 already merged; PRs #4 and #5 are the remaining control plane work. Electron operator console and push automation are not numbered and are not required for the demo.

---

**Ready to merge PR #3 to main?** The worktree implementation uses the real SDK API correctly and already has tests.
