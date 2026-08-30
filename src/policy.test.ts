import { test, beforeEach, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPolicyRule,
  deletePolicyRule,
  getPolicyRule,
  listPolicyRules,
  resetPolicyRules,
  simulatePolicy,
  updatePolicyRule,
} from "./policy";
import { createPolicyRouter } from "./routes/policy";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { initDb, getDb } from "./db";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "policy-test.sqlite");

before(() => {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  initDb(TEST_DB_PATH);
});

after(() => {
  if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
});

beforeEach(() => {
  resetPolicyRules();
});

test("policy CRUD manages in-memory rule store", () => {
  const initial = listPolicyRules();
  assert.ok(initial.length >= 5);

  const custom = createPolicyRule({
    name: "Block drop table",
    regex: "DROP\\s+TABLE",
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    enabled: true,
  });

  assert.ok(custom.id.startsWith("rule-"));
  assert.equal(getPolicyRule(custom.id)?.name, "Block drop table");

  updatePolicyRule(custom.id, { enabled: false });
  assert.equal(getPolicyRule(custom.id)?.enabled, false);

  const deleted = deletePolicyRule(custom.id);
  assert.equal(deleted, true);
  assert.equal(getPolicyRule(custom.id), undefined);
});

test("updatePolicyRule validates regex when property is present, including empty string", () => {
  const rule = createPolicyRule({
    name: "Test rule",
    regex: "test\\s+cmd",
    category: "PROCESS_TERMINATION",
    severity: "REQUIRE_APPROVAL",
    enabled: true,
  });

  // Updating with empty string should throw
  assert.throws(() => {
    updatePolicyRule(rule.id, { regex: "" });
  }, /Regex pattern must be a non-empty string/);

  assert.throws(() => {
    updatePolicyRule(rule.id, { regex: "   " });
  }, /Regex pattern must be a non-empty string/);

  // Updating with valid regex should succeed
  const updated = updatePolicyRule(rule.id, { regex: "new\\s+pattern" });
  assert.equal(updated?.regex, "new\\s+pattern");
});

test("simulatePolicy evaluates AST risk score and detects tripped nodes", () => {
  const result = simulatePolicy("rm -rf /var/log/postgresql/*");
  assert.equal(result.command, "rm -rf /var/log/postgresql/*");
  assert.ok(result.riskScore >= 80);
  assert.ok(result.matchedRules.some((r) => r.category === "DESTRUCTIVE_FS"));
  assert.ok(result.nodes.length >= 3);
  assert.ok(result.trippedNode.length > 0);
});

test("simulatePolicy detects policy violations behind wrappers and shell launchers", () => {
  const sudoResult = simulatePolicy("sudo /bin/rm -rf /var/log/postgresql/*");
  assert.ok(sudoResult.riskScore >= 80);
  assert.ok(sudoResult.matchedRules.some((r) => r.id === "rule-rm-wildcard"));

  const shellResult = simulatePolicy("bash -ec 'rm -rf /etc'");
  assert.ok(shellResult.riskScore >= 80);
  assert.ok(shellResult.matchedRules.some((r) => r.id === "rule-rm-wildcard"));

  const compoundResult = simulatePolicy("echo done; chmod 777 /etc/nginx/site.conf");
  assert.ok(compoundResult.riskScore >= 50);
  assert.ok(compoundResult.matchedRules.some((r) => r.id === "rule-permissions"));
});

test("simulatePolicy scores clean commands with low risk", () => {
  const result = simulatePolicy("uptime");
  assert.equal(result.command, "uptime");
  assert.ok(result.riskScore <= 10);
  assert.equal(result.matchedRules.length, 0);
});

test("policy routes perform validation and simulation over HTTP", async () => {
  const app = express();
  app.use(express.json());
  app.use(createPolicyRouter());
  const server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  try {
    // GET rules
    const resGet = await fetch(`http://127.0.0.1:${port}/api/policy/rules`);
    assert.equal(resGet.status, 200);
    const bodyGet = (await resGet.json()) as { data: any[] };
    assert.ok(bodyGet.data.length >= 5);

    // POST valid rule
    const resPost = await fetch(`http://127.0.0.1:${port}/api/policy/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Block kill 9",
        regex: "kill\\s+-9",
        category: "PROCESS_TERMINATION",
        severity: "CRITICAL_BLOCK",
      }),
    });
    assert.equal(resPost.status, 201);
    const newRule = (await resPost.json()) as { id: string; name: string };
    assert.equal(newRule.name, "Block kill 9");

    // POST invalid regex
    const resBadRegex = await fetch(`http://127.0.0.1:${port}/api/policy/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bad Regex",
        regex: "[unclosed",
        category: "DESTRUCTIVE_FS",
        severity: "CRITICAL_BLOCK",
      }),
    });
    assert.equal(resBadRegex.status, 400);

    // POST simulation
    const resSim = await fetch(`http://127.0.0.1:${port}/api/policy/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "systemctl stop sshd" }),
    });
    assert.equal(resSim.status, 200);
    const simResult = (await resSim.json()) as { riskScore: number; trippedNode: string };
    assert.ok(simResult.riskScore >= 50);

    // GET profiles
    const resProfiles = await fetch(`http://127.0.0.1:${port}/api/policy/profiles`);
    assert.equal(resProfiles.status, 200);
    const profilesBody = (await resProfiles.json()) as {
      data: Array<{ name: string; is_active: boolean; rule_ids: string[] }>;
    };
    assert.ok(Array.isArray(profilesBody.data));
    assert.ok(profilesBody.data.length >= 4);
    const prodSafe = profilesBody.data.find((p) => p.name === "Production Safe");
    assert.ok(prodSafe);
    assert.equal(prodSafe?.is_active, true);
    assert.ok(Array.isArray(prodSafe?.rule_ids));

    // PUT profile switch
    const resSwitch = await fetch(`http://127.0.0.1:${port}/api/policy/profiles/Zero-Trust`, {
      method: "PUT",
    });
    assert.equal(resSwitch.status, 200);
    const switchBody = (await resSwitch.json()) as { status: string; active: string };
    assert.equal(switchBody.status, "ok");
    assert.equal(switchBody.active, "Zero-Trust");

    const resProfilesAfter = await fetch(`http://127.0.0.1:${port}/api/policy/profiles`);
    const profilesAfterBody = (await resProfilesAfter.json()) as {
      data: Array<{ name: string; is_active: boolean; rule_ids: string[] }>;
    };
    const zeroTrust = profilesAfterBody.data.find((p) => p.name === "Zero-Trust");
    const prodSafeAfter = profilesAfterBody.data.find((p) => p.name === "Production Safe");
    assert.equal(zeroTrust?.is_active, true);
    assert.equal(prodSafeAfter?.is_active, false);

    // PUT nonexistent profile
    const resBadProfile = await fetch(`http://127.0.0.1:${port}/api/policy/profiles/NonExistentProfile`, {
      method: "PUT",
    });
    assert.equal(resBadProfile.status, 404);
    const badProfileBody = (await resBadProfile.json()) as { error: string };
    assert.equal(badProfileBody.error, "profile_not_found");

    // GET stats
    const resStats = await fetch(`http://127.0.0.1:${port}/api/policy/stats`);
    assert.equal(resStats.status, 200);
    const statsBody = (await resStats.json()) as {
      activeRules: number;
      blacklistedBinaries: number;
      highRiskPatterns: number;
      interceptedCount: number;
    };
    assert.ok(typeof statsBody.activeRules === "number");
    assert.ok(statsBody.activeRules >= 5);
    assert.ok(statsBody.blacklistedBinaries >= 1);
    assert.ok(statsBody.highRiskPatterns >= 1);
    assert.equal(statsBody.interceptedCount, 0);

    // PUT mode valid
    const resMode = await fetch(`http://127.0.0.1:${port}/api/policy/mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "DRY_RUN" }),
    });
    assert.equal(resMode.status, 200);
    const modeBody = (await resMode.json()) as { status: string; mode: string };
    assert.equal(modeBody.status, "ok");
    assert.equal(modeBody.mode, "DRY_RUN");

    const dbMode = (getDb().prepare("SELECT value FROM settings WHERE key = 'enforcement_mode'").get() as { value: string }).value;
    assert.equal(dbMode, "DRY_RUN");

    // PUT mode invalid
    const resBadMode = await fetch(`http://127.0.0.1:${port}/api/policy/mode`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "INVALID_MODE" }),
    });
    assert.equal(resBadMode.status, 400);
    const badModeBody = (await resBadMode.json()) as { error: string; details: string[] };
    assert.equal(badModeBody.error, "invalid_mode");

    // POST analyze valid
    const resAnalyze = await fetch(`http://127.0.0.1:${port}/api/policy/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "rm -rf /var/log" }),
    });
    assert.equal(resAnalyze.status, 200);
    const analyzeBody = (await resAnalyze.json()) as {
      command: string;
      riskScore: number;
      matchedRules: any[];
      nodes: any[];
      trippedNode: string;
    };
    assert.equal(analyzeBody.command, "rm -rf /var/log");
    assert.ok(analyzeBody.riskScore >= 80);
    assert.ok(analyzeBody.matchedRules.length >= 1);

    // POST analyze empty
    const resBadAnalyze = await fetch(`http://127.0.0.1:${port}/api/policy/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "" }),
    });
    assert.equal(resBadAnalyze.status, 400);

    // POST analyze overlong
    const resOverlongAnalyze = await fetch(`http://127.0.0.1:${port}/api/policy/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "a".repeat(4097) }),
    });
    assert.equal(resOverlongAnalyze.status, 400);
  } finally {
    server.close();
  }
});

