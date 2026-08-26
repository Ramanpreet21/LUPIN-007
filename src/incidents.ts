import { randomUUID } from "node:crypto";

export interface NormalizedAlert {
  service_name: string;
  target_host: string;
  severity: string;
  alert_summary?: string;
}

export type AlertParseResult =
  | { ok: true; alert: NormalizedAlert }
  | { ok: false; error: string; details: string[] };

const REQUIRED_ALERT_FIELDS = ["service_name", "target_host"] as const;

/** Validate and normalize the canonical webhook alert shape (blueprint PR #3). */
export function normalizeAlert(raw: unknown): AlertParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "invalid_alert", details: ["expected a JSON object"] };
  }
  const body = raw as Record<string, unknown>;
  const missing = REQUIRED_ALERT_FIELDS.filter(
    (key) => typeof body[key] !== "string" || body[key] === "",
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: "invalid_alert",
      details: [`missing or empty required field(s): ${missing.join(", ")}`],
    };
  }
  return {
    ok: true,
    alert: {
      service_name: body.service_name as string,
      target_host: body.target_host as string,
      severity:
        typeof body.severity === "string" && body.severity !== "" ? body.severity : "warning",
      ...(typeof body.alert_summary === "string" && body.alert_summary !== ""
        ? { alert_summary: body.alert_summary }
        : {}),
    },
  };
}

export type IncidentStatus =
  | "diagnosing"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "failed";

export interface SafetyBadge {
  name: string;
  status: "pass" | "fail";
}

export interface Incident {
  id: string;
  alert: NormalizedAlert;
  status: IncidentStatus;
  sessionId?: string;
  turnId?: string;
  threadId?: string;
  toolCallId?: string;
  proposedCommand?: string;
  safetyBadges?: SafetyBadge[];
}

// In-memory store for PR #3; a durable store is a later PR.
const incidents = new Map<string, Incident>();

export function createIncident(alert: NormalizedAlert): Incident {
  const incident: Incident = { id: randomUUID(), alert, status: "diagnosing" };
  incidents.set(incident.id, incident);
  return incident;
}

export function getIncident(id: string): Incident | undefined {
  return incidents.get(id);
}

export function setIncidentStatus(
  id: string,
  status: IncidentStatus,
): Incident | undefined {
  const incident = incidents.get(id);
  if (incident) incident.status = status;
  return incident;
}

export function patchIncident(
  id: string,
  patch: Partial<Omit<Incident, "id" | "alert">>,
): Incident | undefined {
  const incident = incidents.get(id);
  if (!incident) return undefined;
  Object.assign(incident, patch);
  return incident;
}
