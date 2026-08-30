import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, type Server } from "node:http";
import { initDb, getDb } from "./db";
import { createSessionsRouter } from "./routes/sessions";
import { createIncidentRouter } from "./incident-plane";
import type { TrueForgeHandle } from "./trueforge";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "./logger";

type TurnStreamingEvent = TrueForgeApi.TurnStreamingEvent;

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "sessions-test.sqlite");
const logger = createLogger("silent");

async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

const ev = (obj: Record<string, unknown>): TurnStreamingEvent =>
  obj as unknown as TurnStreamingEvent;

describe("sessions routes", () => {
  let server: Server;
  let baseUrl: string;
  const broadcastEvents: unknown[] = [];

  before(async () => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
    initDb(TEST_DB_PATH);

    const app = express();
    app.use(express.json());
    app.use(createSessionsRouter());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(() => {
    server.close();
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM sessions").run();
  });

  it("GET /api/sessions returns empty array initially", async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: unknown[] };
    assert.deepEqual(body, { data: [] });
  });

  it("GET /api/sessions returns sessions ordered by created_at DESC with limit", async () => {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
       VALUES (@id, @thread_id, @incident_id, @summary, @created_at)`
    );
    insert.run({
      id: "sess-1",
      thread_id: "th-1",
      incident_id: "inc-1",
      summary: "Incident inc-1 diagnosis session",
      created_at: "2026-08-30T10:00:00.000Z",
    });
    insert.run({
      id: "sess-2",
      thread_id: "th-2",
      incident_id: "inc-2",
      summary: "Incident inc-2 diagnosis session",
      created_at: "2026-08-30T11:00:00.000Z",
    });

    const res = await fetch(`${baseUrl}/api/sessions`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      data: Array<{ id: string; thread_id: string; incident_id: string; summary: string; created_at: string }>;
    };
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].id, "sess-2");
    assert.equal(body.data[1].id, "sess-1");

    const limitedRes = await fetch(`${baseUrl}/api/sessions?limit=1`);
    assert.equal(limitedRes.status, 200);
    const limitedBody = (await limitedRes.json()) as { data: unknown[] };
    assert.equal(limitedBody.data.length, 1);
  });

  it("GET /api/sessions/:id returns session by id", async () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
       VALUES (@id, @thread_id, @incident_id, @summary, @created_at)`
    ).run({
      id: "sess-123",
      thread_id: "th-abc",
      incident_id: "inc-456",
      summary: "Incident inc-456 diagnosis session",
      created_at: "2026-08-30T12:00:00.000Z",
    });

    const res = await fetch(`${baseUrl}/api/sessions/sess-123`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      id: string;
      thread_id: string;
      incident_id: string;
      summary: string;
      created_at: string;
    };
    assert.equal(body.id, "sess-123");
    assert.equal(body.thread_id, "th-abc");
    assert.equal(body.incident_id, "inc-456");
    assert.equal(body.summary, "Incident inc-456 diagnosis session");
  });

  it("GET /api/sessions/:id returns 404 for unknown session id", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/non-existent`);
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "session_not_found");
  });

  it("incident diagnosis sandbox.created persists session row and broadcasts session_created", async () => {
    const t0 = new Date().toISOString();
    const sandboxStream: TurnStreamingEvent[] = [
      ev({ type: "turn.created", id: "s0", createdAt: t0, turnId: "turn-1", threadId: "thread-100", previousTurnId: null, state: "running" }),
      ev({ type: "sandbox.created", id: "s1", createdAt: t0, threadId: "thread-100", sandboxId: "sbx-999" }),
      ev({ type: "turn.done", id: "s2", createdAt: t0, threadId: "thread-100", state: { status: "done" } }),
    ];

    const fakeHandle: TrueForgeHandle = {
      status: { state: "ready", baseUrlConfigured: true, authConfigured: false },
      client: {
        sessions: {
          create: async () => ({ data: { id: "sess-tf-1" } }),
          createTurnStream: async () => iter(sandboxStream),
          cancel: async () => {},
        },
      } as any,
    };

    const incidentApp = express();
    incidentApp.use(express.json());
    const broadcasts: unknown[] = [];
    incidentApp.use(createIncidentRouter({
      getTf: () => fakeHandle,
      logger,
      broadcast: (msg) => broadcasts.push(msg),
    }));
    incidentApp.use(createSessionsRouter());

    const incidentServer = createServer(incidentApp);
    await new Promise<void>((resolve) => incidentServer.listen(0, "127.0.0.1", resolve));
    const incidentAddr = incidentServer.address() as { port: number };
    const incidentBaseUrl = `http://127.0.0.1:${incidentAddr.port}`;

    try {
      const alertRes = await fetch(`${incidentBaseUrl}/alerts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: "payment-api",
          target_host: "prod-pay-01",
          alert_summary: "High Latency",
          severity: "critical",
        }),
      });
      assert.equal(alertRes.status, 202);
      const alertBody = (await alertRes.json()) as { incident_id: string };

      // Allow async diagnosis turn stream to complete
      await new Promise((r) => setTimeout(r, 100));

      const sessionCreatedBroadcast = broadcasts.find(
        (b: any) => b.type === "session_created"
      ) as { type: string; payload: { session_id: string; thread_id: string; incident_id: string } } | undefined;
      assert.ok(sessionCreatedBroadcast, "session_created broadcast emitted");
      assert.equal(sessionCreatedBroadcast.payload.session_id, "sess-tf-1");
      assert.equal(sessionCreatedBroadcast.payload.thread_id, "thread-100");
      assert.equal(sessionCreatedBroadcast.payload.incident_id, alertBody.incident_id);

      const sessionRes = await fetch(`${incidentBaseUrl}/api/sessions/sess-tf-1`);
      assert.equal(sessionRes.status, 200);
      const sessionData = (await sessionRes.json()) as {
        id: string;
        thread_id: string;
        incident_id: string;
        summary: string;
        created_at: string;
      };
      assert.equal(sessionData.id, "sess-tf-1");
      assert.equal(sessionData.thread_id, "thread-100");
      assert.equal(sessionData.incident_id, alertBody.incident_id);
      assert.equal(sessionData.summary, `Incident ${alertBody.incident_id} diagnosis session`);
    } finally {
      incidentServer.close();
    }
  });

  it("POST /api/sessions creates a session and broadcasts session_created", async () => {
    const broadcasts: unknown[] = [];
    const fakeHandle: TrueForgeHandle = {
      status: { state: "ready", baseUrlConfigured: true, authConfigured: false },
      client: {
        sessions: {
          create: async () => ({ data: { id: "sess-created-1" } }),
          cancel: async () => {},
        },
      } as any,
    };

    const app = express();
    app.use(express.json());
    app.use(createSessionsRouter({
      getTf: () => fakeHandle,
      broadcast: (msg) => broadcasts.push(msg),
    }));

    const s = createServer(app);
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const addr = s.address() as { port: number };

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: "Manual test session" }),
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { id: string; summary: string };
      assert.equal(body.id, "sess-created-1");
      assert.equal(body.summary, "Manual test session");

      const sessionInDb = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get("sess-created-1") as { summary: string };
      assert.ok(sessionInDb);
      assert.equal(sessionInDb.summary, "Manual test session");

      const broadcast = broadcasts.find((b: any) => b.type === "session_created");
      assert.ok(broadcast);
    } finally {
      s.close();
    }
  });

  it("DELETE /api/sessions/:id cancels and removes session", async () => {
    let cancelledSessionId: string | null = null;
    const fakeHandle: TrueForgeHandle = {
      status: { state: "ready", baseUrlConfigured: true, authConfigured: false },
      client: {
        sessions: {
          cancel: async (id: string) => { cancelledSessionId = id; },
        },
      } as any,
    };

    getDb().prepare(
      `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
       VALUES ('sess-to-del', null, null, 'Delete test', '2026-08-30T12:00:00.000Z')`
    ).run();

    const app = express();
    app.use(express.json());
    app.use(createSessionsRouter({
      getTf: () => fakeHandle,
    }));

    const s = createServer(app);
    await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
    const addr = s.address() as { port: number };

    try {
      const res = await fetch(`http://127.0.0.1:${addr.port}/api/sessions/sess-to-del`, {
        method: "DELETE",
      });
      assert.equal(res.status, 200);
      assert.equal(cancelledSessionId, "sess-to-del");

      const sessionInDb = getDb().prepare("SELECT * FROM sessions WHERE id = ?").get("sess-to-del");
      assert.equal(sessionInDb, undefined);
    } finally {
      s.close();
    }
  });
});
