/** LUMA GLASS DESIGN REMINDER: pure stream-ready data contract for the cutout status bar. */
export type SSHStatus = "CONNECTED" | "DISCONNECTED" | "RECONNECTING";
export type EngineMode = "LOCAL_MODE" | "HOSTED_MODE" | "agentic" | "fallback";
export type ContainerRuntime = "PODMAN" | "DOCKER" | "sandbox" | "docker" | "native" | "unconfigured";
export type SkillStatus = "READY" | "EXECUTING" | "RESTRICTED" | "active" | "loading" | "error" | "disabled";
export type ExecutionPolicy = "POLICY_GATED" | "AUTONOMOUS";
export type ApprovalMode = "AUTONOMOUS" | "STRICT_GATED";
export type SandboxState = "COLD" | "ACTIVE" | "TEST_BUILDING" | "READY" | "UNCONFIGURED";

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
  hasApiKey?: boolean;
  onOpenSettings?: () => void;
  className?: string;
  models?: Array<{ id: string; name: string }>;
  onModelChange?: (modelId: string) => void;
  targets?: Array<{ id: string; hostname: string; port: number | string }>;
  onTargetChange?: (target: { host: string; port: number }) => void;
}
