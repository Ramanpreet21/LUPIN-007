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

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) if (typeof obj[key] === "string") return obj[key];
  return undefined;
}

/** `host:port` / `[v6]:port` → host only; leaves bare hosts (incl. unbracketed IPv6) as-is. */
function stripInstancePort(instance: unknown): unknown {
  if (typeof instance !== "string") return instance;
  const bracketed = /^\[(.+)]:\d+$/.exec(instance);
  if (bracketed) return bracketed[1];
  return instance.replace(/^([^:]+):\d+$/, "$1");
}

/** Prometheus AlertManager webhook → one canonical alert per entry. */
function fromAlertManager(raw: unknown): Array<Record<string, unknown>> | null {
  const body = asRecord(raw);
  if (!body || !Array.isArray(body.alerts) || body.alerts.length === 0) return null;
  const mapped: Array<Record<string, unknown>> = [];
  for (const alertRaw of body.alerts) {
    const alert = asRecord(alertRaw);
    if (!alert) continue;
    const labels = asRecord(alert.labels) ?? {};
    const annotations = asRecord(alert.annotations) ?? {};
    const summary =
      typeof annotations.summary === "string"
        ? annotations.summary
        : typeof annotations.description === "string"
          ? annotations.description
          : undefined;
    mapped.push({
      target_host: stripInstancePort(pickString(labels, "instance")),
      service_name: pickString(labels, "service", "alertname"),
      severity: labels.severity,
      ...(typeof summary === "string" ? { alert_summary: summary } : {}),
    });
  }
  return mapped.length > 0 ? mapped : null;
}

/** PagerDuty v3 webhook (events v2 payload or incident payload) → canonical alert. */
function fromPagerDuty(raw: unknown): Record<string, unknown> | null {
  const body = asRecord(raw);
  if (!body) return null;
  const payload = asRecord(body.payload);
  if (payload && (payload.severity || payload.source || payload.summary)) {
    const service = asRecord(body.service);
    return {
      target_host: pickString(payload, "source"),
      service_name: pickString(service, "name", "summary"),
      severity: payload.severity,
      ...(typeof payload.summary === "string" ? { alert_summary: payload.summary } : {}),
    };
  }
  const data = asRecord(body.data);
  const incident = asRecord(data && data.incident);
  if (incident) {
    const service = asRecord(incident.service);
    const custom = asRecord(incident.custom_details);
    return {
      target_host: pickString(custom, "host", "target_host", "instance") ?? pickString(incident, "source", "host"),
      service_name: pickString(service, "name", "summary"),
      severity: incident.severity,
      ...(typeof incident.title === "string" ? { alert_summary: incident.title } : {}),
    };
  }
  return null;
}

/**
 * Accepts one or more alerts in the canonical shape, Prometheus AlertManager,
 * or PagerDuty v3. Returns one result per alert so a batch never silently
 * drops entries; anything unsupported yields a single rejected result.
 */
export function normalizeWebhooks(raw: unknown): AlertParseResult[] {
  const body = asRecord(raw);
  if (body && typeof body.service_name === "string" && typeof body.target_host === "string") {
    return [normalizeAlert(raw)];
  }
  const am = fromAlertManager(raw);
  if (am) return am.map((m) => normalizeAlert(m));
  const pager = fromPagerDuty(raw);
  if (pager) return [normalizeAlert(pager)];
  return [
    {
      ok: false,
      error: "invalid_alert",
      details: ["expected AlertManager, PagerDuty, or canonical (service_name+target_host) webhook shape"],
    },
  ];
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
  /** Every gated command, so an incident-level approval maps to what was shown. */
  proposedCommands?: string[];
  safetyBadges?: SafetyBadge[];
}

// In-memory store for PR #3; a durable store is a later PR.
const incidents = new Map<string, Incident>();

const TERMINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set([
  "completed",
  "failed",
  "rejected",
]);

/** TTL for resolved incidents. */
const INCIDENT_TTL_MS = 60 * 60 * 1000;

/**
 * ponytail: hard ceiling on the in-memory store. At capacity we evict resolved
 * (terminal) incidents first — their TrueForge session is complete or already
 * cancelled, so evicting them orphans nothing. If every held incident is still
 * live we refuse new ingestion rather than break an approval in flight or leave
 * a remote session unreachable (per-session cancellation needs the client and
 * is wired into the rejection path, not the store).
 */
export const INCIDENT_MAX = 1000;

export function createIncident(alert: NormalizedAlert): Incident | undefined {
  const now = Date.now();
  for (const [id, incident] of incidents) {
    // Expire resolved incidents past TTL; live ones are bounded by INCIDENT_MAX.
    if (
      TERMINAL_STATUSES.has(incident.status) &&
      now - Date.parse(incident.createdAt) > INCIDENT_TTL_MS
    ) {
      incidents.delete(id);
    }
  }
  // At capacity, make room with resolved entries first: a terminal incident's
  // session is done, so dropping it orphans nothing.
  if (incidents.size >= INCIDENT_MAX) {
    for (const [id, incident] of incidents) {
      if (TERMINAL_STATUSES.has(incident.status)) incidents.delete(id);
    }
    // All remaining entries are live → refuse instead of silently orphaning one.
    if (incidents.size >= INCIDENT_MAX) return undefined;
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
