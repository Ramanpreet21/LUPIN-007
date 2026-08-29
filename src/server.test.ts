import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLogger } from "./logger";
import { startServer } from "./server";
import type { TrueForgeHandle, TrueForgeStatus } from "./trueforge";

import { createIncident, setIncidentStatus } from "./incidents";

import { createModelRouter } from "./routes/model";
import { createSandboxRouter } from "./routes/sandbox";
import { resetModelSettings } from "./model-settings";

const logger = createLogger("silent");
const readyStatus: TrueForgeStatus = { state: "ready", baseUrlConfigured: true, authConfigured: false };
const unconfiguredStatus: TrueForgeStatus = { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] };

async function withServer(getStatus: () => TrueForgeStatus, port = 0) {
  return startServer({ host: "127.0.0.1", port, logger, getStatus });
}
async function withRouters(getTf: () => TrueForgeHandle, getStatus: () => TrueForgeStatus, port = 0) {
  return startServer({
    host: "127.0.0.1",
    port,
    logger,
    getStatus,
    registerRoutes: (app) => {
      app.use(createModelRouter({ logger }));
      app.use(createSandboxRouter({ getTf, logger }));
    },
  });
}
test("GET /health returns ok with truthful trueforge status", async () => {
  const server = await withServer(() => unconfiguredStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; trueforge_ready: boolean; trueforge: TrueForgeStatus };
    assert.equal(body.status, "ok");
    assert.equal(body.trueforge_ready, false);
    assert.deepEqual(body.trueforge, unconfiguredStatus);
  } finally {
    await server.close();
  }
});

test("GET /health reports ready when trueforge client is constructed", async () => {
  const server = await withServer(() => readyStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    const body = (await res.json()) as { trueforge_ready: boolean };
    assert.equal(body.trueforge_ready, true);
  } finally {
    await server.close();
  }
});

test("unknown route returns JSON 404", async () => {
  const server = await withServer(() => unconfiguredStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/does-not-exist`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "not_found");
  } finally {
    await server.close();
  }
});

test("WebSocket connects at /ws and receives broadcasts", async () => {
  const server = await withServer(() => readyStatus);
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const received = new Promise<string>((resolve) => {
      ws.once("message", (data) => resolve(data.toString()));
    });
    server.broadcast({ type: "test", n: 1 });
    const message = await received;
    assert.deepEqual(JSON.parse(message), { type: "test", n: 1 });
  } finally {
    ws.close();
    await server.close();
  }
});

test("upgrade at a non-ws path is rejected", async () => {
  const server = await withServer(() => readyStatus);
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/other`);
  try {
    await new Promise<void>((resolve) => {
      ws.once("error", () => resolve());
    });
  } finally {
    ws.close();
    await server.close();
  }
});


test("GET /health reports live incident counts from the store", async () => {
  const incident = createIncident({ service_name: "svc", target_host: "h", severity: "warning" });
  assert.ok(incident);
  setIncidentStatus(incident!.id, "completed");
  const server = await withServer(() => readyStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { incidents_active: number; incidents_total: number };
    // The seeded incident is terminal (completed) → nothing active; total is exactly 1.
    assert.equal(body.incidents_active, 0);
    assert.equal(body.incidents_total, 1);
  } finally {
    await server.close();
  }
});

test("GET /api/policy/rules returns the seeded policy contract", async () => {
  const server = await withServer(() => readyStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/policy/rules`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    assert.equal(body.data.length, 6);
    for (const rule of body.data) {
      assert.ok("id" in rule && "binaryName" in rule && "forbiddenFlags" in rule);
      assert.ok("category" in rule && "severity" in rule && "reasonDescription" in rule);
      assert.ok("matchExpression" in rule && "enabled" in rule);
    }
  } finally {
    await server.close();
  }
});

test("POST /api/policy/simulate returns an AST simulation and 400 on empty input", async () => {
  const server = await withServer(() => readyStatus);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const res = await fetch(`${base}/api/policy/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "rm -rf /etc/app" }),
    });
    assert.equal(res.status, 200);
    const sim = (await res.json()) as {
      command: string;
      riskScore: number;
      trippedNode: string;
      nodes: unknown[];
    };
    assert.equal(sim.command, "rm -rf /etc/app");
    assert.ok(sim.riskScore > 30, `simulate should escalate rm -rf, got ${sim.riskScore}`);
    assert.ok(sim.nodes.length >= 2);
    assert.equal(sim.trippedNode, "Flag: -rf");

    const bad = await fetch(`${base}/api/policy/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "   " }),
    });
    assert.equal(bad.status, 400);
    const badBody = (await bad.json()) as { error: string };
    assert.equal(badBody.error, "invalid_payload");
  } finally {
    await server.close();
  }
});

test("GET/PUT /api/settings/model roundtrips without leaking the key", async () => {
  resetModelSettings();
  const handle: TrueForgeHandle = { client: null, status: readyStatus };
  const server = await withRouters(() => handle, () => readyStatus);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const before = await fetch(`${base}/api/settings/model`);
    assert.deepEqual((await before.json()) as Record<string, unknown>, { apiKeyConfigured: false });

    const put = await fetch(`${base}/api/settings/model`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-ant-test" }),
    });
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as Record<string, unknown>;
    assert.equal(putBody.apiKeyConfigured, true);
    assert.ok(!("apiKey" in putBody), "status must never echo the key back");

    const after = await fetch(`${base}/api/settings/model`);
    assert.deepEqual((await after.json()) as Record<string, unknown>, { apiKeyConfigured: true });

    const bad = await fetch(`${base}/api/settings/model`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "" }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await server.close();
    resetModelSettings();
  }
});

test("GET /api/sandbox/:id/status → 503 when TrueForge is unconfigured", async () => {
  const handle: TrueForgeHandle = { client: null, status: unconfiguredStatus };
  const server = await withRouters(() => handle, () => unconfiguredStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/sandbox/sbx-1/status`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { metricsAvailable: boolean; error: string };
    assert.equal(body.metricsAvailable, false);
    assert.equal(body.error, "trueforge_unconfigured");
  } finally {
    await server.close();
  }
});

test("GET /api/sandbox/:id/status → 503 fallback when the proxy fetch fails", async () => {
  // A client without the fetch passthrough (or a dead TrueForge server): the
  // proxy must degrade to metricsAvailable:false, never fabricate numbers.
  const client = {} as TrueForgeHandle["client"];
  const handle: TrueForgeHandle = { client, status: readyStatus };
  const server = await withRouters(() => handle, () => readyStatus);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/sandbox/sbx-1/status`);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { metricsAvailable: boolean };
    assert.equal(body.metricsAvailable, false);
  } finally {
    await server.close();
  }
});
