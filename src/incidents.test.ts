import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createIncident,
  getIncident,
  normalizeAlert,
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

test("incident store: create/get/status/patch transitions", () => {
  const result = normalizeAlert({ service_name: "postgres", target_host: "prod-db-01" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const incident = createIncident(result.alert);
  assert.equal(getIncident(incident.id)?.status, "diagnosing");

  setIncidentStatus(incident.id, "awaiting_approval");
  assert.equal(getIncident(incident.id)?.status, "awaiting_approval");

  patchIncident(incident.id, { proposedCommand: "systemctl status postgres" });
  assert.equal(getIncident(incident.id)?.proposedCommand, "systemctl status postgres");

  assert.equal(getIncident("missing"), undefined);
  assert.equal(setIncidentStatus("missing", "completed"), undefined);
});
