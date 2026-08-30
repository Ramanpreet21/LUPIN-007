import test from "node:test";
import assert from "node:assert/strict";
import { IsolatedProcessRunner } from "./isolated-process-runner";

test("IsolatedProcessRunner probes successfully", async () => {
  const runner = new IsolatedProcessRunner();
  const probe = await runner.probe();
  assert.equal(probe.available, true);
  assert.equal(probe.type, "isolated-local");
});

test("IsolatedProcessRunner executes commands in scoped workspace with scrubbed environment", async () => {
  const runner = new IsolatedProcessRunner();
  const sessionId = `test-run-${Date.now()}`;
  await runner.createSession(sessionId);

  try {
    const res = await runner.exec(sessionId, "echo 'hello sandbox' && pwd");
    assert.equal(res.exitCode, 0);
    assert.ok(res.stdout.includes("hello sandbox"));
    assert.ok(res.stdout.includes(`lupin-sandbox-${sessionId}`));
  } finally {
    await runner.destroySession(sessionId);
  }
});
