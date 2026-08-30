#!/usr/bin/env bash
# 007 — Incident Command Deck
# Demo Opening Script
# Shows system architecture, running services, and feature overview
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# ANSI colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

section() {
  echo; echo -e "${BOLD}${BLUE}━━━ $1 ━━━${RESET}"
}
pass() { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET} $1"; }
info() { echo -e "  ${CYAN}→${RESET} $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }

header() {
  clear
  echo -e "${BOLD}"
  echo "  ███████╗██╗     ██╗ █████╗ ██████╗  ██████╗ ███████╗████████╗"
  echo "  ██╔════╝██║     ██║██╔══██╗██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝"
  echo "  ███████╗██║     ██║███████║██████╔╝██║  ███╗█████╗     ██║"
  echo "  ╚════██║██║     ██║██╔══██║██╔══██╗██║   ██║██╔══╝     ██║"
  echo "  ███████║███████╗██║██║  ██║██║  ██║╚██████╔╝███████╗   ██║"
  echo "  ╚══════╝╚══════╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝   ╚═╝"
  echo -e "${RESET}"
  echo -e "  ${BOLD}INCIDENT COMMAND DECK${RESET}  —  The Post-Mortem Sandbox Engine"
  echo
  echo "  An agentic SRE assistant that captures live system state, replicates"
  echo "  it in an isolated sandbox, runs diagnostic experiments in isolation,"
  echo "  and gates production execution behind human approval."
  echo
}

# ── 1. Architecture Overview ──────────────────────────────────────────────────
header
section "SYSTEM ARCHITECTURE"
echo
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │                      OPERATOR CONSOLE                       │"
echo "  │         React 19 + Tailwind CSS + Framer Motion            │"
echo "  │              Luminous Obsidian glass UI                     │"
echo "  │                  Port 3000 (Vite dev)                      │"
echo "  └────────────────────────┬────────────────────────────────────┘"
echo "                            │ HTTP + WebSocket"
echo "                            ▼"
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │                      CONTROL PLANE                          │"
echo "  │         Node.js + Express + SQLite + WebSocket             │"
echo "  │              Port 3001  (incident-plane.ts)                │"
echo "  │                                                             │"
echo "  │  • Alert webhook ingestion (AlertManager, PagerDuty)        │"
echo "  │  • Incident state machine + TTL eviction                    │"
echo "  │  • TrueForge session orchestration                          │"
echo "  │  • AST policy safety gating                                │"
echo "  │  • Daytona sandbox provider config                          │"
echo "  │  • Fleet SSH/Podman connectivity                           │"
echo "  └────────────────────────┬────────────────────────────────────┘"
echo "                            │ MCP / API"
echo "                            ▼"
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │                     TRUEFORGE AGENT                         │"
echo "  │              Port 8790  (truefoundry-sdk)                   │"
echo "  │                                                             │"
echo "  │  • Autonomous diagnostic reasoning                          │"
echo "  │  • Tool routing + policy enforcement                        │"
echo "  │  • Multi-turn session threads                              │"
echo "  └─────────────────────────────────────────────────────────────┘"
echo
echo "  ┌─────────────────────────────────────────────────────────────┐"
echo "  │                    TARGET FLEET (Docker Compose)            │"
echo "  │                                                             │"
echo "  │  prometheus:9090    — Metrics collection                    │"
echo "  │  alertmanager:9093  — Alert routing                         │"
echo "  │  tf-server:22      — SSH port 2222  (nginx, redis, mysql) │"
echo "  │  tf-client1:22     — SSH port 2223  (nginx, redis)        │"
echo "  │  tf-client2:22     — SSH port 2224  (apache2, php-fpm)    │"
echo "  │  tf-client3:22     — SSH port 2225  (python, flask, go)   │"
echo "  │  tf-attacker:22    — SSH port 2226  (nmap, pwntools)     │"
echo "  └─────────────────────────────────────────────────────────────┘"
echo

# ── 2. Running Services Check ───────────────────────────────────────────────
section "SERVICE STATUS"
echo

check_port() {
  local host=$1 port=$2 name=$3
  if timeout 1 bash -c ">/dev/tcp/$host/$port" 2>/dev/null; then
    pass "${name} — reachable at ${host}:${port}"
    return 0
  else
    fail "${name} — NOT reachable at ${host}:${port}"
    return 1
  fi
}

check_http() {
  local url=$1 name=$2
  local code
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^[2-3] ]]; then
    pass "${name} — HTTP $code at $url"
    return 0
  else
    fail "${name} — HTTP $code at $url"
    return 1
  fi
}

check_http "http://localhost:3000" "Dashboard (Vite)"           || true
check_http "http://localhost:3001/health" "Control Plane"        || true
check_http "http://localhost:3001/incidents" "Incidents API"    || true
check_port "localhost" "8790" "TrueForge Agent"                  || true
check_http "http://localhost:9090/-/healthy" "Prometheus"       || true
check_http "http://localhost:9093/-/healthy" "Alertmanager"    || true

echo

# ── 3. Control Plane Health ──────────────────────────────────────────────────
section "CONTROL PLANE HEALTH"
cp_health=$(curl -sS --max-time 3 "http://localhost:3001/health" 2>/dev/null || echo "{}")
echo "  Health payload:"
echo "  $cp_health" | python3 -m json.tool 2>/dev/null | sed 's/^/  /' || echo "  $cp_health"
echo

# ── 4. Incident Stats ───────────────────────────────────────────────────────
section "INCIDENT STATS"
incidents_json=$(curl -sS --max-time 3 "http://localhost:3001/incidents" 2>/dev/null || echo "{}")
total=$(echo "$incidents_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "?")
echo "  Total incidents in DB: $total"
echo

# ── 5. Key Features ──────────────────────────────────────────────────────────
section "KEY CAPABILITIES"
echo
echo "  ${BOLD}1. Alert Ingestion${RESET}"
echo "     POST /alerts accepts AlertManager, PagerDuty v2/v3, and JSON."
echo "     Alerts create incidents and spin up a TrueForge diagnostic session."
echo
echo "  ${BOLD}2. Sandbox Replication${RESET}"
echo "     Captures live system state (process tree, net connections,"
echo "     service status) and replicates it in an isolated Daytona sandbox."
echo
echo "  ${BOLD}3. AST Policy Gating${RESET}"
echo "     Commands are parsed into AST before execution. Safety rules"
echo "     can block, warn, or require approval for high-risk operations."
echo
echo "  ${BOLD}4. Human-in-the-Loop Approval${RESET}"
echo "     Pending approvals broadcast over WebSocket. Operator can"
echo "     Approve or Reject from the Incident Deck UI."
echo
echo "  ${BOLD}5. Live Telemetry Deck${RESET}"
echo "     Real-time fleet metrics from node-exporter sidecars"
echo "     (CPU, memory, filesystem, load, network)."
echo
echo "  ${BOLD}6. Incident Archive${RESET}"
echo "     Full incident history with timeline, tool calls, approvals,"
echo "     and AST safety badges persisted in SQLite."
echo

# ── 6. Demo Flow ─────────────────────────────────────────────────────────────
section "DEMO FLOW"
echo
echo "  ${BOLD}Scenario:${RESET} client1 shows critical CPU alert from Prometheus."
echo
echo "  Step 1  →  Alert fires → POST /alerts → incident created"
echo "  Step 2  →  TrueForge agent starts diagnostic session"
echo "  Step 3  →  Agent captures system state via MCP tools"
echo "  Step 4  →  Agent proposes fix in sandbox, shows AST diff"
echo "  Step 5  →  Approval gate appears in Incident Deck"
echo "  Step 6  →  Operator clicks Approve"
echo "  Step 7  →  Fix applied to target fleet, incident resolved"
echo

# ── 7. Next: Trigger a demo incident ────────────────────────────────────────
section "READY TO RUN"
echo
echo "  Services are live. To trigger a demo incident:"
echo
echo "  curl -sS -X POST http://localhost:3001/alerts \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"service_name\":\"tf-client1\",\"target_host\":\"client1\","
echo "         \"alert_summary\":\"CPU > 90% for 5 min\",\"severity\":\"critical\"}'"
echo
echo "  Or open the Dashboard at: ${CYAN}http://localhost:3000${RESET}"
echo
