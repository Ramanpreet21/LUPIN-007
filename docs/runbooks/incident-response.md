# Runbook: Incident Response & Control Plane Operations

## What this covers

Procedures for operating the 007 Incident Command Deck during production outages, investigating stuck diagnostic sessions, evaluating pending approval gates, and executing emergency halts.

## Severity / Impact

- **SEV-1 (Critical)**: Production service outage; agent fails to diagnose or blocks on an approval gate.
- **SEV-2 (High)**: High system load, disk pressure, or runaway diagnostic session consuming host resources.

---

## 1. Triage & Incident Monitoring

### Step 1: Check Control Plane Health

Run a quick status probe:

```bash
curl -s http://127.0.0.1:3000/health
```

- If `trueforge_ready` is `false`, check network connectivity to TrueForge and ensure `TRUEFORGE_BASE_URL` is accessible.
- If the control plane is completely unresponsive, restart the service with `npm start`.

### Step 2: Review In-Flight Incidents

List active incidents requiring attention:

```bash
curl -s "http://127.0.0.1:3000/incidents?status=awaiting_approval"
```

---

## 2. Handling Approval Gates

When an incident enters `awaiting_approval`, inspect the proposed command and safety badges before taking action.

### Approving a Valid Remediation

If the proposed command is safe, idempotent, and matches the incident diagnosis:

```bash
curl -X POST http://127.0.0.1:3000/api/approvals \
  -H "Content-Type: application/json" \
  -d '{
    "incident_id": "<INCIDENT_UUID>",
    "decision": "approved"
  }'
```

### Rejecting an Unsafe Command

If the proposed command is high-risk, ambiguous, or incorrect:

```bash
curl -X POST http://127.0.0.1:3000/api/approvals \
  -H "Content-Type: application/json" \
  -d '{
    "incident_id": "<INCIDENT_UUID>",
    "decision": "rejected"
  }'
```

*Note: Rejecting a turn automatically cancels the underlying TrueForge session to prevent orphaned background tasks.*

---

## 3. Emergency Operations

### Emergency Stop (Halt All Incidents)

If runaway commands or multiple faulty diagnostic sessions threaten fleet stability, trigger an immediate global cancellation:

```bash
curl -X POST http://127.0.0.1:3000/api/emergency-stop
```

This immediately:
1. Cancels all active TrueForge sessions.
2. Transitions all in-flight incidents to `failed`.
3. Emits `execution_complete` events across the WebSocket stream.

### Switch to Dry-Run Mode

To prevent any command from executing while keeping simulation and diagnosis active:

```bash
curl -X PUT http://127.0.0.1:3000/api/policy/mode \
  -H "Content-Type: application/json" \
  -d '{ "mode": "DRY_RUN" }'
```

---

## 4. Verification

After applying remediation:

1. Query unit status on the target host:
   ```bash
   ssh root@<TARGET_HOST> "systemctl status <SERVICE_NAME>"
   ```
2. Verify Prometheus alert resolves (`@tf-prometheus:9090`).
3. Check the incident record status is `completed`:
   ```bash
   curl -s "http://127.0.0.1:3000/incidents?limit=1"
   ```

---

## 5. Escalation

If automated and guided remediation fails:
1. Page the secondary on-call SRE team.
2. Obtain direct SSH access to the target host.
3. Archive the diagnostic logs from the control plane (`/var/log/incident-agent.log` or console output).
