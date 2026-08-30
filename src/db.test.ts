import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { initDb } from "./db";

// Test uses an isolated temp DB
const TEST_DB_DIR = join(__dirname, "..", "data", "test");
const TEST_DB_PATH = join(TEST_DB_DIR, "test-db.sqlite");

describe("db", () => {
  before(() => {
    mkdirSync(TEST_DB_DIR, { recursive: true });
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  after(() => {
    if (existsSync(TEST_DB_PATH)) rmSync(TEST_DB_PATH);
  });

  it("initDb creates the database file and all tables", () => {
    const db = initDb(TEST_DB_PATH);
    assert.ok(existsSync(TEST_DB_PATH), "DB file should exist");

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes("incidents"), "incidents table");
    assert.ok(tableNames.includes("policy_rules"), "policy_rules table");
    assert.ok(tableNames.includes("policy_profiles"), "policy_profiles table");
    assert.ok(tableNames.includes("sessions"), "sessions table");
    assert.ok(tableNames.includes("settings"), "settings table");
    assert.ok(tableNames.includes("fleet_hosts"), "fleet_hosts table");

    db.close();
  });

  it("initDb seeds default policy rules when table is empty", () => {
    const db = initDb(TEST_DB_PATH);

    const count = db.prepare("SELECT COUNT(*) as cnt FROM policy_rules").get() as { cnt: number };
    assert.ok(count.cnt >= 6, `Expected >=6 default rules, got ${count.cnt}`);

    db.close();
  });

  it("initDb seeds default policy profiles", () => {
    const db = initDb(TEST_DB_PATH);

    const count = db.prepare("SELECT COUNT(*) as cnt FROM policy_profiles").get() as { cnt: number };
    assert.ok(count.cnt >= 4, `Expected >=4 default profiles, got ${count.cnt}`);

    db.close();
  });

  it("initDb seeds default settings", () => {
    const db = initDb(TEST_DB_PATH);

    const mode = db.prepare("SELECT value FROM settings WHERE key = 'enforcement_mode'").get() as { value: string } | undefined;
    assert.ok(mode, "enforcement_mode setting should exist");
    assert.equal(mode.value, "STRICT_GATED");

    db.close();
  });
});
