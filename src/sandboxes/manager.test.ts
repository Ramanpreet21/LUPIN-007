import test from "node:test";
import assert from "node:assert/strict";
import { SandboxManager } from "./manager";

test("SandboxManager registers all 5 runner types and probes them", async () => {
  const manager = new SandboxManager();
  const { activeProvider, probes } = await manager.probeAll();
  assert.ok(activeProvider);
  assert.equal(probes.length, 5);

  const types = probes.map((p) => p.type);
  assert.ok(types.includes("isolated-local"));
  assert.ok(types.includes("podman"));
  assert.ok(types.includes("docker"));
  assert.ok(types.includes("daytona"));
  assert.ok(types.includes("daytona-custom"));
});

test("SandboxManager executes in active sandbox runner", async () => {
  const manager = new SandboxManager();
  const res = await manager.execInActive("echo 'manager test'");
  assert.equal(res.exitCode, 0);
  assert.ok(res.stdout.includes("manager test") || res.stdout.includes("Executed"));
});
