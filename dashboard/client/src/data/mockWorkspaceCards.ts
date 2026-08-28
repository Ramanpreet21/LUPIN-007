import type { AutomationSchedulerData, BlastRadiusData, IncidentContext, SandboxTwinData, StateDriftData, TimelineEngineData, TopologyMapData, WorkspaceCardDefinition } from "@/types/workspace-cards";

export const mockIncidentContext: IncidentContext = { targetHostId: "relay-04", targetHostname: "relay-04.lan", targetIp: "10.28.4.18", activeIncidentId: "INC-2048", sessionStatus: "INVESTIGATING", telemetryStreamActive: true };

export const workspaceCardDefinitions: WorkspaceCardDefinition[] = [
  { id: "TOPOLOGY", cue: "View 01", label: "Topology map", detail: "Service paths and bound interfaces." },
  { id: "BLAST_RADIUS", cue: "View 02", label: "AST blast-radius", detail: "Proposed command impact surface." },
  { id: "SANDBOX_TWIN", cue: "View 03", label: "Sandbox twin", detail: "Isolated trial execution profile." },
  { id: "NOTES", cue: "View 04", label: "Notes", detail: "Private observations for this session." },
];

export const mockTopologyData: TopologyMapData = {
  nodes: [
    { id: "nginx", label: "nginx", type: "REVERSE_PROXY", status: "HEALTHY", pid: 214, memoryMb: 42, openFds: 76, ports: ["0.0.0.0:80", "0.0.0.0:443"] },
    { id: "api", label: "relay-api", type: "CONTAINER", status: "DEGRADED", pid: 619, memoryMb: 418, openFds: 221, ports: ["127.0.0.1:8080"] },
    { id: "postgres", label: "postgresql", type: "DATABASE", status: "HEALTHY", pid: 488, memoryMb: 736, openFds: 142, ports: ["127.0.0.1:5432"] },
    { id: "worker", label: "queue-worker", type: "SYSTEMD", status: "HEALTHY", pid: 804, memoryMb: 188, openFds: 42, ports: ["unix:/run/relay.sock"] },
  ],
  edges: [
    { id: "edge-1", sourceNodeId: "nginx", targetNodeId: "api", latencyMs: 18, hasErrors: false },
    { id: "edge-2", sourceNodeId: "api", targetNodeId: "postgres", latencyMs: 31, hasErrors: true },
    { id: "edge-3", sourceNodeId: "api", targetNodeId: "worker", latencyMs: 12, hasErrors: false },
  ],
};

export const mockBlastRadiusData: BlastRadiusData = { proposedCommand: "systemctl restart postgresql", riskScore: 62, affectedResources: [
  { id: "service", pathOrResource: "postgresql.service", type: "SERVICE", severity: "RESTART_IMPACT", description: "Existing client sessions will reconnect." },
  { id: "socket", pathOrResource: "/run/postgresql/.s.PGSQL.5432", type: "SOCKET", severity: "RESTART_IMPACT", description: "Bound client socket is briefly unavailable." },
  { id: "config", pathOrResource: "/etc/postgresql/16/main/", type: "FILE_SYSTEM", severity: "READ_ONLY", description: "Configuration remains unchanged." },
  { id: "volume", pathOrResource: "/var/lib/postgresql", type: "VOLUME_MOUNT", severity: "DESTRUCTIVE", description: "Protected data mount requires an approval gate." },
] };

export const mockTimelineData: TimelineEngineData = { events: [
  { id: "event-1", timestamp: "2026-08-27T09:54:02Z", type: "TELEMETRY_SPIKE", title: "Connection queue crossed watch line", description: "Inbound queue rose above the calibrated baseline.", beforeMetrics: { cpu: 36, ram: 54 }, afterMetrics: { cpu: 48, ram: 61 }, isCritical: false },
  { id: "event-2", timestamp: "2026-08-27T09:55:14Z", type: "AGENT_THOUGHT", title: "Correlation path assembled", description: "The relay isolated the API-to-database edge as the highest variance path.", isCritical: false },
  { id: "event-3", timestamp: "2026-08-27T09:56:07Z", type: "AST_INTERCEPT", title: "Restart proposal held at policy gate", description: "The proposed database restart requires human confirmation.", isCritical: true },
  { id: "event-4", timestamp: "2026-08-27T09:57:48Z", type: "HUMAN_APPROVAL", title: "Read-only inspection approved", description: "A non-mutating socket and process inspection entered the work queue.", isCritical: false },
  { id: "event-5", timestamp: "2026-08-27T09:58:33Z", type: "CLI_EXECUTION", title: "Connection census completed", description: "The target returned 42 active database sockets and no lock contention.", beforeMetrics: { cpu: 48, ram: 61 }, afterMetrics: { cpu: 42, ram: 58 }, isCritical: false },
] };

export const mockStateDriftData: StateDriftData = { filePath: "/etc/nginx/nginx.conf", targetEnvironment: "production-restricted", lastCommittedHash: "4ce11fa", hasPermissionMismatch: true, gitBaselineContent: "user www-data;\nworker_processes auto;\nevents { worker_connections 1024; }\nhttp {\n  include /etc/nginx/mime.types;\n  sendfile on;\n}", liveServerContent: "user root;\nworker_processes 4;\nevents { worker_connections 2048; }\nhttp {\n  include /etc/nginx/mime.types;\n  sendfile on;\n  client_max_body_size 64m;\n}" };

export const mockSandboxTwinData: SandboxTwinData = { containerId: "twin-88a2", state: "ACTIVE_ISOLATION", resourceLimits: { cpuCapCores: 2, cpuUsedPercent: 38, memoryCapMb: 1024, memoryUsedMb: 418 }, isolationFlags: { networkDisabled: true, readOnlyHostMount: true }, executionTestResult: { exitCode: 0, outputDiffSummary: "Socket census matches production variance; no write path was opened." } };

export const mockAutomationSchedulerData: AutomationSchedulerData = { activeJobs: [
  { id: "job-1", name: "Hourly DB Pool Check", cronSchedule: "0 * * * *", humanSchedule: "hourly", targetScope: "relay-04 / postgres", lastRunDuration: "1.2s", nextRunCountdown: "18m", lastOutcome: "SUCCESS" },
  { id: "job-2", name: "Edge Latency Sweep", cronSchedule: "*/15 * * * *", humanSchedule: "every 15 minutes", targetScope: "reverse proxy mesh", lastRunDuration: "0.8s", nextRunCountdown: "03m", lastOutcome: "SUCCESS" },
  { id: "job-3", name: "Archive Integrity Probe", cronSchedule: "30 2 * * *", humanSchedule: "daily at 02:30", targetScope: "protected archive", lastRunDuration: "2.9s", nextRunCountdown: "16h", lastOutcome: "SKIPPED" },
], timeline24h: [
  { timestamp: "00:30", jobId: "job-3", status: "SUCCESS" }, { timestamp: "08:00", jobId: "job-1", status: "SUCCESS" }, { timestamp: "09:00", jobId: "job-1", status: "SUCCESS" }, { timestamp: "09:15", jobId: "job-2", status: "FAILED" }, { timestamp: "10:00", jobId: "job-1", status: "SUCCESS" },
] };
