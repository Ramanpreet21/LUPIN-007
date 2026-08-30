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

  const formatted = formatCapturedState(state);
  assert.ok(formatted.includes("## CAPTURED SYSTEM STATE"));
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
});

test("captureTargetState gracefully handles timeouts and errors without throwing", async () => {
  const executor = async () => {
    throw new Error("SSH Connection refused");
  };

  const state = await captureTargetState("broken-node", "postgres", { executor });
  assert.equal(state.targetHost, "broken-node");
  assert.ok(state.processTree.includes("SSH Connection refused"));
  assert.ok(state.networkConnections.includes("SSH Connection refused"));
});
