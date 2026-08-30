import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb } from "./db";
import { createFleetRouter } from "./routes/fleet";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
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

  it("POST /api/fleet/probe rejects missing host info", async () => {
    const res = await fetch(`${baseUrl}/api/fleet/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/fleet/probe returns 404 for unknown host_id", async () => {
    const res = await fetch(`${baseUrl}/api/fleet/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host_id: "unknown-id" }),
    });
    assert.equal(res.status, 404);
  });
});
