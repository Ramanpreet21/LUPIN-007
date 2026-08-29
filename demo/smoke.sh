#!/usr/bin/env bash
# Incident Command Deck — PR #4 live-wiring smoke test.
#
# Starts the control plane, configures the sandbox provider, fires one alert
# through the diagnosis flow, then checks /health and /incidents are live.
#
# Env:
#   PORT           control-plane port (default 3000)
#   DAYTONA_API_KEY key for the sandbox provider step (defaults to a placeholder)
set -euo pipefail

PORT="${PORT:-3000}"
ORIGIN="http://127.0.0.1:${PORT}"
BASE="${ORIGIN}/api"
CT="Content-Type: application/json"

echo "== starting control plane on :${PORT}"
npm run dev &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

# Give the server a moment to bind
sleep 2

echo
echo "== PUT /api/settings/sandbox"
curl -sS -X PUT "${BASE}/settings/sandbox" \
  -H "${CT}" \
  -d "{\"apiKey\":\"${DAYTONA_API_KEY:-your-daytona-key}\"}"
echo

echo
echo "== GET /api/settings/sandbox"
curl -sS "${BASE}/settings/sandbox"
echo

echo
echo "== POST /alerts (diagnosis; may halt at the approval gate)"
curl -sS -X POST "${ORIGIN}/alerts" \
  -H "${CT}" \
  -d '{"service_name":"test-svc","target_host":"test-host","alert_summary":"CPU > 90%","severity":"critical"}'
echo

echo
echo "== GET /health"
curl -sS "${ORIGIN}/health"
echo

echo
echo "== GET /incidents"
curl -sS "${ORIGIN}/incidents"
echo

echo
echo "== smoke OK"
