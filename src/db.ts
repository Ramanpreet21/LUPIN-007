import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let _db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'created',
  alert_json TEXT NOT NULL,
  session_id TEXT,
  turn_id TEXT,
  thread_id TEXT,
  tool_call_id TEXT,
  tool_call_ids TEXT,
  proposed_command TEXT,
  proposed_commands TEXT,
  safety_badges TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  regex TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  reason_description TEXT,
  match_expression TEXT,
  binary_name TEXT,
  forbidden_flags TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS policy_profiles (
  name TEXT PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 0,
  rule_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  incident_id TEXT,
  summary TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fleet_hosts (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  ip TEXT,
  port INTEGER DEFAULT 22,
  ssh_user TEXT,
  ssh_key_path TEXT,
  podman_socket TEXT,
  last_probe_status TEXT,
  last_probe_at TEXT,
  probe_latency_ms INTEGER,
  probe_error TEXT,
  os_info TEXT,
  created_at TEXT NOT NULL
);
`;

const DEFAULT_POLICY_RULES = [
  {
    id: "rule-rm-wildcard",
    name: "Block wildcard / root deletion",
    regex: "^rm\\s+.*(\\*|--no-preserve-root|/etc|/var|/usr)",
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    enabled: 1,
    reason_description: "Prevent destructive file removal across protected system paths or wildcards.",
    match_expression: "path === '/' || path.startsWith('/etc') || contains('*')",
    binary_name: "rm",
    forbidden_flags: '["-rf","--no-preserve-root","*"]',
  },
  {
    id: "rule-permissions",
    name: "Require approval for broad permission escalation",
    regex: "^chmod\\s+(777|a\\+rwx|-R\\s+777)",
    category: "PRIVILEGE_ESCALATION",
    severity: "REQUIRE_APPROVAL",
    enabled: 1,
    reason_description: "Require human review for full read/write/execute permission escalation.",
    match_expression: "mode === '777' || mode === 'a+rwx'",
    binary_name: "chmod",
    forbidden_flags: '["777","a+rwx"]',
  },
  {
    id: "rule-format",
    name: "Block raw disk format & block device writes",
    regex: "^(mkfs|fdisk|parted|dd\\s+if=)",
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    enabled: 1,
    reason_description: "Block direct filesystem formatting or raw disk overwrites from agent execution.",
    match_expression: "argument.type === 'BlockDevice'",
    binary_name: "mkfs",
    forbidden_flags: '["*"]',
  },
  {
    id: "rule-service-stop",
    name: "Gate critical service stoppage",
    regex: "^(systemctl|service)\\s+(stop|disable|mask)",
    category: "PROCESS_TERMINATION",
    severity: "REQUIRE_APPROVAL",
    enabled: 1,
    reason_description: "Protect critical relay, edge, and cluster-control services from unauthorized shutdown.",
    match_expression: "unit in ['sshd','k3s','lupin-relay','nginx']",
    binary_name: "systemctl",
    forbidden_flags: '["stop","disable","mask"]',
  },
  {
    id: "rule-exfil",
    name: "Gate outbound network uploads",
    regex: "^(curl|wget)\\s+.*(-T|--upload-file|-d\\s+@|--post-file)",
    category: "NETWORK_EXFIL",
    severity: "REQUIRE_APPROVAL",
    enabled: 1,
    reason_description: "Gate outbound file upload and exfiltration commands until destination is reviewed.",
    match_expression: "url.origin !== trustedOrigins",
    binary_name: "curl",
    forbidden_flags: '["-T","--upload-file","--post-file"]',
  },
  {
    id: "rule-eval",
    name: "Block dynamic code evaluation",
    regex: "(^|\\s)(eval|source|bash\\s+-c|sh\\s+-c|\\$\\()",
    category: "PRIVILEGE_ESCALATION",
    severity: "CRITICAL_BLOCK",
    enabled: 1,
    reason_description: "Prevent command injection and dynamic arbitrary script evaluation.",
    match_expression: "hasDynamicEval(command)",
    binary_name: "eval",
    forbidden_flags: '["eval","$()","source"]',
  },
];

const DEFAULT_PROFILES = [
  { name: "Production Safe", is_active: 1, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
  { name: "Strict Read-Only", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
  { name: "Staging Unrestricted", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-format","rule-eval"]' },
  { name: "Zero-Trust", is_active: 0, rule_ids: '["rule-rm-wildcard","rule-permissions","rule-format","rule-service-stop","rule-exfil","rule-eval"]' },
];

const DEFAULT_SETTINGS: Record<string, string> = {
  enforcement_mode: "STRICT_GATED",
  model: "google-gemini/gemini-3-6-flash",
  sandbox_url: "",
  operator_name: "",
  skills: '["diagnostic","remediation","runbook"]',
  mcps: '["ssh","cli","filesystem"]',
};

function seedDefaults(db: Database.Database): void {
  const ruleCount = (db.prepare("SELECT COUNT(*) as cnt FROM policy_rules").get() as { cnt: number }).cnt;
  if (ruleCount === 0) {
    const insertRule = db.prepare(
      `INSERT OR IGNORE INTO policy_rules (id, name, regex, category, severity, enabled, reason_description, match_expression, binary_name, forbidden_flags, created_at)
       VALUES (@id, @name, @regex, @category, @severity, @enabled, @reason_description, @match_expression, @binary_name, @forbidden_flags, @created_at)`
    );
    const now = new Date().toISOString();
    for (const rule of DEFAULT_POLICY_RULES) {
      insertRule.run({ ...rule, created_at: now });
    }
  }

  const profileCount = (db.prepare("SELECT COUNT(*) as cnt FROM policy_profiles").get() as { cnt: number }).cnt;
  if (profileCount === 0) {
    const insertProfile = db.prepare(
      `INSERT OR IGNORE INTO policy_profiles (name, is_active, rule_ids, created_at) VALUES (@name, @is_active, @rule_ids, @created_at)`
    );
    const now = new Date().toISOString();
    for (const profile of DEFAULT_PROFILES) {
      insertProfile.run({ ...profile, created_at: now });
    }
  }

  const settingCount = (db.prepare("SELECT COUNT(*) as cnt FROM settings").get() as { cnt: number }).cnt;
  if (settingCount === 0) {
    const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)");
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insertSetting.run({ key, value });
    }
  }
}

export function initDb(dbPath = "./data/incident-deck.db"): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  seedDefaults(db);
  _db = db;
  return db;
}

export function getDb(): Database.Database {
  if (!_db) throw new Error("Database not initialized — call initDb() first");
  return _db;
}
