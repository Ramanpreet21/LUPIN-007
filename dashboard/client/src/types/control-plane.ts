/**
 * Operator-console contract for the incident-plane WebSocket (server:
 * src/incident-plane.ts). Envelope shape is `{ type, incident_id, payload }`,
 * which is also what the dashboard terminal and incident deck consume.
 */

export interface SafetyBadge {
  name: string;
  status: "pass" | "fail";
}

export interface PendingApproval {
  proposed_command: string;
  proposed_commands: string[];
  safety_badges: SafetyBadge[];
  diff: string;
}

export type ExecutionStatus = "success" | "failed" | "rejected";

export type ApprovalDecision = "approved" | "rejected";

export type ControlPlaneEvent =
  | { type: "incident_created"; incident_id: string; payload: { diagnosis: null } }
  | {
      type: "agent_thinking";
      incident_id: string;
      payload: { content: string; step: number };
    }
  | { type: "pending_approval"; incident_id: string; payload: PendingApproval }
  | {
      type: "execution_complete";
      incident_id: string;
      payload: { status: ExecutionStatus };
    }
  | { type: "sandbox_started"; incident_id: string; payload: { sandbox_id: string; thread_id?: string; created_at: string } }
  | {
      type: "fleet_updated";
      host_id: string;
      payload: { status: string; latency_ms: number };
    }
  | {
      type: "converse_thinking";
      session_id: string;
      payload: { content: string; step: number };
    }
  | {
      type: "converse_complete";
      session_id: string;
      payload: { content: string; status: "done" | "failed" };
    };

export type IncidentDeckStatus =
  | "diagnosing"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed";

export interface DeckIncident {
  incident_id: string;
  status: IncidentDeckStatus;
  thinking: string[];
  pending: PendingApproval | null;
}

export type ControlPlaneConnectionStatus =
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "ERROR";
