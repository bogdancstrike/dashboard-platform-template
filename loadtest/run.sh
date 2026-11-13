#!/usr/bin/env bash
# Headless load test against the running stack: snapshot → run → clean → verify.
#
#   loadtest/run.sh [users] [spawn-rate] [duration]      # defaults 1000 10 5m
#
# Environment: LOADTEST_HOST (http://localhost:5101), LOADTEST_AI (off|fake),
# LOADTEST_WRITES (on|off), LOADTEST_WS (on|off), LOADTEST_PROCESSES (1).
set -euo pipefail
cd "$(dirname "$0")"

USERS=${1:-1000}
RATE=${2:-10}
DURATION=${3:-5m}
RUN_ID=${LOADTEST_RUN_ID:-$(date -u +%Y%m%d%H%M%S)}
export LOADTEST_RUN_ID=$RUN_ID
PY=.venv/bin/python
OUT=reports/$RUN_ID

if [ ! -x .venv/bin/locust ]; then
  echo "creating loadtest/.venv (locust, websocket-client)…"
  if command -v uv >/dev/null; then uv venv -q .venv && uv pip install -q --python .venv/bin/python -r requirements.txt
  else python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt; fi
fi
mkdir -p reports

# Refuse to load anything that is not a Nucleus API: a port taken by some other
# dev server answers every path with 200 and would silently absorb the run.
HOST=${LOADTEST_HOST:-http://localhost:5101}
if ! curl -fsS "$HOST${LOADTEST_PREFIX:-/platform}/meta/app" 2>/dev/null | grep -q '"name"'; then
  echo "!! $HOST does not look like a Nucleus API (no $HOST${LOADTEST_PREFIX:-/platform}/meta/app); not starting" >&2
  exit 2
fi

$PY tokens.py                                  # one sign-in per persona, at most
$PY cleanup.py snapshot > "$OUT-before.json"

# Server-side resources every 5 s while the run lasts.
( while true; do
    date -u +%H:%M:%S
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' \
      nucleus-api nucleus-postgres nucleus-redis 2>/dev/null || true
    docker exec nucleus-postgres psql -U platform -d platform -At -c \
      "select 'pg connections: '||count(*)||' active='||count(*) filter (where state='active') from pg_stat_activity where datname='platform'" 2>/dev/null || true
    if [ -n "${LOADTEST_SAMPLE_CMD:-}" ]; then bash -c "$LOADTEST_SAMPLE_CMD" 2>/dev/null || true; fi
    sleep 5
  done ) > "$OUT-docker.txt" 2>&1 &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT

PROCS=()
if [ "${LOADTEST_PROCESSES:-1}" != "1" ]; then PROCS=(--processes "$LOADTEST_PROCESSES"); fi

set +e
.venv/bin/locust -f locustfile.py --headless -u "$USERS" -r "$RATE" -t "$DURATION" \
  --csv "$OUT" --csv-full-history --html "$OUT.html" --only-summary --stop-timeout 70 "${PROCS[@]}" \
  2>&1 | tail -n 60
STATUS=${PIPESTATUS[0]}
set -e
kill $SAMPLER 2>/dev/null || true

echo "── cleanup ──"
$PY cleanup.py clean "$RUN_ID"
$PY cleanup.py diff "$OUT-before.json" || echo "!! the load test left rows behind — see above"
$PY summarize.py "$OUT" --stats-file "$OUT-docker.txt"
echo "report: loadtest/$OUT.html   summary: loadtest/${OUT}_SUMMARY.md"
exit "$STATUS"
