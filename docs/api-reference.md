# Incident Command Deck API Reference

Base URL: `http://127.0.0.1:3000` (or configured `$HOST:$PORT`)  
WebSocket: `ws://127.0.0.1:3000/ws`

---

## 1. Incidents & Ingestion

### `POST /alerts`

Ingests incoming alerts from Prometheus AlertManager, PagerDuty, or canonical JSON payloads.

**Request Formats**

**Canonical JSON Payload**:
```json
{
  "service_name": "nginx",
  "target_host": "server",
  "severity": "critical",
  "alert_summary": "Nginx process is unresponsive"
}
```

**Prometheus AlertManager Payload**:
```json
{
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "DiskSpaceCritical",
        "instance": "client1:9100",
        "severity": "critical"
      },
      "annotations": {
        "summary": "Disk usage is 96.8%"
      }
    }
  ]
}
```

**Response** `202 Accepted`
```json
{
  "status": "accepted",
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "incident_ids": ["3f82e564-9b21-4ec4-a15d-639f72b9a712"],
  "skipped": 0,
  "refused": 0,
  "resolved": 0
}
```

**Errors**
| Status | Code | Description |
|---|---|---|
| `400` | `invalid_alert` | Missing required fields (`service_name`, `target_host`). |
| `503` | `trueforge_unconfigured` | TrueForge client is not ready. |
| `503` | `incident_store_full` | In-memory incident capacity reached and no terminal items to evict. |

---

### `GET /incidents`

Retrieves a list of tracked incidents ordered newest first.

**Parameters**
| Name | Type | Required | Description |
|---|---|---|---|
| `status` | `string` | No | Filter by status: `diagnosing`, `awaiting_approval`, `approved`, `rejected`, `completed`, `failed`, or `resolved`. |
| `limit` | `number` | No | Maximum number of records to return (default: `50`). |

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
      "alert": {
        "service_name": "nginx",
        "target_host": "server",
        "severity": "critical",
        "alert_summary": "Nginx process is unresponsive"
      },
      "status": "awaiting_approval",
      "createdAt": "2026-08-31T12:00:00.000Z",
      "proposedCommand": "systemctl restart nginx",
      "proposedCommands": ["systemctl restart nginx"],
      "safetyBadges": [
        { "name": "destructive", "status": "pass" },
        { "name": "privilege-escalation", "status": "pass" },
        { "name": "eval", "status": "pass" }
      ]
    }
  ]
}
```

---

### `POST /api/approvals`

Submits human-in-the-loop decision for an incident halted at an approval gate.

**Request**
```json
{
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "decision": "approved"
}
```

| Field | Type | Required | Values |
|---|---|---|---|
| `incident_id` | `string` | Yes | UUID of the incident. |
| `decision` | `string` | Yes | `"approved"` or `"rejected"`. |

**Response** `200 OK`
```json
{ "status": "ok" }
```

**Errors**
| Status | Code | Description |
|---|---|---|
| `400` | `invalid_payload` | Malformed body or unknown decision value. |
| `404` | `unknown_incident` | Incident ID not found. |
| `409` | `not_awaiting_approval` | Incident is not currently waiting for approval. |
| `503` | `trueforge_unconfigured` | TrueForge client unavailable. |

---

### `POST /api/emergency-stop`

Cancels all in-flight incidents and terminates all active TrueForge sessions immediately.

**Response** `200 OK`
```json
{
  "status": "ok",
  "cancelled": 3
}
```

---

## 2. Policy & AST Governance

### `GET /api/policy/rules`

Lists all registered dynamic policy rules.

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "rule-rm-wildcard",
      "name": "Block wildcard / root deletion",
      "regex": "^rm\\s+.*(\\*|--no-preserve-root|/etc|/var|/usr)",
      "category": "DESTRUCTIVE_FS",
      "severity": "CRITICAL_BLOCK",
      "enabled": true
    }
  ]
}
```

---

### `POST /api/policy/simulate`

Simulates policy enforcement and parses a command into AST nodes.

**Request**
```json
{
  "command": "rm -rf /tmp/cache/* && systemctl restart nginx"
}
```

**Response** `200 OK`
```json
{
  "command": "rm -rf /tmp/cache/* && systemctl restart nginx",
  "riskScore": 85,
  "matchedRules": [
    {
      "id": "rule-rm-wildcard",
      "name": "Block wildcard / root deletion",
      "category": "DESTRUCTIVE_FS",
      "severity": "CRITICAL_BLOCK"
    }
  ],
  "nodes": [
    { "id": "node-root", "label": "Command", "kind": "rm", "risk": "low" },
    { "id": "node-1", "label": "Flag", "kind": "-rf", "risk": "high" },
    { "id": "node-2", "label": "Path", "kind": "/tmp/cache/*", "risk": "medium" }
  ],
  "trippedNode": "Flag: -rf"
}
```

---

## 3. Sandboxes & Settings

### `GET /api/sandboxes/probes`

Probes the status and availability of all sandbox execution runners.

**Response** `200 OK`
```json
{
  "activeProvider": "isolated-local",
  "probes": [
    { "type": "isolated-local", "available": true },
    { "type": "podman", "available": false, "error": "Podman socket not reachable" },
    { "type": "docker", "available": true },
    { "type": "daytona", "available": false, "error": "Daytona API key not configured" }
  ]
}
```

---

### `POST /api/sandboxes/exec`

Executes a command inside the active sandbox environment.

**Request**
```json
{
  "command": "echo 'testing sandbox isolation'",
  "timeoutMs": 5000
}
```

**Response** `200 OK`
```json
{
  "exitCode": 0,
  "stdout": "testing sandbox isolation\n",
  "stderr": "",
  "durationMs": 14
}
```

---

## 4. WebSocket Event Stream (`/ws`)

Connect to `ws://127.0.0.1:3000/ws` to receive live JSON envelopes.

### Event Envelope Catalog

#### `incident_created`
Emitted when a new incident is ingested.
```json
{
  "type": "incident_created",
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "payload": { "diagnosis": null }
}
```

#### `agent_thinking`
Emitted during AI diagnostic stream.
```json
{
  "type": "agent_thinking",
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "payload": {
    "content": "Checking nginx error logs and socket bindings...",
    "step": 1
  }
}
```

#### `pending_approval`
Emitted when the turn halts at an approval gate.
```json
{
  "type": "pending_approval",
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "payload": {
    "proposed_command": "systemctl restart nginx",
    "proposed_commands": ["systemctl restart nginx"],
    "safety_badges": [
      { "name": "destructive", "status": "pass" },
      { "name": "privilege-escalation", "status": "pass" },
      { "name": "eval", "status": "pass" }
    ],
    "diff": "+ systemctl restart nginx",
    "scope": [
      {
        "command": "systemctl restart nginx",
        "executable": "systemctl",
        "subcommand": "restart",
        "files": ["/etc/nginx/nginx.conf", "/etc/systemd/system/nginx.service"],
        "sockets": ["tcp/80", "tcp/443"],
        "services": ["nginx"],
        "ports": ["80", "443"],
        "riskLevel": "medium",
        "impactSummary": "Mutates state of service nginx (restart)"
      }
    ]
  }
}
```

#### `execution_complete`
Emitted when an incident concludes.
```json
{
  "type": "execution_complete",
  "incident_id": "3f82e564-9b21-4ec4-a15d-639f72b9a712",
  "payload": { "status": "success" }
}
```

---

## 5. Model Context Protocol (MCP) Server (`POST /mcp`)

Read-only JSON-RPC tool provider conforming to MCP protocol version `2025-03-26`.

### `tools/list`
Returns available inspection tools:
- `system_snapshot`: Full composite host snapshot.
- `process_tree`: Formatted `ps aux --forest`.
- `net_connections`: Active sockets via `ss -tulnp`.
- `service_status`: Unit status (`systemctl status <service>`).
- `journal_logs`: Unit logs (`journalctl -u <unit> -n <lines>`).
- `file_read`: Reads configuration under `/etc/nginx/`, `/opt/`, `/usr/local/etc/`.
- `dns_lookup`: Resolves hostname via `getent hosts <hostname>`.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "service_status",
    "arguments": { "service": "nginx" }
  }
}
```

**Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "● nginx.service - Nginx HTTP Server\n   Active: active (running)..." }
    ]
  }
}
```
