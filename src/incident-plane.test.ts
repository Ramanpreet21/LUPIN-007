import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLogger } from "./logger";
import { startServer } from "./server";
import type { TrueForgeHandle } from "./trueforge";
import { computeSafetyBadges, createIncidentRouter } from "./incident-plane";
import { createIncident, getIncident, listIncidents, patchIncident, setIncidentStatus } from "./incidents";
import { initDb, getDb } from "./db";
import type { TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type TurnStreamingEvent = TrueForgeApi.TurnStreamingEvent;

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "incident-plane-test.sqlite");
mkdirSync(TEST_DB_DIR, { recursive: true });
initDb(TEST_DB_PATH);

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
  const createRequests: unknown[] = [];
  const client = {
    sessions: {
      create: async (request: unknown): Promise<{ data: { id: string } }> => {
        createRequests.push(request);
        return { data: { id: "sess-1" } };
      },
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
  return { handle, cancelled, resumed, createCalls, createRequests };
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

test("GET /incidents returns an empty list on an empty store", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/incidents`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: unknown };
    assert.deepEqual(body, { data: [] });
  } finally {
    await server.close();
  }
});

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

test("POST /alerts returns 400 invalid_json on a syntactically broken body", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    // Unclosed brace: body-parser throws SyntaxError (entity.parse.failed); the
    // mounted incident route must surface a client 400, not a 500 internal error.
    const res = await postJson(
      `http://127.0.0.1:${server.port}/alerts`,
      '{"service_name": "postgres"',
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, "invalid_json");
  } finally {
    await server.close();
  }
});

test("POST /alerts acknowledges a fully-resolved AlertManager group without creating incidents", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    const res = await postJson(
      `http://127.0.0.1:${server.port}/alerts`,
      JSON.stringify({
        status: "resolved",
        alerts: [
          {
            status: "resolved",
            labels: { alertname: "HighCPU", instance: "prod-db-01:9100", severity: "critical" },
            annotations: { summary: "prod-db-01 CPU back under 80%" },
          },
        ],
      }),
    );
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      status: string;
      resolved: number;
      incident_ids?: string[];
    };
    // A resolved notification must not spawn diagnosis: acknowledge, create nothing.
    assert.equal(body.status, "acknowledged");
    assert.equal(body.resolved, 1);
    assert.equal(body.incident_ids, undefined);
  } finally {
    await server.close();
  }
});

test("POST /alerts accepts firing entries and reports resolved ones in mixed batches", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    const res = await postJson(
      `http://127.0.0.1:${server.port}/alerts`,
      JSON.stringify({
        alerts: [
          { labels: { alertname: "HighCPU", instance: "prod-db-01:9100", severity: "critical" } },
          {
            status: "resolved",
            labels: { alertname: "HighCPU", instance: "prod-db-01:9100", severity: "critical" },
          },
        ],
      }),
    );
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      status: string;
      incident_ids: string[];
      resolved: number;
    };
    assert.equal(body.status, "accepted");
    assert.equal(body.incident_ids.length, 1);
    assert.equal(body.resolved, 1);
  } finally {
    await server.close();
  }
});

test("POST /alerts acknowledges resolved PagerDuty v3 webhooks without creating incidents", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    const res = await postJson(
      `http://127.0.0.1:${server.port}/alerts`,
      JSON.stringify({
        account: "PagerDuty Account",
        event: {
          id: "b1e63870-5f46-11e8-8f45-9d78e8227d0f",
          event_type: "incident.resolved",
          resource_type: "incident",
          occurred_at: "2023-05-12T11:30:00.000-04:00",
          data: {
            id: "P13DTTX",
            title: "The server is on fire",
            severity: "critical",
            status: "resolved",
            service: {
              id: "PXP42J4",
              type: "service_reference",
              summary: "Production Database",
            },
            custom_details: { host: "db-primary-01" },
          },
        },
      }),
    );
    assert.equal(res.status, 202);
    const body = (await res.json()) as {
      status: string;
      resolved: number;
      incident_ids?: string[];
    };
    // A resolved webhook must not spawn diagnosis: acknowledge, create nothing.
    assert.equal(body.status, "acknowledged");
    assert.equal(body.resolved, 1);
    assert.equal(body.incident_ids, undefined);
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

/** Gate stream where the single tool call is a compound shell command. */
function compoundGateStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "e0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({ type: "model.message", id: "e1", createdAt: t0, threadId: "thread-1", content: "Diagnosing...", reasoningContent: "" }),
    ev({
      type: "model.message",
      id: "e2",
      createdAt: t0,
      threadId: "thread-1",
      toolCalls: [
        { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"systemctl status db; rm -rf /tmp/*"}' } },
      ],
    }),
    ev({ type: "tool.approval_required", id: "e3", createdAt: t0, threadId: "thread-1", toolCalls: [{ id: "call-1", sourceEventId: "e2" }] }),
  ];
}

test("destructive badge fails on a compound command, not just a leading rm", async () => {
  const fake = makeFakeHandle(compoundGateStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    const pending = await ws.waitFor("pending_approval");
    const badges = pending.payload.safety_badges as Array<{ name: string; status: string }>;
    assert.equal(badges.find((b) => b.name === "destructive")?.status, "fail");
  } finally {
    ws.close();
    await server.close();
  }
});

/** Gate stream whose risky text appears only inside a quoted argument. */
function quotedGateStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "e0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({ type: "model.message", id: "e1", createdAt: t0, threadId: "thread-1", content: "Diagnosing...", reasoningContent: "" }),
    ev({
      type: "model.message",
      id: "e2",
      createdAt: t0,
      threadId: "thread-1",
      toolCalls: [
        { id: "call-1", type: "function", function: { name: "bash", arguments: '{"command":"printf \'note; rm -rf /tmp/*\'"}' } },
      ],
    }),
    ev({ type: "tool.approval_required", id: "e3", createdAt: t0, threadId: "thread-1", toolCalls: [{ id: "call-1", sourceEventId: "e2" }] }),
  ];
}

test("destructive badge stays pass when the risky text is only a quoted argument", async () => {
  const fake = makeFakeHandle(quotedGateStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    const pending = await ws.waitFor("pending_approval");
    const badges = pending.payload.safety_badges as Array<{ name: string; status: string }>;
    assert.equal(badges.find((b) => b.name === "destructive")?.status, "pass");
  } finally {
    ws.close();
    await server.close();
  }
});

test("safety badges resolve env-assignment and wrapper prefixes to the real command", () => {
  // Start-anchored regexes must see the effective executable, not the prefix:
  // FOO=bar rm …, sudo env sh -c …, etc. must all fail the destructive rule.
  const cases: Array<{ command: string; expect: Array<[string, "pass" | "fail"]> }> = [
    { command: "FOO=bar rm -rf /tmp/*", expect: [["destructive", "fail"]] },
    { command: "rm -rf /tmp/*", expect: [["destructive", "fail"]] },
    { command: "sudo rm -rf /tmp/*", expect: [["destructive", "fail"], ["privilege-escalation", "fail"]] },
    { command: "sudo bash -c 'rm -rf /tmp/*'", expect: [["destructive", "fail"]] },
    { command: "env sh -c 'rm -rf /tmp/*'", expect: [["destructive", "fail"]] },
    { command: "sudo -u root rm -rf /tmp/*", expect: [["destructive", "fail"]] },
    { command: "AB=1 sudo -u root env X=2 bash -c 'rm -rf /tmp/*'", expect: [["destructive", "fail"]] },
    { command: "sudo chmod +777 /data/app", expect: [["privilege-escalation", "fail"]] },
    { command: "export PATH=/usr/bin rm -rf /tmp/*", expect: [["destructive", "fail"]] },
  ];
  for (const { command, expect } of cases) {
    const badges = computeSafetyBadges(command);
    for (const [name, status] of expect) {
      assert.equal(badges.find((b) => b.name === name)?.status, status, `${command} → ${name}`);
    }
  }
});

test("safety badges do not flag rm that is only an argument, not the executable", () => {
  // The conservative peel must not turn quoted/argument text into a false fail.
  const cases = [
    "printf 'note; rm -rf /tmp/*'",
    "FOO=bar echo rm -rf /tmp/*",
  ];
  for (const command of cases) {
    assert.equal(
      computeSafetyBadges(command).find((b) => b.name === "destructive")?.status,
      "pass",
      command,
    );
  }
});

test("approved stream that ends without turn.done cancels the session", async () => {
  const t0 = new Date().toISOString();
  const fake = makeFakeHandle(diagnosisGateStream(), [
    ev({ type: "turn.created", id: "r0", createdAt: t0, turnId: "turn-2", threadId: "thread-1", previousTurnId: "turn-1", state: "running" }),
    ev({ type: "model.message", id: "r1", createdAt: t0, threadId: "thread-1", content: "still working" }),
  ]);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    const { incident_id } = (await res.json()) as { incident_id: string };
    await ws.waitFor("pending_approval");
    await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "approved" }),
    );
    const done = await ws.waitFor("execution_complete");
    assert.equal(done.payload.status, "failed");
    assert.deepEqual(fake.cancelled, ["sess-1"]);
  } finally {
    ws.close();
    await server.close();
  }
});

test("diagnosis stream that ends abruptly cancels the orphaned session", async () => {
  const t0 = new Date().toISOString();
  const fake = makeFakeHandle(
    [
      ev({ type: "turn.created", id: "d0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
      ev({ type: "model.message", id: "d1", createdAt: t0, threadId: "thread-1", content: "partial reasoning", reasoningContent: "" }),
    ],
    [],
  );
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    const done = await ws.waitFor("execution_complete");
    assert.equal(done.payload.status, "failed");
    assert.deepEqual(fake.cancelled, ["sess-1"]);
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
        { id: "call-b", type: "function", function: { name: "bash", arguments: '{"command":"rm -rf /tmp/*"}' } },
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
    // The operator panel discloses EVERY gated command, not just the first.
    const proposed = pending.payload.proposed_command as string;
    assert.ok(proposed.includes("db2cli status"));
    assert.ok(proposed.includes("rm -rf /tmp/*"));
    assert.deepEqual(pending.payload.proposed_commands, ["db2cli status", "rm -rf /tmp/*"]);
    // Safety badges cover the whole gate: the hidden `rm -rf` flags destructive.
    const badges = pending.payload.safety_badges as Array<{ name: string; status: string }>;
    assert.equal(badges.find((b) => b.name === "destructive")?.status, "fail");
    // No sandbox state diff yet (blueprint PR #4) — `diff` lists every gated command with a `+`.
    const diff = pending.payload.diff as string;
    assert.ok(diff.includes("+ db2cli status"));
    assert.ok(diff.includes("+ rm -rf /tmp/*"));

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

function sandboxStream(): TurnStreamingEvent[] {
  const t0 = new Date().toISOString();
  return [
    ev({ type: "turn.created", id: "s0", createdAt: t0, turnId: "turn-1", threadId: "thread-1", previousTurnId: null, state: "running" }),
    ev({ type: "sandbox.created", id: "s1", createdAt: t0, threadId: "thread-1", sandboxId: "sbx-123" }),
    ev({ type: "turn.done", id: "s2", createdAt: t0, threadId: "thread-1", state: { status: "done" } }),
  ];
}

test("sandbox.created in the diagnosis stream broadcasts sandbox_started", async () => {
  const fake = makeFakeHandle(sandboxStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };
    const started = await ws.waitFor("sandbox_started");
    assert.equal(started.incident_id, incident_id);
    assert.equal(started.payload.sandbox_id, "sbx-123");
    assert.equal(started.payload.thread_id, "thread-1");
    assert.equal(typeof started.payload.created_at, "string");
  } finally {
    ws.close();
    await server.close();
  }
});

test("session creation enables the sandbox with the configured model FQN", async () => {
  const fake = makeFakeHandle(completedStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    await ws.waitFor("execution_complete");
    assert.equal(fake.createRequests.length, 1);
    const request = fake.createRequests[0] as {
      agent: {
        spec: {
          model: { name: string };
          instructions: string;
          config: { sandbox: { enabled: boolean } };
        };
      };
    };
    // No name-ref shortcut: sandbox mode + the responder prompt live on the spec body.
    assert.equal(request.agent.spec.config.sandbox.enabled, true);
    // Router-constructed default here; index.ts injects the TRUEFORGE_MODEL value.
    assert.equal(request.agent.spec.model.name, "anthropic/claude-sonnet-5");
    // The responder prompt rides as system instructions, not a user message (qodo #6).
    assert.ok(request.agent.spec.instructions.includes("expert Site Reliability Engineer"));
  } finally {
    ws.close();
    await server.close();
  }
});

test("GET /incidents lists the store newest-first with status/limit filtering", async () => {
  const a = createIncident({ service_name: "svc-a", target_host: "h1", severity: "warning" });
  const b = createIncident({ service_name: "svc-b", target_host: "h2", severity: "critical" });
  const c = createIncident({ service_name: "svc-c", target_host: "h3", severity: "warning" });
  assert.ok(a && b && c);
  setIncidentStatus(a!.id, "completed");
  setIncidentStatus(b!.id, "awaiting_approval");
  setIncidentStatus(c!.id, "failed");
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    // `resolved` maps to the terminal set (completed | failed | rejected).
    const resolved = await fetch(
      `http://127.0.0.1:${server.port}/incidents?status=resolved&limit=50`,
    );
    assert.equal(resolved.status, 200);
    const resolvedBody = (await resolved.json()) as {
      data: Array<{ id: string; status: string; createdAt: string }>;
    };
    const resolvedIds = resolvedBody.data.map((i) => i.id);
    assert.ok(resolvedIds.includes(a!.id));
    assert.ok(resolvedIds.includes(c!.id));
    assert.ok(!resolvedIds.includes(b!.id), "awaiting_approval is not terminal");
    for (const incident of resolvedBody.data) {
      assert.ok(["completed", "failed", "rejected"].includes(incident.status));
    }
    // Newest first by createdAt; same-millisecond rows keep insertion order.
    for (let i = 1; i < resolvedBody.data.length; i++) {
      assert.ok(
        Date.parse(resolvedBody.data[i - 1].createdAt) >= Date.parse(resolvedBody.data[i].createdAt),
        "resolved rows are ordered newest first",
      );
    }

    const awaiting = await fetch(
      `http://127.0.0.1:${server.port}/incidents?status=awaiting_approval`,
    );
    assert.equal(awaiting.status, 200);
    const awaitingBody = (await awaiting.json()) as {
      data: Array<{ id: string; status: string }>;
    };
    // Shared store: earlier tests may have left other awaiting_approval incidents,
    // so assert membership + purity rather than an exact row list.
    const awaitingIds = awaitingBody.data.map((i) => i.id);
    assert.ok(awaitingIds.includes(b!.id), "awaiting filter includes b");
    for (const incident of awaitingBody.data) {
      assert.ok(incident.status === "awaiting_approval");
    }

    const limited = await fetch(
      `http://127.0.0.1:${server.port}/incidents?status=resolved&limit=1`,
    );
    assert.equal(limited.status, 200);
    const limitedBody = (await limited.json()) as { data: unknown[] };
    assert.equal(limitedBody.data.length, 1);

    // A malformed limit falls back to the default 50-row cap (qodo #3).
    const malformed = await fetch(
      `http://127.0.0.1:${server.port}/incidents?status=resolved&limit=abc`,
    );
    assert.equal(malformed.status, 200);
    const malformedBody = (await malformed.json()) as { data: unknown[] };
    assert.ok(malformedBody.data.length <= 50, "malformed limit stays capped at 50");
  } finally {
    await server.close();
  }
});

test("POST /api/emergency-stop cancels active sessions and fails diagnosing/awaiting incidents", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const inc1 = createIncident({ service_name: "svc-stop-1", target_host: "h1", severity: "warning" });
    const inc2 = createIncident({ service_name: "svc-stop-2", target_host: "h2", severity: "critical" });
    assert.ok(inc1 && inc2);
    // inc1 is diagnosing with a session
    patchIncident(inc1.id, { sessionId: "sess-stop-1" });
    // inc2 is awaiting_approval with a session
    patchIncident(inc2.id, { sessionId: "sess-stop-2" });
    setIncidentStatus(inc2.id, "awaiting_approval");

    const res = await postJson(`http://127.0.0.1:${server.port}/api/emergency-stop`, "{}");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; cancelled: number };
    assert.equal(body.status, "ok");
    assert.ok(body.cancelled >= 2);

    // Verify both sessions were cancelled via the TrueForge client
    assert.ok(fake.cancelled.includes("sess-stop-1"));
    assert.ok(fake.cancelled.includes("sess-stop-2"));

    // Verify incident statuses are marked failed in the store
    assert.equal(getIncident(inc1.id)?.status, "failed");
    assert.equal(getIncident(inc2.id)?.status, "failed");

    // Verify execution_complete broadcasts occurred
    const event1 = await ws.waitFor("execution_complete");
    assert.equal(event1.payload.status, "failed");
  } finally {
    ws.close();
    await server.close();
  }
});

test("POST /api/emergency-stop returns cancelled 0 when no incidents are active", async () => {
  const fake = makeFakeHandle([], []);
  const server = await withServer(fake.handle);
  try {
    // Note: ensure no active incidents remain from previous tests by setting any active ones to completed
    const active = listIncidents({ status: "diagnosing" }).concat(listIncidents({ status: "awaiting_approval" }));
    for (const inc of active) {
      setIncidentStatus(inc.id, "completed");
    }

    const res = await postJson(`http://127.0.0.1:${server.port}/api/emergency-stop`, "{}");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; cancelled: number };
    assert.deepEqual(body, { status: "ok", cancelled: 0 });
    assert.equal(fake.cancelled.length, 0);
  } finally {
    await server.close();
  }
});

test("POST /api/emergency-stop handles session cancellation errors gracefully (best-effort)", async () => {
  const fake = makeFakeHandle([], []);
  // Make client.sessions.cancel throw
  fake.handle.client!.sessions.cancel = (async () => {
    throw new Error("cancellation network timeout");
  }) as any;
  const server = await withServer(fake.handle);
  try {
    const inc = createIncident({ service_name: "svc-err-1", target_host: "h1", severity: "warning" });
    assert.ok(inc);
    patchIncident(inc.id, { sessionId: "sess-throw-1" });

    const res = await postJson(`http://127.0.0.1:${server.port}/api/emergency-stop`, "{}");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; cancelled: number };
    assert.equal(body.status, "ok");
    assert.ok(body.cancelled >= 1);
    assert.equal(getIncident(inc.id)?.status, "failed");
  } finally {
    await server.close();
  }
});

test("enforcement mode AUTONOMOUS: auto-approves immediately on tool.approval_required", async () => {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'AUTONOMOUS')").run();
  const fake = makeFakeHandle(diagnosisGateStream(), doneStream("done"));
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };

    const thinking = await ws.waitFor("agent_thinking");
    assert.equal(thinking.incident_id, incident_id);

    // In AUTONOMOUS mode, no manual approval is needed; turn resumes automatically to completion
    const done = await ws.waitFor("execution_complete");
    assert.equal(done.incident_id, incident_id);
    assert.equal(done.payload.status, "success");

    // Verify tool approval was auto-allowed
    assert.equal(fake.resumed.length, 1);
    const resumeInput = fake.resumed[0].request.input;
    assert.ok(resumeInput && Array.isArray(resumeInput) && resumeInput.length === 1);
    const approvalItem = resumeInput[0] as { type?: string; approval?: { status?: string } };
    assert.equal(approvalItem.type, "user.tool_approval");
    assert.equal(approvalItem.approval?.status, "allow");

    const incident = getIncident(incident_id);
    assert.equal(incident?.status, "completed");
  } finally {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'STRICT_GATED')").run();
    ws.close();
    await server.close();
  }
});

test("enforcement mode DRY_RUN: auto-denies immediately on tool.approval_required and cancels session", async () => {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'DRY_RUN')").run();
  const fake = makeFakeHandle(diagnosisGateStream(), []);
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };

    const thinking = await ws.waitFor("agent_thinking");
    assert.equal(thinking.incident_id, incident_id);

    // In DRY_RUN mode, auto-denies and emits execution_complete rejected
    const done = await ws.waitFor("execution_complete");
    assert.equal(done.incident_id, incident_id);
    assert.equal(done.payload.status, "rejected");

    // Verify tool approval was auto-denied
    assert.equal(fake.resumed.length, 1);
    const resumeInput = fake.resumed[0].request.input;
    assert.ok(resumeInput && Array.isArray(resumeInput) && resumeInput.length === 1);
    const approvalItem = resumeInput[0] as { type?: string; approval?: { status?: string; reason?: string } };
    assert.equal(approvalItem.type, "user.tool_approval");
    assert.equal(approvalItem.approval?.status, "deny");

    // Session is cancelled
    assert.ok(fake.cancelled.length >= 1);

    const incident = getIncident(incident_id);
    assert.equal(incident?.status, "rejected");
  } finally {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'STRICT_GATED')").run();
    ws.close();
    await server.close();
  }
});

test("enforcement mode STRICT_GATED: broadcasts pending_approval and halts until operator acts", async () => {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'STRICT_GATED')").run();
  const fake = makeFakeHandle(diagnosisGateStream(), doneStream("done"));
  const server = await withServer(fake.handle);
  const ws = await connectWs(server.port);
  try {
    const res = await postJson(`http://127.0.0.1:${server.port}/alerts`, alertBody);
    assert.equal(res.status, 202);
    const { incident_id } = (await res.json()) as { incident_id: string };

    const pending = await ws.waitFor("pending_approval");
    assert.equal(pending.incident_id, incident_id);
    assert.equal(fake.resumed.length, 0);

    const incBefore = getIncident(incident_id);
    assert.equal(incBefore?.status, "awaiting_approval");

    const approve = await postJson(
      `http://127.0.0.1:${server.port}/api/approvals`,
      JSON.stringify({ incident_id, decision: "approved" }),
    );
    assert.equal(approve.status, 200);

    const done = await ws.waitFor("execution_complete");
    assert.equal(done.incident_id, incident_id);
    assert.equal(done.payload.status, "success");
    assert.equal(fake.resumed.length, 1);
  } finally {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('enforcement_mode', 'STRICT_GATED')").run();
    ws.close();
    await server.close();
  }
});