# Getting Started with Incident Command Deck

This guide walks you through setting up the 007 Incident Command Deck, starting the simulated demo cluster, and diagnosing your first incident using the AI agent.

## Prerequisites

Ensure you have the following installed on your machine:

- Node.js ≥ 22.0.0 (`node --version`)
- Docker & Docker Compose (`docker compose version`)
- TrueForge server running locally or accessible via network (e.g. `http://localhost:8765`)

---

## Step 1: Install Dependencies and Build

Clone the repository and install all npm dependencies:

```bash
git clone https://github.com/Ramanpreet21/007.git
cd 007
npm install
npm run build
```

Verify that the build succeeds and generates files inside `dist/`.

---

## Step 2: Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and verify the settings:

```ini
PORT=3000
HOST=127.0.0.1
TRUEFORGE_BASE_URL=http://localhost:8765
TRUEFORGE_MODEL=anthropic/claude-sonnet-5
```

---

## Step 3: Start the Control Plane

Start the server in development mode with live compilation:

```bash
npm run dev
```

You will see output confirming the server has started:

```text
{"event":"server_start","host":"127.0.0.1","port":3000,"msg":"Ready at http://127.0.0.1:3000"}
```

In a separate terminal, verify the `/health` endpoint:

```bash
curl http://127.0.0.1:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "uptime": 2,
  "trueforge_ready": true,
  "incidents_active": 0,
  "incidents_total": 0
}
```

---

## Step 4: Start the Demo Lab Cluster

In another terminal, start the multi-node container fleet:

```bash
docker compose up -d
```

This starts:
- **`tf-prometheus`** (`:9090`): Metrics collection.
- **`tf-alertmanager`** (`:9093`): Alert routing engine configured to forward firing alerts to `http://host.docker.internal:3000/alerts`.
- **`tf-server`** (`:2222`): Target gateway node.
- **`tf-client1`** (`:2223`): Target Redis/DB node.
- **`tf-client2`** (`:2224`): Target Web node.
- **`tf-client3`** (`:2225`): Target API node.

Check container health:

```bash
docker compose ps
```

---

## Step 5: Send a Simulated Outage Alert

Trigger an incident on `client2` (Nginx service down):

```bash
curl -X POST http://127.0.0.1:3000/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "service_name": "nginx",
    "target_host": "client2",
    "severity": "critical",
    "alert_summary": "Nginx web server is down on port 80"
  }'
```

Response:

```json
{
  "status": "accepted",
  "incident_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "incident_ids": ["9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"]
}
```

---

## Step 6: Inspect Incident State & Approve Remediation

List active incidents:

```bash
curl http://127.0.0.1:3000/incidents
```

When the agent finishes diagnosing, the incident status will transition to `awaiting_approval`. Check the incident details:

```bash
curl http://127.0.0.1:3000/incidents?status=awaiting_approval
```

Approve the proposed remediation command:

```bash
curl -X POST http://127.0.0.1:3000/api/approvals \
  -H "Content-Type: application/json" \
  -d '{
    "incident_id": "YOUR_INCIDENT_ID",
    "decision": "approved"
  }'
```

The agent will execute the verified command, restart the service, and mark the incident status as `completed`.

---

## What You Built

You have now:
1. Deployed the 007 incident control plane.
2. Initialized an ephemeral multi-container target fleet with Prometheus telemetry.
3. Ingested an alert, watched the agent capture telemetry, evaluated AST safety guards, and gated remediation on human sign-off.

## Next Steps

- Consult the [API Reference](api-reference.md) for full REST and WebSocket schemas.
- Read [Safety and Policy](safety-and-policy.md) to customize regex rules.
- Review [Incident Response Runbook](runbooks/incident-response.md) for incident management operations.
