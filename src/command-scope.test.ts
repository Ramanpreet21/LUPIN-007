import { test } from "node:test";
import assert from "node:assert/strict";
import { commandScope } from "./command-scope";

test("systemctl restart nginx annotates the unit and its resources", () => {
  const scope = commandScope("sudo systemctl restart nginx");
  assert.equal(scope.executable, "systemctl");
  assert.ok(scope.services.includes("nginx"));
  assert.ok(scope.files.includes("/etc/nginx/"));
  assert.ok(scope.ports.includes("80"));
  assert.ok(scope.ports.includes("443"));
  assert.equal(scope.risk, "low");
  assert.equal(scope.unknown, false);
});

test("an unmapped executable is flagged unknown for operator review", () => {
  const scope = commandScope("python3 deploy.py --prod");
  assert.equal(scope.executable, "python3");
  assert.equal(scope.unknown, true);
  assert.deepEqual(scope.files, []);
  assert.deepEqual(scope.services, []);
});

test("high-risk markers raise risk for the whole gate", () => {
  assert.equal(commandScope("rm -rf /var/log/foo").risk, "high");
  assert.equal(commandScope("chmod 777 /etc/nginx/site.conf").risk, "high");
  assert.equal(commandScope("ssh root@10.0.0.1 -p 22").risk, "high");
  assert.equal(commandScope("systemctl stop nginx").risk, "high");
  assert.equal(commandScope("echo /etc/shadow").risk, "high", "path mention is still high-risk");
});

test("env-assignment and wrapper prefixes resolve to the real executable", () => {
  const scope = commandScope("FOO=bar sudo env sh -c 'systemctl restart nginx'");
  assert.equal(scope.executable, "systemctl");
  assert.ok(scope.services.includes("nginx"));
});
