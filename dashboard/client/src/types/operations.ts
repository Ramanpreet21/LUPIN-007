/** Stream-ready presentation contracts for the operational dashboard views. */
export type TargetStatus = "CONNECTED" | "RECONNECTING" | "UNREACHABLE";
export type RuntimeEngine = "DIRECT_SSH" | "PODMAN_SOCKET" | "DOCKER_DAEMON" | "K8S_POD";
export type SafetyEnforcementMode = "AUTONOMOUS" | "STRICT_GATED" | "DRY_RUN";
export type IncidentSeverity = "P1_CRITICAL" | "P2_HIGH" | "P3_MEDIUM" | "P4_LOW";
export type JobOutcome = "SUCCESS" | "FAILED" | "SKIPPED";
export type SchedulerState = "ACTIVE" | "PAUSED" | "MAINTENANCE_WINDOW";
export type FleetEnvironment = "all" | "prod" | "staging" | "ephemeral" | "edge";

export interface TargetNode {
  id: string;
  hostname: string;
  ipAddress: string;
  osBadge: string;
  cloudProvider: string;
  status: TargetStatus;
  latencyMs: number;
  runtimeEngine: RuntimeEngine;
  isAgentExecuting: boolean;
  environmentTag: Exclude<FleetEnvironment, "all">;
  tags: string[];
  authConfig: { keyPath: string; user: string; port: number };
  metrics: { cpuPercent: number; ramPercent: number; diskAvailableGb: number; activeProcesses: number };
  attachedServices: string[];
  commandHistory: Array<{ id: string; time: string; command: string; outcome: "SUCCESS" | "BLOCKED" | "FAILED" }>;
}

export interface PolicyRule {
  id: string;
  binaryName: string;
  forbiddenFlags: string[];
  category: "DESTRUCTIVE_FS" | "PRIVILEGE_ESCALATION" | "NETWORK_EXFIL" | "PROCESS_TERMINATION";
  severity: "CRITICAL_BLOCK" | "REQUIRE_APPROVAL";
  reasonDescription: string;
  matchExpression: string;
  enabled: boolean;
}

export interface ArchivedIncident {
  id: string;
  title: string;
  timestamp: string;
  duration: string;
  severity: IncidentSeverity;
  status: "RESOLVED" | "ARCHIVED" | "POST_MORTEM_PENDING";
  targetHost: string;
  approverOperator: string;
  totalCommandsExecuted: number;
  agentVersion: string;
  rootCauseCategory: string;
  approvalEvents: Array<{ time: string; decision: "APPROVED" | "REJECTED"; operator: string; note: string }>;
}

export interface ScheduledJob {
  id: string;
  name: string;
  category: "Health Check" | "Cleanup" | "Security Audit" | "Backup";
  description: string;
  cronExpression: string;
  humanInterval: string;
  targetScope: string;
  lastRunTimestamp: string;
  nextRunTimestamp: string;
  lastOutcome: JobOutcome;
  lastDuration: string;
  isEnabled: boolean;
  history: Array<{ time: string; exitCode: 0 | 1; duration: string; output: string }>;
}

export interface AstSimulation {
  command: string;
  riskScore: number;
  trippedNode: string;
  nodes: Array<{ id: string; label: string; kind: string; risk: "low" | "medium" | "high" }>;
}
