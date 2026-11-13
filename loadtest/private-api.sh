#!/usr/bin/env bash
# A private API process for load runs — same code, same database/Redis/Keycloak/
# MinIO as the compose stack, but its own gunicorn on its own port, with the
# load profile: the fake model for every AI call (LLM_MODE=fake — no request
# can reach a paid model, whatever header it sends), 3 s caps, 4 workers.
#
#   loadtest/private-api.sh [port] [workers] [source-dir]
#     port        default 5197 — the script refuses a port that is already taken
#     workers     default 4
#     source-dir  default: this checkout. Pass a clean worktree to measure a
#                 commit (`git worktree add /tmp/nucleus-lt origin/master`).
#
# Then: LOADTEST_HOST=http://localhost:5197 make loadtest
#
# The shared dev stack (:5101) is never touched, so its default — the real
# model — stays as it is.
set -euo pipefail
PORT=${1:-5197}
WORKERS=${2:-4}
SRC=${3:-$(cd "$(dirname "$0")/.." && pwd)}
REPO=$(cd "$(dirname "$0")/.." && pwd)

if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "port $PORT is already in use — pick another (a dev server answering 200 to everything would absorb the run)" >&2
  exit 2
fi

cd "$SRC/backend"
export API_PORT=$PORT WEB_CONCURRENCY=$WORKERS ENVIRONMENT=load SERVICE_NAME=nucleus-api API_PREFIX=/platform \
  DATABASE_URL=postgresql+psycopg2://platform:platform@localhost:${POSTGRES_PORT:-5433}/platform \
  REDIS_URL=redis://localhost:${REDIS_PORT:-6380}/0 \
  KEYCLOAK_INTERNAL_URL=http://localhost:${KEYCLOAK_PORT:-8080} KEYCLOAK_PUBLIC_URL=http://localhost:${KEYCLOAK_PORT:-8080} \
  KEYCLOAK_REALM=template KEYCLOAK_AUDIENCE=template-api KEYCLOAK_SPA_CLIENT_ID=template-spa \
  ALLOWED_ORIGINS=http://localhost:5174 \
  STORAGE_ENDPOINT=http://localhost:${MINIO_PORT:-9000} STORAGE_PUBLIC_ENDPOINT=http://localhost:${MINIO_PORT:-9000} \
  STORAGE_BUCKET=nucleus STORAGE_ACCESS_KEY=${MINIO_ROOT_USER:-nucleus} \
  STORAGE_SECRET_KEY=${MINIO_ROOT_PASSWORD:-nucleus-dev-secret} STORAGE_DIR="${TMPDIR:-/tmp}/nucleus-lt-storage" \
  LLM_MODE=fake LLM_API_KEY= LLM_ALLOW_FAKE_HEADER=true LLM_MAX_SECONDS=3 LLM_TURN_MAX_SECONDS=3 \
  LOG_LEVEL=WARNING DB_POOL_SIZE=${DB_POOL_SIZE:-5} DB_MAX_OVERFLOW=${DB_MAX_OVERFLOW:-5}
exec "$REPO/backend/.venv/bin/python" -m gunicorn -c gunicorn.conf.py wsgi:application
