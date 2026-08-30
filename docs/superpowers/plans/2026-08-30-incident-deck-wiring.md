# Incident Command Deck — Full Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all 10 checklist items from `demo_final.md` — replacing every mock data source and in-memory store with real SQLite persistence, live API endpoints, and wired frontend hooks.

**Architecture:** Layered Control Plane — SQLite DB foundation → backend REST/WS routes → enforcement mode integration → frontend hook rewrites. All endpoints under `/api/*` in Express, real-time sync via WebSocket broadcasts.

**Tech Stack:** Node.js ≥22, Express 5, better-sqlite3, ws, TypeScript 7, React 19, Vite 7, Tailwind CSS 4

## Global Constraints

- All new backend routes follow the `createXxxRouter(opts): Router` factory pattern (see `src/routes/policy.ts`)
- All new routers are mounted in `src/index.ts` via `registerRoutes` callback
- SQLite DB file lives at `./data/incident-deck.db` (auto-created, gitignored)
- Tests use Node's built-in test runner (`node --test`), not Jest/Vitest
- Frontend API base URL: `import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000"`
- No new npm dependencies on the dashboard side — only `better-sqlite3` + `@types/better-sqlite3` on the control plane
- Preserve all existing comments, docstrings, and code unrelated to changes

---

### Task 1: SQLite Persistence Layer

**Files:**
- Create: `src/db.ts`
- Modify: `package.json` (add `better-sqlite3` + `@types/better-sqlite3`)
- Modify: `tsconfig.json` (no changes needed — `nodenext` resolution handles it)
- Modify: `.gitignore` (add `data/`)
- Test: `src/db.test.ts`

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces:
  - `initDb(dbPath?: string): Database` — opens/creates SQLite file, runs schema migrations, returns `better-sqlite3` Database instance
  - `getDb(): Database` — returns the initialized singleton (throws if `initDb` not called)
  - All `CREATE TABLE IF NOT EXISTS` statements from design spec (incidents, policy_rules, policy_profiles, sessions, settings, fleet_hosts)

- [ ] **Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3 && npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Add `data/` to .gitignore**

Append to `.gitignore`:
```
data/
```

- [ ] **Step 3: Write the failing test**

Create `src/db.test.ts`:
```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// Test uses an isolated temp DB
const TEST_DB_DIR = join(import.meta.dirname ?? __dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "test-db.sqlite");

describe("db", () => {
  before(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  after(() => {
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it("initDb creates the database file and all tables", async () => {
    const { initDb } = await import("./db");
    const db = initDb(TEST_DB_PATH);
    assert.ok(existsSync(TEST_DB_PATH), "DB file should exist");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes("incidents"), "incidents table");
    assert.ok(tableNames.includes("policy_rules"), "policy_rules table");
    assert.ok(tableNames.includes("policy_profiles"), "policy_profiles table");
    assert.ok(tableNames.includes("sessions"), "sessions table");
    assert.ok(tableNames.includes("settings"), "settings table");
    assert.ok(tableNames.includes("fleet_hosts"), "fleet_hosts table");

    db.close();
  });

  it("initDb seeds default policy rules when table is empty", async () => {
    const { initDb } = await import("./db");
    const db = initDb(TEST_DB_PATH);

    const count = db.prepare("SELECT COUNT(*) as cnt FROM policy_rules").get() as { cnt: number };
    assert.ok(count.cnt >= 6, `Expected >=6 default rules, got ${count.cnt}`);

    db.close();
  });

  it("initDb seeds default policy profiles", async () => {
    const { initDb } = await import("./db");
    const db = initDb(TEST_DB_PATH);

    const count = db.prepare("SELECT COUNT(*) as cnt FROM policy_profiles").get() as { cnt: number };
    assert.ok(count.cnt >= 4, `Expected >=4 default profiles, got ${count.cnt}`);

    db.close();
  });

  it("initDb seeds default settings", async () => {
    const { initDb } = await import("./db");
    const db = initDb(TEST_DB_PATH);

    const mode = db.prepare("SELECT value FROM settings WHERE key = 'enforcement_mode'").get() as { value: string } | undefined;
    assert.ok(mode, "enforcement_mode setting should exist");
    assert.equal(mode.value, "STRICT_GATED");

    db.close();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json && node --test dist/db.test.js
```
Expected: FAIL — `./db` module not found

- [ ] **Step 5: Write the implementation**

Create `src/db.ts`:
```typescript
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'created',
  alert_json TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  thread_id TEXT,
  tool_call_id TEXT,
  tool_call_ids TEXT,
  proposed_command TEXT,
  proposed_commands TEXT,
  safety_badges TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
  forbidden_flags TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_profiles (
  name TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  rule_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  incident_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_hosts (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  ip TEXT,
  port INTEGER DEFAULT 22,
  ssh_user TEXT,
  ssh_key_path TEXT,
  podman_socket TEXT,
  last_probe_status TEXT,
  last_probe_at TEXT,
  probe_latency_ms INTEGER,
  probe_error TEXT,
  os_info TEXT,
  created_at TEXT NOT NULL
);
`;

const DEFAULT_POLICY_RULES = [
  { id: "rule-rm-wildcard", name: "Block wildcard / root deletion", regex: "^rm\\\\s+.*(\\\\*|--no-preserve-root|/etc|/var|/usr)", category: "DESTRUCTIVE_FS", severity: "CRITICAL_BLOCK", enabled: 1, reason_description: "Prevent destructive file removal across protected system paths or wildcards.", match_expression: "path === '/' || path.startsWith('/etc') || contains('*')", binary_name: "rm", forbidden_flags: '[\"-rf\",\"--no-preserve-root\",\"*\"]' },
  { id: "rule-permissions", name: "Require approval for broad permission escalation", regex: "^chmod\\\\s+(777|a\\\\+rwx|-R\\\\s+777)", category: "PRIVILEGE_ESCALATION", severity: "REQUIRE_APPROVAL", enabled: 1, reason_description: "Require human review for full read/write/execute permission escalation.", match_expression: "mode === '777' || mode === 'a+rwx'", binary_name: "chmod", forbidden_flags: '[\"777\",\"a+rwx\"]' },
  { id: "rule-format", name: "Block raw disk format & block device writes", regex: "^(mkfs|fdisk|parted|dd\\\\s+if=)", category: "DESTRUCTIVE_FS", severity: "CRITICAL_BLOCK", enabled: 1, reason_description: "Block direct filesystem formatting or raw disk overwrites from agent execution.", match_expression: "argument.type === 'BlockDevice'", binary_name: "mkfs", forbidden_flags: '[\"*\"]' },
  { id: "rule-service-stop", name: "Gate critical service stoppage", regex: "^(systemctl|service)\\\\s+(stop|disable|mask)", category: "PROCESS_TERMINATION", severity: "REQUIRE_APPROVAL", enabled: 1, reason_description: "Protect critical relay, edge, and cluster-control services from unauthorized shutdown.", match_expression: "unit in ['sshd','k3s','lupin-relay','nginx']", binary_name: "systemctl", forbidden_flags: '[\"stop\",\"disable\",\"mask\"]' },
  { id: "rule-exfil", name: "Gate outbound network uploads", regex: "^(curl|wget)\\\\s+.*(-T|--upload-file|-d\\\\s+@|--post-file)", category: "NETWORK_EXFIL", severity: "REQUIRE_APPROVAL", enabled: 1, reason_description: "Gate outbound file upload and exfiltration commands until destination is reviewed.", match_expression: "url.origin !== trustedOrigins", binary_name: "curl", forbidden_flags: '[\"-T\",\"--upload-file\",\"--post-file\"]' },
  { id: "rule-eval", name: "Block dynamic code evaluation", regex: "(^|\\\\s)(eval|source|bash\\\\s+-c|sh\\\\s+-c|\\\\$\\\\()", category: "PRIVILEGE_ESCALATION", severity: "CRITICAL_BLOCK", enabled: 1, reason_description: "Prevent command injection and dynamic arbitrary script evaluation.", match_expression: "hasDynamicEval(command)", binary_name: "eval", forbidden_flags: '[\"eval\",\"$()\",\"source\"]' },
];

const DEFAULT_PROFILES = [
  { name: "Production Safe", is_active: 1, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
  { name: "Strict Read-Only", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
  { name: "Staging Unrestricted", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-format","rule-eval"]' },
  { name: "Zero-Trust", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  enforcement_mode: "STRICT_GATED",
  model: "anthropic/claude-sonnet-5",
  sandbox_url: "",
  operator_name: "",
  skills: '["diagnostic","remediation","runbook"]',
  mcps: '["ssh","cli","filesystem"]',
};

function seedDefaults(db: Database.Database): void {
  const ruleCount = (db.prepare("SELECT COUNT(*) as cnt FROM policy_rules").get() as { cnt: number }).cnt;
  if (ruleCount === 0) {
    const insertRule = db.prepare(
      `INSERT OR IGNORE INTO policy_rules (id, name, regex, category, severity, enabled, reason_description, match_expression, binary_name, forbidden_flags, created_at)
       VALUES (@id, @name, @regex, @category, @severity, @enabled, @reason_description, @match_expression, @binary_name, @forbidden_flags, @created_at)`
    );
    const now = new Date().toISOString();
    for (const rule of DEFAULT_POLICY_RULES) {
      insertRule.run({ ...rule, created_at: now });
    }
  }

  const profileCount = (db.prepare("SELECT COUNT(*) as cnt FROM policy_profiles").get() as { cnt: number }).cnt;
  if (profileCount === 0) {
    const insertProfile = db.prepare(
      `INSERT OR IGNORE INTO policy_profiles (name, is_active, rule_ids, created_at) VALUES (@name, @is_active, @rule_ids, @created_at)`
    );
    const now = new Date().toISOString();
    for (const profile of DEFAULT_PROFILES) {
      insertProfile.run({ ...profile, created_at: now });
    }
  }

  const settingCount = (db.prepare("SELECT COUNT(*) as cnt FROM settings").get() as { cnt: number }).cnt;
  if (settingCount === 0) {
    const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run({ key, value });
    }
  }
}

export function initDb(dbPath = "./data/incident-deck.db"): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedDefaults(db);
  _db = db;
  return db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error("Database not initialized — call initDb() first");
  return _db;
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx tsc -p tsconfig.json && node --test dist/db.test.js
```
Expected: 4 tests PASS

- [ ] **Step 7: Wire initDb into entry point**

Modify `src/index.ts`:
- Add import: `import { initDb } from "./db";`
- Before `initTrueForge(...)`, add: `const db = initDb();`
- Pass `db` to `registerRoutes` closure (will be consumed in later tasks)

```typescript
// In src/index.ts, after loadConfig and createLogger:
import { initDb } from "./db";

// ... inside main(), after const logger:
const db = initDb();

// ... in startServer registerRoutes:
registerRoutes: (app, { broadcast }) => {
  app.use(createIncidentRouter({ getTf: () => tf, logger, broadcast, model: config.trueforgeModel }));
  app.use(createSandboxRouter({ getTf: () => tf, logger }));
  app.use(createPolicyRouter({ logger }));
},
```

(The `db` variable isn't passed yet — later tasks will add it to router opts. The `getDb()` singleton accessor is used inside route handlers.)

- [ ] **Step 8: Add db.test.js to test script in package.json**

In `package.json`, add `dist/db.test.js` to the `"test"` script's file list.

- [ ] **Step 9: Run full test suite**

```bash
npm test
```
Expected: All existing + new tests PASS

- [ ] **Step 10: Commit**

```bash
git add src/db.ts src/db.test.ts src/index.ts package.json package-lock.json .gitignore
git commit -m "feat: add SQLite persistence layer with schema bootstrap and default seeds"
```

---

### Task 2: Logo Replacement

**Files:**
- Create: `dashboard/client/public/brand-logo.png` (copy from Downloads)
- Modify: `dashboard/client/src/pages/Home.tsx` (update logo references)
- Modify: `dashboard/client/src/components/FirstRunSetup.tsx` (update logo references)

**Interfaces:**
- Consumes: nothing
- Produces: brand logo asset available at `/brand-logo.png` in the Vite public directory

- [ ] **Step 1: Copy the brand logo asset**

```bash
cp /home/rs/Downloads/800444533751307567-removebg-preview.png dashboard/client/public/brand-logo.png
```

- [ ] **Step 2: Find and update logo references in Home.tsx**

Search for SVG logo/brand references in `Home.tsx`. Replace inline SVG brand marks and assistant avatar image sources with:
```tsx
<img src="/brand-logo.png" alt="Incident Command Deck" className="h-8 w-8 object-contain" />
```

- [ ] **Step 3: Find and update logo references in FirstRunSetup.tsx**

Search for SVG logo references in `FirstRunSetup.tsx`. Replace with:
```tsx
<img src="/brand-logo.png" alt="Incident Command Deck" className="h-10 w-10 object-contain" />
```

- [ ] **Step 4: Verify visually**

```bash
cd dashboard && npm run dev
```
Open `http://localhost:3000` — confirm brand logo renders in rail, assistant avatar, and first-run setup.

- [ ] **Step 5: Commit**

```bash
git add dashboard/client/public/brand-logo.png dashboard/client/src/pages/Home.tsx dashboard/client/src/components/FirstRunSetup.tsx
git commit -m "feat: replace placeholder SVG logos with brand asset"
```

---

### Task 3: Fleet & SSH Probe Routes

**Files:**
- Create: `src/routes/fleet.ts`
- Test: `src/fleet.test.ts`
- Modify: `src/index.ts` (mount router)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`
- Produces:
  - `createFleetRouter(opts?: { logger?: Logger }): Router`
  - `GET /api/fleet/hosts` — returns `{ data: FleetHost[] }`
  - `POST /api/fleet/hosts` — body `{ hostname, port?, ssh_user?, ssh_key_path?, podman_socket? }`, returns 201 with created host
  - `POST /api/fleet/probe` — body `{ host_id }` or `{ hostname, port }`, returns `{ ssh: boolean, podman: boolean, latency_ms: number, error?: string }`
  - `DELETE /api/fleet/hosts/:id` — returns `{ status: "ok" }`

- [ ] **Step 1: Write the failing test**

Create `src/fleet.test.ts`:
```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb } from "./db";
import { createFleetRouter } from "./routes/fleet";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(import.meta.dirname ?? __dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "fleet-test.sqlite");

describe("fleet routes", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    initDb(TEST_DB_PATH);

    const app = express();
    app.use(express.json());
    app.use(createFleetRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it("GET /api/fleet/hosts returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/fleet/hosts`);
    assert.equal(res.status, 200);
    const body = await res.json() as { data: unknown[] };
    assert.ok(Array.isArray(body.data));
  });

  it("POST /api/fleet/hosts creates a host", async () => {
    const res = await fetch(`${baseUrl}/api/fleet/hosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: "test-host.local", port: 22, ssh_user: "root" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { id: string; hostname: string };
    assert.equal(body.hostname, "test-host.local");
    assert.ok(body.id);
  });

  it("POST /api/fleet/hosts rejects missing hostname", async () => {
    const res = await fetch(`${baseUrl}/api/fleet/hosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: 22 }),
    });
    assert.equal(res.status, 400);
  });

  it("DELETE /api/fleet/hosts/:id removes a host", async () => {
    // Create first
    const createRes = await fetch(`${baseUrl}/api/fleet/hosts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: "delete-me.local" }),
    });
    const { id } = await createRes.json() as { id: string };

    const res = await fetch(`${baseUrl}/api/fleet/hosts/${id}`, { method: "DELETE" });
    assert.equal(res.status, 200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json && node --test dist/fleet.test.js
```
Expected: FAIL — `./routes/fleet` not found

- [ ] **Step 3: Write the implementation**

Create `src/routes/fleet.ts`:
```typescript
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { request as httpRequest } from "node:http";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface FleetRouterOptions {
  logger?: Logger;
  broadcast?: (message: unknown) => void;
}

export function createFleetRouter(opts?: FleetRouterOptions): Router {
  const router = Router();
  const logger = opts?.logger;
  const broadcast = opts?.broadcast;

  router.get("/api/fleet/hosts", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM fleet_hosts ORDER BY created_at DESC").all();
    res.json({ data: rows });
  });

  router.post("/api/fleet/hosts", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hostname = typeof body.hostname === "string" ? body.hostname.trim() : "";
    if (!hostname) {
      res.status(400).json({ error: "invalid_payload", details: ["hostname is required"] });
      return;
    }
    const id = `host-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare(
      `INSERT INTO fleet_hosts (id, hostname, ip, port, ssh_user, ssh_key_path, podman_socket, created_at)
       VALUES (@id, @hostname, @ip, @port, @ssh_user, @ssh_key_path, @podman_socket, @created_at)`
    ).run({
      id,
      hostname,
      ip: typeof body.ip === "string" ? body.ip : null,
      port: typeof body.port === "number" ? body.port : 22,
      ssh_user: typeof body.ssh_user === "string" ? body.ssh_user : null,
      ssh_key_path: typeof body.ssh_key_path === "string" ? body.ssh_key_path : null,
      podman_socket: typeof body.podman_socket === "string" ? body.podman_socket : null,
      created_at: now,
    });
    const host = db.prepare("SELECT * FROM fleet_hosts WHERE id = ?").get(id);
    logger?.info({ event: "fleet_host_created", hostId: id }, "fleet host registered");
    res.status(201).json(host);
  });

  router.post("/api/fleet/probe", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const db = getDb();

    let hostname: string;
    let port: number;
    let podmanSocket: string | null = null;
    let hostId: string | null = null;

    if (typeof body.host_id === "string") {
      const host = db.prepare("SELECT * FROM fleet_hosts WHERE id = ?").get(body.host_id) as Record<string, unknown> | undefined;
      if (!host) {
        res.status(404).json({ error: "host_not_found" });
        return;
      }
      hostname = host.hostname as string;
      port = (host.port as number) || 22;
      podmanSocket = (host.podman_socket as string) || null;
      hostId = body.host_id;
    } else if (typeof body.hostname === "string") {
      hostname = body.hostname;
      port = typeof body.port === "number" ? body.port : 22;
      podmanSocket = typeof body.podman_socket === "string" ? body.podman_socket : null;
    } else {
      res.status(400).json({ error: "invalid_payload", details: ["host_id or hostname required"] });
      return;
    }

    // SSH TCP probe
    const sshResult = await new Promise<{ ok: boolean; latency_ms: number; error?: string }>((resolve) => {
      const start = Date.now();
      const socket = createConnection({ host: hostname, port, timeout: 5000 }, () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({ ok: true, latency_ms: latency });
      });
      socket.on("error", (err) => {
        socket.destroy();
        resolve({ ok: false, latency_ms: Date.now() - start, error: err.message });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ ok: false, latency_ms: Date.now() - start, error: "connection timeout (5s)" });
      });
    });

    // Podman socket probe (local unix socket only)
    let podmanResult = { ok: false, error: "no socket configured" };
    if (podmanSocket) {
      podmanResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const req = httpRequest({ socketPath: podmanSocket!, path: "/_ping", method: "GET", timeout: 3000 }, (response) => {
          let data = "";
          response.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          response.on("end", () => resolve({ ok: response.statusCode === 200 }));
        });
        req.on("error", (err) => resolve({ ok: false, error: err.message }));
        req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "timeout (3s)" }); });
        req.end();
      });
    }

    // Persist probe result
    if (hostId) {
      const now = new Date().toISOString();
      const probeStatus = sshResult.ok ? "online" : "offline";
      db.prepare(
        `UPDATE fleet_hosts SET last_probe_status = @status, last_probe_at = @at, probe_latency_ms = @latency, probe_error = @error WHERE id = @id`
      ).run({ status: probeStatus, at: now, latency: sshResult.latency_ms, error: sshResult.error ?? null, id: hostId });
      broadcast?.({ type: "fleet_updated", host_id: hostId, payload: { status: probeStatus, latency_ms: sshResult.latency_ms } });
    }

    res.json({ ssh: sshResult.ok, podman: podmanResult.ok, latency_ms: sshResult.latency_ms, error: sshResult.error ?? podmanResult.error });
  });

  router.delete("/api/fleet/hosts/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const result = db.prepare("DELETE FROM fleet_hosts WHERE id = ?").run(id);
    if (result.changes === 0) {
      res.status(404).json({ error: "host_not_found" });
      return;
    }
    res.json({ status: "ok" });
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx tsc -p tsconfig.json && node --test dist/fleet.test.js
```
Expected: 4 tests PASS

- [ ] **Step 5: Mount fleet router in index.ts**

In `src/index.ts`, add:
```typescript
import { createFleetRouter } from "./routes/fleet";
```

Inside `registerRoutes`:
```typescript
app.use(createFleetRouter({ logger, broadcast }));
```

- [ ] **Step 6: Add fleet.test.js to package.json test script**

- [ ] **Step 7: Commit**

```bash
git add src/routes/fleet.ts src/fleet.test.ts src/index.ts package.json
git commit -m "feat: add fleet host CRUD and SSH/Podman probe routes"
```

---

### Task 4: Model Config Route

**Files:**
- Create: `src/routes/models.ts`
- Modify: `src/index.ts` (mount router)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`, env `TRUEFORGE_MODEL`
- Produces:
  - `createModelsRouter(opts?: { logger?: Logger }): Router`
  - `GET /api/models` — returns `{ data: Array<{ id: string; name: string; provider: string }>, active: string }`

- [ ] **Step 1: Write the implementation**

Create `src/routes/models.ts`:
```typescript
import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface ModelsRouterOptions {
  logger?: Logger;
}

const KNOWN_MODELS = [
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", provider: "Anthropic" },
  { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", provider: "Anthropic" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "Google" },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
  { id: "local", name: "Local Model", provider: "Local" },
];

export function createModelsRouter(opts?: ModelsRouterOptions): Router {
  const router = Router();

  router.get("/api/models", (_req: Request, res: Response) => {
    const db = getDb();
    const activeSetting = db.prepare("SELECT value FROM settings WHERE key = 'model'").get() as { value: string } | undefined;
    const active = activeSetting?.value ?? "anthropic/claude-sonnet-5";
    res.json({ data: KNOWN_MODELS, active });
  });

  return router;
}
```

- [ ] **Step 2: Mount in index.ts**

```typescript
import { createModelsRouter } from "./routes/models";
// inside registerRoutes:
app.use(createModelsRouter({ logger }));
```

- [ ] **Step 3: Verify**

```bash
npx tsc -p tsconfig.json && curl -s http://localhost:3001/api/models | jq .
```
Expected: JSON with `data` array of models and `active` field

- [ ] **Step 4: Commit**

```bash
git add src/routes/models.ts src/index.ts
git commit -m "feat: add model config listing route"
```

---

### Task 5: Settings Routes

**Files:**
- Create: `src/routes/settings.ts`
- Test: `src/settings.test.ts`
- Modify: `src/index.ts` (mount router)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`
- Produces:
  - `createSettingsRouter(opts?): Router`
  - `GET /api/settings` — returns `{ enforcement_mode, model, sandbox_url, operator_name, skills, mcps }`
  - `PUT /api/settings` — body `{ [key]: value }`, upserts each key-value pair

- [ ] **Step 1: Write the failing test**

Create `src/settings.test.ts`:
```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb } from "./db";
import { createSettingsRouter } from "./routes/settings";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(import.meta.dirname ?? __dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "settings-test.sqlite");

describe("settings routes", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    initDb(TEST_DB_PATH);
    const app = express();
    app.use(express.json());
    app.use(createSettingsRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => { server.close(); if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH); });

  it("GET /api/settings returns seeded defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, string>;
    assert.equal(body.enforcement_mode, "STRICT_GATED");
    assert.ok(body.skills);
  });

  it("PUT /api/settings upserts values", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_name: "ops-lead", model: "google/gemini-2.5-pro" }),
    });
    assert.equal(res.status, 200);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = await getRes.json() as Record<string, string>;
    assert.equal(body.operator_name, "ops-lead");
    assert.equal(body.model, "google/gemini-2.5-pro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx tsc -p tsconfig.json && node --test dist/settings.test.js
```
Expected: FAIL

- [ ] **Step 3: Write the implementation**

Create `src/routes/settings.ts`:
```typescript
import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface SettingsRouterOptions {
  logger?: Logger;
  broadcast?: (message: unknown) => void;
}

const ALLOWED_KEYS = new Set(["enforcement_mode", "model", "sandbox_url", "operator_name", "skills", "mcps"]);

export function createSettingsRouter(opts?: SettingsRouterOptions): Router {
  const router = Router();
  const broadcast = opts?.broadcast;

  router.get("/api/settings", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    res.json(settings);
  });

  router.put("/api/settings", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const db = getDb();
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value");

    const updated: string[] = [];
    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(key)) continue;
      const strValue = typeof value === "string" ? value : JSON.stringify(value);
      upsert.run({ key, value: strValue });
      updated.push(key);
    }

    if (updated.includes("enforcement_mode")) {
      broadcast?.({ type: "agent_mode_changed", payload: { mode: body.enforcement_mode } });
    }

    res.json({ status: "ok", updated });
  });

  return router;
}
```

- [ ] **Step 4: Run tests**

```bash
npx tsc -p tsconfig.json && node --test dist/settings.test.js
```
Expected: 2 tests PASS

- [ ] **Step 5: Mount in index.ts and add to test script**

- [ ] **Step 6: Commit**

```bash
git add src/routes/settings.ts src/settings.test.ts src/index.ts package.json
git commit -m "feat: add settings CRUD routes with enforcement mode broadcast"
```

---

### Task 6: Policy Extensions (Profiles, Stats, Mode, Analyze)

**Files:**
- Modify: `src/routes/policy.ts` (add profile, stats, mode, analyze routes)
- Modify: `src/policy.ts` (add profile/stats/mode helpers reading from DB)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`, existing `listPolicyRules()`, `simulatePolicy()` from `src/policy.ts`
- Produces:
  - `GET /api/policy/profiles` — returns `{ data: Array<{ name: string; is_active: boolean; rule_ids: string[] }> }`
  - `PUT /api/policy/profiles/:name` — switches active profile, returns updated profile
  - `GET /api/policy/stats` — returns `{ activeRules, blacklistedBinaries, highRiskPatterns, interceptedCount }`
  - `PUT /api/policy/mode` — body `{ mode: "AUTONOMOUS"|"STRICT_GATED"|"DRY_RUN" }`, persists to settings
  - `POST /api/policy/analyze` — body `{ command: string }`, returns AST simulation result (alias for simulate)

- [ ] **Step 1: Add new routes to `src/routes/policy.ts`**

Append before the `return router;` line:

```typescript
  router.get("/api/policy/profiles", (_req: Request, res: Response) => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM policy_profiles ORDER BY name").all() as Array<{ name: string; is_active: number; rule_ids: string; created_at: string }>;
    res.json({
      data: rows.map((r) => ({ name: r.name, is_active: Boolean(r.is_active), rule_ids: JSON.parse(r.rule_ids) })),
    });
  });

  router.put("/api/policy/profiles/:name", (req: Request, res: Response) => {
    const name = String(req.params.name);
    const db = getDb();
    const profile = db.prepare("SELECT * FROM policy_profiles WHERE name = ?").get(name);
    if (!profile) {
      res.status(404).json({ error: "profile_not_found" });
      return;
    }
    db.prepare("UPDATE policy_profiles SET is_active = 0").run();
    db.prepare("UPDATE policy_profiles SET is_active = 1 WHERE name = ?").run(name);
    res.json({ status: "ok", active: name });
  });

  router.get("/api/policy/stats", (_req: Request, res: Response) => {
    const rules = listPolicyRules();
    const active = rules.filter((r) => r.enabled);
    res.json({
      activeRules: active.length,
      blacklistedBinaries: active.filter((r) => r.severity === "CRITICAL_BLOCK").length,
      highRiskPatterns: active.filter((r) => r.category === "DESTRUCTIVE_FS" || r.category === "NETWORK_EXFIL").length,
      interceptedCount: 0, // live count will be incremented per gate trip
    });
  });

  router.put("/api/policy/mode", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = typeof body.mode === "string" ? body.mode : "";
    if (!["AUTONOMOUS", "STRICT_GATED", "DRY_RUN"].includes(mode)) {
      res.status(400).json({ error: "invalid_mode", details: ["mode must be AUTONOMOUS, STRICT_GATED, or DRY_RUN"] });
      return;
    }
    const db = getDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('enforcement_mode', @mode) ON CONFLICT(key) DO UPDATE SET value = @mode").run({ mode });
    res.json({ status: "ok", mode });
  });

  router.post("/api/policy/analyze", (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    if (!command.trim()) {
      res.status(400).json({ error: "invalid_payload", details: ["command must be a non-empty string"] });
      return;
    }
    if (command.length > 4096) {
      res.status(400).json({ error: "invalid_payload", details: ["command exceeds maximum length of 4096 characters"] });
      return;
    }
    const result = simulatePolicy(command);
    res.json(result);
  });
```

Add imports at top of `src/routes/policy.ts`:
```typescript
import { getDb } from "../db";
```

- [ ] **Step 2: Verify with curl**

```bash
curl -s http://localhost:3001/api/policy/profiles | jq .
curl -s http://localhost:3001/api/policy/stats | jq .
curl -s -X PUT -H "Content-Type: application/json" -d '{"mode":"DRY_RUN"}' http://localhost:3001/api/policy/mode | jq .
curl -s -X POST -H "Content-Type: application/json" -d '{"command":"rm -rf /var/log"}' http://localhost:3001/api/policy/analyze | jq .
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/policy.ts
git commit -m "feat: add policy profiles, stats, mode, and analyze routes"
```

---

### Task 7: Sessions Route

**Files:**
- Create: `src/routes/sessions.ts`
- Modify: `src/index.ts` (mount router)
- Modify: `src/incident-plane.ts` (insert session row on sandbox_started)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`
- Produces:
  - `createSessionsRouter(opts?): Router`
  - `GET /api/sessions` — returns `{ data: Array<{ id, thread_id, incident_id, summary, created_at }> }`
  - `GET /api/sessions/:id` — returns single session

- [ ] **Step 1: Write the implementation**

Create `src/routes/sessions.ts`:
```typescript
import { Router, type Request, type Response } from "express";
import type { Logger } from "../logger";
import { getDb } from "../db";

export interface SessionsRouterOptions {
  logger?: Logger;
}

export function createSessionsRouter(opts?: SessionsRouterOptions): Router {
  const router = Router();

  router.get("/api/sessions", (_req: Request, res: Response) => {
    const db = getDb();
    const limit = Number(_req.query.limit) || 50;
    const rows = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?").all(limit);
    res.json({ data: rows });
  });

  router.get("/api/sessions/:id", (req: Request, res: Response) => {
    const id = String(req.params.id);
    const db = getDb();
    const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.json(session);
  });

  return router;
}
```

- [ ] **Step 2: Wire session insertion in incident-plane.ts**

In `src/incident-plane.ts`, in the `sandbox_started` event handler (the `case "sandbox.created"` block), add after the broadcast:

```typescript
import { getDb } from "./db";

// Inside the sandbox.created handler, after broadcast:
try {
  const db = getDb();
  db.prepare(
    `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
     VALUES (@id, @thread_id, @incident_id, @summary, @created_at)`
  ).run({
    id: sessionId,
    thread_id: ev.threadId ?? null,
    incident_id: incidentId,
    summary: `Incident ${incidentId} diagnosis session`,
    created_at: new Date().toISOString(),
  });
  broadcast({ type: "session_created", payload: { session_id: sessionId, thread_id: ev.threadId, incident_id: incidentId } });
} catch { /* DB insert failure is non-fatal */ }
```

- [ ] **Step 3: Mount in index.ts**

```typescript
import { createSessionsRouter } from "./routes/sessions";
// inside registerRoutes:
app.use(createSessionsRouter({ logger }));
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/sessions.ts src/incident-plane.ts src/index.ts
git commit -m "feat: add sessions list route and persist sessions on sandbox creation"
```

---

### Task 8: Emergency Stop Route

**Files:**
- Modify: `src/incident-plane.ts` (add emergency stop handler)

**Interfaces:**
- Consumes: TrueForge client, incident store
- Produces: `POST /api/emergency-stop` — cancels all active sessions, returns `{ cancelled: number }`

- [ ] **Step 1: Add route in incident-plane.ts**

In the `createIncidentRouter` function, add before `return router`:

```typescript
  router.post("/api/emergency-stop", async (_req: Request, res: Response) => {
    const client = getTf().client;
    const active = listIncidents({ status: "diagnosing" }).concat(listIncidents({ status: "awaiting_approval" }));
    let cancelled = 0;

    for (const incident of active) {
      if (incident.sessionId && client) {
        try {
          await client.sessions.cancel(incident.sessionId);
        } catch { /* best-effort cancellation */ }
      }
      setIncidentStatus(incident.id, "failed");
      broadcast({
        type: "execution_complete",
        incident_id: incident.id,
        payload: { status: "failed" },
      });
      cancelled++;
    }

    logger.info({ event: "emergency_stop", cancelled }, "emergency stop executed");
    res.json({ status: "ok", cancelled });
  });
```

- [ ] **Step 2: Verify**

```bash
npx tsc -p tsconfig.json
curl -s -X POST http://localhost:3001/api/emergency-stop | jq .
```

- [ ] **Step 3: Commit**

```bash
git add src/incident-plane.ts
git commit -m "feat: add emergency stop route to cancel all active sessions"
```

---

### Task 9: Wire Enforcement Mode into Approval Gate

**Files:**
- Modify: `src/incident-plane.ts` (check enforcement mode in tool_approval_required handler)

**Interfaces:**
- Consumes: `getDb()` from `src/db.ts`, enforcement mode from settings table
- Produces: Modified approval gate behavior based on mode

- [ ] **Step 1: Add mode check in the `tool.approval_required` handler**

In `src/incident-plane.ts`, at the top of the `case "tool.approval_required"` block (around line 448), before `patchIncident(...)`:

```typescript
          case "tool.approval_required": {
            const gate = ev as ToolApprovalRequiredEvent;
            const gated = gate.toolCalls.map((r) => toolCallById.get(r.id) ?? r);
            const commands = gated.map((t) => toolCommandString(t) || t.id || "unknown");
            const badges = computeGateBadges(commands);

            // Check enforcement mode
            let enforcementMode = "STRICT_GATED";
            try {
              const db = getDb();
              const row = db.prepare("SELECT value FROM settings WHERE key = 'enforcement_mode'").get() as { value: string } | undefined;
              if (row) enforcementMode = row.value;
            } catch { /* fallback to STRICT_GATED */ }

            if (enforcementMode === "AUTONOMOUS") {
              // Auto-approve: resume turn immediately
              patchIncident(incidentId, { turnId, threadId: gate.threadId, proposedCommand: commands.join("\n"), proposedCommands: commands, safetyBadges: badges });
              setIncidentStatus(incidentId, "approved");
              const approvalInputs = gated.map((t) => ({
                type: "user.tool_approval" as const,
                threadId: gate.threadId,
                toolCallId: t.id,
                approval: { status: "allow" as const },
              }));
              // Resume the turn (fire-and-forget the stream continuation)
              resumeApproval(incidentId, approvalInputs);
              return;
            }

            if (enforcementMode === "DRY_RUN") {
              // Log only, auto-deny
              patchIncident(incidentId, { turnId, threadId: gate.threadId, proposedCommand: commands.join("\n"), proposedCommands: commands, safetyBadges: badges });
              setIncidentStatus(incidentId, "rejected");
              logger.info({ event: "dry_run_deny", incidentId, commands }, "DRY_RUN mode: auto-denied");
              broadcast({ type: "execution_complete", incident_id: incidentId, payload: { status: "rejected" } });
              const denyInputs = gated.map((t) => ({
                type: "user.tool_approval" as const,
                threadId: gate.threadId,
                toolCallId: t.id,
                approval: { status: "deny" as const },
              }));
              resumeApproval(incidentId, denyInputs);
              return;
            }

            // STRICT_GATED (default): existing behavior — wait for human
            patchIncident(incidentId, {
              turnId,
              threadId: gate.threadId,
              toolCallId: gated[0]?.id,
              toolCallIds: gated.map((t) => t.id),
              proposedCommand: commands.join("\n"),
              proposedCommands: commands,
              safetyBadges: badges,
            });
            setIncidentStatus(incidentId, "awaiting_approval");
            broadcast({
              type: "pending_approval",
              incident_id: incidentId,
              payload: {
                proposed_command: commands.join("\n"),
                proposed_commands: commands,
                safety_badges: badges,
                diff: commandDiff(commands),
              },
            });
            return; // halt; the approval route resumes the turn
          }
```

Note: `resumeApproval` is the existing function that calls `client.sessions.createTurnStream(...)` with approval inputs. Ensure it's accessible in this scope (it's defined later in the same file as `resumeApproval`).

- [ ] **Step 2: Verify compilation**

```bash
npx tsc -p tsconfig.json
```

- [ ] **Step 3: Commit**

```bash
git add src/incident-plane.ts
git commit -m "feat: wire enforcement mode (AUTONOMOUS/STRICT_GATED/DRY_RUN) into approval gate"
```

---

### Task 10: Rewrite `usePolicyEngine` Hook

**Files:**
- Modify: `dashboard/client/src/hooks/usePolicyEngine.ts` (replace mock with real API calls)
- Modify: `dashboard/client/src/types/operations.ts` (add `matchedRules` to `AstSimulation`)

**Interfaces:**
- Consumes: Control plane APIs: `GET /api/policy/rules`, `GET /api/policy/profiles`, `GET /api/policy/stats`, `GET /api/settings`, `PUT /api/policy/rules/:id`, `POST /api/policy/rules`, `PUT /api/policy/profiles/:name`, `PUT /api/policy/mode`, `POST /api/policy/analyze`
- Produces: Same hook return shape as before — `GovernanceView.tsx` needs zero changes

- [ ] **Step 1: Rewrite the hook**

Replace `dashboard/client/src/hooks/usePolicyEngine.ts` entirely:
```typescript
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AstSimulation, PolicyRule, SafetyEnforcementMode } from "@/types/operations";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function usePolicyEngine() {
  const [profile, setProfile] = useState<string>("Production Safe");
  const [profiles, setProfiles] = useState<string[]>([]);
  const [mode, setMode] = useState<SafetyEnforcementMode>("STRICT_GATED");
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [astSimulation, setAstSimulation] = useState<AstSimulation | null>(null);
  const [statsData, setStatsData] = useState({ activeRules: 0, blacklistedBinaries: 0, highRiskPatterns: 0, interceptedCount: 0 });

  // Initial data load
  useEffect(() => {
    void (async () => {
      try {
        const [rulesRes, profilesRes, statsRes, settingsRes] = await Promise.all([
          apiFetch<{ data: PolicyRule[] }>("/api/policy/rules"),
          apiFetch<{ data: Array<{ name: string; is_active: boolean }> }>("/api/policy/profiles"),
          apiFetch<{ activeRules: number; blacklistedBinaries: number; highRiskPatterns: number; interceptedCount: number }>("/api/policy/stats"),
          apiFetch<Record<string, string>>("/api/settings"),
        ]);
        setRules(rulesRes.data);
        const profileNames = profilesRes.data.map((p) => p.name);
        setProfiles(profileNames);
        const activeProfile = profilesRes.data.find((p) => p.is_active);
        if (activeProfile) setProfile(activeProfile.name);
        setStatsData(statsRes);
        if (settingsRes.enforcement_mode) setMode(settingsRes.enforcement_mode as SafetyEnforcementMode);
      } catch (err) {
        console.error("Failed to load policy data:", err);
      }
    })();
  }, []);

  const stats = useMemo(() => statsData, [statsData]);

  const onProfileChange = useCallback(async (value: string) => {
    setProfile(value);
    try {
      await apiFetch(`/api/policy/profiles/${encodeURIComponent(value)}`, { method: "PUT" });
    } catch (err) {
      console.error("Failed to switch profile:", err);
    }
  }, []);

  const onToggleRule = useCallback(async (id: string) => {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
    try {
      const rule = rules.find((r) => r.id === id);
      if (rule) {
        await apiFetch(`/api/policy/rules/${id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) });
      }
    } catch (err) {
      console.error("Failed to toggle rule:", err);
      // Revert optimistic update
      setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
    }
  }, [rules]);

  const onSaveRule = useCallback(async (ruleData?: Record<string, unknown>) => {
    setEditorOpen(false);
    if (!ruleData) return;
    try {
      const created = await apiFetch<PolicyRule>("/api/policy/rules", { method: "POST", body: JSON.stringify(ruleData) });
      setRules((current) => [...current, created]);
      setNotice("Policy rule created successfully.");
    } catch (err) {
      setNotice(`Failed to create rule: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onAnalyze = useCallback(async (command: string) => {
    try {
      const result = await apiFetch<AstSimulation>("/api/policy/analyze", { method: "POST", body: JSON.stringify({ command }) });
      setAstSimulation(result);
      setNotice("");
    } catch (err) {
      setNotice(`Analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const onModeChange = useCallback(async (newMode: SafetyEnforcementMode) => {
    setMode(newMode);
    try {
      await apiFetch("/api/policy/mode", { method: "PUT", body: JSON.stringify({ mode: newMode }) });
    } catch (err) {
      console.error("Failed to set mode:", err);
    }
  }, []);

  return {
    profile,
    profiles,
    mode,
    rules,
    stats,
    expandedRuleId,
    editorOpen,
    notice,
    astSimulation,
    onProfileChange,
    setMode: onModeChange,
    setExpandedRuleId,
    setEditorOpen,
    onToggleRule,
    onSaveRule,
    onAnalyze,
  };
}
```

- [ ] **Step 2: Verify GovernanceView still renders**

```bash
cd dashboard && npm run dev
```
Navigate to AST Governance view — confirm rules load from API, toggle works, analyze works.

- [ ] **Step 3: Commit**

```bash
git add dashboard/client/src/hooks/usePolicyEngine.ts
git commit -m "feat: rewrite usePolicyEngine hook to use real control plane API"
```

---

### Task 11: Rewrite FirstRunSetup

**Files:**
- Modify: `dashboard/client/src/components/FirstRunSetup.tsx`

**Interfaces:**
- Consumes: `GET /api/models`, `POST /api/fleet/probe`, `PUT /api/settings`, `PUT /api/settings/sandbox`
- Produces: Wired setup wizard with real model dropdown, SSH probe, sandbox URL, settings persistence

- [ ] **Step 1: Add API base constant and model fetch**

At the top of `FirstRunSetup.tsx`, after the existing imports:
```typescript
const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";
```

- [ ] **Step 2: Add model list state and fetch**

Inside the component function, add:
```typescript
const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);

useEffect(() => {
  void fetch(`${API}/api/models`)
    .then((r) => r.json())
    .then((data: { data: Array<{ id: string; name: string; provider: string }> }) => setModels(data.data))
    .catch(() => {});
}, []);
```

- [ ] **Step 3: Replace LLM endpoint text input with dropdown**

Find the LLM endpoint input field and replace with:
```tsx
<select
  value={form.modelKeys.localLlmEndpoint ?? ""}
  onChange={(e) => updateModelKey("localLlmEndpoint", e.target.value)}
  className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white/90"
>
  <option value="">Select model…</option>
  {models.map((m) => (
    <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
  ))}
</select>
```

If selected model is `"local"`, show base URL input below.

- [ ] **Step 4: Replace testConnection with real probe**

Replace the mock `testConnection` function:
```typescript
const testConnection = async () => {
  setConnectionCheck({ state: "testing", message: "Probing SSH target…" });
  try {
    const res = await fetch(`${API}/api/fleet/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostname: form.ssh.targetHost, port: form.ssh.sshPort }),
    });
    const data = await res.json() as { ssh: boolean; latency_ms: number; error?: string };
    if (data.ssh) {
      setConnectionCheck({ state: "success", message: `Connected (${data.latency_ms}ms latency)` });
    } else {
      setConnectionCheck({ state: "error", message: data.error ?? "Connection failed" });
    }
  } catch (err) {
    setConnectionCheck({ state: "error", message: err instanceof Error ? err.message : "Probe failed" });
  }
};
```

- [ ] **Step 5: Add Sandbox URL field**

Add a new section in the wizard (between model config and safeguards):
```tsx
<div className="space-y-2">
  <label className="text-xs text-white/50 uppercase tracking-wider">Sandbox URL (Daytona)</label>
  <input
    type="url"
    placeholder="https://sandbox.example.com"
    value={form.sandboxUrl ?? ""}
    onChange={(e) => update("sandboxUrl", e.target.value)}
    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white/90"
  />
</div>
```

- [ ] **Step 6: Persist settings on complete**

In the `onComplete` handler, add settings persistence:
```typescript
void fetch(`${API}/api/settings`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: preferences.modelKeys.localLlmEndpoint ?? "",
    operator_name: preferences.operatorLabel,
    enforcement_mode: preferences.defaultApprovalMode,
    sandbox_url: preferences.sandboxUrl ?? "",
  }),
}).catch(() => {});

// Register the SSH host if live mode
if (preferences.launchMode === "LIVE_HOST" && preferences.ssh.targetHost) {
  void fetch(`${API}/api/fleet/hosts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hostname: preferences.ssh.targetHost,
      port: preferences.ssh.sshPort,
      ssh_user: preferences.ssh.userKeyPath?.split("@")[0] ?? "",
      ssh_key_path: preferences.ssh.userKeyPath,
    }),
  }).catch(() => {});
}
```

- [ ] **Step 7: Verify visually**

Open `http://localhost:3000`, clear localStorage, reload. Walk through setup wizard.

- [ ] **Step 8: Commit**

```bash
git add dashboard/client/src/components/FirstRunSetup.tsx
git commit -m "feat: wire FirstRunSetup to real model API, SSH probe, and settings persistence"
```

---

### Task 12: Wire AgentStatusCapabilitiesBar

**Files:**
- Modify: `dashboard/client/src/pages/Home.tsx` (wire callbacks to real APIs)
- Modify: `dashboard/client/src/components/AgentStatusCapabilitiesBar.tsx` (add model dropdown select)

**Interfaces:**
- Consumes: `PUT /api/policy/mode`, `GET /api/models`, `PUT /api/settings`, `POST /api/emergency-stop`, `POST /api/fleet/probe`
- Produces: Wired GATED toggle, model dropdown, emergency stop, SSH reconnect

- [ ] **Step 1: Wire onToggleApprovalMode in Home.tsx**

Find the `onToggleApprovalMode` callback in Home.tsx. Replace with:
```typescript
const handleToggleApprovalMode = useCallback(async (newMode: ApprovalMode) => {
  setApprovalMode(newMode);
  try {
    await fetch(`${CONTROL_PLANE_ORIGIN}/api/policy/mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: newMode }),
    });
  } catch (err) {
    console.error("Failed to set approval mode:", err);
    // Revert on error
    setApprovalMode((prev) => prev === "AUTONOMOUS" ? "STRICT_GATED" : "AUTONOMOUS");
  }
}, []);
```

- [ ] **Step 2: Wire onEmergencyStop in Home.tsx**

```typescript
const handleEmergencyStop = useCallback(async () => {
  if (!window.confirm("Emergency stop will cancel ALL active agent sessions. Continue?")) return;
  try {
    await fetch(`${CONTROL_PLANE_ORIGIN}/api/emergency-stop`, { method: "POST" });
  } catch (err) {
    console.error("Emergency stop failed:", err);
  }
}, []);
```

- [ ] **Step 3: Add model state and dropdown in AgentStatusCapabilitiesBar.tsx**

In `AgentStatusCapabilitiesBar.tsx`, find the static model name display. Replace with an interactive select if the parent provides a models list and onChange handler. Add to props:
```typescript
models?: Array<{ id: string; name: string }>;
onModelChange?: (modelId: string) => void;
```

Replace the model name span with:
```tsx
{props.models && props.onModelChange ? (
  <select
    value={data.telemetry.activeModel}
    onChange={(e) => props.onModelChange?.(e.target.value)}
    className="bg-transparent border border-white/10 rounded px-2 py-0.5 text-xs text-white/80"
  >
    {props.models.map((m) => (
      <option key={m.id} value={m.id}>{m.name}</option>
    ))}
  </select>
) : (
  <span className="text-xs text-white/60">{data.telemetry.activeModel}</span>
)}
```

- [ ] **Step 4: Fetch models in Home.tsx and pass to bar**

```typescript
const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
useEffect(() => {
  void fetch(`${CONTROL_PLANE_ORIGIN}/api/models`)
    .then((r) => r.json())
    .then((d: { data: Array<{ id: string; name: string }> }) => setModels(d.data))
    .catch(() => {});
}, []);

const handleModelChange = useCallback(async (modelId: string) => {
  try {
    await fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId }),
    });
  } catch (err) {
    console.error("Failed to switch model:", err);
  }
}, []);
```

Pass `models={models}` and `onModelChange={handleModelChange}` to `<AgentStatusCapabilitiesBar>`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/client/src/pages/Home.tsx dashboard/client/src/components/AgentStatusCapabilitiesBar.tsx
git commit -m "feat: wire agent status bar — GATED toggle, model dropdown, emergency stop"
```

---

### Task 13: Wire Workspace Cards

**Files:**
- Modify: `dashboard/client/src/pages/Home.tsx` (replace mock card data with real sources)

**Interfaces:**
- Consumes: `GET /api/fleet/hosts`, WS `pending_approval` event (already wired), WS `fleet_updated`
- Produces: TopologyMapCard fed from fleet API, BlastRadiusCard fed from per-incident approval data

- [ ] **Step 1: Fetch fleet hosts for TopologyMapCard**

In `Home.tsx`, add fleet data state:
```typescript
const [fleetHosts, setFleetHosts] = useState<unknown[]>([]);
useEffect(() => {
  void fetch(`${CONTROL_PLANE_ORIGIN}/api/fleet/hosts`)
    .then((r) => r.json())
    .then((d: { data: unknown[] }) => setFleetHosts(d.data))
    .catch(() => {});
}, []);
```

Transform fleet hosts into the `TopologyMapData` shape expected by `TopologyMapCard`. Map `fleet_hosts` rows to nodes with status/latency/services.

- [ ] **Step 2: Feed BlastRadiusCard from pending_approval**

The `pending_approval` WS event already arrives via `useControlPlane`. Extract `safety_badges` and `diff` from the latest `backendPopup` or incident state. Pass to `BlastRadiusCard` data prop instead of `mockBlastRadiusData`:

```typescript
const blastRadiusData = useMemo(() => {
  const latestApproval = plane.incidents.find((i) => i.pending);
  if (!latestApproval?.pending) return mockBlastRadiusData; // fallback
  return {
    command: latestApproval.pending.proposed_command,
    affectedResources: latestApproval.pending.safety_badges.map((b) => ({
      name: b.name,
      severity: b.status === "fail" ? "high" : "low",
    })),
    diff: latestApproval.pending.diff,
    riskScore: latestApproval.pending.safety_badges.filter((b) => b.status === "fail").length * 20,
  };
}, [plane.incidents]);
```

- [ ] **Step 3: Verify visually**

Open dashboard, trigger an alert, confirm topology card shows fleet data and blast radius card shows real incident data.

- [ ] **Step 4: Commit**

```bash
git add dashboard/client/src/pages/Home.tsx
git commit -m "feat: wire workspace cards to fleet API and live incident data"
```

---

### Task 14: Sessions Sidebar Component

**Files:**
- Create: `dashboard/client/src/components/SessionsList.tsx`
- Modify: `dashboard/client/src/pages/Home.tsx` (mount in sidebar rail)

**Interfaces:**
- Consumes: `GET /api/sessions`, WS `session_created` event
- Produces: Clickable session list in left navigation rail

- [ ] **Step 1: Create SessionsList component**

Create `dashboard/client/src/components/SessionsList.tsx`:
```tsx
import { useEffect, useState } from "react";
import { GalleryVerticalEnd } from "lucide-react";

const API = import.meta.env.VITE_CONTROL_PLANE_ORIGIN ?? "http://localhost:3000";

interface Session {
  id: string;
  thread_id: string | null;
  incident_id: string | null;
  summary: string | null;
  created_at: string;
}

interface SessionsListProps {
  onSelectSession?: (sessionId: string) => void;
  className?: string;
}

export function SessionsList({ onSelectSession, className }: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);

  useEffect(() => {
    void fetch(`${API}/api/sessions?limit=20`)
      .then((r) => r.json())
      .then((d: { data: Session[] }) => setSessions(d.data))
      .catch(() => {});
  }, []);

  if (sessions.length === 0) return null;

  return (
    <div className={className}>
      <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-white/30 font-medium">
        Sessions
      </div>
      <div className="space-y-0.5 px-1">
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelectSession?.(s.id)}
            className="w-full text-left px-2 py-1.5 rounded text-xs text-white/60 hover:text-white/90 hover:bg-white/5 transition-colors truncate flex items-center gap-2"
          >
            <GalleryVerticalEnd className="h-3 w-3 shrink-0 text-white/30" />
            <span className="truncate">{s.summary ?? `Session ${s.id.slice(0, 8)}`}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount in Home.tsx sidebar**

In `Home.tsx`, import `SessionsList` and add it below the nav items in the left rail:
```tsx
import { SessionsList } from "@/components/SessionsList";

// In the rail JSX, below the nav items:
<SessionsList className="mt-4 border-t border-white/5 pt-2" />
```

- [ ] **Step 3: Verify**

Open dashboard — sessions list should appear in sidebar (empty until incidents are triggered).

- [ ] **Step 4: Commit**

```bash
git add dashboard/client/src/components/SessionsList.tsx dashboard/client/src/pages/Home.tsx
git commit -m "feat: add sessions list sidebar component"
```

---

### Task 15: Settings Dialog Wiring

**Files:**
- Modify: `dashboard/client/src/pages/Home.tsx` (wire settings dialog to API)

**Interfaces:**
- Consumes: `GET /api/settings`, `PUT /api/settings`
- Produces: Skills and MCPs lists populated from API with add/remove

- [ ] **Step 1: Fetch settings when dialog opens**

In `Home.tsx`, add settings state:
```typescript
const [settingsData, setSettingsData] = useState<Record<string, string>>({});

useEffect(() => {
  if (!settingsOpen) return;
  void fetch(`${CONTROL_PLANE_ORIGIN}/api/settings`)
    .then((r) => r.json())
    .then((d: Record<string, string>) => setSettingsData(d))
    .catch(() => {});
}, [settingsOpen]);
```

- [ ] **Step 2: Replace mock skills/MCPs in the dialog**

Replace the hardcoded skills and MCPs lists with:
```typescript
const skills = useMemo(() => {
  try { return JSON.parse(settingsData.skills ?? "[]") as string[]; } catch { return []; }
}, [settingsData.skills]);

const mcps = useMemo(() => {
  try { return JSON.parse(settingsData.mcps ?? "[]") as string[]; } catch { return []; }
}, [settingsData.mcps]);
```

Wire add/remove handlers to `PUT /api/settings`.

- [ ] **Step 3: Verify**

Open settings dialog — skills and MCPs should load from API.

- [ ] **Step 4: Commit**

```bash
git add dashboard/client/src/pages/Home.tsx
git commit -m "feat: wire settings dialog to real settings API for skills and MCPs"
```

---

### Task 16: Final Integration Test & Cleanup

**Files:**
- Modify: `package.json` (ensure all test files in test script)
- Delete (after verification): `dashboard/client/src/data/mockGovernanceData.ts`, `dashboard/client/src/data/mockAgentStatus.ts`, `dashboard/client/src/data/mockFleetData.ts`

**Interfaces:**
- Consumes: All previous tasks
- Produces: Clean build, all tests passing, mock files removed

- [ ] **Step 1: Run full backend test suite**

```bash
npm test
```
Expected: All tests PASS

- [ ] **Step 2: Run frontend type check**

```bash
cd dashboard && npx tsc --noEmit
```
Expected: No type errors

- [ ] **Step 3: Verify full flow**

1. Start control plane: `TRUEFORGE_BASE_URL=http://localhost:8790 npm run dev -- serve --port 3001`
2. Start dashboard: `cd dashboard && npm run dev`
3. Walk through FirstRunSetup with real model dropdown + SSH probe
4. Open AST Governance — verify rules load from API, analyze works
5. Toggle GATED/AUTONOMOUS in agent status bar
6. Trigger an alert — verify approval gate respects enforcement mode
7. Check sessions sidebar populates after incident

- [ ] **Step 4: Remove mock data files**

Only after confirming all views work without them:
```bash
rm dashboard/client/src/data/mockGovernanceData.ts
rm dashboard/client/src/data/mockAgentStatus.ts
rm dashboard/client/src/data/mockFleetData.ts
```

Update any remaining imports that reference these files — the `Home.tsx` fallbacks for `mockTopologyData`, `mockSandboxTwinData`, etc. in `mockWorkspaceCards.ts` may still be needed for cards not yet fully wired.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete incident deck wiring — remove mock data, all views live"
```
