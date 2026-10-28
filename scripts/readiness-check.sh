#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${TOKEN:-demo-public-token}"
ORIGIN="${ORIGIN:-https://example.com}"
DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
export DATABASE_URL

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" != "20" && "$NODE_MAJOR" != "22" ]]; then
  echo "Readiness requires Node.js 20 or 22; found $(node --version)." >&2
  exit 1
fi

echo "==> prisma db sync"
npm run -s db:push

echo "==> lint"
npm run -s lint

echo "==> typecheck"
npm run -s typecheck

echo "==> platform tests"
npm run -s test:platform

echo "==> domain tests"
npm run -s test:domains

echo "==> app tests"
npm run -s test:app

echo "==> build"
npm run -s build

echo "==> start demo server"
SERVER_LOG="$(mktemp)"
node dist/app/demo-server.js >"$SERVER_LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

echo "==> wait for health"
for _ in $(seq 1 60); do
  if curl -fsS "${BASE_URL}/v1/health" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -fsS "${BASE_URL}/v1/health" >/dev/null; then
  echo "Demo server failed to become healthy"
  cat "$SERVER_LOG" || true
  exit 1
fi

if ! kill -0 "$PID" >/dev/null 2>&1; then
  echo "Readiness server exited before smoke checks (the port may already be in use)." >&2
  cat "$SERVER_LOG" || true
  exit 1
fi

echo "==> smoke checks"
BASE_URL="$BASE_URL" TOKEN="$TOKEN" ORIGIN="$ORIGIN" npm run -s smoke:e2e

echo "Readiness check complete"
