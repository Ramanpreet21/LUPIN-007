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

  it("enforces foreign key constraint on session_messages inserting with non-existent session_id", () => {
    const db = initDb(TEST_DB_PATH);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO session_messages (id, session_id, role, label, content, created_at)
         VALUES ('msg-invalid', 'non-existent-session', 'user', 'OPERATOR', 'hello', datetime('now'))`
      ).run();
    }, /FOREIGN KEY constraint failed/i);

    db.close();
  });

  it("enforces foreign key constraint on sessions inserting with non-existent incident_id", () => {
    const db = initDb(TEST_DB_PATH);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
         VALUES ('sess-invalid', 'th-1', 'non-existent-incident', 'test', datetime('now'))`
      ).run();
    }, /FOREIGN KEY constraint failed/i);

    db.close();
  });

  it("cascades deletion from incident to sessions and session_messages", () => {
    const db = initDb(TEST_DB_PATH);

    db.prepare(
      `INSERT INTO incidents (id, status, alert_json, created_at, updated_at)
       VALUES ('inc-test-fk', 'created', '{}', datetime('now'), datetime('now'))`
    ).run();

    db.prepare(
      `INSERT INTO sessions (id, thread_id, incident_id, summary, created_at)
       VALUES ('sess-test-fk', 'th-1', 'inc-test-fk', 'summary', datetime('now'))`
    ).run();

    db.prepare(
      `INSERT INTO session_messages (id, session_id, role, label, content, created_at)
       VALUES ('msg-test-fk', 'sess-test-fk', 'user', 'OPERATOR', 'hello', datetime('now'))`
    ).run();

    // Verify rows exist
    assert.ok(db.prepare("SELECT id FROM incidents WHERE id = 'inc-test-fk'").get());
    assert.ok(db.prepare("SELECT id FROM sessions WHERE id = 'sess-test-fk'").get());
    assert.ok(db.prepare("SELECT id FROM session_messages WHERE id = 'msg-test-fk'").get());

    // Delete parent incident
    db.prepare("DELETE FROM incidents WHERE id = 'inc-test-fk'").run();

    // Verify cascade deletion
    assert.equal(db.prepare("SELECT id FROM incidents WHERE id = 'inc-test-fk'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM sessions WHERE id = 'sess-test-fk'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM session_messages WHERE id = 'msg-test-fk'").get(), undefined);

    db.close();
  });
});

