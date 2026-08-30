export interface IncidentContext {
  targetHostId: string;
  targetHostname: string;
  targetIp: string;
  activeIncidentId: string;
  sessionStatus: "ACTIVE" | "RESOLVED" | "INVESTIGATING";
  telemetryStreamActive: boolean;
}

export interface WorkspaceViewProps<T> {
  context: IncidentContext;
  data: T;
  onAction?: (actionType: string, payload?: Record<string, unknown>) => void;
  className?: string;
}

export type WorkspaceCardId = "TOPOLOGY" | "BLAST_RADIUS" | "TIMELINE" | "STATE_DRIFT" | "SANDBOX_TWIN" | "AUTOMATION_SCHEDULER";
export type ArchiveWorkspaceCardId = "TOPOLOGY" | "BLAST_RADIUS" | "SANDBOX_TWIN" | "NOTES";

export interface WorkspaceCardDefinition {
  id: ArchiveWorkspaceCardId;
  cue: string;
  label: string;
  detail: string;
}

export interface TopologyNode {
  id: string;
  label: string;
  type: "SYSTEMD" | "CONTAINER" | "DATABASE" | "REVERSE_PROXY";
  status: "HEALTHY" | "DEGRADED" | "CRITICAL";
  pid: number;
  memoryMb: number;
  openFds: number;
  ports: string[];
}

export interface TopologyEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  latencyMs: number;
  hasErrors: boolean;
}

export interface TopologyMapData { nodes: TopologyNode[]; edges: TopologyEdge[]; }

export interface AffectedSubsystem {
  id: string;
  pathOrResource: string;
  type: "FILE_SYSTEM" | "SOCKET" | "SERVICE" | "VOLUME_MOUNT";
  severity: "READ_ONLY" | "RESTART_IMPACT" | "DESTRUCTIVE";
  description: string;
}

export interface BlastRadiusData {
  proposedCommand: string;
  command?: string;
  diff?: string;
  riskScore: number;
  affectedResources: AffectedSubsystem[];
}

export type TimelineEventType = "TELEMETRY_SPIKE" | "AGENT_THOUGHT" | "CLI_EXECUTION" | "AST_INTERCEPT" | "HUMAN_APPROVAL";
export interface TimelineEvent { id: string; timestamp: string; type: TimelineEventType; title: string; description: string; beforeMetrics?: { cpu: number; ram: number }; afterMetrics?: { cpu: number; ram: number }; isCritical: boolean; }
export interface TimelineEngineData { events: TimelineEvent[]; }

export interface StateDriftData { filePath: string; targetEnvironment: string; gitBaselineContent: string; liveServerContent: string; lastCommittedHash: string; hasPermissionMismatch: boolean; }

export type SandboxState = "ACTIVE_ISOLATION" | "RUNNING_TEST_BUILD" | "TEARDOWN_QUEUED";
export interface SandboxTwinData { containerId: string; state: SandboxState; resourceLimits: { cpuCapCores: number; cpuUsedPercent: number; memoryCapMb: number; memoryUsedMb: number; }; isolationFlags: { networkDisabled: boolean; readOnlyHostMount: boolean; }; executionTestResult?: { exitCode: number; outputDiffSummary: string; }; }

export interface ScheduledJobItem { id: string; name: string; cronSchedule: string; humanSchedule: string; targetScope: string; lastRunDuration: string; nextRunCountdown: string; lastOutcome: "SUCCESS" | "FAILED" | "SKIPPED"; }
export interface AutomationSchedulerData { activeJobs: ScheduledJobItem[]; timeline24h: Array<{ timestamp: string; jobId: string; status: "SUCCESS" | "FAILED" }>; }
