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

const MAX_FIELD_LENGTH = {
  service_name: 128,
  target_host: 253,
  severity: 32,
  alert_summary: 500,
} as const;

/**
 * Collapse to a single line, strip control characters, and trim.
 * Alert fields are interpolated into a tool-enabled model prompt, so this
 * neutralizes multi-line instruction-style content. Single-line directives
 * can still appear — incidentMessage frames the alert block as UNTRUSTED
 * DATA, and the server-side approval gate is the real tool-execution control.
 */
function cleanField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? null : cleaned;
}

/** Validate and normalize the canonical webhook alert shape (blueprint PR #3). */
export function normalizeAlert(raw: unknown): AlertParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "invalid_alert", details: ["expected a JSON object"] };
  }
  const body = raw as Record<string, unknown>;
  const cleaned: Record<string, string> = {};
  for (const key of REQUIRED_ALERT_FIELDS) {
    const value = cleanField(body[key]);
    if (value === null) continue;
    // Identity fields must not be silently truncated: the agent would diagnose
    // or remediate a different host than the alert's real target.
    if (value.length > MAX_FIELD_LENGTH[key]) {
      return {
        ok: false,
        error: "invalid_alert",
        details: [`field '${key}' exceeds max length ${MAX_FIELD_LENGTH[key]}`],
      };
    }
    cleaned[key] = value;
  }
  const missing = REQUIRED_ALERT_FIELDS.filter((key) => !(key in cleaned));
  if (missing.length > 0) {
    return {
      ok: false,
      error: "invalid_alert",
      details: [`missing or empty required field(s): ${missing.join(", ")}`],
    };
  }
  // Free-text fields are safe to cap; identifiers are not (checked above).
  const severity = cleanField(body.severity)?.slice(0, MAX_FIELD_LENGTH.severity);
  const alertSummary = cleanField(body.alert_summary)?.slice(0, MAX_FIELD_LENGTH.alert_summary);
  return {
    ok: true,
    alert: {
      service_name: cleaned.service_name,
      target_host: cleaned.target_host,
      severity: severity ?? "warning",
      ...(alertSummary != null ? { alert_summary: alertSummary } : {}),
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
  createdAt: string;
  sessionId?: string;
  turnId?: string;
  threadId?: string;
  /** Full set of tool-call ids in the gate that halted the turn. */
  toolCallIds?: string[];
  /** First gate tool-call id (kept for display and single-call resume). */
  toolCallId?: string;
  proposedCommand?: string;
  safetyBadges?: SafetyBadge[];
}

// In-memory store for PR #3; a durable store is a later PR.
const incidents = new Map<string, Incident>();

/** Retention for incidents; any entry older than TTL is pruned on each create. */
const INCIDENT_TTL_MS = 60 * 60 * 1000;

export function createIncident(alert: NormalizedAlert): Incident {
  const now = Date.now();
  for (const [id, incident] of incidents) {
    // Expire ALL stale incidents, not just terminal ones: an incident left in
    // awaiting_approval (no operator response) would otherwise be retained
    // forever and the map would grow without bound. A late operator decision
    // on a pruned incident simply 404s on the approvals route.
    if (now - Date.parse(incident.createdAt) > INCIDENT_TTL_MS) {
      incidents.delete(id);
    }
  }
  const incident: Incident = {
    id: randomUUID(),
    alert,
    status: "diagnosing",
    createdAt: new Date(now).toISOString(),
  };
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
