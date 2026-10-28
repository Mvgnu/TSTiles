#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${TOKEN:-demo-public-token}"
ADMIN_TOKEN="${ADMIN_TOKEN:-demo-admin-token}"
ORIGIN="${ORIGIN:-https://example.com}"
COOKIE_JAR="$(mktemp)"
HEADER_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"

cleanup() {
  rm -f "$COOKIE_JAR" "$HEADER_FILE" "$BODY_FILE"
}
trap cleanup EXIT

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

capture_response() {
  local method="$1"
  local url="$2"
  shift 2
  curl -sS -D "$HEADER_FILE" -o "$BODY_FILE" -X "$method" "$url" "$@"
}

expect_body_contains() {
  local needle="$1"
  local label="$2"
  if ! grep -Fq "$needle" "$BODY_FILE"; then
    echo "FAIL: $label missing body text: $needle" >&2
    cat "$BODY_FILE" >&2
    exit 1
  fi
  echo "PASS: $label contains expected text"
}

expect_header_contains() {
  local header_name="$1"
  local expected_substring="$2"
  local label="$3"
  local actual
  actual="$(awk -F': ' -v name="$header_name" 'BEGIN { IGNORECASE=1 } $1 == name { print $2 }' "$HEADER_FILE" | tr -d '\r' | tail -n1)"
  if [[ "$actual" != *"$expected_substring"* ]]; then
    echo "FAIL: $label expected header $header_name to contain $expected_substring got ${actual:-<missing>}" >&2
    cat "$HEADER_FILE" >&2
    exit 1
  fi
  echo "PASS: $label header contains expected value"
}

expect_nonempty_body() {
  local label="$1"
  if [[ ! -s "$BODY_FILE" ]]; then
    echo "FAIL: $label returned an empty body" >&2
    exit 1
  fi
  echo "PASS: $label returned non-empty bytes ($(wc -c < "$BODY_FILE" | tr -d ' ') bytes)"
}

echo "Running smoke checks against $BASE_URL"

health="$(status_code GET "$BASE_URL/v1/health")"
expect_status "$health" "200" "health endpoint"

docs="$(status_code GET "$BASE_URL/docs")"
expect_status "$docs" "200" "docs index"

pricing="$(status_code GET "$BASE_URL/pricing")"
expect_status "$pricing" "200" "pricing page"

status_page="$(status_code GET "$BASE_URL/status")"
expect_status "$status_page" "200" "status page"

security_page="$(status_code GET "$BASE_URL/security")"
expect_status "$security_page" "200" "security page"

dpa_page="$(status_code GET "$BASE_URL/legal/dpa")"
expect_status "$dpa_page" "200" "dpa page"

capture_response GET "$BASE_URL/docs/quickstart" -H "Accept: text/html"
expect_header_contains "content-type" "text/html" "docs quickstart html"
expect_body_contains "Copy snippet" "docs quickstart html"
expect_body_contains "Create project" "docs app handoff"

capture_response GET "$BASE_URL/status"
expect_body_contains "Health endpoint" "status page"
expect_body_contains "/v1/health" "status page"

capture_response GET "$BASE_URL/security"
expect_body_contains "security@tstiles.com" "security page"
expect_body_contains "/status" "security page"

capture_response GET "$BASE_URL/legal/dpa"
expect_body_contains "Data Processing Addendum" "dpa page"
expect_body_contains "Stripe remains the payment processor" "dpa page"

unauth_tile="$(status_code GET "$BASE_URL/v1/tiles/0/0/0.mvt")"
expect_status "$unauth_tile" "401" "unauthorized tile request"

preflight="$(status_code OPTIONS "$BASE_URL/v1/tiles/0/0/0.mvt" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization")"
expect_status "$preflight" "204" "tile preflight"

auth_tile="$(curl -sS -D "$HEADER_FILE" -o "$BODY_FILE" \
  -H "Authorization: Bearer $TOKEN" \
  -w "%{http_code}" \
  "$BASE_URL/v1/tiles/0/0/0.mvt")"
expect_status "$auth_tile" "200" "fixture-backed authenticated tile request"
expect_header_contains "content-type" "application/vnd.mapbox-vector-tile" "fixture-backed authenticated tile request"
expect_nonempty_body "fixture-backed authenticated tile request"

metadata="$(status_code GET "$BASE_URL/v1/tiles/metadata?access_token=$TOKEN")"
expect_status "$metadata" "200" "metadata request"

capture_response GET "$BASE_URL/app"
expect_header_contains "location" "/sign-in?next=%2Fapp" "unauthenticated app redirect"

app_sign_in_status="$(curl -sS -D "$HEADER_FILE" -o "$BODY_FILE" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/auth/demo/sign-in" \
  -H "content-type: application/json" \
  --data '{"email":"smoke@example.com","userId":"smoke-user","workspaceId":"smoke-workspace","workspaceName":"Smoke Workspace"}' \
  -w "%{http_code}")"
if [[ "$app_sign_in_status" == "201" ]]; then
  echo "PASS: development demo auth bridge available"
  expect_header_contains "set-cookie" "app_session=" "demo sign-in session cookie"

  capture_response GET "$BASE_URL/app" -c "$COOKIE_JAR" -b "$COOKIE_JAR"
  expect_header_contains "content-type" "text/html" "authenticated app overview"
  expect_body_contains "Workspace overview" "authenticated app overview"

  capture_response GET "$BASE_URL/app/billing?intent=upgrade&plan=pro" -c "$COOKIE_JAR" -b "$COOKIE_JAR"
  expect_header_contains "content-type" "text/html" "billing handoff page"
  expect_body_contains "Checkout handoff ready" "billing upgrade handoff"
  expect_body_contains "data-billing-auto-open=\"true\"" "billing auto-open marker"

  session_status="$(status_code GET "$BASE_URL/app-api/session" -c "$COOKIE_JAR" -b "$COOKIE_JAR")"
  expect_status "$session_status" "200" "authenticated session endpoint"

  sign_out_status="$(curl -sS -D "$HEADER_FILE" -o "$BODY_FILE" -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
    -X POST "$BASE_URL/auth/demo/sign-out" \
    -w "%{http_code}")"
  expect_status "$sign_out_status" "200" "demo sign-out"
  expect_header_contains "set-cookie" "Max-Age=0" "demo sign-out cleared cookie"

  capture_response GET "$BASE_URL/app" -c "$COOKIE_JAR" -b "$COOKIE_JAR"
  expect_header_contains "location" "/sign-in?next=%2Fapp" "post sign-out app redirect"
else
  expect_status "$app_sign_in_status" "404" "production demo auth bridge disabled"

  capture_response GET "$BASE_URL/sign-in?plan=pro&next=%2Fapp%2Fbilling"
  expect_body_contains "Managed sign-in required" "production sign-in page"
  expect_body_contains "After managed auth, billing handoff continues into Stripe Checkout for the Pro plan." "production sign-in plan intent"

  capture_response GET "$BASE_URL/app/billing?intent=upgrade&plan=pro"
  expect_header_contains "location" "/sign-in?next=%2Fapp%2Fbilling%3Fintent%3Dupgrade%26plan%3Dpro" "unauthenticated billing redirect"
fi

echo "Admin endpoint smoke checks"

admin_health_unauth="$(status_code GET "$BASE_URL/admin/health")"
expect_status "$admin_health_unauth" "401" "admin health unauthorized"

admin_health="$(status_code GET "$BASE_URL/admin/health" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_any_status "$admin_health" "admin health authorized" "200" "503"

admin_artifacts="$(status_code GET "$BASE_URL/admin/artifacts" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_status "$admin_artifacts" "200" "admin artifacts list"

admin_audit_events="$(status_code GET "$BASE_URL/admin/audit-events" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_status "$admin_audit_events" "200" "admin audit events list"

admin_jobs="$(status_code GET "$BASE_URL/admin/jobs" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_status "$admin_jobs" "200" "admin jobs list"

admin_unknown="$(status_code GET "$BASE_URL/admin/does-not-exist" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_status "$admin_unknown" "404" "admin unknown subpath"

admin_method_mismatch="$(status_code POST "$BASE_URL/admin/artifacts" -H "Authorization: Bearer $ADMIN_TOKEN")"
expect_status "$admin_method_mismatch" "405" "admin method mismatch"

echo "Smoke checks complete"
