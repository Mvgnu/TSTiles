---
name: hosting
description: Serve stable archive bytes cheaply from a VPS and document optional object storage.
paths:
  owned:
    - ops/
    - docs/hosting.md
  tests:
    - test/hosting/
exports:
  - Caddy deployment
  - nginx production site (itstiles.com) and route snippets (ops/nginx/)
  - hosting runbook
  - one-planet operator script ops/planet-update.mjs (status, snapshot, update, rollback)
  - HTTP verification (Caddy and nginx)
consumes:
  - archive publication layout
  - archive CLI publish --link (dist/archive/cli.js)
  - web style CLI (dist/web/styles-cli.js)
  - web static build
verification:
  check: npm run check
  test: npm run test:hosting
  build: npm run build
bar:
  reference: Official Caddy file_server and Protomaps static PMTiles hosting guide
  property: A fresh operator can serve, update, and roll back one archive with correct byte ranges and cross-site access using one static server and no application database.
---

# Hosting

Read `../specs/00_system.md` and the Lop/Gauntlet workflows first.
Own only the declared paths. Root tooling, workflows, and contracts are PM-owned.

Serve the built `site/` with Caddy. Preserve correct Range, HEAD, conditional
request, and CORS behavior. Versioned digest archives receive long immutable
cache lifetimes; mutable manifests must revalidate. Do not apply whole-file
HTTP compression to PMTiles. Public maps do not use credentialed CORS. No
source/config/legacy tree may be exposed as the document root.

Document local proof, HTTPS VPS setup, disk/update headroom, immutable upload,
manifest-last release ordering, rollback, and no automatic archive garbage
collection. Optional S3-compatible storage stores intact objects and uses an
established multipart upload client; never replace this with a custom SDK
pipeline. Explain request/storage/egress costs and verify quoted prices from
official sources. Large R2 archives are not automatically Cloudflare cached.

## Evidence required

Run real Caddy against a temporary prepared site. Compare a 206 response with
the original byte range, verify Content-Range and Content-Length, HEAD, invalid
ranges, CORS/preflight, ETag behavior, immutable archives and mutable manifests.
An explicitly requested hosting test fails when Caddy is unavailable; it must
not turn missing infrastructure into a green skipped gate.

Production (ruling 2026-10-29) is the shared VPS's nginx serving
`/mnt/tstiles/site` for `itstiles.com`. `ops/nginx/` holds the site file, a
bootstrap site for certificate issuance, the route snippet that reproduces the
`ops/public.caddy` table, its http-context maps, and the Cloudflare real-IP
snippet. `test/hosting/nginx.test.mjs` runs real nginx (`NGINX_BIN`) against the
route snippet unmodified, and validates/runs path-rewritten copies of the site
and bootstrap files with a throwaway certificate; it fails when nginx is missing.

`ops/planet-update.mjs` is the one-planet update/rollback procedure for that
host: it picks plan two (room for two archives, no downtime) or plan one
(delete first, stated outage, requires `--allow-outage`). It verifies the
build-list size/MD5 and that the build is still downloadable, publishes every
manifest id with `--link`, and regenerates styles. It swaps archive -> styles ->
manifests, snapshots and restores `maps/*.json` together with
`styles/protomaps/*.json`, and verifies on disk and over HTTP.
`test/hosting/planet-update.test.mjs` drives it against a scratch volume
served by real nginx, with two archives derived from the one-tile fixture.

## Known gaps

Local HTTP evidence cannot prove a production TLS/domain configuration, real
traffic capacity, live S3 semantics, or the owner's actual storage bill.
The supplied Compose deployment also needs an actual container-runtime check;
the current verification environment has no Docker binary.

nginx-specific gaps: the brotli directives in `itstiles.com.conf` are removed
for the local run (stock nginx has no brotli module), so only `nginx -t` on the
host proves them. Local nginx is 1.31 on macOS (case-insensitive location
matching; the case-variant path check runs only on Linux); production is 1.28.
An unsatisfiable range (416) carries the archive's immutable Cache-Control from
nginx's first header pass plus `no-store` (no-store governs), and a 206 carries
no `Accept-Ranges`; both differ from Caddy byte-for-byte. The real certificate,
DNS, Cloudflare proxying, HTTP/2 and the live 139 GB archive are proved only by
the PM's checks against https://itstiles.com.

One-planet gaps: the script has not run against the live 139 GB planet. The
outage estimate (about 1 hour) comes from the 2026-10-29 manual deployment's
timings, not from a script run. The test archives copy the fixture's tile
bytes and declare the Protomaps layer ids in metadata only, so they prove
digest wiring through publish/styles/manifests, not cartography. Each manifest
id costs one full sha256 pass (6 x ~5.5 min on the planet) because the archive
CLI has no "reuse a verified digest" option; that dominates plan one's outage.
