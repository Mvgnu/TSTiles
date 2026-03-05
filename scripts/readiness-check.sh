#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${TOKEN:-demo-public-token}"
ORIGIN="${ORIGIN:-https://example.com}"

echo "==> lint"
npm run -s lint

echo "==> typecheck"
npm run -s typecheck

echo "==> domain tests"
npm run -s test:domains

echo "==> build"
npm run -s build

echo "==> start demo server"
node dist/app/demo-server.js >/tmp/tileserver-readiness.log 2>&1 &
PID=$!
cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
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
  cat /tmp/tileserver-readiness.log || true
  exit 1
fi

echo "==> smoke checks"
BASE_URL="$BASE_URL" TOKEN="$TOKEN" ORIGIN="$ORIGIN" npm run -s smoke:e2e

echo "Readiness check complete"
