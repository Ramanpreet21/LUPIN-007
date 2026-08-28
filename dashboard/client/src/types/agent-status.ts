/** LUMA GLASS DESIGN REMINDER: pure stream-ready data contract for the cutout status bar. */
export type SSHStatus = "CONNECTED" | "DISCONNECTED" | "RECONNECTING";
export type EngineMode = "LOCAL_MODE" | "HOSTED_MODE";
export type ContainerRuntime = "PODMAN" | "DOCKER";
export type SkillStatus = "READY" | "EXECUTING" | "RESTRICTED";
export type ExecutionPolicy = "POLICY_GATED" | "AUTONOMOUS";
export type ApprovalMode = "AUTONOMOUS" | "STRICT_GATED";
export type SandboxState = "COLD" | "ACTIVE" | "TEST_BUILDING";

export interface AgentSkill {
  id: string;
  displayName: string;
  category: "SSH" | "Filesystem" | "AST_Parser" | "Sandbox_Runner" | string;
  status: SkillStatus;
  executionPolicy: ExecutionPolicy;
  policyConstraintMessage?: string;
}

export interface AgentStatusSummary {
  session: { targetIp: string; hostname: string; sshStatus: SSHStatus; latencyMs: number; targetOs: string; };
  engine: { mode: EngineMode; orchestratorRuntime: string; containerRuntime: ContainerRuntime; socketConnected: boolean; };
  skills: AgentSkill[];
  activeSkillId?: string | null;
  safety: { approvalMode: ApprovalMode; isExecuting: boolean; };
  telemetry: { activeModel: string; tokensUsed: number; maxTokens: number; };
  sandboxTwin: { id: string; state: SandboxState; };
  policy: { activeRuleSet: string; blockedCommandCount: number; };
}

export interface AgentStatusCapabilitiesBarProps {
  data: AgentStatusSummary;
  onToggleApprovalMode?: (newMode: ApprovalMode) => void;
  onEmergencyStop?: () => void;
  onSSHAction?: (action: "RECONNECT" | "CLEAR_SCROLLBACK" | "SPAWN_SUBSHELL") => void;
  onSkillClick?: (skillId: string) => void;
  className?: string;
}
