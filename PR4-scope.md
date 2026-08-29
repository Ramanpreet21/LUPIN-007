# PR #4 — `feat/live-wiring`

**Branch:** `feat/live-wiring`
**Base:** `origin/main` (PRs #1–#3 merged)
**Goal:** Drive the health card and incident archive from live backend data; wire sandbox setup and runtime relay end-to-end.

---

## What exists on main

| Surface | Current source |
|---|---|
| HealthSummaryCard | `mockHealthData.HEALTHY` (fixture) |
| Incident archive | `mockArchiveData` (fixture) |
| SandboxTwinCard | `mockSandboxTwinData` (fixture) |
| Fleet / Policy / Job views | fixtures — untouched in this PR |

| Backend surface | Current state |
|---|---|
| `GET /health` | Returns `{ status, uptime, trueforge_ready, trueforge }` |
| `GET /incidents` | Not implemented |
| `GET /api/settings/sandbox` | Not implemented |
| `PUT /api/settings/sandbox` | Not implemented |
| `sandbox.created` relay | Not implemented |
| Session creation | No `config.sandbox.enabled` |

---

## Scope

### 4a — Sandbox Setup API

**Goal:** Allow the operator to enter a Daytona API key via the setup page. The control plane stores it and configures the TrueForge sandbox provider on behalf of the operator.

**Backend:**

```
PUT /api/settings/sandbox
Body: { apiKey: string }
```

- Store API key in memory (single global, not per-tenant)
- Call `client.settings.sandboxProviders.createOrUpdate()` with the API key + hardcoded Daytona preset values:
  - `type: "daytona"`
  - `autoStopIntervalInMinutes: 30`
  - `autoArchiveIntervalInMinutes: 60`
  - `autoDeleteIntervalInMinutes: 1440` (24h)
  - `execTimeoutMs: 300000` (5 min)
- On success: mark sandbox as `configured`
- On error: surface the error (e.g. key missing snapshot permission → 400 with descriptive message)

```
GET /api/settings/sandbox
```

- Returns `{ configured: boolean, status: "unconfigured" | "pending" | "ready" | "error", errorReason?: string }`
- `status` comes from `client.settings.sandboxProviders.get().data.status` if a provider is configured; otherwise `unconfigured`

**New file:** `src/sandbox-settings.ts` — holds the in-memory API key + status, exports `getSandboxSettings()`, `updateSandboxSettings(apiKey)`.

**New file:** `src/routes/sandbox.ts` — Express router with `GET /api/settings/sandbox` and `PUT /api/settings/sandbox`.

**No new backend concept for presets** — the control plane hardcodes the Daytona preset values. The operator only supplies the API key.

**Scope:** ~80 lines server-side.

---

### 4b — Sandbox Runtime (session creation)

**Goal:** When a TrueForge session is created for an incident, enable sandbox mode so the agent can use code/file/shell tools.

**Change:** In `src/incident-plane.ts`, `runDiagnosis()`, update the `sessions.create` call:

```typescript
const { data } = await client.sessions.create({
  agent: {
    name: "incident-responder",
    description: "SRE incident responder",
    config: {
      sandbox: {
        enabled: true,
      },
    },
  },
});
```

**Scope:** ~5 lines.

---

### 4c — Sandbox Event Relay

**Goal:** Forward `sandbox.created` from the TrueForge turn stream to WebSocket clients so the dashboard can show a live sandbox started event.

**Change:** In the `runDiagnosis` stream iterator (`for await (const ev of stream)`), add one case:

```typescript
case "sandbox.created": {
  broadcast({
    type: "sandbox_started",
    incident_id: incident.id,
    sandbox_id: (ev as SandboxCreatedEvent).sandboxId,
  });
  break;
}
```

Import `SandboxCreatedEvent` from `@truefoundry/trueforge-sdk`.

**Scope:** ~10 lines.

---

### 4d — Live Health Summary

**Goal:** Replace `mockHealthData.HEALTHY` with real `/health` data.

**Backend:** Extend `GET /health` in `src/server.ts` to include `incidents_active` count (from the `incidents` map in `incident-plane.ts`). The TrueForge status is already returned via `getStatus()`.

```typescript
// GET /health response shape
interface HealthResponse {
  status: "ok";
  uptime: number;          // already exists
  trueforge_ready: boolean; // already exists
  incidents_active: number; // new — count of non-terminal incidents
  incidents_total: number;  // new — total in store
}
```

Access the incident store via a shared reference. **Do not export the incidents map directly** — wrap with a function.

**Frontend:** New `useHealth` hook that polls `GET /health` every 10 seconds. `HealthSummaryCard` renders the live fields.

**Slim the card** — remove gauges (RPS, error rate, burn rate, budget remaining) that have no backend data source. Keep: aggregate status, uptime, trueforge_ready, incidents_active count.

**New file:** `dashboard/client/src/hooks/useHealth.ts`

**Scope:** ~40 lines server-side + ~30 lines frontend hook.

---

### 4e — Live Incident Archive

**Goal:** Replace `mockArchiveData` with data from the live incident store.

**Backend:** In `src/incident-plane.ts`, add:

```
GET /incidents?status=resolved&limit=50
```

```typescript
router.get("/incidents", (req, res) => {
  const { status, limit = "50" } = req.query;
  const rows = listIncidents({
    status: status as IncidentStatus | undefined,
    limit: Number(limit),
  });
  res.json({ data: rows });
});
```

Export `listIncidents()` from `src/incidents.ts` if not already exported (see below).

**Frontend:** Update `useIncidentArchive` to fetch from `GET /incidents`. Date-range filtering is client-side only (fetch all resolved, filter by `createdAt`). `onExport` stays as a stub.

**Scope:** ~30 lines server-side + ~20 lines frontend hook change.

---

### 4f — `listIncidents` helper

**Goal:** Export a read-only view of the incident store for health and archive endpoints.

**New function in `src/incidents.ts`:**

```typescript
export function listIncidents(options?: {
  status?: IncidentStatus;
  limit?: number;
}): Incident[] {
  const { status, limit } = options ?? {};
  const all = [...incidents.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return all.filter((i) => !status || i.status === status).slice(0, limit ?? all.length);
}
```

Also add `incidents_total` and `incidents_active` counts to the health response.

**Scope:** ~20 lines.

---

### 4g — QA Coverage

**New test cases:**

| Scenario | File | Expected |
|---|---|---|
| `PUT /api/settings/sandbox` with valid key | `sandbox-settings.test.ts` | 200 + provider configured |
| `PUT /api/settings/sandbox` with invalid key | `sandbox-settings.test.ts` | 400 + error message |
| `GET /api/settings/sandbox` when unconfigured | `sandbox-settings.test.ts` | `{ configured: false, status: "unconfigured" }` |
| `GET /incidents` empty store | `incident-plane.test.ts` | `{ data: [] }` |
| `GET /incidents` with resolved incidents | `incident-plane.test.ts` | Returns only resolved, newest first |
| `GET /incidents?status=awaiting_approval` | `incident-plane.test.ts` | Filters correctly |
| `GET /health` returns incidents_active | `server.test.ts` | Reflects actual store count |
| `sandbox.created` in stream broadcasts WS | `incident-plane.test.ts` | Broadcast called with correct envelope |

**Demo smoke script:** `demo/smoke.sh`

```bash
# Start server
npm run dev &
SERVER_PID=$!

# Wait for ready
sleep 2

# Configure sandbox
curl -X PUT http://localhost:3000/api/settings/sandbox \
  -H "Content-Type: application/json" \
  -d '{"apiKey":"your-daytona-key"}'

# Check status
curl http://localhost:3000/api/settings/sandbox

# Fire an alert
curl -X POST http://localhost:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{"service_name":"test-svc","target_host":"test-host","alert_summary":"CPU > 90%","severity":"critical"}'

# Check health
curl http://localhost:3000/health

# Check incidents
curl http://localhost:3000/incidents

kill $SERVER_PID 2>/dev/null
```

**Scope:** ~150 lines tests + demo script.

---

## What is NOT in scope

- Fleet / policy / job scheduler views — remain on fixtures
- Drift detection — separate project, not in this repo
- GitHub PR generation — cut entirely
- SandboxTwinCard going live with resource metrics (CPU%, memory) — no TrueForge API for per-sandbox metrics; stays on mock data
- Target registry or any new backend concept beyond what is listed above

---

## Files to create

| File | Purpose |
|---|---|
| `src/sandbox-settings.ts` | In-memory sandbox config store + API |
| `src/routes/sandbox.ts` | Express router for sandbox settings endpoints |
| `dashboard/client/src/hooks/useHealth.ts` | Polling hook for `GET /health` |
| `src/sandbox-settings.test.ts` | Tests for sandbox settings |
| `demo/smoke.sh` | End-to-end smoke script |

## Files to modify

| File | Change |
|---|---|
| `src/incidents.ts` | Add `listIncidents()` export |
| `src/incident-plane.ts` | Add `GET /incidents` route; add `sandbox.created` case; add `config.sandbox.enabled` to session |
| `src/server.ts` | Extend `GET /health` with `incidents_active`, `incidents_total` |
| `src/index.ts` | Mount sandbox router; pass incident store accessor to server |
| `dashboard/client/src/hooks/useIncidentArchive.ts` | Fetch from `GET /incidents` instead of mock |
| `dashboard/client/src/components/HealthSummaryCard.tsx` | Slim to live fields only; remove fixture gauges |
| `dashboard/client/src/pages/Home.tsx` | Wire `useHealth` hook to `HealthSummaryCard` |
| `dashboard/client/src/components/workspace-cards/SandboxTwinCard.tsx` | Show `sandbox_id` from WS event instead of mock (partial — resource metrics still mock) |

---

## Success criteria

- `npm run typecheck` clean
- `npm test` — all suites including new sandbox-settings tests pass
- `PUT /api/settings/sandbox` with a valid Daytona key → TrueForge provider configured
- `PUT /api/settings/sandbox` with a bad key → 400 with descriptive error
- Session created for incident has `config.sandbox.enabled: true`
- `sandbox.created` in turn stream → WebSocket broadcast with `sandbox_id`
- `GET /health` returns live `incidents_active` and `incidents_total`
- `GET /incidents` returns incidents from store, filtered by `status`, newest first
- `useIncidentArchive` shows real archived incidents (no mock data)
- `HealthSummaryCard` renders live status/uptime/trueforge/incident count (no fixture gauges)
- `demo/smoke.sh` runs end-to-end without errors
