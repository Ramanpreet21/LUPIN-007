/**
 * In-memory policy rule store and AST simulation engine (PR #5 §5e).
 * Provides dynamic safety rule CRUD, regex validation, command syntax breakdown,
 * and risk-scoring simulation for the AST Governance canvas.
 */

import { splitCompoundStatements, extractCommandSubstitutions } from "./command-scope";
import { effectiveCommand } from "./shell-parse";

export type PolicyCategory =
  | "DESTRUCTIVE_FS"
  | "PRIVILEGE_ESCALATION"
  | "NETWORK_EXFIL"
  | "PROCESS_TERMINATION";

export type PolicySeverity = "CRITICAL_BLOCK" | "REQUIRE_APPROVAL" | "WARN";

export interface PolicyRule {
  id: string;
  name: string;
  regex: string;
  category: PolicyCategory;
  severity: PolicySeverity;
  enabled: boolean;
  reasonDescription?: string;
  matchExpression?: string;
  binaryName?: string;
  forbiddenFlags?: string[];
}

export interface AstNode {
  id: string;
  label: string;
  kind: string;
  risk: "low" | "medium" | "high" | "critical";
}

export interface AstSimulationResult {
  command: string;
  riskScore: number; // 0-100
  matchedRules: PolicyRule[];
  nodes: AstNode[];
  trippedNode: string;
}

const DEFAULT_RULES: PolicyRule[] = [
  {
    id: "rule-rm-wildcard",
    name: "Block wildcard / root deletion",
    regex: "^rm\\s+.*(\\*|--no-preserve-root|/etc|/var|/usr)",
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    enabled: true,
    binaryName: "rm",
    forbiddenFlags: ["-rf", "--no-preserve-root", "*"],
    matchExpression: "path === '/' || path.startsWith('/etc') || contains('*')",
    reasonDescription: "Prevent destructive file removal across protected system paths or wildcards.",
  },
  {
    id: "rule-permissions",
    name: "Require approval for broad permission escalation",
    regex: "^chmod\\s+(777|a\\+rwx|-R\\s+777)",
    category: "PRIVILEGE_ESCALATION",
    severity: "REQUIRE_APPROVAL",
    enabled: true,
    binaryName: "chmod",
    forbiddenFlags: ["777", "a+rwx"],
    matchExpression: "mode === '777' || mode === 'a+rwx'",
    reasonDescription: "Require human review for full read/write/execute permission escalation.",
  },
  {
    id: "rule-format",
    name: "Block raw disk format & block device writes",
    regex: "^(mkfs|fdisk|parted|dd\\s+if=)",
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    enabled: true,
    binaryName: "mkfs",
    forbiddenFlags: ["*"],
    matchExpression: "argument.type === 'BlockDevice'",
    reasonDescription: "Block direct filesystem formatting or raw disk overwrites from agent execution.",
  },
  {
    id: "rule-service-stop",
    name: "Gate critical service stoppage",
    regex: "^(systemctl|service)\\s+(stop|disable|mask)",
    category: "PROCESS_TERMINATION",
    severity: "REQUIRE_APPROVAL",
    enabled: true,
    binaryName: "systemctl",
    forbiddenFlags: ["stop", "disable", "mask"],
    matchExpression: "unit in ['sshd','k3s','lupin-relay','nginx']",
    reasonDescription: "Protect critical relay, edge, and cluster-control services from unauthorized shutdown.",
  },
  {
    id: "rule-exfil",
    name: "Gate outbound network uploads",
    regex: "^(curl|wget)\\s+.*(-T|--upload-file|-d\\s+@|--post-file)",
    category: "NETWORK_EXFIL",
    severity: "REQUIRE_APPROVAL",
    enabled: true,
    binaryName: "curl",
    forbiddenFlags: ["-T", "--upload-file", "--post-file"],
    matchExpression: "url.origin !== trustedOrigins",
    reasonDescription: "Gate outbound file upload and exfiltration commands until destination is reviewed.",
  },
  {
    id: "rule-eval",
    name: "Block dynamic code evaluation",
    regex: "(^|\\s)(eval|source|bash\\s+-c|sh\\s+-c|\\$\\()",
    category: "PRIVILEGE_ESCALATION",
    severity: "CRITICAL_BLOCK",
    enabled: true,
    binaryName: "eval",
    forbiddenFlags: ["eval", "$()", "source"],
    matchExpression: "hasDynamicEval(command)",
    reasonDescription: "Prevent command injection and dynamic arbitrary script evaluation.",
  },
];

const MAX_REGEX_LENGTH = 512;
const MAX_COMMAND_LENGTH = 4096;

/**
 * Validate that a regex is syntactically valid and free of dangerous nested quantifiers.
 */
export function validateSafeRegex(pattern: string): void {
  if (typeof pattern !== "string" || !pattern.trim()) {
    throw new Error("Regex pattern must be a non-empty string");
  }
  const trimmed = pattern.trim();
  if (trimmed.length > MAX_REGEX_LENGTH) {
    throw new Error(`Regex length exceeds maximum allowed length of ${MAX_REGEX_LENGTH} characters`);
  }
  if (/(\([^)]*[*+?]\)[*+?])|(\([^)]*[*+?]\)\{\d+,?\})|(\((?:[a-zA-Z0-9_.-]+\|[a-zA-Z0-9_.-]+)+\)[*+])/.test(trimmed)) {
    throw new Error("Potentially catastrophic nested quantifiers are not permitted in policy expressions");
  }
  new RegExp(trimmed);
}

let rulesStore: Map<string, PolicyRule> = new Map(DEFAULT_RULES.map((r) => [r.id, { ...r }]));

export function listPolicyRules(): PolicyRule[] {
  return Array.from(rulesStore.values());
}

export function getPolicyRule(id: string): PolicyRule | undefined {
  return rulesStore.get(id);
}

export function createPolicyRule(input: Omit<PolicyRule, "id">): PolicyRule {
  validateSafeRegex(input.regex);
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const rule: PolicyRule = { ...input, id };
  rulesStore.set(id, rule);
  return rule;
}

export function updatePolicyRule(id: string, patch: Partial<PolicyRule>): PolicyRule | undefined {
  const existing = rulesStore.get(id);
  if (!existing) return undefined;
  if ("regex" in patch && patch.regex !== undefined) {
    validateSafeRegex(patch.regex);
  }
  const updated: PolicyRule = { ...existing, ...patch, id };
  rulesStore.set(id, updated);
  return updated;
}

export function deletePolicyRule(id: string): boolean {
  return rulesStore.delete(id);
}

export function resetPolicyRules(): void {
  rulesStore = new Map(DEFAULT_RULES.map((r) => [r.id, { ...r }]));
}

function normalizeLeadingBinary(stmt: string): string {
  const trimmed = stmt.trim();
  const firstSpace = trimmed.indexOf(" ");
  const firstWord = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const rest = firstSpace === -1 ? "" : trimmed.slice(firstSpace);
  const exe = firstWord.slice(firstWord.lastIndexOf("/") + 1);
  return `${exe}${rest}`;
}

/**
 * Break a command into AST nodes for syntax canvas visualization.
 */
function parseAstNodes(command: string): AstNode[] {
  const trimmed = command.trim();
  if (!trimmed) {
    return [{ id: "node-0", label: "Empty", kind: "(empty)", risk: "low" }];
  }

  const effective = effectiveCommand(trimmed);
  const parts = effective.split(/\s+/);
  const nodes: AstNode[] = [];

  // Root command node
  const rawExe = parts[0] || "";
  const rootExe = rawExe.slice(rawExe.lastIndexOf("/") + 1);
  const isRiskyExe = ["mkfs", "dd", "fdisk", "eval", "kill", "reboot", "shutdown"].includes(rootExe) || rootExe.startsWith("mkfs.");
  nodes.push({
    id: "node-root",
    label: "Command",
    kind: rootExe || rawExe,
    risk: isRiskyExe ? "high" : "low",
  });

  // Parse arguments, flags, paths, subactions
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    let label = "Argument";
    let risk: AstNode["risk"] = "low";

    if (part.startsWith("-")) {
      label = "Flag";
      if (["-rf", "-fr", "--no-preserve-root", "-delete", "-9", "-KILL"].includes(part)) {
        risk = "high";
      } else if (["-T", "--upload-file", "-d", "--output", "-o", "-O"].includes(part) || part.startsWith("--output=")) {
        risk = "medium";
      }
    } else if (part.startsWith("/") || part.startsWith("./") || part.startsWith("~/")) {
      label = "Path";
      if (part === "/" || part.startsWith("/etc") || part.startsWith("/var/lib")) {
        risk = "high";
      } else if (part.startsWith("/var/log") || part.startsWith("/tmp")) {
        risk = "medium";
      }
    } else if (["stop", "disable", "restart", "kill", "777", "a+rwx"].includes(part)) {
      label = "Action";
      risk = ["stop", "disable", "777", "a+rwx"].includes(part) ? "high" : "medium";
    }

    nodes.push({
      id: `node-${i}`,
      label,
      kind: part,
      risk,
    });
  }

  return nodes;
}

/**
 * Simulate safety policy against a CLI command string.
 */
export function simulatePolicy(command: string): AstSimulationResult {
  const trimmed = command.trim();
  const nodes = parseAstNodes(trimmed);
  const matchedRules: PolicyRule[] = [];

  const activeRules = listPolicyRules().filter((r) => r.enabled);

  // Extract all sub-statements, substitutions, and their effective commands
  const stmts = splitCompoundStatements(trimmed);
  const subs = extractCommandSubstitutions(trimmed);
  const allFragments = Array.from(new Set([trimmed, ...stmts, ...subs]));
  const targetsToTest = Array.from(
    new Set([
      ...allFragments,
      ...allFragments.map((f) => effectiveCommand(f)),
      ...allFragments.map((f) => normalizeLeadingBinary(f)),
      ...allFragments.map((f) => normalizeLeadingBinary(effectiveCommand(f))),
    ]),
  );

  for (const rule of activeRules) {
    try {
      const rx = new RegExp(rule.regex, "i");
      if (targetsToTest.some((target) => rx.test(target))) {
        matchedRules.push(rule);
      }
    } catch {
      /* ignore invalid stored regex */
    }
  }

  // Calculate composite risk score
  let riskScore = 0;
  let trippedNode = "None (clean syntax)";

  if (matchedRules.some((r) => r.severity === "CRITICAL_BLOCK")) {
    riskScore = Math.min(100, 80 + matchedRules.length * 5);
  } else if (matchedRules.some((r) => r.severity === "REQUIRE_APPROVAL")) {
    riskScore = Math.min(79, 50 + matchedRules.length * 8);
  } else if (matchedRules.some((r) => r.severity === "WARN")) {
    riskScore = Math.min(49, 25 + matchedRules.length * 6);
  } else if (nodes.some((n) => n.risk === "high")) {
    riskScore = 40;
  } else if (nodes.some((n) => n.risk === "medium")) {
    riskScore = 20;
  } else {
    riskScore = 5;
  }

  // Find the highest-risk node
  const highestNode = nodes.find((n) => n.risk === "high") ?? nodes.find((n) => n.risk === "medium");
  if (highestNode) {
    trippedNode = `${highestNode.label}: ${highestNode.kind}`;
  } else if (matchedRules[0]) {
    trippedNode = `Policy: ${matchedRules[0].name}`;
  }

  return {
    command: trimmed,
    riskScore,
    matchedRules,
    nodes,
    trippedNode,
  };
}
