import { effectiveCommand, shellWords } from "./shell-parse";

/**
 * Read-only policy backend (5e). The rule list is seeded to mirror the
 * dashboard's existing `PolicyRule` contract (see `dashboard/client/src/types/
 * operations.ts`), carrying over SAFETY_POLICY intent (rm -rf, chmod +777,
 * eval). The surface is GET rules + POST simulate only — no create / delete /
 * toggle. This is a local, display-only layer, with the same honesty note as
 * `SAFETY_POLICY` in trueforge-config.ts: nothing here enforces anything
 * server-side (real enforcement lives on the TrueForge connector's
 * `requireApprovalForTools`).
 */

export type PolicyCategory =
  | "DESTRUCTIVE_FS"
  | "PRIVILEGE_ESCALATION"
  | "NETWORK_EXFIL"
  | "PROCESS_TERMINATION";
export type PolicySeverity = "CRITICAL_BLOCK" | "REQUIRE_APPROVAL";

export interface PolicyRule {
  id: string;
  binaryName: string;
  forbiddenFlags: string[];
  category: PolicyCategory;
  severity: PolicySeverity;
  reasonDescription: string;
  matchExpression: string;
  enabled: boolean;
}

/**
 * Seed mirrors `dashboard/client/src/data/mockGovernanceData.ts` so the wired
 * governance view reconciles 1:1, plus the one rule the mock lacked: SAFETY_POLICY's
 * `eval` intent. `matchExpression` is descriptive UI metadata (the mock's DSL is
 * pseudo-code); the matcher below is the binary + forbidden-flag engine.
 */
const POLICY_RULES: PolicyRule[] = [
  {
    id: "rule-rm-root",
    binaryName: "rm",
    forbiddenFlags: ["-rf", "--no-preserve-root"],
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    reasonDescription: "Prevent destructive removal at filesystem root.",
    matchExpression: "path === '/' || path.startsWith('/etc')",
    enabled: true,
  },
  {
    id: "rule-permissions",
    binaryName: "chmod",
    forbiddenFlags: ["777", "a+rwx"],
    category: "PRIVILEGE_ESCALATION",
    severity: "REQUIRE_APPROVAL",
    reasonDescription: "Require human review for broad permission escalation.",
    matchExpression: "target.matches(/^(\\/etc|\\/usr|\\/var\\/lib)/)",
    enabled: true,
  },
  {
    id: "rule-format",
    binaryName: "mkfs.ext4",
    forbiddenFlags: ["*"],
    category: "DESTRUCTIVE_FS",
    severity: "CRITICAL_BLOCK",
    reasonDescription: "Block direct filesystem formatting from agent execution.",
    matchExpression: "argument.type === 'BlockDevice'",
    enabled: true,
  },
  {
    id: "rule-service-stop",
    binaryName: "systemctl",
    forbiddenFlags: ["stop", "disable"],
    category: "PROCESS_TERMINATION",
    severity: "REQUIRE_APPROVAL",
    reasonDescription: "Protect critical relay and cluster-control services.",
    matchExpression: "unit in ['sshd','k3s','lupin-relay']",
    enabled: true,
  },
  {
    id: "rule-exfil",
    binaryName: "curl",
    forbiddenFlags: ["-T", "--upload-file"],
    category: "NETWORK_EXFIL",
    severity: "REQUIRE_APPROVAL",
    reasonDescription: "Gate outbound upload commands until their destination is reviewed.",
    matchExpression: "url.origin !== trustedOrigins",
    enabled: false,
  },
  {
    id: "rule-eval",
    binaryName: "eval",
    forbiddenFlags: [],
    category: "PRIVILEGE_ESCALATION",
    severity: "REQUIRE_APPROVAL",
    reasonDescription: "Block shell evaluation that could run unexpected payloads.",
    matchExpression: "/eval|source|\\$\\(/.test(command)",
    enabled: true,
  },
];

/** Read-only view of the rule set. Disabled rules stay visible so the UI can
 *  render each rule's toggle state even though toggling is read-only (5e). */
export function listPolicyRules(): PolicyRule[] {
  return POLICY_RULES;
}

export interface AstNode {
  id: string;
  label: string;
  kind: string;
  risk: "low" | "medium" | "high";
}

/** Dashboard `AstSimulation` shape (see types/operations.ts), defined here so
 *  this package never depends on the dashboard directory. */
export interface AstSimulation {
  command: string;
  riskScore: number;
  trippedNode: string;
  nodes: AstNode[];
}

const RISK_BY_SEVERITY: Record<PolicySeverity, AstNode["risk"]> = {
  CRITICAL_BLOCK: "high",
  REQUIRE_APPROVAL: "medium",
};
const SCORE = { BASE: 10, CRITICAL_BLOCK: 35, REQUIRE_APPROVAL: 15, MAX: 100 } as const;

/**
 * Run a command through the active rules and produce the dashboard's AST shape.
 * The tree is a linear token walk (Command → each argument); an argument that
 * trips a rule is escalated to the rule's severity. The highest-risk node is
 * `trippedNode` (`"<label>: <kind>"`, same form as the mock). `*` in
 * `forbiddenFlags` means "any argument on this binary"; an empty list means the
 * binary name alone trips (the eval rule).
 */
export function simulatePolicyRule(command: string): AstSimulation {
  const statement = effectiveCommand(command);
  const tokens = shellWords(statement);
  const executable = tokens[0]?.word ?? "";
  const args = tokens.slice(1).map((t) => t.word).filter(Boolean);

  const nodes: AstNode[] = [
    { id: "root", label: "Command", kind: executable || "(none)", risk: "low" },
  ];
  args.forEach((arg, i) => {
    nodes.push({
      id: `arg-${i}`,
      label: arg.startsWith("-") ? "Flag" : i === 0 ? "Path" : "Argument",
      kind: arg,
      risk: "low",
    });
  });
  const nodeByArg = new Map<number, AstNode>();
  args.forEach((_arg, i) => nodeByArg.set(i, nodes[i + 1]));

  let high = 0;
  let medium = 0;
  for (const rule of POLICY_RULES) {
    if (!rule.enabled || rule.binaryName !== executable) continue;
    let trippedIndex: number | null = null;
    if (rule.forbiddenFlags.includes("*") || rule.forbiddenFlags.length === 0) {
      trippedIndex = args.length > 0 ? 0 : null;
    } else {
      for (const flag of rule.forbiddenFlags) {
        const i = args.indexOf(flag);
        if (i >= 0) {
          trippedIndex = i;
          break;
        }
      }
    }
    if (trippedIndex === null) continue;
    const target = nodeByArg.get(trippedIndex) ?? nodes[0];
    if (target.risk === "low") target.risk = RISK_BY_SEVERITY[rule.severity];
    if (rule.severity === "CRITICAL_BLOCK") high += 1;
    else medium += 1;
  }

  const riskScore = Math.min(
    SCORE.MAX,
    SCORE.BASE + high * SCORE.CRITICAL_BLOCK + medium * SCORE.REQUIRE_APPROVAL,
  );
  const highest =
    nodes.find((n) => n.risk === "high") ?? nodes.find((n) => n.risk === "medium") ?? nodes[0];

  return {
    command: command.trim(),
    riskScore,
    trippedNode: `${highest.label}: ${highest.kind}`,
    nodes,
  };
}
