# Comprehensive Debug & Reconnaissance Report: Incident Command Deck (007)

**Date:** 2026-08-30  
**Scope:** Full repository audit (`src/` backend, `dashboard/` frontend & Electron, test suites, build configs, and architectural contracts).  
**Constraint:** Reconnaissance only; zero modifications made to existing application code.

---

## 1. Executive Summary & Architecture Overview

The repository consists of two primary sub-systems:
1. **Control Plane Backend (`src/`)**: Node.js/Express (CommonJS) application interacting with the `@truefoundry/trueforge-sdk`. It handles webhook alert ingestion (AlertManager, PagerDuty), manages incident state machines, drives TrueForge diagnostic sessions, gates dangerous operations via safety policies, broadcasts live status over WebSockets (`/ws`), and configures Daytona sandbox providers (`/api/settings/sandbox`).
2. **Operator Console Frontend (`dashboard/`)**: React 19 + TypeScript + Vite + Tailwind CSS v4 desktop/web application with an Electron shell wrapper (`dashboard/electron/`). It implements the Luma Glass ("Luminous Obsidian") design system and features a live incident deck, terminal diagnostic stream, system health telemetry, AST governance simulator, fleet inventory, and incident archive.

---

## 2. Test & Typecheck Status

| Component | Command | Result | Details |
|---|---|---|---|
| **Root Backend Tests** | `npm test` | **PASS (70/70)** | 70 passing tests across `config`, `server`, `trueforge`, `incidents`, `incident-plane`, and `sandbox-settings`. |
| **Root Backend Types** | `npm run typecheck` | **PASS** | `tsc -p tsconfig.json --noEmit` exited 0 with 0 errors. |
| **Dashboard Unit Tests** | `pnpm test` (vitest) | **PASS (12/12)** | All 12 tests passing across `electron-config`, `useControlPlane`, and `useControlPlaneTerminalStream`. |
| **Dashboard Types** | `pnpm check` | **FAIL (1 error)** | `tsc --noEmit` failed with TypeScript error `TS2741` in `useControlPlaneTerminalStream.ts`. |

---

## 3. Critical Bugs & Type Failures

### 3.1. [BLOCKER] TypeScript Compilation Failure in Frontend Terminal Adapter
* **File:** `dashboard/client/src/hooks/useControlPlaneTerminalStream.ts:42`
* **Error:** 
  ```text
  client/src/hooks/useControlPlaneTerminalStream.ts:42:11 - error TS2741: Property 'incomingData' is missing in type '{ transcript: string; terminalCursor: number; connectionStatus: ControlPlaneConnectionStatus; sendData: () => void; sendResize: () => void; }' but required in type 'UseTerminalStreamReturn'.
  ```
* **Root Cause:** 
  `dashboard/client/src/types/terminal.ts` defines `UseTerminalStreamReturn` expecting `incomingData: string | null`, and `LiveTerminal.tsx` consumes `stream.incomingData`. `useControlPlaneTerminalStream.ts` defines the helper `nextTerminalDelta()` to compute incremental deltas from `transcript` and `terminalCursor`, but its `useMemo` returns the raw `transcript` and `terminalCursor` object instead of tracking delivered offsets and exposing `incomingData`.
* **Fix Required:** Update `useControlPlaneTerminalStream` to maintain a local delivered offset ref and compute/return `incomingData: string | null` conforming to `UseTerminalStreamReturn`.

---

### 3.2. [HIGH] Endpoint & Data Contract Mismatch in Health Polling (`/api/health-summary` vs `/health`)
* **Files:** 
  * `dashboard/client/src/hooks/useHealth.ts:27`
  * `dashboard/client/src/types/health.ts:45-74`
  * `src/server.ts:64-75`
* **Issue:** 
  1. `useHealth.ts` polls `GET ${CONTROL_PLANE_ORIGIN}/api/health-summary` every 10 seconds. The backend `src/server.ts` does not register `/api/health-summary`, only `GET /health`. Consequently, polling fails with HTTP 404 on every request.
  2. The response schema from backend `GET /health` is:
     ```json
     { "status": "ok", "uptime": 123, "trueforge_ready": true, "trueforge": {...}, "incidents_active": 0, "incidents_total": 0 }
     ```
     Whereas frontend `ControlPlaneHealth` expects an object extending `HealthSummary` (`trafficRate`, `errorRate`, `errorBudget`, `agent`, `_meta`).
* **Fix Required:** 
  * Either add a `/api/health-summary` route (or enrich `/health`) in `src/server.ts` with agent telemetry / default baseline health metrics, or adapt `useHealth.ts` and `HealthSummaryCard.tsx` to handle the actual backend `/health` payload gracefully without falling back to stale mock data on 404.

---

### 3.3. [HIGH] Live Incident Archive Hook Disconnected from Backend
* **Files:**
  * `dashboard/client/src/hooks/useIncidentArchive.ts:2-15`
  * `src/incident-plane.ts:764-775`
* **Issue:** 
  The backend implements `GET /incidents` with status filtering and limits. However, the frontend hook `useIncidentArchive.ts` continues to filter against hardcoded `mockArchiveData`.
* **Fix Required:** Wire `useIncidentArchive.ts` to fetch live incident records via `fetch(`${CONTROL_PLANE_ORIGIN}/incidents?limit=50`)` and map backend incident fields to the `ArchivedIncident` table format.

---

### 3.4. [MEDIUM] First-Run Sandbox Configuration Disconnected
* **Files:**
  * `dashboard/client/src/pages/Home.tsx:286-296`
  * `dashboard/client/src/components/FirstRunSetup.tsx:163-172`
  * `src/routes/sandbox.ts:30-61`
* **Issue:** 
  The backend provides `PUT /api/settings/sandbox` to configure Daytona provider keys in TrueForge. In `Home.tsx`, the `configureSandbox` callback was removed from `FirstRunSetup`, causing entered keys to only be stored in browser memory/localStorage without sending the configuration request to the backend.
* **Fix Required:** Re-integrate `onConfigureSandbox` prop in `FirstRunSetup` and invoke `PUT /api/settings/sandbox` during the setup completion step.

---

### 3.5. [MEDIUM] Default Port Collision Risk
* **Files:**
  * `src/config.ts:40` (Defaults to port `3000`)
  * `dashboard/vite.config.ts:224` (Defaults to port `3000`)
  * `dashboard/server/index.ts:26` (Defaults to port `3000`)
  * `dashboard/electron/main.cjs:3` (`DEV_SERVER_URL` defaults to `http://localhost:3000`)
* **Issue:** 
  Both the backend control plane and the frontend Vite/Express server default to port `3000`. If launched together without explicit environment variables, Vite auto-increments to `3001` or conflicts, while Electron expects the UI at `3000` (which may serve backend API JSON instead of the UI).
* **Fix Required:** Standardize explicit distinct default ports:
  * Backend API: `3000` (API + WS)
  * Frontend Vite Dev: `5173` or `3001`
  * Frontend Prod Express Server: `3001`
  * Update `electron/main.cjs` `ELECTRON_START_URL` default to match Vite dev port (`http://localhost:5173` or `http://localhost:3001`).

---

## 4. Feature Gap Analysis (PR #4 & PR #5 Alignment)

### 4.1. Completed Features (Operational)
* [x] Alert Webhook Ingestion (`POST /alerts` supporting AlertManager batches, PagerDuty v2/v3, and canonical JSON).
* [x] Asynchronous Turn Stream & Reasoning broadcast (`agent_thinking`, `turn.created`, `turn.done`).
* [x] AST Policy Safety Badges & Gating (`pending_approval` WebSocket event with prefix/wrapper unwrapping).
* [x] Operator Approval Endpoint (`POST /api/approvals` with resume & cancellation guarantees).
* [x] Live WebSocket Incident Deck (`IncidentDeck.tsx` + `useControlPlane.ts`).
* [x] In-memory Incident Storage & TTL eviction (`incidents.ts`).
* [x] Daytona Sandbox Provider API (`src/routes/sandbox.ts`).

### 4.2. Incomplete / Missing Features from PR #4 & PR #5 Specs
1. **MCP Diagnostic Tool Provider (`src/mcp-provider.ts` - PR #5 5b):**
   * *Status:* Not yet implemented.
   * *Impact:* TrueForge agent currently lacks live diagnostic tools (`system_snapshot`, `process_tree`, `net_connections`, `service_status`, `journal_logs`, `file_read`, `dns_lookup`).
2. **State Capture Pre-Session (`src/capture.ts` - PR #5 5c):**
   * *Status:* Not yet implemented.
   * *Impact:* Incident diagnosis currently runs on alert text only, without attached target machine snapshot state.
3. **Command Scope & Blast Radius Annotation (`src/command-scope.ts` - PR #5 5d):**
   * *Status:* Not yet implemented.
   * *Impact:* `commandDiff` currently returns a flat `+ <command>` list without file/socket/service resource annotations.
4. **Dynamic Policy Rule Store & Simulation Engine (`src/policy.ts`, `src/routes/policy.ts` - PR #5 5e):**
   * *Status:* Not yet implemented.
   * *Impact:* `GovernanceView.tsx` and AST syntax canvas remain on static simulation fixtures.
5. **SandboxTwin Real-Time Status Endpoint (`src/routes/sandbox.ts` - PR #5 5f):**
   * *Status:* Endpoint `GET /api/sandbox/:id/status` not yet implemented.

---

## 5. Step-by-Step Remediation Plan

### Phase 1: Fix TypeScript Compilation (Immediate)
1. In `dashboard/client/src/hooks/useControlPlaneTerminalStream.ts`:
   * Track `deliveredRef` (character cursor).
   * Inside an effect or state derivation, run `nextTerminalDelta(plane.terminalChunk, plane.terminalCursor, deliveredRef.current)`.
   * Return `incomingData` alongside `connectionStatus`, `sendData`, and `sendResize` to satisfy `UseTerminalStreamReturn`.
2. Verify with `pnpm check` in `dashboard/`.

### Phase 2: Align Health Summary Contract
1. In `src/server.ts` or `src/incident-plane.ts`:
   * Add `GET /api/health-summary` returning aggregate status, active incident counts, and system telemetry structure (or adjust `/health` and update frontend consumer).
2. In `dashboard/client/src/hooks/useHealth.ts`:
   * Handle errors cleanly without failing when running in demo/standalone mode.

### Phase 3: Wire Up Archive and Sandbox Settings
1. Update `dashboard/client/src/hooks/useIncidentArchive.ts` to query `GET /incidents?limit=50` from `CONTROL_PLANE_ORIGIN`.
2. Update `dashboard/client/src/pages/Home.tsx` and `FirstRunSetup.tsx` to execute `PUT /api/settings/sandbox` when submitting API keys.

### Phase 4: Port Coordination & Build Script Cleanup
1. Set default Vite dev port in `dashboard/vite.config.ts` to `5173` or `3001` (avoiding conflict with backend on `3000`).
2. Update `dashboard/electron/main.cjs` default URL to match Vite dev port.
3. Update `dashboard/package.json` scripts so `pnpm dev` and `pnpm start` work seamlessly with backend `npm run dev`.

### Phase 5: Implement PR #5 Features (Diagnostic Tools & Policy Engine)
1. Create `src/mcp-provider.ts` and mount `/mcp` route.
2. Create `src/capture.ts` to capture state snapshot on alert ingestion.
3. Create `src/command-scope.ts` to calculate blast radius and resources touched per command.
4. Implement `src/policy.ts` and `src/routes/policy.ts` for dynamic rule simulation.
