import { test } from "node:test";
import assert from "node:assert/strict";
import { captureTargetState, formatCapturedState } from "./capture";

test("captureTargetState generates fallback synthetic state when no executor provided", async () => {
  const state = await captureTargetState("relay-04.lan", "lupin-relay");
  assert.equal(state.targetHost, "relay-04.lan");
  assert.equal(state.serviceName, "lupin-relay");
  assert.ok(state.processTree.includes("lupin-relay"));
  assert.ok(state.networkConnections.includes("LISTEN"));
  assert.ok(state.serviceStatus.includes("lupin-relay.service"));
  assert.equal(state.captureStatus, "success");

  const formatted = formatCapturedState(state);
  assert.ok(formatted.includes("## CAPTURED SYSTEM STATE"));
  assert.ok(formatted.includes("synthetic baseline"));
  assert.ok(formatted.includes("Process tree:"));
  assert.ok(formatted.includes("Network connections:"));
  assert.ok(formatted.includes("Service status:"));
});

test("captureTargetState runs custom executor and captures outputs", async () => {
  const executed: string[] = [];
  const executor = async (cmd: string, host: string) => {
    executed.push(`${host}:${cmd}`);
    if (cmd.includes("ps")) return "root 1 0 systemd\nroot 214 1 nginx";
    if (cmd.includes("ss")) return "tcp LISTEN 0 128 0.0.0.0:80";
    if (cmd.includes("systemctl")) return "● nginx.service - Active running";
    return "";
  };

  const state = await captureTargetState("prod-node-1", "nginx", { executor });
  assert.equal(state.targetHost, "prod-node-1");
  assert.equal(state.processTree, "root 1 0 systemd\nroot 214 1 nginx");
  assert.equal(state.networkConnections, "tcp LISTEN 0 128 0.0.0.0:80");
  assert.equal(state.serviceStatus, "● nginx.service - Active running");
  assert.equal(executed.length, 3);
  assert.equal(state.captureStatus, "success");

  const formatted = formatCapturedState(state);
  assert.ok(formatted.includes("live snapshot from prod-node-1"));
});

test("captureTargetState gracefully handles timeouts and errors without throwing", async () => {
  const executor = async () => {
    throw new Error("SSH Connection refused");
  };

  const state = await captureTargetState("broken-node", "postgres", { executor });
  assert.equal(state.targetHost, "broken-node");
  assert.ok(state.processTree.includes("SSH Connection refused"));
  assert.ok(state.networkConnections.includes("SSH Connection refused"));
  assert.equal(state.captureStatus, "failed");

  const formatted = formatCapturedState(state);
  assert.ok(formatted.includes("FAILED capture from broken-node"));
  assert.ok(!formatted.includes("live snapshot"));
});

test("captureTargetState handles partial failure correctly", async () => {
  const executor = async (cmd: string) => {
    if (cmd.includes("ps")) return "root 1 0 systemd";
    throw new Error("Probe failed");
  };

  const state = await captureTargetState("partial-node", "app", { executor });
  assert.equal(state.captureStatus, "partial_failure");
  assert.equal(state.probes?.processes.success, true);
  assert.equal(state.probes?.network.success, false);

  const formatted = formatCapturedState(state);
  assert.ok(formatted.includes("PARTIAL capture from partial-node"));
  assert.ok(!formatted.includes("live snapshot"));
});

test("captureTargetState aborts timed-out probes with AbortSignal", async () => {
  let wasAborted = false;
  const executor = async (_cmd: string, _host: string, signal?: AbortSignal) => {
    if (signal) {
      signal.addEventListener("abort", () => {
        wasAborted = true;
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return "too late";
  };

  const state = await captureTargetState("timeout-node", undefined, { executor, timeoutMs: 50 });
  assert.equal(state.captureStatus, "failed");
  assert.ok(wasAborted, "AbortSignal should have fired when timeout exceeded");
});
