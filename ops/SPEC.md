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
  - hosting runbook
  - HTTP verification
consumes:
  - archive publication layout
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

## Known gaps

Local HTTP evidence cannot prove a production TLS/domain configuration, real
traffic capacity, live S3 semantics, or the owner's actual storage bill.
The supplied Compose deployment also needs an actual container-runtime check;
the current verification environment has no Docker binary.
