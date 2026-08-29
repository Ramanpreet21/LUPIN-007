# PR #5 — `feat/complete-incident-loop` — Design Spec

Status: approved (brainstorming) · Date: 2026-08-30

## Goal

Close the six gaps so the incident-response loop works end-to-end from `POST /alerts`
to a gated, scoped command diff:

- the agent has **no tools** (the responder prompt claims SSH/CLI access, nothing provides it),
- the sandbox **starts empty** (no captured system state in the prompt),
- the approval gate shows a **bare `+ cmd` diff** (no blast radius),
- TrueForge **must be pre-configured by hand**,
- `GovernanceView` and `SandboxTwinCard` render **fixture data**.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| 5c host capture | **Local host state.** Read-only snapshot commands run against the control-plane host, labeled with the alert's `target_host`. One shared `execReadOnly` layer powers 5b and 5c. |
| 5a provider key | **From FirstRunSetup UI**, mirroring PR4's sandbox flow: `PUT /api/settings/model` → in-memory store (`src/model-settings.ts`) → `trueforge-setup.ts` creates the Anthropic provider if absent. No new env var. |
| 5e policy backend | **Read-only**: `GET /api/policy/rules` + `POST /api/policy/simulate`. Backend schema reconciled to the **dashboard's existing** `PolicyRule` / `AstSimulation` types. |
| 5f sandbox card | **TrueForge REST proxy** via the SDK's `client.fetch()` passthrough, with a documented fallback when the endpoint is unavailable. |

## Flagged risks

1. **5f endpoint path unconfirmed.** `PR4-scope.md` and the SDK surface show no per-sandbox
   metrics endpoint. The proxy is real HTTP to `TRUEFORGE_BASE_URL` behind a constant; on 404
   it returns `metricsAvailable:false` and the card keeps fixtures.
2. **5d/5e badge interplay.** `SAFETY_POLICY` stays a local display-only layer.
   `commandScope()` adds `risk` per command in the `pending_approval` payload rather than
   rewriting badges; the policy store seeds from overlapping rules so `simulate` and badges agree.

## Workstreams

### 5a — TrueForge auto-setup (Model B)

`src/trueforge-setup.ts`: `runTrueForgeSetup(tf, logger, deps)` fire-and-forget after the
server listens. Steps, each no-op-or-warn, never throwing:

1. `!tf.client` → warn, return.
2. `client.server.getCapabilities()` — readiness probe.
3. `client.settings.modelProviders.list()`; create the `anthropic` provider (models from
   `TRUEFORGE_MODEL`, default `claude-sonnet-5`) only if absent **and** an in-memory key exists.
4. `client.settings.mcpServers.createOrUpdate({ name: LOCAL_MCP_NAME, type:"remote", url: LOCAL_MCP_URL })`.

`src/model-settings.ts` — in-memory key store mirroring `sandbox-settings.ts`;
`getModelSettings()` redacts the key. `src/routes/model.ts` — `GET`/`PUT /api/settings/model`.
`src/index.ts` mounts the router and fires setup.

Dashboard: `FirstRunSetup.tsx` gains `onConfigureModel` (the model-key form step already
exists); `Home.tsx` gains `configureModel()` → `PUT /api/settings/model` (mirrors `configureSandbox`).

### 5b — Local MCP tool provider (read-only)

`src/exec-readonly.ts` — `execReadOnly(command, args, opts)`: `child_process` `spawn` with
arg arrays (no shell interpolation), `maxBuffer`/`timeout`, rejects on non-zero exit.

`src/mcp-provider.ts` — Express router at `/mcp`, POST JSON-RPC 2.0: `tools/list` (7
read-only tools), `tools/call` with strict input validation and `file_read` path allowlist.
Exports `TOOL_NAMES` (single source of truth), `LOCAL_MCP_NAME`, `LOCAL_MCP_URL`.
Errors return JSON-RPC error codes, not 500s.

Tools: `system_snapshot`, `process_tree`, `net_connections`, `service_status`,
`journal_logs`, `file_read`, `dns_lookup`.

`incident-plane.ts` attaches `mcpServers: [{ name: LOCAL_MCP_NAME }]` to the session agent
spec. Tool selectors (`enableTools`/`requireApprovalForTools`) are **derived** from
`TOOL_NAMES` and the SDK's `McpServerApprovalToolSelector` type — literal read-only names for
`enableTools`; SDK write/destructive groups if supported. All tools read-only ⇒ the gate only
trips for future write/remediation tools.

### 5c — System state capture

`src/capture.ts` — `captureTargetState(alert, executor = execReadOnly)`: runs
`ps aux --forest`, `ss -tulnp`, `df -h`, `free -m` (+ `systemctl status` when the alert names a
service); serializes to a `## CAPTURED SYSTEM STATE` block; per-command failure renders
`(unavailable)`, never fails the alert. `executor` injectable for tests.

`incident-plane.ts` captures before `sessions.create` and appends the block inside
`incidentMessage(alert, stateBlock?)` after the `## UNTRUSTED alert data` section.

### 5d — Scoped command diff

Shared shell helpers (`splitShellStatements`, `shellWords`, `effectiveCommand`) move verbatim
from `incident-plane.ts` to `src/shell-parse.ts`, re-exported for import compatibility.
`command-scope.ts` depends on `shell-parse.ts` (acyclic).

`src/command-scope.ts` — `commandScope(command): CommandScope` via `shellWords`/`effectiveCommand`
against a static `RESOURCE_MAP` (binaries → files/ports/services). Unknown binary ⇒
`unknown:true`. High-risk markers (port 22, `/etc/shadow`, `systemctl stop|disable`, `rm -rf`,
`chmod 777`) ⇒ `risk:"high"`.

`incident-plane.ts` adds `scope: CommandScope[]` to the `pending_approval` `WsEnvelope` payload.

### 5e — Policy backend (read-only)

`src/policy.ts` — seeded in-memory rule list typed to the dashboard's `PolicyRule`
(`{ id, binaryName, forbiddenFlags, category, severity: CRITICAL_BLOCK|REQUIRE_APPROVAL,
reasonDescription, matchExpression, enabled }`). Seeds carry `SAFETY_POLICY` intent.
`simulatePolicyRule(command)` returns the dashboard `AstSimulation` shape
(`riskScore`, `trippedNode`, `nodes[]`).

`src/routes/policy.ts` — `GET /api/policy/rules`, `POST /api/policy/simulate`. No CRUD/toggle.

Dashboard: `hooks/usePolicy.ts` (fetch pattern of `useIncidentArchive`); `GovernanceView.tsx`
loads rules and posts the AST canvas to `/api/policy/simulate`; rule editor/toggles become
read-only; `mockGovernanceData` stays as offline fallback.

### 5f — SandboxTwinCard status proxy

`src/routes/sandbox.ts` — `GET /api/sandbox/:id/status`: `client.fetch()` passthrough to the
TrueForge REST sandbox-status path; map to `SandboxTwinData` resources where available; on 404
return `503 { sandbox_id, metricsAvailable:false }`. Never invented numbers.

Dashboard: `hooks/useSandbox.ts` polls after `sandbox_started` (10s interval like `useHealth`);
`SandboxTwinCard.tsx` falls back to `mockSandboxTwinData` when metrics are unavailable.

## File inventory

```
src/
  trueforge-setup.ts   NEW   routes/model.ts        NEW   shell-parse.ts  NEW
  model-settings.ts    NEW   exec-readonly.ts       NEW   mcp-provider.ts NEW
  capture.ts           NEW   command-scope.ts       NEW   policy.ts       NEW
  routes/policy.ts     NEW   index.ts               MOD   server.ts       MOD
  incident-plane.ts    MOD   routes/sandbox.ts      MOD   package.json    MOD
  *.test.ts            NEW   command-scope / policy / model-settings

dashboard/client/src/
  hooks/usePolicy.ts      NEW   hooks/useSandbox.ts         NEW
  pages/Home.tsx          MOD   components/FirstRunSetup.tsx MOD
  components/operations/GovernanceView.tsx       MOD
  components/workspace-cards/SandboxTwinCard.tsx MOD
```

No new production dependencies.

## Verification

- `npm run typecheck`, `npm test` (new suites appended), `npm run smoke`.
- Dashboard `pnpm --dir dashboard check`, `pnpm --dir dashboard test`.
- Manual loop: boot server → `PUT /api/settings/model` → `POST /alerts` → WS shows
  `sandbox_started`; prompt contains `## CAPTURED SYSTEM STATE`; `pending_approval` payload
  includes per-command `scope`; `simulate` returns AST; SandboxTwinCard shows live-or-fallback status.
