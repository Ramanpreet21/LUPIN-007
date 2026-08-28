import type { AstSimulation, PolicyRule } from "@/types/operations";

export const mockPolicyProfiles = ["Production Safe", "Strict Read-Only", "Staging Unrestricted", "Zero-Trust"] as const;

export const mockGovernanceData: PolicyRule[] = [
  { id: "rule-rm-root", binaryName: "rm", forbiddenFlags: ["-rf", "--no-preserve-root"], category: "DESTRUCTIVE_FS", severity: "CRITICAL_BLOCK", reasonDescription: "Prevent destructive removal at filesystem root.", matchExpression: "path === '/' || path.startsWith('/etc')", enabled: true },
  { id: "rule-permissions", binaryName: "chmod", forbiddenFlags: ["777", "a+rwx"], category: "PRIVILEGE_ESCALATION", severity: "REQUIRE_APPROVAL", reasonDescription: "Require human review for broad permission escalation.", matchExpression: "target.matches(/^(\/etc|\/usr|\/var\/lib)/)", enabled: true },
  { id: "rule-format", binaryName: "mkfs.ext4", forbiddenFlags: ["*"], category: "DESTRUCTIVE_FS", severity: "CRITICAL_BLOCK", reasonDescription: "Block direct filesystem formatting from agent execution.", matchExpression: "argument.type === 'BlockDevice'", enabled: true },
  { id: "rule-service-stop", binaryName: "systemctl", forbiddenFlags: ["stop", "disable"], category: "PROCESS_TERMINATION", severity: "REQUIRE_APPROVAL", reasonDescription: "Protect critical relay and cluster-control services.", matchExpression: "unit in ['sshd','k3s','lupin-relay']", enabled: true },
  { id: "rule-exfil", binaryName: "curl", forbiddenFlags: ["-T", "--upload-file"], category: "NETWORK_EXFIL", severity: "REQUIRE_APPROVAL", reasonDescription: "Gate outbound upload commands until their destination is reviewed.", matchExpression: "url.origin !== trustedOrigins", enabled: false },
];

export const mockAstSimulation: AstSimulation = {
  command: "find /var/log -type f -delete",
  riskScore: 82,
  trippedNode: "Action: -delete",
  nodes: [
    { id: "root", label: "Command", kind: "find", risk: "low" },
    { id: "path", label: "Path", kind: "/var/log", risk: "medium" },
    { id: "type", label: "Predicate", kind: "-type f", risk: "low" },
    { id: "delete", label: "Action", kind: "-delete", risk: "high" },
  ],
};
