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

test("triggerDemoPrometheusAlert merges custom severity and description into preset", async () => {
  // Test alert triggering payload merging by running against mock server
  let capturedBody: any = null;
  const mockServer = require("node:http").createServer((req: any, res: any) => {
    let raw = "";
    req.on("data", (chunk: any) => (raw += chunk));
    req.on("end", () => {
      capturedBody = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, incidentId: "inc-123" }));
    });
  });

  await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const port = mockServer.address().port;

  try {
    const { triggerDemoPrometheusAlert } = require("./compose-orchestrator");
    const result = await triggerDemoPrometheusAlert(port, {
      alertname: "HighCPUUsage",
      severity: "warning",
      summary: "Custom CPU spike",
      description: "Overridden CPU description",
    });

    assert.equal(result.ok, true);
    assert.equal(result.incidentId, "inc-123");
    assert.ok(capturedBody);
    assert.equal(capturedBody.alerts.length, 1);
    assert.equal(capturedBody.alerts[0].labels.alertname, "HighCPUUsage");
    assert.equal(capturedBody.alerts[0].labels.severity, "warning");
    assert.equal(capturedBody.alerts[0].annotations.summary, "Custom CPU spike");
    assert.equal(capturedBody.alerts[0].annotations.description, "Overridden CPU description");
  } finally {
    mockServer.close();
  }
});

test("demo router rejects untrusted cross-origin requests with 403", async () => {
  const { startServer } = require("../server");
  const { createDemoRouter } = require("../routes/demo");
  const { createLogger } = require("../logger");

  const logger = createLogger("silent");
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    logger,
    getStatus: () => ({ state: "ready", baseUrlConfigured: true, authConfigured: false }),
    registerRoutes: (app: any) => {
      app.use(createDemoRouter({ logger, port: 3001 }));
    },
  });

  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/demo/start`, {
      method: "POST",
      headers: { Origin: "http://malicious-site.com" },
    });
    assert.equal(res.status, 403);
    const data = (await res.json()) as { ok: boolean; error: string };
    assert.equal(data.ok, false);
    assert.equal(data.error, "forbidden_origin");
  } finally {
    await server.close();
  }
});

test("Prometheus configuration and alert_rules.yml contain all 8 required rules and valid mounts", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const workspaceRoot = path.resolve(__dirname, "../..");

  // 1. Verify alert_rules.yml exists
  const alertRulesPath = path.join(workspaceRoot, "alert_rules.yml");
  assert.ok(fs.existsSync(alertRulesPath), "alert_rules.yml must exist at repository root");
  const alertRulesContent = fs.readFileSync(alertRulesPath, "utf8");

  // 2. Verify all 8 preset rules are present
  const EXPECTED_RULES = [
    "HighCPUUsage",
    "DiskSpaceCritical",
    "NginxDown",
    "MySQLDown",
    "RedisDown",
    "HighMemoryUsage",
    "LoadAverageHigh",
    "SSLCertExpiring",
  ];

  for (const rule of EXPECTED_RULES) {
    assert.ok(
      alertRulesContent.includes(`alert: ${rule}`),
      `alert_rules.yml must define rule: ${rule}`
    );
  }

  // 3. Verify docker-compose.yml mounts alert_rules.yml
  const composePath = path.join(workspaceRoot, "docker-compose.yml");
  assert.ok(fs.existsSync(composePath), "docker-compose.yml must exist");
  const composeContent = fs.readFileSync(composePath, "utf8");
  assert.ok(
    composeContent.includes("./alert_rules.yml:/etc/prometheus/alert_rules.yml:ro"),
    "docker-compose.yml must mount ./alert_rules.yml to /etc/prometheus/alert_rules.yml:ro"
  );

  // 4. Verify prometheus.yml references /etc/prometheus/alert_rules.yml
  const promPath = path.join(workspaceRoot, "prometheus.yml");
  assert.ok(fs.existsSync(promPath), "prometheus.yml must exist");
  const promContent = fs.readFileSync(promPath, "utf8");
  assert.ok(
    promContent.includes("/etc/prometheus/alert_rules.yml"),
    "prometheus.yml must reference /etc/prometheus/alert_rules.yml in rule_files"
  );
});

