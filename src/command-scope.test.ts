import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotateCommandScope,
  annotateCommandsScope,
  formatScopedDiff,
  tokenizeShellWords,
} from "./command-scope";

test("tokenizeShellWords handles quotes and whitespace accurately", () => {
  const tokens = tokenizeShellWords(`systemctl restart 'my service' --flag="val with spaces"`);
  assert.equal(tokens.length, 4);
  assert.equal(tokens[0].word, "systemctl");
  assert.equal(tokens[1].word, "restart");
  assert.equal(tokens[2].word, "my service");
  assert.equal(tokens[3].word, "--flag=val with spaces");
});

test("annotateCommandScope resolves systemctl service resources and ports", () => {
  const scope = annotateCommandScope("sudo systemctl restart nginx.service");
  assert.equal(scope.executable, "systemctl");
  assert.equal(scope.subcommand, "restart");
  assert.ok(scope.services.includes("nginx (restart)"));
  assert.ok(scope.ports.includes("80"));
  assert.ok(scope.ports.includes("443"));
  assert.ok(scope.sockets.includes("tcp/80"));
  assert.ok(scope.files.includes("/etc/nginx/nginx.conf"));
  assert.equal(scope.riskLevel, "medium");
});

test("annotateCommandScope flags destructive rm as critical", () => {
  const scope = annotateCommandScope("rm -rf /var/lib/data/*");
  assert.equal(scope.executable, "rm");
  assert.equal(scope.riskLevel, "critical");
  assert.ok(scope.files.includes("/var/lib/data/*"));
});

test("annotateCommandScope handles container commands", () => {
  const scope = annotateCommandScope("podman stop twin-a9");
  assert.equal(scope.executable, "podman");
  assert.equal(scope.subcommand, "stop");
  assert.equal(scope.riskLevel, "high");
  assert.ok(scope.sockets.includes("unix:/run/podman/podman.sock"));
});

test("formatScopedDiff formats diff blocks with resource annotations", () => {
  const diff = formatScopedDiff([
    "systemctl restart postgresql",
    "rm -rf /tmp/cache/*",
  ]);
  assert.ok(diff.includes("+ systemctl restart postgresql"));
  assert.ok(diff.includes("sockets:  tcp/5432"));
  assert.ok(diff.includes("ports:    5432"));
  assert.ok(diff.includes("+ rm -rf /tmp/cache/*"));
  assert.ok(diff.includes("[CRITICAL]"));
});

test("annotateCommandScope detects destructive statements in compound commands", () => {
  const compound = annotateCommandScope("echo ok; rm -rf /var/lib/app/*");
  assert.equal(compound.riskLevel, "critical");
  assert.ok(compound.files.includes("/var/lib/app/*"));

  const piped = annotateCommandScope("cat /etc/passwd | rm -f /tmp/test");
  assert.equal(piped.riskLevel, "high");
  assert.ok(piped.files.includes("/tmp/test"));
});

test("annotateCommandScope unwraps sh -c commands", () => {
  const shCmd = annotateCommandScope("sh -c 'rm -rf /tmp/data/*'");
  assert.equal(shCmd.riskLevel, "critical");
  assert.ok(shCmd.files.includes("/tmp/data/*"));
});

test("annotateCommandScope flags mutating power commands", () => {
  const rebootScope = annotateCommandScope("reboot");
  assert.equal(rebootScope.riskLevel, "critical");

  const unknownScope = annotateCommandScope("custom_admin_tool --action fix");
  assert.equal(unknownScope.riskLevel, "medium");
  assert.ok(unknownScope.impactSummary.includes("Unknown command"));
});

test("annotateCommandScope detects command substitutions $(...) and `...`", () => {
  const sub = annotateCommandScope('echo "$(rm -rf /var/lib/app/*)"');
  assert.equal(sub.riskLevel, "critical");
  assert.ok(sub.files.includes("/var/lib/app/*"));

  const backtick = annotateCommandScope("echo `rm -rf /tmp/data`");
  assert.equal(backtick.riskLevel, "critical");
  assert.ok(backtick.files.includes("/tmp/data"));
});

test("annotateCommandScope handles descriptor redirections", () => {
  const redir = annotateCommandScope("cat non_existent 2>/etc/shadow");
  assert.equal(redir.riskLevel, "critical");
  assert.ok(redir.files.includes("/etc/shadow"));
});

test("annotateCommandScope handles deeply nested substitutions", () => {
  const deeplyNested = annotateCommandScope('echo "$(echo $(reboot))"');
  assert.equal(deeplyNested.riskLevel, "critical");
});

test("annotateCommandScope handles numeric append descriptor redirections", () => {
  const redir = annotateCommandScope('echo "test" 1>>/etc/shadow');
  assert.equal(redir.riskLevel, "critical");
  assert.ok(redir.files.includes("/etc/shadow"));
});

test("annotateCommandScope recognizes systemctl start as mutating", () => {
  const scope = annotateCommandScope("systemctl start nginx");
  assert.equal(scope.riskLevel, "medium");
  assert.ok(scope.services.some(s => s.includes("nginx")));
});

test("annotateCommandScope handles process substitutions <(...) and >(...)", () => {
  const proc = annotateCommandScope("cat <(rm -rf /var/lib/app/*)");
  assert.equal(proc.riskLevel, "critical");
  assert.ok(proc.files.includes("/var/lib/app/*"));
});

test("annotateCommandScope handles sudo -n without argument eating", () => {
  const sudoN = annotateCommandScope("sudo -n rm -rf /var/lib/app/*");
  assert.equal(sudoN.riskLevel, "critical");
  assert.ok(sudoN.files.includes("/var/lib/app/*"));
});

test("annotateCommandScope unwraps eval commands", () => {
  const ev = annotateCommandScope('eval "rm -rf /var/lib/app/*"');
  assert.equal(ev.riskLevel, "critical");
  assert.ok(ev.files.includes("/var/lib/app/*"));
});

test("annotateCommandScope splits compound commands inside substitutions", () => {
  const compoundSub = annotateCommandScope('echo "$(echo ok; rm -rf /var/lib/app/*)"');
  assert.equal(compoundSub.riskLevel, "critical");
  assert.ok(compoundSub.files.includes("/var/lib/app/*"));
});

test("annotateCommandScope handles unspaced redirections", () => {
  const unspaced = annotateCommandScope("echo value>/etc/shadow");
  assert.equal(unspaced.riskLevel, "critical");
  assert.ok(unspaced.files.includes("/etc/shadow"));
});

test("annotateCommandScope handles sudo -D option consumption", () => {
  const sudoD = annotateCommandScope("sudo -D /tmp rm -rf /var/lib/app/*");
  assert.equal(sudoD.riskLevel, "critical");
  assert.ok(sudoD.files.includes("/var/lib/app/*"));
});

test("annotateCommandScope handles systemctl with option arguments", () => {
  const sys = annotateCommandScope("systemctl -H remote-host restart nginx");
  assert.equal(sys.riskLevel, "medium");
  assert.ok(sys.services.some(s => s.includes("nginx")));
});
