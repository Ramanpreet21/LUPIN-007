<div align="center">

# 🕵️‍♂️ 007 — Incident Command Deck (LUPIN)

**Deterministic Autonomous Incident Response & Safe SRE Control Plane**

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Node: >=22](https://img.shields.io/badge/Node.js->=22.0.0-green.svg)](package.json)
[![Architecture: TrueForge](https://img.shields.io/badge/Orchestrator-TrueForge-orange.svg)](https://www.truefoundry.com/)
[![Safety: AST Verified](https://img.shields.io/badge/Safety-AST_Sandboxed-red.svg)](docs/safety-and-policy.md)

</div>

---

## Overview

**007 (Incident Command Deck)** is an autonomous SRE control plane and incident responder. When production alerts fire, the system captures live target state, performs root-cause analysis via an LLM agent, isolates remediation scripts in ephemeral sandboxes, and verifies every proposed shell command through Abstract Syntax Tree (AST) policy checks before requiring explicit human approval.

---

## Key Features

- **Multi-Source Ingestion**: Normalizes alerts from Prometheus AlertManager, PagerDuty (v2/v3), and direct JSON webhooks.
- **Pre-Diagnostic Telemetry Capture**: Collects live process trees, listening sockets, and service states (`ps aux --forest`, `ss -tulnp`, `systemctl status`) before starting the session.
- **Local Read-Only MCP Provider**: Embeds a JSON-RPC Model Context Protocol (MCP) server exposing safe inspection tools (`system_snapshot`, `journal_logs`, `file_read`, etc.).
- **Deterministic AST Safety Guardrails**: Quotes and tokenizes shell commands, extracts nested subshells (`$(...)`), matches regex security rules, and calculates blast-radius impact (affected files, ports, services).
- **Three Enforcement Modes**:
  - `STRICT_GATED`: Default human-in-the-loop approval gate.
  - `AUTONOMOUS`: Evaluates safety rules and auto-approves safe actions.
  - `DRY_RUN`: Simulates and logs actions, auto-denying real execution.
- **Multi-Runtime Sandboxing**: Supports isolated local subprocesses, Docker, Podman, and Daytona cloud workspaces.
- **Embedded Persistence**: Lightweight SQLite backend (WAL mode) tracking incidents, policy rules, sessions, and fleet hosts.
- **Real-Time WebSocket Stream**: Emits live `agent_thinking`, `pending_approval`, and `execution_complete` events to the UI.

---

## Architecture Diagram

```
                 POST /alerts
[Monitoring] ───────────────────► [ Alert Normalizer ]
(Prometheus/PD)                          │
                                         ▼
                                [ Incident SQLite DB ]
                                         │
                                         ▼
                              [ Host State Capture ] ── (ps / ss / systemctl)
                                         │
                                         ▼
                             [ TrueForge Session Stream ]
                                   │            ▲
         (local read-only tools)   ▼            │ (JSON-RPC)
                            [ Local MCP Server ]
                                   │
                                   ▼
                         [ AST Policy Evaluator ]
                                   │
                       ┌───────────┴───────────┐
                       ▼                       ▼
            [ Gated: pending_approval ]   [ Safety Badges & Scope ]
                       │
                       ▼ (POST /api/approvals)
              [ Operator Decision ]
```

---

## Quick Start

### Prerequisites

- **Node.js**: `>=22.0.0`
- **Container Engine** *(optional, for local demo lab)*: Docker / Podman
- **TrueForge**: Local harness server running (default: `http://localhost:8765`)

### 1. Setup & Installation

```bash
git clone https://github.com/Ramanpreet21/007.git
cd 007
npm install
cp .env.example .env
```

### 2. Build & Launch Backend

```bash
# Development mode (Hot Reload)
npm run dev

# Or Production build & run
npm run build
npm start
```

### 3. Launch Dashboard UI (Optional)

```bash
cd dashboard
pnpm install
pnpm run dev
```

---

## In-Depth Documentation (`docs/`)

- 📐 **[Architecture Overview](docs/architecture.md)**: Deep dive into topology, sequence diagrams, and module responsibilities.
- 🚀 **[Getting Started Guide](docs/getting-started.md)**: Step-by-step tutorial using the included Docker Compose cluster.
- 📖 **[API Reference](docs/api-reference.md)**: Exhaustive REST endpoints, WebSocket schemas, and JSON-RPC tool specifications.
- 🛡️ **[Safety & Policy Governance](docs/safety-and-policy.md)**: AST parsing mechanics, risk scoring, and rule configurations.
- 📋 **[Incident Response Runbook](docs/runbooks/incident-response.md)**: Emergency operations, triage, and approval gate workflows.
- 🏛️ **[ADR 0001: Safety & MCP Architecture](docs/adr/0001-two-tier-safety-and-local-mcp.md)**: Architectural decisions and trade-offs.

---

## Environment Variables

| Variable | Type | Default | Description |
|---|---|---|---|
| `PORT` | number | `3000` | HTTP and WebSocket server port |
| `HOST` | string | `127.0.0.1` | Network bind interface (`0.0.0.0` for all) |
| `LOG_LEVEL` | string | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `TRUEFORGE_BASE_URL` | string | `http://localhost:8765` | Base URL of TrueForge harness server |
| `TRUEFORGE_TOKEN` | string | `""` | Optional bearer token for TrueForge |
| `TRUEFORGE_MODEL` | string | `anthropic/claude-sonnet-5` | Model identifier (`provider/model`) |
| `CONTROL_PLANE_URL` | string | `""` | Externally reachable URL for MCP callbacks |
| `CONTROL_PLANE_API_TOKEN` | string | `""` | Bearer token for mutating settings APIs |

---

## Testing & Quality Assurance

```bash
# Run backend test suite
npm test

# Type-check TypeScript code
npm run typecheck

# Run end-to-end smoke tests
npm run smoke
```

---

## License

ISC
