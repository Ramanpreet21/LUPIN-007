import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLogger } from "./logger";
import { startServer } from "./server";
import type { TrueForgeStatus } from "./trueforge";

import { createIncident, setIncidentStatus } from "./incidents";

const logger = createLogger("silent");
const readyStatus: TrueForgeStatus = { state: "ready", baseUrlConfigured: true, authConfigured: false };
const unconfiguredStatus: TrueForgeStatus = { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] };

async function withServer(getStatus: () => TrueForgeStatus, port = 0) {
  return startServer({ host: "127.0.0.1", port, logger, getStatus });
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
