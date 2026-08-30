import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb, getDb } from "./db";
import { createModelsRouter } from "./routes/models";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "models-test.sqlite");

describe("models routes", () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    initDb(TEST_DB_PATH);

    const app = express();
    app.use(express.json());
    app.use(createModelsRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it("GET /api/models returns known models list and active model", async () => {
    const res = await fetch(`${baseUrl}/api/models`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: Array<{ id: string; name: string; provider: string }>;
      active: string;
    };
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 5);
    assert.equal(body.active, "google-gemini/gemini-3-6-flash");
    assert.deepEqual(
      body.data.map((m) => m.id),
      [
        "google-gemini/gemini-3-6-flash",
        "google-gemini/gemini-3-1-pro-preview",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-sonnet-4",
        "local",
      ]
    );
  });

  it("GET /api/models reflects updated active model in settings", async () => {
    const db = getDb();
    db.prepare("UPDATE settings SET value = ? WHERE key = 'model'").run("google-gemini/gemini-3-1-pro-preview");

    const res = await fetch(`${baseUrl}/api/models`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: Array<{ id: string; name: string; provider: string }>;
      active: string;
    };
    assert.equal(body.active, "google-gemini/gemini-3-1-pro-preview");
  });

  it("GET /api/models falls back to default if setting is missing", async () => {
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'model'").run();

    const res = await fetch(`${baseUrl}/api/models`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: Array<{ id: string; name: string; provider: string }>;
      active: string;
    };
    assert.equal(body.active, "google-gemini/gemini-3-6-flash");
  });
});
