import { test } from "node:test";
import assert from "node:assert/strict";
import { detectComposeEngine, getDemoStatus } from "./compose-orchestrator";
import { initDb, getDb } from "../db";

test("detectComposeEngine detects installed docker or podman runtime", async () => {
  const engine = await detectComposeEngine();
  assert.ok(["docker", "podman"].includes(engine.type));
  assert.ok(engine.binary.length > 0);
  assert.ok(Array.isArray(engine.composeArgs));
});

test("getDemoStatus returns structured status without throwing", async () => {
  const status = await getDemoStatus();
  assert.equal(typeof status.running, "boolean");
  assert.equal(typeof status.sshReady, "boolean");
  assert.ok(["docker", "podman", "none"].includes(status.engine));
  assert.ok(Array.isArray(status.nodes));
});

test("fleet hosts table can be populated with demo cluster nodes", () => {
  initDb();
  const db = getDb();
  
  const insertHost = db.prepare(`
    INSERT INTO fleet_hosts (id, hostname, ip, port, ssh_user, last_probe_status, os_info, created_at)
    VALUES (@id, @hostname, @ip, @port, @ssh_user, @last_probe_status, @os_info, @created_at)
    ON CONFLICT(id) DO UPDATE SET last_probe_status = @last_probe_status
  `);

  const now = new Date().toISOString();
  insertHost.run({
    id: "node-server-test",
    hostname: "localhost",
    ip: "127.0.0.1",
    port: 2222,
    ssh_user: "root",
    last_probe_status: "online",
    os_info: "Alpine Linux (Gateway / Server)",
    created_at: now,
  });

  const row = db.prepare("SELECT * FROM fleet_hosts WHERE id = 'node-server-test'").get() as {
    id: string;
    hostname: string;
    port: number;
    ssh_user: string;
    last_probe_status: string;
  };

  assert.equal(row.id, "node-server-test");
  assert.equal(row.hostname, "localhost");
  assert.equal(row.port, 2222);
  assert.equal(row.ssh_user, "root");
  assert.equal(row.last_probe_status, "online");
});
