import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb } from "./db";
import { createSettingsRouter } from "./routes/settings";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "settings-test.sqlite");

describe("settings routes", () => {
  let server: Server;
  let baseUrl: string;
  const broadcastEvents: unknown[] = [];

  before(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    initDb(TEST_DB_PATH);
    const app = express();
    app.use(express.json());
    app.use(createSettingsRouter({ broadcast: (msg) => broadcastEvents.push(msg) }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it("GET /api/settings returns seeded defaults", async () => {
    const res = await fetch(`${baseUrl}/api/settings`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, string>;
    assert.equal(body.enforcement_mode, "STRICT_GATED");
    assert.ok(body.skills);
  });

  it("PUT /api/settings upserts values", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator_name: "ops-lead", model: "google/gemini-2.5-pro", enforcement_mode: "AUTONOMOUS" }),
    });
    assert.equal(res.status, 200);

    const getRes = await fetch(`${baseUrl}/api/settings`);
    const body = (await getRes.json()) as Record<string, string>;
    assert.equal(body.operator_name, "ops-lead");
    assert.equal(body.model, "google/gemini-2.5-pro");
    assert.equal(body.enforcement_mode, "AUTONOMOUS");
    assert.deepEqual(broadcastEvents, [
      { type: "agent_mode_changed", payload: { mode: "AUTONOMOUS" } },
    ]);
  });

  it("PUT /api/settings ignores disallowed keys", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unknown_key: "should_ignore", operator_name: "new-op" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; updated: string[] };
    assert.equal(body.status, "ok");
    assert.deepEqual(body.updated, ["operator_name"]);
  });
});
