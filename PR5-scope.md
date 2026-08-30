# PR #5 — `feat/complete-incident-loop`

## Goal

Make the incident-response loop actually work end-to-end: alert fires, agent captures live system state, diagnoses inside an isolated sandbox using real tools, surfaces a scoped command diff at the approval gate, and the operator approves before any fix reaches production.

## What the README promises (the bar)

> Alert → capture live system state → replicate in isolated sandbox → autonomous diagnosis → safety verification + blast-radius map → human-in-the-loop approval → apply verified patch

The current code handles routing and the approval gate UI, but the agent has no tools, no captured state, no real sandbox content, and no meaningful diff. This PR fills every gap.

---

## Scope

### 5a — TrueForge auto-setup (Model B)

**Problem:** TrueForge must be pre-configured by hand (model providers, MCP connectors) before `incident-agent` can do anything. This blocks a one-command startup.

**Solution:** `src/trueforge-setup.ts` — runs once at startup (or on first alert if the server wasn't ready yet). Calls the TrueForge REST API to:

- Ensure a model provider is configured (Anthropic with `claude-sonnet-5`)
- Create a remote MCP connector pointing at the local MCP tool provider (see 5b)
- Set `requireApprovalForTools` on the connector so the TrueForge server itself gates tool calls
- Verify readiness via `/api/v1/capabilities`

**Delivery:** `src/trueforge-setup.ts` + calls from `src/index.ts` after `initTrueForge()`. Falls back gracefully: if the TrueForge server is unreachable, log a warning and continue — the existing 503 on `POST /alerts` is preserved.

**Files:**
- `src/trueforge-setup.ts` (new)
- `src/index.ts` (add setup call)

---

### 5b — Local MCP tool provider (diagnostic engine)

**Problem:** The agent has no tools. The prompt asks for SSH/CLI/filesystem access but nothing provides it.

**Solution:** A minimal HTTP MCP server that ships alongside the control plane (same process, separate router at `/mcp`). Read-only tools only — this phase is diagnosis, not remediation.

**Tools:**

| Tool | Purpose |
|---|---|
| `system_snapshot` | Run: `ps aux`, `ss -tulnp`, `mount`, `df -h`, `free -m` on the target host via SSH |
| `process_tree` | `ps aux --forest` — show parent/child relationships |
| `net_connections` | `ss -tulnp` or `netstat -tulnp` — listening ports and established connections |
| `service_status` | `systemctl status <service>` for a named service |
| `journal_logs` | `journalctl -u <unit> --since "1 hour ago" -n 100` |
| `file_read` | `cat` a config file path (authorized paths only, e.g. `/etc/nginx/`, `/opt/`) |
| `dns_lookup` | `dig +short <hostname>` or `getent hosts` |

All tools are read-only. No `rm`, `kill`, `systemctl stop`, or any mutation.

**MCP protocol:** Implement the `tools/list` and `tools/call` method handling over HTTP, matching the MCP over HTTP spec (POST `/mcp` with JSON-RPC body).

**Registration:** On startup, the setup in 5a registers `http://localhost:3000/mcp` as a remote MCP connector in TrueForge.

**Files:**
- `src/mcp-provider.ts` (new — MCP server logic)
- `src/server.ts` (mount MCP router at `/mcp`)
- `src/index.ts` (start MCP provider before TrueForge setup)

---

### 5c — System state capture before sandbox session

**Problem:** The sandbox starts empty. The agent diagnoses from just the alert label, not from actual live state.

**Solution:** Before creating the TrueForge session, run snapshot commands against the target host (via the local MCP provider or directly over SSH) and inject the results into the incident message.

**Flow:**

```
POST /alerts
  → normalize alert
  → createIncident()
  → captureTargetState(alert.target_host)   ← NEW
      calls MCP tool: system_snapshot, process_tree, net_connections
      serializes to structured text block
  → runDiagnosis()
      injects state block into incidentMessage()
```

**State block format** (injected into the prompt):

```
## CAPTURED SYSTEM STATE (snapshot at alert time)
Process tree:
<ps --forest output>

Network connections:
<ss -tulnp output>

Service status:
<target service status>

## ALERT CONTEXT
service=... | target_host=... | severity=...
summary="..."
```

The agent receives actual state. Its diagnosis is grounded, not speculative.

**Files:**
- `src/incident-plane.ts` (add `captureTargetState()` call before `runDiagnosis()`)
- `src/capture.ts` (new — state capture orchestration)

---

### 5d — Scoped command diff at approval gate

**Problem:** `commandDiff()` currently returns `+ cmd` per line — no information about blast radius. The operator can't assess impact.

**Solution:** Parse each proposed command and annotate it with what it touches:

**Per-command annotation:**
```
+ systemctl restart nginx
  files:   /etc/systemd/system/nginx.service
  sockets: tcp/80, tcp/443
  procs:   nginx (graceful restart)
  ports:   80, 443
```

**Implementation:**
- `src/command-scope.ts` — for each command string, use `shellWords()` to extract the executable and arguments
- Cross-reference against a static `RESOURCE_MAP` (known binaries → which files/ports/services they touch)
- For unknown binaries, fall back to "unknown — operator should verify"

**Wire into `computeGateBadges()`** — if a command touches a high-risk resource (e.g. `/etc/shadow`, port 22, `systemctl` with stop/disable), mark it as high-severity in the badge.

**Files:**
- `src/command-scope.ts` (new)
- `src/incident-plane.ts` (import and call `commandScope()` in `tool.approval_required` handler)
- Update `WsEnvelope.pending_approval.payload` to include `scope: CommandScope[]`

---

### 5e — Wire GovernanceView to a real backend

**Problem:** The AST canvas and policy rule editor in `GovernanceView` are presentation-only. No backend, no enforcement.

**Solution:** Back the `SAFETY_POLICY` with a rule store and add a simulation endpoint.

**Rule store (in-memory, same as incidents):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/policy/rules` | GET | List all active rules |
| `/api/policy/rules` | POST | Create a rule `{ name, regex, category, severity }` |
| `/api/policy/rules/:id` | DELETE | Remove a rule |
| `/api/policy/simulate` | POST | Run a command string through all rules, return matched rules + AST nodes |

**Rule shape:**
```typescript
interface PolicyRule {
  id: string;
  name: string;
  regex: string;          // stored as string, compiled to RegExp at startup
  category: "DESTRUCTIVE_FS" | "PRIVILEGE_ESCALATION" | "NETWORK_EXFIL" | "PROCESS_TERMINATION";
  severity: "CRITICAL_BLOCK" | "REQUIRE_APPROVAL" | "WARN";
  enabled: boolean;
}
```

**AST simulation response:**
```typescript
interface AstSimulationResult {
  command: string;
  riskScore: number;       // 0-100
  matchedRules: PolicyRule[];
  nodes: AstNode[];        // for the canvas visualization
  trippedNode: string;     // label of the highest-risk node
}
```

**GovernanceView adapter (frontend):**
- Load rules from `GET /api/policy/rules`
- Toggle rule enabled/disabled via `PATCH /api/policy/rules/:id`
- Rule editor submits to `POST /api/policy/rules`
- AST canvas calls `POST /api/policy/simulate` on submit instead of using mock data

**Files:**
- `src/policy.ts` (new — rule store + CRUD)
- `src/routes/policy.ts` (new — Express routes)
- `src/server.ts` (register policy router)
- `dashboard/client/src/hooks/usePolicy.ts` (new)
- `dashboard/client/src/components/operations/GovernanceView.tsx` (wire to real backend)

---

### 5f — Dashboard: SandboxTwinCard shows real state

**Problem:** `SandboxTwinCard` shows hardcoded fixture data for resource metrics and isolation flags.

**Solution:** After `sandbox_started` is received, poll `GET /api/sandbox/:sandbox_id/status` (new endpoint) for real resource usage. Fall back to mock data if the TrueForge API doesn't expose sandbox status.

**Files:**
- `src/routes/sandbox.ts` (add `GET /api/sandbox/:id/status`)
- `dashboard/client/src/components/workspace-cards/SandboxTwinCard.tsx` (wire live data)
- `dashboard/client/src/hooks/useSandbox.ts` (new)

---

## Out of scope (not this PR)

- **TrueForge server itself** — always a runtime dependency, never built here
- **Push automation / drift detection** — separate project
- **Electron operator console** — separate repo
- **Durable incident store** — in-memory is fine for this PR; SQLite/Postgres is a later concern
- **Production deployment** — Docker, Kubernetes, env vars for prod are not this PR's concern
- **TrueForge Model A pre-config** — Model B (auto-setup) replaces the need for this

---

## File inventory

```
src/
  trueforge-setup.ts      [NEW] Model B auto-configure TrueForge at startup
  mcp-provider.ts         [NEW] Local HTTP MCP tool provider (diagnostic tools)
  capture.ts               [NEW] System state capture before sandbox session
  command-scope.ts         [NEW] Per-command blast-radius annotation
  policy.ts               [NEW] In-memory policy rule store + simulation engine
  routes/policy.ts        [NEW] REST routes for policy CRUD + simulate
  index.ts                [MOD] Start MCP provider, call TrueForge setup
  server.ts               [MOD] Mount /mcp and /api/policy routers
  incident-plane.ts       [MOD] Call captureTargetState(); use commandScope()
  incident-plane.test.ts  [MOD] Cover capture path, new policy scenarios

dashboard/client/src/
  hooks/usePolicy.ts      [NEW] Fetch/patch policy rules + simulate
  hooks/useSandbox.ts     [NEW] Poll sandbox status after sandbox_started
  components/workspace-cards/SandboxTwinCard.tsx  [MOD] Wire live sandbox status
  components/operations/GovernanceView.tsx       [MOD] Wire to usePolicy
```

---

## Success criteria

1. `POST /alerts` with a real alert fires a TrueForge session that uses the local MCP provider's diagnostic tools
2. The incident message includes captured system state from the target host
3. `tool.approval_required` events include scoped diff (files/ports/services per command)
4. `GET /api/policy/rules` returns rules; `POST /api/policy/simulate` returns AST analysis
5. GovernanceView loads rules from the API and the AST canvas shows real simulation results
6. `SandboxTwinCard` displays live resource metrics after `sandbox_started`
7. All existing tests pass (70+ backend, 12 dashboard vitest)
8. `npm run smoke` completes end-to-end
9. `npm run typecheck` is clean

---

## Dependencies

- `@truefoundry/trueforge-sdk` — existing
- `@truefoundry/trueforge` harness must be running at `TRUEFORGE_BASE_URL` (same as today)
- Node.js >= 22 (same as today)

No new production dependencies. All new code is plain TypeScript.
