import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLogger } from "./logger";
import { startServer } from "./server";
import type { TrueForgeHandle } from "./trueforge";
import { createIncidentRouter } from "./incident-plane";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";

type TurnStreamingEvent = TrueForgeApi.TurnStreamingEvent;

const logger = createLogger("silent");

/* eslint-disable @typescript-eslint/no-explicit-any */

/** An AsyncIterable over fixed events — the honest stand-in for live SSE. */
async function* iter<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

/** Build a TurnStreamingEvent-typed object from a plain literal. */
const ev = (obj: Record<string, unknown>): TurnStreamingEvent =>
  obj as unknown as TurnStreamingEvent;

function makeFakeHandle(initial: TurnStreamingEvent[], resume: TurnStreamingEvent[]) {
  const cancelled: string[] = [];
  const resumed: { sessionId: string; request: { previousTurnId?: string; input?: unknown } }[] = [];
  const createCalls: { sessionId: string; request: unknown }[] = [];
  const client = {
    sessions: {
      create: async (): Promise<{ data: { id: string } }> => ({ data: { id: "sess-1" } }),
      createTurnStream: async (
        sessionId: string,
        request: { previousTurnId?: string; input?: unknown },
      ): Promise<AsyncIterable<TurnStreamingEvent>> => {
        // Initial turns pass the SDK's `previousTurnId: "none"` sentinel; resume
        // turns pass the prior turnId. Mirror that contract so "none" isn't
        // mistaken for a resume.
        if (request.previousTurnId && request.previousTurnId !== "none") {
          resumed.push({ sessionId, request });
          return iter(resume);
        }
        createCalls.push({ sessionId, request });
        return iter(initial);
      },
      cancel: async (sessionId: string): Promise<void> => {
        cancelled.push(sessionId);
      },
    },
  };
  const handle = {
    status: { state: "ready", baseUrlConfigured: true, authConfigured: false },
    client,
  } as unknown as TrueForgeHandle;
  return { handle, cancelled, resumed, createCalls };
}

function diagnosisGateStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "e0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({ type: "model.message", id: "e1", createdAt: t0, threadId: "thread-1", content: "Diagnosing postgres CPU usage...", reasoningContent: "checking pg_stat_activity" }),
    ev({
      type: "model.message",
      id: "e2",
      createdAt: t0,
      threadId: "thread-1",
      toolCalls: [
        { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"rm -rf /var/log/postgresql/*"}' } },
      ],
    }),
    ev({ type: "tool.approval_required", id: "e3", createdAt: t0, threadId: "thread-1", toolCalls: [{ id: "call-1", sourceEventId: "e2" }] }),
  ];
}

function doneStream(state: "done" | "error"): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "g0", createdAt: t0, turnId: "turn-2", threadId: "thread-1", previousTurnId: "turn-1", state: "running" }),
    ev({ type: "model.message", id: "g1", createdAt: t0, threadId: "thread-1", content: "Remediation applied." }),
    ev({ type: "turn.done", id: "g2", createdAt: t0, threadId: "thread-1", state: { status: state } }),
  ];
}

function completedStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "c0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({ type: "turn.done", id: "c1", createdAt: t0, threadId: "thread-1", state: { status: "done" } }),
  ];
}

async function withServer(fakeHandle: TrueForgeHandle) {
  return startServer({
    host: "127.0.0.1",
    port: 0,
    logger,
    getStatus: () => fakeHandle.status,
    registerRoutes: (app, { broadcast }) => {
      app.use(createIncidentRouter({ getTf: () => fakeHandle, logger, broadcast }));
    },
  });
}

interface WsClient {
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, any>>;
  close: () => void;
}

async function connectWs(port: number): Promise<WsClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const byType = new Map<string, Record<string, any>[]>();
  let pending: { type: string; resolve: (m: Record<string, any>) => void; timer: NodeJS.Timeout } | null = null;
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as Record<string, any>;
    if (pending && pending.type === msg.type) {
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      p.resolve(msg);
      return;
    }
    const list = byType.get(msg.type);
    if (list) list.push(msg);
    else byType.set(msg.type, [msg]);
  });
  return {
    waitFor: (type, timeoutMs = 4000) => {
      const queued = byType.get(type);
      if (queued && queued.length > 0) return Promise.resolve(queued.shift() as Record<string, any>);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (pending?.type === type) pending = null;
          reject(new Error(`timeout waiting for ws event ${type}`));
        }, timeoutMs);
        pending = { type, resolve, timer };
      });
    },
    close: () => ws.close(),
  };
}

const alertBody = JSON.stringify({
  service_name: "postgres",
  target_host: "prod-db-01",
  alert_summary: "CPU > 80%",
  severity: "warning",
});

function postJson(url: string, body: string) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

test("POST /alerts returns 503 trueforge_unconfigured when TrueForge is not ready", async () => {
  const handle: TrueForgeHandle = {
    client: null,
    status: { state: "unconfigured", missing: ["TRUEFORGE_BASE_URL"] },
  };
  const server = await withServer(handle);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "trueforge_unconfigured");
  } finally {
    await server.close();
  }
});

test("POST /alerts returns 400 on a malformed alert", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    const res = await postJson(
      `http://127.0.0.1:${server.port}/alerts`,
      JSON.stringify({ service_name: "postgres" }),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string; details: string[] };
    assert.equal(body.error, "invalid_alert");
    assert.ok(body.details.length > 0);
  } finally {
    await server.close();
  }
});

test("alert → reasoning → approval gate → approve → execution_complete success", async () => {
  const fake = makeFakeHandle(diagnosisGateStream(), doneStream("done"));
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };

    const thinking = await ws.waitFor("agent_thinking");
    assert.equal(thinking.incident_id, incident_id);
    assert.equal(typeof thinking.payload.content, "string");
    assert.equal(thinking.payload.step, 1);

    const pending = await ws.waitFor("pending_approval");
    assert.equal(pending.incident_id, incident_id);
    assert.equal(typeof pending.payload.proposed_command, "string");
    assert.ok(pending.payload.safety_badges.length >= 1);
    for (const badge of pending.payload.safety_badges) {
      assert.ok(badge.status === "pass" || badge.status === "fail");
    }
    assert.ok(
      pending.payload.safety_badges.some((b: { status: string }) => b.status === "fail"),
    );

    const approve = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "approved" }),
    );
    assert.equal(approve.status, 200);

    // Honest assertion of the resume mechanism: the next turn stream carried a
    // user.tool_approval allow input. Verify the resume payload + terminal event.
    assert.equal(fake.resumed.length, 1);
    const resumeInput = fake.resumed[0].request.input;
    assert.ok(resumeInput && Array.isArray(resumeInput) && resumeInput.length === 1);
    const approvalItem = resumeInput[0] as { type?: string; approval?: { status?: string } };
    assert.equal(approvalItem.type, "user.tool_approval");
    assert.equal(approvalItem.approval?.status, "allow");

    const done = await ws.waitFor("execution_complete");
    assert.equal(done.incident_id, incident_id);
    assert.equal(done.payload.status, "success");
  } finally {
    ws.close();
    await server.close();
  }
});

test("POST /api/approvals rejected → deny resume + session cancelled + execution_complete rejected", async () => {
  const fake = makeFakeHandle(diagnosisGateStream(), doneStream("done"));
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };
    await ws.waitFor("pending_approval");

    const deny = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "rejected" }),
    );
    assert.equal(deny.status, 200);

    const done = await ws.waitFor("execution_complete");
    assert.equal(done.payload.status, "rejected");
    // Deny halts the run: the turn resumes with a deny, then the session is cancelled.
    assert.equal(fake.resumed.length, 1);
    const resumeInput = fake.resumed[0].request.input;
    assert.ok(resumeInput && Array.isArray(resumeInput) && resumeInput.length === 1);
    const approvalItem = resumeInput[0] as { approval?: { status?: string } };
    assert.equal(approvalItem.approval?.status, "deny");
    assert.deepEqual(fake.cancelled, ["sess-1"]);
  } finally {
    ws.close();
    await server.close();
  }
});

test("POST /api/approvals → 400 invalid / 404 unknown / 409 not awaiting", async () => {
  const fake = makeFakeHandle(completedStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const invalid = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id: "x", decision: "maybe" }),
    );
    assert.equal(invalid.status, 400);

    const notFound = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id: "missing", decision: "approved" }),
    );
    assert.equal(notFound.status, 404);

    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };
    // completedStream ends the diagnosis without a gate → never awaiting_approval.
    const done = await ws.waitFor("execution_complete");
    assert.equal(done.payload.status, "success");

    const conflict = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "approved" }),
    );
    assert.equal(conflict.status, 409);
  } finally {
    ws.close();
    await server.close();
  }
});

function multiCallGateStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "m0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({
      type: "model.message",
      id: "m1",
      createdAt: t0,
      threadId: "thread-1",
      toolCalls: [
        { id: "call-a", type: "function", function: { name: "bash", arguments: '{"command":"db2cli status"}' } },
        { id: "call-b", type: "function", function: { name: "bash", arguments: '{"command":"rm -f /tmp/x"}' } },
      ],
    }),
    ev({
      type: "tool.approval_required",
      id: "m2",
      createdAt: t0,
      threadId: "thread-1",
      toolCalls: [
        { id: "call-a", sourceEventId: "m1" },
        { id: "call-b", sourceEventId: "m1" },
      ],
    }),
  ];
}

test("multi-call approval gate resumes every gated tool call", async () => {
  const fake = makeFakeHandle(multiCallGateStream(), doneStream("done"));
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };

    const pending = await ws.waitFor("pending_approval");
    assert.equal(pending.incident_id, incident_id);
    // The operator panel shows the first gated command.
    assert.equal(pending.payload.proposed_command, "db2cli status");

    const approve = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "approved" }),
    );
    assert.equal(approve.status, 200);

    // Every gated call is resumed with its own user.tool_approval allow.
    assert.equal(fake.resumed.length, 1);
    const resumeInput = fake.resumed[0].request.input as Array<{
      toolCallId?: string;
      approval?: { status?: string };
    }>;
    assert.ok(Array.isArray(resumeInput));
    assert.equal(resumeInput.length, 2);
    assert.deepEqual(
      resumeInput.map((i) => i.toolCallId),
      ["call-a", "call-b"],
    );
    assert.equal(resumeInput[0].approval?.status, "allow");
    assert.equal(resumeInput[1].approval?.status, "allow");
  } finally {
    ws.close();
    await server.close();
  }
});