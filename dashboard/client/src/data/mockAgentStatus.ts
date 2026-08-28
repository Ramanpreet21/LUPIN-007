import type { AgentStatusSummary } from "@/types/agent-status";

/** Fixture with the same contract expected from an eventual engine event stream. */
export const mockAgentStatus: AgentStatusSummary = {
  session: { targetIp: "192.168.1.104", hostname: "relay-04.lan", sshStatus: "CONNECTED", latencyMs: 8, targetOs: "Ubuntu 24.04" },
  engine: { mode: "LOCAL_MODE", orchestratorRuntime: "TrueForge", containerRuntime: "PODMAN", socketConnected: true },
  skills: [
    { id: "ssh", displayName: "SSH", category: "SSH", status: "READY", executionPolicy: "POLICY_GATED", policyConstraintMessage: "Remote mutations require confirmation." },
    { id: "files", displayName: "Files", category: "Filesystem", status: "READY", executionPolicy: "AUTONOMOUS" },
    { id: "ast", displayName: "AST", category: "AST_Parser", status: "READY", executionPolicy: "AUTONOMOUS" },
    { id: "sandbox", displayName: "Sandbox", category: "Sandbox_Runner", status: "EXECUTING", executionPolicy: "POLICY_GATED", policyConstraintMessage: "Production network access is restricted." },
  ],
  activeSkillId: "sandbox",
  safety: { approvalMode: "AUTONOMOUS", isExecuting: true },
  telemetry: { activeModel: "Claude 3.5 Sonnet", tokensUsed: 14200, maxTokens: 200000 },
  sandboxTwin: { id: "twin-88a2", state: "ACTIVE" },
  policy: { activeRuleSet: "Prod-Restricted", blockedCommandCount: 3 },
};
