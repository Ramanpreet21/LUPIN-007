import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIncident,
  getIncident,
  INCIDENT_MAX,
  normalizeAlert,
  normalizeWebhooks,
  patchIncident,
  setIncidentStatus,
} from "./incidents";

test("normalizeAlert accepts a canonical alert with defaults", () => {
  const result = normalizeAlert({ service_name: "postgres", target_host: "prod-db-01" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alert.service_name, "postgres");
  assert.equal(result.alert.target_host, "prod-db-01");
  assert.equal(result.alert.severity, "warning");
  assert.equal(result.alert.alert_summary, undefined);
});

test("normalizeAlert keeps explicit severity and summary", () => {
  const result = normalizeAlert({
    service_name: "postgres",
    target_host: "prod-db-01",
    severity: "critical",
    alert_summary: "CPU > 80%",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.alert.severity, "critical");
  assert.equal(result.alert.alert_summary, "CPU > 80%");
});

test("normalizeAlert rejects missing required fields", () => {
  const result = normalizeAlert({ target_host: "prod-db-01" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.details[0], /service_name/);
});

test("normalizeAlert rejects non-object payloads", () => {
  assert.equal(normalizeAlert("x").ok, false);
  assert.equal(normalizeAlert(null).ok, false);
  assert.equal(normalizeAlert([1]).ok, false);
});

test("normalizeAlert rejects overlong required identifiers instead of truncating", () => {
  const longHost = "h".repeat(254); // > 253 cap for target_host
  const result = normalizeAlert({ service_name: "postgres", target_host: longHost });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.details[0], /target_host/);
  assert.match(result.details[0], /exceeds max length/);
});

test("normalizeAlert caps free-text summary but never truncates identifiers", () => {
  const result = normalizeAlert({
    service_name: "postgres",
    target_host: "prod-db-01",
    alert_summary: "x".repeat(600),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.alert.alert_summary);
  assert.equal(result.alert.alert_summary.length, 500);
});

test("incident store: create/get/status/patch transitions", () => {
  const result = normalizeAlert({ service_name: "postgres", target_host: "prod-db-01" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const incident = createIncident(result.alert);

  assert.ok(incident); // store not at cap yet — creation must not have been refused
  assert.equal(getIncident(incident.id)?.status, "diagnosing");

  setIncidentStatus(incident.id, "awaiting_approval");
  assert.equal(getIncident(incident.id)?.status, "awaiting_approval");

  patchIncident(incident.id, { proposedCommand: "systemctl status postgres" });
  assert.equal(getIncident(incident.id)?.proposedCommand, "systemctl status postgres");

  assert.equal(getIncident("missing"), undefined);
  assert.equal(setIncidentStatus("missing", "completed"), undefined);
});

test("TTL sweep expires resolved incidents only; live ones are retained", () => {
  const resolved = createIncident({
    service_name: "postgres",
    target_host: "prod-db-01",
    severity: "warning",
  });
  assert.ok(resolved);
  patchIncident(resolved.id, {
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  });
  setIncidentStatus(resolved.id, "completed");

  const live = createIncident({
    service_name: "mysql",
    target_host: "db-02",
    severity: "warning",
  });
  assert.ok(live);
  // Backdated and awaiting approval: retained, since only the cap evicts it.
  patchIncident(live.id, {
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  });
  setIncidentStatus(live.id, "awaiting_approval");

  createIncident({ service_name: "redis", target_host: "cache-01", severity: "warning" });

  assert.equal(getIncident(resolved.id), undefined); // terminal + stale → pruned
  assert.ok(getIncident(live.id)); // awaiting_approval → kept until the cap
});

test("normalizeWebhooks maps Prometheus AlertManager payloads", () => {
  const results = normalizeWebhooks({
    alerts: [
      {
        labels: { alertname: "HighCPU", instance: "prod-db-01:9100", severity: "critical" },
        annotations: { summary: "prod-db-01 CPU > 80% for 5m", description: "full description" },
      },
    ],
  });
  assert.equal(results.length, 1);
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "HighCPU");
  assert.equal(parsed.alert.target_host, "prod-db-01"); // :port stripped
  assert.equal(parsed.alert.severity, "critical");
  assert.equal(parsed.alert.alert_summary, "prod-db-01 CPU > 80% for 5m"); // summary wins over description
});

test("normalizeWebhooks keeps every alert in a batch", () => {
  const results = normalizeWebhooks({
    alerts: [
      { labels: { alertname: "HighCPU", instance: "prod-db-01:9100", severity: "critical" } },
      { labels: { alertname: "LowDisk", instance: "db-02", severity: "warning" } },
    ],
  });
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.flatMap((r) => (r.ok ? [r.alert.target_host] : [])),
    ["prod-db-01", "db-02"],
  );
});

test("normalizeWebhooks flags malformed AlertManager batch members", () => {
  const results = normalizeWebhooks({
    alerts: [
      "not-an-object",
      { labels: { alertname: "LowDisk", instance: "db-02", severity: "warning" } },
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].ok, false);
  if (!results[0].ok) assert.match(results[0].details[0], /not an object/);
  assert.equal(results[1].ok, true);
});

test("normalizeWebhooks strips IPv6 host:port instances", () => {
  const results = normalizeWebhooks({
    alerts: [{ labels: { alertname: "V6Down", instance: "[2001:db8::1]:9100", severity: "critical" } }],
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.target_host, "2001:db8::1");
});

test("normalizeWebhooks maps standard PagerDuty events-v2 payloads via payload.component", () => {
  // Events API v2 carries no top-level `service`; service_name must come from
  // the standard payload.component / payload.group fallback or be rejected.
  const results = normalizeWebhooks({
    payload: {
      source: "db-02.internal",
      severity: "error",
      summary: "Postgres down",
      component: "postgres",
    },
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "postgres");
  assert.equal(parsed.alert.target_host, "db-02.internal");
  assert.equal(parsed.alert.severity, "error");
  assert.equal(parsed.alert.alert_summary, "Postgres down");
});

test("normalizeWebhooks prefers a legacy top-level PagerDuty service object over payload.component", () => {
  const results = normalizeWebhooks({
    payload: {
      source: "db-02.internal",
      severity: "error",
      summary: "Postgres down",
      component: "other-svc",
    },
    service: { name: "postgres", summary: "Postgres cluster" },
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "postgres");
});

test("normalizeWebhooks falls back to payload.group when component is absent", () => {
  const results = normalizeWebhooks({
    payload: { source: "db-02.internal", severity: "error", summary: "Postgres down", group: "pg-prod" },
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "pg-prod");
});

test("normalizeWebhooks maps PagerDuty incident webhooks via custom_details.host", () => {
  const results = normalizeWebhooks({
    event: "incident.triggered",
    data: {
      incident: {
        title: "Node flapping",
        severity: "warning",
        service: { name: "nginx-edge", summary: "nginx edge" },
        custom_details: { host: "lb-01" },
      },
    },
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "nginx-edge");
  assert.equal(parsed.alert.target_host, "lb-01");
  assert.equal(parsed.alert.severity, "warning");
  assert.equal(parsed.alert.alert_summary, "Node flapping");
});

test("normalizeWebhooks maps PagerDuty v3 webhooks via the top-level event object", () => {
  // PagerDuty's documented webhook v3 envelope: the incident resource lives at
  // event.data, and event.event_type names the incident lifecycle event.
  const results = normalizeWebhooks({
    account: "PagerDuty Account",
    event: {
      id: "b1e63870-5f46-11e8-8f45-9d78e8227d0f",
      event_type: "incident.triggered",
      resource_type: "incident",
      occurred_at: "2023-05-12T11:15:34.000-04:00",
      data: {
        id: "P13DTTX",
        incident_number: 123,
        title: "The server is on fire",
        severity: "critical",
        status: "triggered",
        urgency: "high",
        created_at: "2023-05-12T11:15:34.000-04:00",
        service: {
          id: "PXP42J4",
          type: "service_reference",
          summary: "Production Database",
          self: "https://api.pagerduty.com/services/PXP42J4",
        },
        custom_details: { host: "db-primary-01" },
      },
    },
    occurred_at: "2023-05-12T11:15:34.000-04:00",
  });
  const parsed = results[0];
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.alert.service_name, "Production Database");
  assert.equal(parsed.alert.target_host, "db-primary-01");
  assert.equal(parsed.alert.severity, "critical");
  assert.equal(parsed.alert.alert_summary, "The server is on fire");
});

test("normalizeWebhooks rejects PagerDuty payloads without a host", () => {
  const results = normalizeWebhooks({ payload: { severity: "warning", summary: "no source" } });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  if (results[0].ok) return;
  assert.match(results[0].details[0], /target_host/);
});

test("normalizeWebhooks rejects unsupported envelopes", () => {
  const results = normalizeWebhooks({ hello: "world" });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  if (results[0].ok) return;
  assert.match(results[0].details[0], /AlertManager|PagerDuty/);
});

// Keep this test last: it fills the in-memory store to INCIDENT_MAX.
test("cap eviction refuses rather than evicting a live incident", () => {
  // Fill the store with live incidents; at the cap, creation is refused instead
  // of silently orphaning a live TrueForge session.
  const liveIds: string[] = [];
  while (true) {
    const incident = createIncident({
      service_name: "svc",
      target_host: `host-${liveIds.length}`,
      severity: "warning",
    });
    if (!incident) break; // refused → every held incident is live
    setIncidentStatus(incident.id, "awaiting_approval");
    liveIds.push(incident.id);
    // Tripwire: if cap logic ever silently evicts a live entry, this fails.
    assert.ok(liveIds.length <= INCIDENT_MAX);
  }
  assert.ok(liveIds.length > 0);
  assert.ok(liveIds.length <= INCIDENT_MAX);
  // No live incident was evicted to make room for later ones.
  assert.ok(liveIds.every((id) => getIncident(id)));
});

