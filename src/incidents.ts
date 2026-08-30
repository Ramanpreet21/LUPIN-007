import { randomUUID } from "node:crypto";

export interface NormalizedAlert {
  service_name: string;
  target_host: string;
  severity: string;
  alert_summary?: string;
}

export type AlertParseResult =
  | { ok: true; alert: NormalizedAlert }
  | { ok: false; error: string; details: string[]; resolved?: boolean };

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

/** Prometheus AlertManager webhook → one entry per alert. Firing alerts carry
 * the canonical shape; resolved notifications carry {status:"resolved"} so the
 * caller skips incident creation; malformed members are null. The per-alert
 * `status` wins, with the group-level status as fallback — a resolved group is
 * never re-diagnosed as a fresh incident. */
function fromAlertManager(
  raw: unknown,
):
  | Array<
      | { status: "firing"; alert: Record<string, unknown> }
      | { status: "resolved" }
      | null
    >
  | null {
  const body = asRecord(raw);
  if (!body || !Array.isArray(body.alerts) || body.alerts.length === 0) return null;
  // One entry per supplied alert — null for a malformed member — so the
  // one-result-per-alert contract (and the route's `skipped` count) holds.
  return body.alerts.map((alertRaw) => {
    const alert = asRecord(alertRaw);
    if (!alert) return null;
    // Per-alert `status` is authoritative: an explicitly-firing member stays
    // active even inside a resolved group; only members that say resolved (or
    // omit a status under a resolved group) become no-ops.
    if (alert.status === "resolved" || (alert.status !== "firing" && body.status === "resolved")) {
      return { status: "resolved" };
    }
    const labels = asRecord(alert.labels) ?? {};
    const annotations = asRecord(alert.annotations) ?? {};
    const summary =
      typeof annotations.summary === "string"
        ? annotations.summary
        : typeof annotations.description === "string"
          ? annotations.description
          : undefined;
    return {
      status: "firing",
      alert: {
        target_host: stripInstancePort(pickString(labels, "instance")),
        service_name: pickString(labels, "service", "alertname"),
        severity: labels.severity,
        ...(typeof summary === "string" ? { alert_summary: summary } : {}),
      },
    };
  });
}

/** PagerDuty webhook — Events API v2 payload, or v3 webhook incident payload → canonical alert.
 * Resolved lifecycle events map to { resolved: true } so the caller skips incident creation. */
function fromPagerDuty(
  raw: unknown,
):
  | { alert: Record<string, unknown> }
  | { resolved: true }
  | null {
  const body = asRecord(raw);
  if (!body) return null;
  const payload = asRecord(body.payload);
  if (payload && (payload.severity || payload.source || payload.summary)) {
    if (body.event_action === "resolve") return { resolved: true };
    const service = asRecord(body.service);
    return {
      alert: {
        target_host: pickString(payload, "source"),
        // Standard Events API v2 carries no top-level `service` object; component /
        // group under `payload` are the standard service-name proxies. A legacy
        // top-level `service` object still wins when one is present.
        service_name:
          pickString(service, "name", "summary") ?? pickString(payload, "component", "group"),
        severity: payload.severity,
        ...(typeof payload.summary === "string" ? { alert_summary: payload.summary } : {}),
      },
    };
  }
  // PagerDuty webhooks v3 unwrap through a top-level `event` object whose data
  // is the incident resource itself; the legacy shape nests it under data.incident
  // with a bare `event` string sibling. Support both.
  const event = asRecord(body.event);
  // The legacy envelope encodes the lifecycle event as a bare top-level string
  // (event: "incident.resolved" with data.incident nested); the v3 object form
  // carries event.event_type. Resolution must be recognized from either.
  const eventType =
    (event && typeof event.event_type === "string" ? event.event_type : undefined) ??
    (typeof body.event === "string" ? body.event : undefined);
  const data = (event && eventType ? asRecord(event.data) : null) ?? asRecord(body.data);
  const incident = asRecord(data && data.incident) ?? data;
  if (incident) {
    // Resolution lifecycle events must not spawn diagnosis: a resolved incident
    // (v3 event_type incident.resolved, a resolved incident resource — incl. the
    // legacy shape) is acknowledged, never re-diagnosed as a fresh incident.
    if (eventType === "incident.resolved" || incident.status === "resolved") {
      return { resolved: true };
    }
    const service = asRecord(incident.service);
    const custom = asRecord(incident.custom_details);
    return {
      alert: {
        target_host: pickString(custom, "host", "target_host", "instance") ?? pickString(incident, "source", "host"),
        service_name: pickString(service, "name", "summary"),
        severity: incident.severity,
        ...(typeof incident.title === "string" ? { alert_summary: incident.title } : {}),
      },
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
  if (am) {
    return am.map((entry) => {
      if (!entry) {
        return {
          ok: false,
          error: "invalid_alert",
          details: ["AlertManager batch entry is not an object"],
        };
      }
      if (entry.status === "resolved") {
        return { ok: false, error: "resolved_alert", details: [], resolved: true };
      }
      return normalizeAlert(entry.alert);
    });
  }
  const pager = fromPagerDuty(raw);
  if (pager) {
    if ("resolved" in pager) {
      return [{ ok: false, error: "resolved_alert", details: [], resolved: true }];
    }
    return [normalizeAlert(pager.alert)];
  }
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

export const TERMINAL_STATUSES: ReadonlySet<IncidentStatus> = new Set([
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
  if (incidents.size >= INCIDENT_MAX) {
    // At capacity, evict only the OLDEST terminal incidents, oldest first, and
    // stop as soon as one slot is free: a terminal incident's session is done so
    // dropping it orphans nothing, but the newer terminal history (below TTL) is
    // still worth keeping rather than wiping every terminal at once.
    const terminal = [...incidents.values()]
      .filter((i) => TERMINAL_STATUSES.has(i.status))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const incident of terminal) {
      if (incidents.size < INCIDENT_MAX) break;
      incidents.delete(incident.id);
    }
    // No terminal entries left to evict → refuse instead of silently orphaning a
    // live incident (its session is still running and needs its client to cancel it).
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

export function getIncidentStats(): { active: number; total: number } {
  let active = 0;
  for (const incident of incidents.values()) {
    if (!TERMINAL_STATUSES.has(incident.status)) active += 1;
  }
  return { active, total: incidents.size };
}

/**
 * Read-only view of the incident store, newest first. The archive's `resolved`
 * filter is the set of terminal statuses: the store has no literal `resolved`
 * state, so listIncidents maps `status: "resolved"` to the terminal set
 * (completed | failed | rejected) instead of a dead-exact match.
 */
export function listIncidents(options?: {
  status?: IncidentStatus | "resolved";
  limit?: number;
}): Incident[] {
  const { status, limit } = options ?? {};
  const all = [...incidents.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const rows =
    status === "resolved"
      ? all.filter((incident) => TERMINAL_STATUSES.has(incident.status))
      : status
        ? all.filter((incident) => incident.status === status)
        : all;
  return limit !== undefined && Number.isInteger(limit) && limit >= 0
    ? rows.slice(0, limit)
    : rows;
}
