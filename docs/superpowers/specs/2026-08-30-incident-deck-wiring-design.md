# Incident Command Deck — Full Wiring Design Spec

**Date:** 2026-08-30
**Branch:** `approval-gate-wiring`
**Source:** `demo_final.md` (10-item wiring checklist)
**Approach:** Layered Control Plane Architecture — all live endpoints centralized under `/api/*` in Express, SQLite persistence, WebSocket real-time sync, frontend hooks rewritten against real APIs.

---

## Current State Summary

### Backend — What Exists

| Component | Status | Location |
|---|---|---|
| Express server + CORS + WS | ✅ Built | `src/server.ts` |
| TrueForge SDK init + sessions + approval flow | ✅ Built | `src/trueforge.ts`, `src/incident-plane.ts` |
| Incident CRUD (in-memory Map, 1000 cap, 1h TTL) | ✅ Built | `src/incidents.ts` |
| Policy rules CRUD + AST simulate | ✅ Built | `src/policy.ts`, `src/routes/policy.ts` |
| Sandbox settings (Daytona) | ✅ Built | `src/routes/sandbox.ts` |
| Pre-session target capture + command-scope blast radius | ✅ Built | `src/capture.ts`, `src/command-scope.ts` |
| Multi-format webhook ingestion (Canonical, Prometheus, PagerDuty) | ✅ Built | `src/incident-plane.ts` |

### Backend — What's Missing

| Component | Status |
|---|---|
| SQLite persistence (all storage is in-memory Maps) | ❌ Missing |
| SSH/Podman probe endpoints | ❌ Missing |
| Model config listing endpoint | ❌ Missing |
| Policy profiles, stats, enforcement mode routes | ❌ Missing |
| Sessions list endpoint | ❌ Missing |
| Fleet topology endpoint | ❌ Missing |
| Emergency stop endpoint | ❌ Missing |
| General settings CRUD | ❌ Missing |

### Frontend — What's Real

| Component | Status | Detail |
|---|---|---|
| WebSocket + incident stream | ✅ Real | `useControlPlane.ts` |
| Approval flow (approve/reject) | ✅ Real | `POST /api/approvals` |
| Health polling | ✅ Real | `useHealth.ts` → `GET /api/health-summary` |
| Terminal stream | ✅ Real | xterm + WS chunks |

### Frontend — What's Mock

| Component | Status | Detail |
|---|---|---|
| `usePolicyEngine` hook | ❌ Mock | Reads `mockGovernanceData.ts`, zero network calls |
| `GovernanceView` | ❌ Mock | Beautiful UI, entirely static data |
| `FirstRunSetup` | ❌ Mock | 650ms fake connection test, localStorage only |
| `AgentStatusCapabilitiesBar` | ⚠️ Partial | Stateless presenter; GATED toggle fires callback but parent doesn't POST; model is static text |
| Workspace cards (Topology, BlastRadius) | ❌ Mock | All use mock fixtures |
| Settings dialog (Skills/MCPs) | ❌ Mock | Mock lists |
| SSH manager | ❌ Mock | Mock target list |

---

## Architecture

### Data Flow

```
TrueForge MCP (localhost:8790)
        │
        ▼
Control Plane (localhost:3001)
  ├── Express REST API (/api/*)
  ├── WebSocket Server (/ws)
  ├── SQLite DB (incidents, policy, sessions, settings, fleet)
  └── TrueForge SDK client
        │
        ▼ (HTTP + WS)
Dashboard (localhost:3000)
  ├── React 19 + Vite 7
  ├── Hooks: useControlPlane, usePolicyEngine, useHealth
  └── Components: GovernanceView, FirstRunSetup, AgentStatusBar, WorkspaceCards
```

### Persistence Strategy

| Data | Storage | Rationale |
|---|---|---|
| Incidents, approval audit log | SQLite `incidents` table | Survives restarts, queryable |
| Policy rules, profiles | SQLite `policy_rules`, `policy_profiles` | CRUD with history |
| Sessions (thread history) | SQLite `sessions` | Sidebar session list |
| Settings (model, mode, sandbox URL) | SQLite `settings` (key-value) | Single source of truth |
| Fleet host state | SQLite `fleet_hosts` | Probe results cache |
| TrueForge conversation context | TrueForge sessions (thread_id) | Multi-turn memory |
| UI preferences (theme, rail state) | Browser `localStorage` | Client-only, non-critical |

---

## Layer 0: Foundation

### 0a. SQLite Persistence Layer

**New file:** `src/db.ts`
**New dependency:** `better-sqlite3`

Schema (idempotent `CREATE TABLE IF NOT EXISTS`):

```sql
-- Incidents (migrate from in-memory Map)
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'created',
  alert_json TEXT NOT NULL,
  session_id TEXT,
  thread_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Policy rules (migrate from in-memory Map, seed defaults)
CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  regex TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  reason_description TEXT,
  match_expression TEXT,
  binary_name TEXT,
  forbidden_flags TEXT, -- JSON array
  created_at TEXT NOT NULL
);

-- Policy profiles
CREATE TABLE IF NOT EXISTS policy_profiles (
  name TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  rule_ids TEXT NOT NULL, -- JSON array of rule IDs
  created_at TEXT NOT NULL
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  incident_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

-- Settings (key-value)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Fleet hosts
CREATE TABLE IF NOT EXISTS fleet_hosts (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  ip TEXT,
  port INTEGER DEFAULT 22,
  ssh_user TEXT,
  ssh_key_path TEXT,
  podman_socket TEXT,
  last_probe_status TEXT, -- 'online' | 'offline' | 'error'
  last_probe_at TEXT,
  probe_latency_ms INTEGER,
  probe_error TEXT,
  os_info TEXT,
  created_at TEXT NOT NULL
);
```

**Migration path for existing in-memory stores:**
- `incidents.ts`: Replace `Map<string, Incident>` reads/writes with SQLite queries. Keep the `normalizeAlert`/`normalizeWebhooks` functions as-is.
- `policy.ts`: Replace `Map<string, PolicyRule>` with SQLite reads/writes. Keep `simulatePolicy` and `parseAstNodes` as-is (they operate on rule arrays, not the storage layer). Seed default rules on first boot if table is empty.

**Init:** `initDb()` called from `src/index.ts` before `startServer()`. Returns a `Database` handle passed to route factories.

### 0b. Logo Replacement

- Copy `/home/rs/Downloads/800444533751307567-removebg-preview.png` → `dashboard/client/public/brand-logo.png`
- Update `Home.tsx`: rail brand mark + assistant avatar image sources
- Update `FirstRunSetup.tsx`: any logo references
- Remove old SVG placeholder imports

---

## Layer 1: Backend API Surface

All new route files follow the existing pattern (`createXxxRouter(opts)` returning an Express `Router`, mounted in `src/index.ts` via `registerRoutes`).

### 1a. Fleet & SSH Probe Routes (`src/routes/fleet.ts`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/fleet/hosts` | List all registered hosts from SQLite with last probe status |
| `POST` | `/api/fleet/hosts` | Register a new host (hostname, port, ssh_user, ssh_key_path, podman_socket) |
| `POST` | `/api/fleet/probe` | Probe a specific host: Podman socket liveness + SSH TCP handshake |
| `DELETE` | `/api/fleet/hosts/:id` | Remove a host |

**Podman probe:** `node:http` GET request to unix socket path (`/run/user/1000/podman/podman.sock`) hitting `/_ping`. Returns `{ podman: true, version }` on success.

**SSH probe:** `node:net` TCP `connect()` to `host:port` with 5s timeout. Measures latency. Returns `{ ssh: true, latency_ms }` on success, `{ ssh: false, error }` on failure.

**Probe result:** Persisted to `fleet_hosts` table. Broadcasts `fleet_updated` WS event.

### 1b. Model Config Route (`src/routes/models.ts`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/models` | List available models |

**Implementation:** If TrueForge SDK exposes a model listing endpoint, proxy it. Otherwise, return a static list derived from env config (`TRUEFORGE_MODEL`) plus known model options (e.g., `anthropic/claude-sonnet-5`, `anthropic/claude-sonnet-4`, `google/gemini-2.5-pro`). Include a `"local"` option that signals the frontend to show a base URL input.

### 1c. Settings Routes (`src/routes/settings.ts`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/settings` | Read all settings (model, enforcement_mode, sandbox_url, operator_name, skills, mcps) |
| `PUT` | `/api/settings` | Upsert settings key-value pairs |

**Skills & MCPs:** Stored as JSON arrays in the `settings` table under keys `skills` and `mcps`. Preconfigured defaults seeded on first boot:
- Skills: `["diagnostic", "remediation", "runbook"]`
- MCPs: `["ssh", "cli", "filesystem"]`

### 1d. Policy Extensions (extend `src/routes/policy.ts`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/policy/profiles` | List profiles from SQLite |
| `PUT` | `/api/policy/profiles/:name` | Switch active profile (deactivate others, activate named) |
| `GET` | `/api/policy/stats` | Live stats: active rule count, blacklisted binary count, high-risk pattern count, intercepted action count |
| `PUT` | `/api/policy/mode` | Set enforcement mode (`AUTONOMOUS` / `STRICT_GATED` / `DRY_RUN`) in settings table |
| `POST` | `/api/policy/analyze` | Alias for existing `/api/policy/simulate` — takes `{ command }`, returns AST nodes + risk score |

**Default profiles seeded:**
- `"Production Safe"` — all rules enabled
- `"Strict Read-Only"` — all rules enabled + extra FS write rules
- `"Staging Unrestricted"` — only CRITICAL_BLOCK rules enabled
- `"Zero-Trust"` — all rules at CRITICAL_BLOCK severity

### 1e. Sessions Route (`src/routes/sessions.ts`)

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/sessions` | List past sessions (thread_id, incident_id, summary, created_at) from SQLite |
| `GET` | `/api/sessions/:id` | Get single session detail |

**Population:** When `incident-plane.ts` receives a `sandbox_started` event with `thread_id`, insert a row into the `sessions` table. Update summary when incident completes.

### 1f. Emergency Stop Route

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/emergency-stop` | Cancel all active TrueForge sessions |

**Implementation:** Iterate active incidents with status `diagnosing` or `awaiting_approval`, call `client.sessions.cancel(sessionId)` for each, set incident status to `failed`. Broadcast `execution_complete` with `status: "failed"` for each.

---

## Layer 2: Backend Integration

### 2a. Wire Enforcement Mode into Approval Gate

In `src/incident-plane.ts`, modify the `tool_approval_required` event handler:

1. Read `enforcement_mode` from settings DB
2. Branch on mode:
   - `AUTONOMOUS` → auto-approve: immediately send `user.tool_approval { status: "allow" }` back to TrueForge without waiting for human
   - `STRICT_GATED` → current behavior: broadcast `pending_approval`, wait for `POST /api/approvals`
   - `DRY_RUN` → log the proposed command and safety badges, auto-deny with `user.tool_approval { status: "deny" }`, broadcast `execution_complete { status: "rejected" }` with a `dry_run: true` flag

### 2b. WebSocket Event Extensions

New broadcast events from control plane:

| Event Type | Trigger | Payload |
|---|---|---|
| `policy_stats_update` | Rule toggled, rule created/deleted, command intercepted | `{ activeRules, blacklistedBinaries, highRiskPatterns, interceptedCount }` |
| `fleet_updated` | Probe completes | `{ host_id, status, latency_ms }` |
| `session_created` | New TrueForge session starts | `{ session_id, thread_id, incident_id, created_at }` |
| `agent_mode_changed` | Enforcement mode changes | `{ mode: "AUTONOMOUS" | "STRICT_GATED" | "DRY_RUN" }` |

---

## Layer 3: Frontend Wiring

### 3a. Rewrite `usePolicyEngine` Hook

Replace all `mockGovernanceData` imports with real API calls:

- **Initial load:** `GET /api/policy/rules`, `GET /api/policy/profiles`, `GET /api/policy/stats`, `GET /api/settings` (for enforcement mode)
- **Mutations:** `PUT /api/policy/rules/:id` (toggle), `POST /api/policy/rules` (create), `PUT /api/policy/profiles/:name` (switch), `PUT /api/policy/mode` (mode change), `POST /api/policy/analyze` (AST canvas)
- **Live updates:** WS listener for `policy_stats_update` to refresh stats without polling
- **`GovernanceView.tsx` changes:** None — it's already a controlled component consuming the hook's return value

### 3b. Rewrite `FirstRunSetup.tsx`

- **Step 1 (Launch Path):** SSH host/port/key fields → `POST /api/fleet/probe` on "Test Connection" button. Display real latency/error.
- **Step 2 (Model Config):** Replace text input with `<select>` dropdown populated from `GET /api/models`. "local" option reveals base URL input. Register host via `POST /api/fleet/hosts` on connection test success.
- **New section between Step 2 and Step 3:** Sandbox Config — single Daytona URL input, saved via `PUT /api/settings/sandbox`.
- **Step 3 (Safeguards):** Operator name + Gated/Autonomous toggle.
- **On complete:** `PUT /api/settings` to persist all config to control plane DB. Keep `localStorage` for UI-only prefs (theme, setup-complete flag).

### 3c. Wire `AgentStatusCapabilitiesBar`

In `Home.tsx`, wire the parent callbacks:

- **GATED toggle:** `onToggleApprovalMode` → `PUT /api/policy/mode`. Optimistic UI, revert on error.
- **Model dropdown:** Replace static `data.telemetry.activeModel` text with `<select>` from `GET /api/models`. On change → `PUT /api/settings { model }`.
- **Emergency stop:** `onEmergencyStop` → `POST /api/emergency-stop`. Show confirmation dialog first.
- **SSH actions:** Reconnect → `POST /api/fleet/probe` for active target.

### 3d. Wire Workspace Cards

- **TopologyMapCard:** Replace `mockTopologyData` with `GET /api/fleet/hosts`. WS `fleet_updated` for live node status changes. Existing SVG graph renderer works as-is with different data shape.
- **BlastRadiusCard:** Populated per-incident from `pending_approval` WS event. The `safety_badges` and `diff` from `command-scope.ts` already match the card's expected data shape — wire the event payload directly to the card's `data` prop.
- **SandboxTwinCard:** Already partially wired (accepts `sandboxId` prop). No additional changes needed.

### 3e. Sessions List Component

**New file:** `dashboard/client/src/components/SessionsList.tsx`

- Positioned in left navigation rail below existing nav items
- `GET /api/sessions` on mount
- Renders scrollable list: each entry shows timestamp, incident summary (truncated), thread status indicator
- Click → reload conversation context for that session
- WS listener for `session_created` to prepend new entries

### 3f. Settings Dialog Wiring

- **Skills section:** Fetch from `GET /api/settings` (key: `skills`). Render preconfigured list with checkboxes. Add button opens text input for custom skill name. Save → `PUT /api/settings`.
- **MCPs section:** Same pattern with key `mcps`.
- Both are simple string arrays; no complex schema needed.

---

## Implementation Order

```
Layer 0 (Foundation)
  ├── 0a. SQLite persistence layer (src/db.ts + better-sqlite3 dep)
  ├── 0b. Logo replacement (asset copy + import updates)
  └── 0c. Migrate incidents.ts and policy.ts to SQLite read/write
          │
Layer 1 (Backend APIs) — all parallelizable
  ├── 1a. Fleet/SSH probe routes (src/routes/fleet.ts)
  ├── 1b. Model config route (src/routes/models.ts)
  ├── 1c. Settings routes (src/routes/settings.ts)
  ├── 1d. Policy extensions (profiles, stats, mode in src/routes/policy.ts)
  ├── 1e. Sessions route (src/routes/sessions.ts)
  └── 1f. Emergency stop route (in src/routes/fleet.ts or incident-plane.ts)
          │
Layer 2 (Backend Integration)
  ├── 2a. Wire enforcement mode into approval gate (incident-plane.ts)
  └── 2b. WebSocket event extensions (server.ts + route handlers)
          │
Layer 3 (Frontend Wiring)
  ├── 3a. Rewrite usePolicyEngine hook
  ├── 3b. Rewrite FirstRunSetup.tsx
  ├── 3c. Wire AgentStatusCapabilitiesBar
  ├── 3d. Wire workspace cards (Topology, BlastRadius)
  ├── 3e. Sessions list component
  └── 3f. Settings dialog wiring
```

---

## Files Changed / Created

### New Files
| File | Purpose |
|---|---|
| `src/db.ts` | SQLite schema, init, query helpers |
| `src/routes/fleet.ts` | Fleet host CRUD + Podman/SSH probes |
| `src/routes/models.ts` | Model listing endpoint |
| `src/routes/settings.ts` | General settings CRUD |
| `src/routes/sessions.ts` | Session history endpoint |
| `dashboard/client/src/components/SessionsList.tsx` | Sidebar sessions list |
| `dashboard/client/public/brand-logo.png` | Brand logo asset |

### Modified Files
| File | Changes |
|---|---|
| `package.json` | Add `better-sqlite3` dependency |
| `src/index.ts` | Mount new routers, call `initDb()` |
| `src/server.ts` | Pass DB handle to route factories |
| `src/incidents.ts` | Replace in-memory Map with SQLite queries |
| `src/policy.ts` | Replace in-memory Map with SQLite queries |
| `src/routes/policy.ts` | Add profiles, stats, mode, analyze routes |
| `src/incident-plane.ts` | Enforcement mode check in approval gate, session row insert |
| `dashboard/client/src/hooks/usePolicyEngine.ts` | Replace mock imports with real API calls |
| `dashboard/client/src/components/FirstRunSetup.tsx` | Model dropdown, sandbox config, real probe |
| `dashboard/client/src/pages/Home.tsx` | Wire AgentStatusBar callbacks, replace mock card data, add SessionsList, update logo |
| `dashboard/client/src/components/AgentStatusCapabilitiesBar.tsx` | Model dropdown select element |
| `dashboard/client/src/components/workspace-cards/TopologyMapCard.tsx` | Accept real fleet data |
| `dashboard/client/src/components/workspace-cards/BlastRadiusCard.tsx` | Accept per-incident approval data |

### Deleted Files
| File | Reason |
|---|---|
| `dashboard/client/src/data/mockGovernanceData.ts` | Replaced by real API |
| `dashboard/client/src/data/mockAgentStatus.ts` | Replaced by real health endpoint |
| `dashboard/client/src/data/mockFleetData.ts` | Replaced by real fleet endpoint |

> **Note:** Mock data files are deleted only after their corresponding real API wiring is complete and verified. During development, the mock files serve as the reference data shape contract.

---

## Testing Strategy

- **Backend routes:** Node test runner (`npm test`) with HTTP assertions against each new route
- **Policy engine:** Existing `src/policy.test.ts` extended for profiles/stats/mode
- **SQLite persistence:** Test CRUD lifecycle for each table
- **Probe endpoints:** Test with both reachable and unreachable targets (timeout handling)
- **Frontend:** Manual verification against running control plane — each mock replacement verified by toggling the mock import back if the API is down
- **Integration:** Full flow test: FirstRunSetup → configure model/SSH → trigger alert → approval gate respects enforcement mode → session appears in sidebar

---

## Out of Scope

- Multi-user authentication / RBAC (bearer-free API by design)
- Production SQLite WAL tuning or connection pooling
- TrueForge SDK model listing (if SDK doesn't expose it, use static list)
- Remote SSH command execution through the probe endpoint (probes are connectivity checks only)
- Historical incident replay / session transcript rendering
