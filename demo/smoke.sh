#!/usr/bin/env bash
# Incident Command Deck — PR #4 live-wiring smoke test.
#
# Starts the control plane, configures the sandbox provider, fires one alert
# through the diagnosis flow, then checks /health and /incidents are live.
# A failing must-pass GET, or a 4xx/5xx on PUT sandbox / POST alerts that is not
# the documented unconfigured 503, fails the run (set -euo pipefail).
#
# Env:
#   PORT           control-plane port (default 3000)
#   DAYTONA_API_KEY key for the sandbox provider step (defaults to a placeholder)
set -euo pipefail

PORT="${PORT:-3000}"
ORIGIN="http://127.0.0.1:${PORT}"
BASE="${ORIGIN}/api"
CT="Content-Type: application/json"
TMP="${TMPDIR:-/tmp}/007-smoke-$$"

echo "== starting control plane on :${PORT}"
npm run dev &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; rm -f "${TMP}"-*' EXIT

# Give the server a moment to bind
sleep 2

echo
echo "== PUT /api/settings/sandbox"
curl -sS -X PUT "${BASE}/settings/sandbox" \
  -H "${CT}" \
  -d "{\"apiKey\":\"${DAYTONA_API_KEY:-your-daytona-key}\"}" \
  -o "${TMP}-sandbox.json" -w '%{http_code}' > "${TMP}-sandbox.code"
code=$(cat "${TMP}-sandbox.code")
case "$code" in
  200) echo "sandbox provider configured (HTTP $code)" ;;
  503) echo "skipped: TrueForge unconfigured (no TRUEFORGE_BASE_URL)" ;;
  *) echo "sandbox PUT failed: HTTP $code" >&2; cat "${TMP}-sandbox.json" >&2; exit 1 ;;
esac

echo
echo "== GET /api/settings/sandbox"
curl --fail-with-body -sS "${BASE}/settings/sandbox"
echo

echo
echo "== POST /alerts (diagnosis; may halt at the approval gate)"
curl -sS -X POST "${ORIGIN}/alerts" \
  -H "${CT}" \
  -d '{"service_name":"test-svc","target_host":"test-host","alert_summary":"CPU > 90%","severity":"critical"}' \
  -o "${TMP}-alert.json" -w '%{http_code}' > "${TMP}-alert.code"
code=$(cat "${TMP}-alert.code")
case "$code" in
  2??) echo "alert accepted/acknowledged (HTTP $code)" ;;
  503) echo "skipped: TrueForge unconfigured (no TRUEFORGE_BASE_URL)" ;;
  *) echo "alert POST failed: HTTP $code" >&2; cat "${TMP}-alert.json" >&2; exit 1 ;;
esac

echo
echo "== GET /health"
curl --fail-with-body -sS "${ORIGIN}/health"
echo

echo
echo "== GET /incidents"
curl --fail-with-body -sS "${ORIGIN}/incidents"
echo

echo
echo "== smoke OK"
