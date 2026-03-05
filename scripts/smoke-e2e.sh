#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${TOKEN:-demo-public-token}"
ORIGIN="${ORIGIN:-https://example.com}"

status_code() {
  local method="$1"
  local url="$2"
  shift 2
  curl -sS -o /dev/null -w "%{http_code}" -X "$method" "$url" "$@"
}

expect_status() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL: $label expected $expected got $actual" >&2
    exit 1
  fi
  echo "PASS: $label ($actual)"
}

expect_any_status() {
  local actual="$1"
  local label="$2"
  shift 2
  local allowed=("$@")
  for candidate in "${allowed[@]}"; do
    if [[ "$actual" == "$candidate" ]]; then
      echo "PASS: $label ($actual)"
      return 0
    fi
  done
  echo "FAIL: $label got $actual; allowed: ${allowed[*]}" >&2
  exit 1
}

echo "Running smoke checks against $BASE_URL"

health="$(status_code GET "$BASE_URL/v1/health")"
expect_status "$health" "200" "health endpoint"

docs="$(status_code GET "$BASE_URL/docs")"
expect_status "$docs" "200" "docs index"

unauth_tile="$(status_code GET "$BASE_URL/v1/tiles/2/2/3.mvt")"
expect_status "$unauth_tile" "401" "unauthorized tile request"

preflight="$(status_code OPTIONS "$BASE_URL/v1/tiles/2/2/3.mvt?access_token=$TOKEN" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization")"
expect_status "$preflight" "204" "tile preflight"

auth_tile="$(status_code GET "$BASE_URL/v1/tiles/2/2/3.mvt?access_token=$TOKEN")"
expect_any_status "$auth_tile" "authorized tile request" "200" "404" "409" "502"

metadata="$(status_code GET "$BASE_URL/v1/tiles/metadata?access_token=$TOKEN")"
expect_any_status "$metadata" "metadata request" "200" "404" "409" "503"

echo "Smoke checks complete"
