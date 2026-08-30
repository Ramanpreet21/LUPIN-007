# Incident Command Deck — Wiring Checklist

All items are pending. Branch: `approval-gate-wiring`. Control plane at `http://localhost:3001`.

---

## 1. Podman / SSH Wiring

**Live host registration panel** currently shows mock/static values for:

- **Podman socket** (`/run/user/1000/podman/podman.sock`) — real availability check; socket liveness probe
- **Target host or IP** — SSH target; real host resolution
- **SSH port** — real port, not hardcoded
- **User / key path** — real SSH credentials field
- **"Mock handshake ready"** — replace with real SSH connectivity test; backend callback verifies socket/connection is live

**Wiring:** SSH connectivity check likely calls the control plane, which proxies to the Podman socket or SSH daemon.

---

## 2. FirstRunSetup: LLM Endpoint Dropdown

During first-run setup, the LLM endpoint field must be a **dropdown** (not a free text input):

- **Options from TrueForge model config** — dynamic, populated from the TrueForge model configuration endpoint (wired, real)
- **"local" option** — reveals a base URL input field when selected; the base URL itself must also be wired (POST to TrueForge or control plane)
- No mock values; all live

**Supporting route** (if not already present in control plane): `GET /model/config` or similar to list available models.

---

## 3. FirstRunSetup: Sandbox Config Component

New component (analogous to model configuration), separate from model config:

- **Single input field** for the Daytona sandbox URL
- Simple one-option setup; just the sandbox URL
- Fully wired — POST to control plane or TrueForge on save

---

## 4. Skills and MCP Configuration

**Settings panel** (accessible during setup or in settings view):

- **Preconfigured skills** — curated list relevant to incident response/SRE (diagnostic, remediation, runbook). Wired to TrueForge skill configuration endpoints
- **Preconfigured MCPs** — curated list specific to the task (SSH, CLI, filesystem). Wired to TrueForge MCP endpoints
- **Add/remove UI** — option to add more skills and MCPs beyond the preconfigured set; maps to TrueForge's actual skill/MCP settings endpoints

---

## 5. Topology Map and Blast Radius — Real Wiring

Both workspace cards are currently mock/placeholder:

- **Topology map** — real host relationships, service dependencies, network layout; data from live fleet/sandbox state or control plane
- **Blast radius** — real cascading impact analysis; based on live incidents or sandbox state

**Wiring:** Control plane surfaces fleet topology (from SSH/Podman scan results) and incident impact data. Dashboard fetches and renders.

---

## 6. Data Persistence

**Current:** In-memory only. React `useState`, `sessionStorage`, no backend persistence.

**What TrueForge can handle:**
- Conversation context / session history — TrueForge sessions maintain thread context across turns; `thread_id` in `sandbox_started` events confirms multi-turn threads exist
- Operator notes and incident context can be threaded into TrueForge sessions for continuity
- Model / MCP / skill configurations — TrueForge has these as first-class entities

**What TrueForge cannot handle:**
- Dashboard UI state — topology layout, blast-radius graph, workspace card positions
- Operator notes (browser-only unless threaded into TrueForge)
- Incident metadata — status, pending approvals, audit log — needs control plane SQLite

**What the control plane handles:**
- Incident records, approval audit log (existing SQLite tables)
- Policy rules and profiles (new — see section 9)
- Sandbox / fleet state

**Proposed approach:**
- TrueForge sessions as the memory layer — thread operator notes and incident context into sessions
- Control plane DB for incidents, policy, fleet state
- Browser `localStorage` for setup preferences only

---

## 7. Sessions List in Sidebar

Sidebar has enough space for a **"Sessions"** section:

- List of past TrueForge sessions (thread history)
- Click to revisit/reload a session
- Control plane surfaces session list from its SQLite `incident_sessions` table
- Wired, not mock

---

## 8. Logo Replacement

Replace all SVG placeholder logos with the real brand asset:

- **Path:** `/home/rs/Downloads/800444533751307567-removebg-preview.png`
- **Locations:** `Home.tsx` (rail brand mark + assistant avatar), `FirstRunSetup.tsx`, any other Lupin logo references

---

## 9. Agent Status Panel

All three items are currently non-functional or mock:

### 9a. GATED Button
- Currently non-functional; needs wiring to approval mode / policy gate state
- Likely calls `PUT /policy/mode` or similar to set `SafetyEnforcementMode`

### 9b. Model Selection Dropdown
- Currently absent; needs a dynamic dropdown in the agent status panel
- Populated from TrueForge model configuration options (wired to model settings endpoint)
- Mirrors the same model list used in FirstRunSetup LLM endpoint dropdown

### 9c. All Agent Status Buttons
- Emergency stop, approval mode toggle, SSH action buttons — currently mock/placeholder
- All need real handlers wired to control plane endpoints

---

## 10. AST Safety and Policy Governance — Full Wiring

**Current state:** `usePolicyEngine` hook is entirely local/mock. `GovernanceView.tsx` is fully built but backed by static data from `mockGovernanceData.ts`. No policy routes exist in the control plane.

### 10a. Control Plane: New Policy Routes

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/policy/rules` | Fetch active rules from DB |
| `PUT` | `/policy/rules/:id` | Toggle rule enabled/disabled |
| `POST` | `/policy/rules` | Create custom rule |
| `GET` | `/policy/profiles` | Fetch profile list |
| `PUT` | `/policy/profiles/:name` | Switch active profile |
| `GET` | `/policy/stats` | Live enforcement stats (intercepted count, active rules, blacklisted, etc.) |
| `POST` | `/policy/analyze` | AST command analysis — parse CLI string, return node breakdown + risk score |

**Database:** `policy_rules` and `policy_profiles` tables in the control plane SQLite.

### 10b. Dashboard: Rewrite `usePolicyEngine`

Replace `mockGovernanceData` imports with real control plane calls:

```
GET /policy/rules         → initial rules load
PUT /policy/rules/:id     → toggle rule
POST /policy/rules         → create rule
GET /policy/profiles      → profile list
PUT /policy/profiles/:name → switch profile
GET /policy/stats         → live stats
POST /policy/analyze      → AST canvas analysis
```

Add WebSocket event support for live stats updates (`policy_stats_update`).

### 10c. AST Canvas / Command Analysis

The `AST risk visualizer` in `GovernanceView` needs real AST parsing:

- **Option A:** Control plane does the parsing — receives a CLI command string, returns AST node breakdown + risk score. Dashboard renders the visualizer.
- **Option B:** Shared AST parsing library in both dashboard and control plane.

Minimum viable: `POST /policy/analyze` takes `{ "command": "find /var/log -type f -delete" }` and returns the same shape as `AstSimulation`.

### 10d. Rule Editor

The "Define policy rule" dialog in `GovernanceView` is currently presentation-only ("connect a policy adapter to persist it" notice).

- "Validate rule draft" button → `POST /policy/rules`
- Handle validation response from control plane
- Show success/error feedback

### 10e. Safety Enforcement Mode

`AUTONOMOUS` / `STRICT_GATED` / `DRY_RUN` modes need to:
- Persist to control plane via `PUT /policy/mode`
- Affect how the MCP approval gate behaves on the control plane side (STRICT_GATED = all destructive commands require approval before execution)

---

## Summary Table

| # | Area | Status | Work Type |
|---|------|--------|-----------|
| 1 | Podman / SSH wiring | Mock | Wiring |
| 2 | LLM endpoint dropdown (FirstRunSetup) | Mock | Wiring + build |
| 3 | Sandbox config component | Missing | Build + wiring |
| 4 | Skills & MCP config | Mock | Wiring |
| 5 | Topology map + blast radius | Mock | Wiring |
| 6 | Data persistence | None | Design + build |
| 7 | Sessions list in sidebar | Missing | Build + wiring |
| 8 | Logo replacement | SVG placeholder | Replace asset |
| 9a | GATED button | Non-functional | Wiring |
| 9b | Model dropdown in agent status | Missing | Build + wiring |
| 9c | Agent status buttons | Mock | Wiring |
| 10 | AST Safety / Policy Governance | Mock | Build + wiring |

---

## Running Services (for reference)

| Service | URL | Session |
|---------|-----|---------|
| TrueForge MCP | `http://localhost:8790` | `proc_e47506565af6` |
| Control plane | `http://localhost:3001` | `proc_57b974d1aae0` |
| Dashboard (Vite) | `http://localhost:3000` | `proc_793b8fe78f3f` |

Start control plane with: `TRUEFORGE_BASE_URL=http://localhost:8790 npm run dev -- serve --port 3001`
