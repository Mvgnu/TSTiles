# Release Readiness

Updated: 2026-09-04

Current classification: **development proof, not production-ready**.

This file records observed evidence and open gates. Domain `status: ready`
markers describe spec maturity only; they do not make the composed service or a
deployment ready.

## What the local path proves

The supported development path uses Node.js 20, local SQLite, the checked-in
`src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles`, and the
development token. The delivery smoke is successful only when the composed
server returns all of the following for an authenticated
`GET /v1/tiles/0/0/0.mvt`:

- HTTP `200`;
- `content-type: application/vnd.mapbox-vector-tile`;
- a non-empty response body.

`npm run readiness:check` runs database synchronization, lint, typecheck,
platform/domain/app tests, build, starts the composed server, and then runs that
delivery smoke. A 4xx/5xx tile response is a failure, even if public HTML pages
remain available.

## Current evidence

| Check | State | Evidence |
| --- | --- | --- |
| Deterministic PMTiles input | implemented | Development bootstrap defaults to the checked-in fixture when neither `DEMO_PMTILES_PATH` nor `DEMO_PMTILES_KEY` is set. |
| Authenticated vector tile | verified locally | On 2026-09-04 under Node.js 20, the composed server returned `200`, `application/vnd.mapbox-vector-tile`, and 49 bytes at `0/0/0`. |
| Local persistence | implemented; full readiness rerun required | Readiness defaults an unset `DATABASE_URL` to Prisma SQLite `file:./dev.db`; the shared checkout's existing database could not be synchronized after concurrent schema changes. |
| Static quality gates | partially verified | Node.js 20 app tests, typecheck, and build passed on 2026-09-04. Lint and the full domain matrix were not rerun in this slice. |
| Composed HTTP coverage | incomplete | The current executable does not register the implemented `/ops/*` console or `/webhooks/brevo` handler. |
| Visual and usability review | in progress | Separate visual Gauntlet review is required at desktop and mobile widths. |
| Production deployment | unverified | No production host, secrets, provider calls, migrations, backup/restore, or load behavior were verified by this local gate. |

## Spec status reconciliation

- `tile_resolver`, `design_system`, `marketing_site`, and `app_console` declare
  `status: in-review`.
- `auth_flows` declares `status: planned` even though implementation files are
  present. Its spec owner must reconcile that disagreement after review.
- Other domain specs declare `status: ready`; that means their written contract
  is ready for use, not that production behavior has been proven.
- The old all-green launch checklist was removed because it mixed unit-test
  coverage, planned work, local behavior, and unexecuted external checks into a
  single production-ready claim.

## Gates still required before a release claim

- [ ] `npm run readiness:check` passes on a clean checkout under Node.js 20.
- [ ] A fresh code critic reviews the composed request path, authentication,
  lifecycle, bounded inputs, safe errors, and secret handling.
- [ ] `/ops/*` and `/webhooks/brevo` are registered and exercised through the
  composed server, or removed from the advertised runtime contract.
- [ ] A fresh visual critic passes the real public, auth, customer, and operator
  surfaces at representative desktop and mobile widths.
- [ ] Production database migrations and rollback are exercised against the
  chosen database, with backup and restore evidence.
- [ ] Managed authentication, Stripe, Brevo, object storage/filesystem, and
  telemetry are exercised with provisioned staging credentials.
- [ ] A real PMTiles archive is validated separately from the fixture, including
  representative tile, metadata, raster/static, range-read, and failure cases.
- [ ] Deployment health, graceful restart, concurrency, rate/quota enforcement,
  and load behavior are verified on the target host.

Until those gates close, the checked-in fixture supports a trustworthy local
developer success path—not a production-readiness claim.
