# TSTiles: inexpensive maps for owned sites

Status: active PM ruling, 2026-10-28. This file supersedes all archived SaaS specs.

## Product

An operator already has a PMTiles archive. They can inspect it, publish stable
bytes to a VPS, and embed an independently configured MapLibre map on multiple
websites. Persistent delivery requires one static HTTP server and disk. The
visitor's browser renders vectors. No database, customer accounts, billing,
email, native raster renderer, or request-time Node process is required.

The cheapest default is existing VPS disk and included traffic when they have
capacity. Object storage is optional and stores the same intact archive. Do
not expand the archive into individual objects. A future XYZ compatibility
layer requires a demonstrated consumer need and an architecture ruling.

## Architecture

`local archive → archive CLI → immutable archive + map manifest → Caddy → MapLibre`

The active repository remains one npm package. Boundaries are enforced at
domain directories; inventing a pnpm monorepo would not improve this product.
Node 22 or 24 is a build/publication tool, not a permanent delivery service.

| Domain | Spec | Responsibility |
| --- | --- | --- |
| archive | `src/archive/SPEC.md` | Inspect existing vector PMTiles, stream immutable publication |
| web | `src/web/SPEC.md` | Validate manifest, render a map, embed into another site |
| hosting | `ops/SPEC.md` | Static Range/CORS/cache delivery and operator runbook |

The complete previous tree is retained unchanged under `legacy/saas/`. It is
not a supported alternate runtime. Active imports, default checks, deployment,
and documentation must not depend on it.

## Frozen cross-domain contract

`src/contract.ts` owns `MapManifest` and `VectorLayer`; do not copy their shapes.
The manifest is JSON with `schemaVersion: 1`. The archive URL resolves relative
to the manifest URL, and published archives use `archives/<sha256>.pmtiles`.
Manifests live at `maps/<id>.json`; publishing a new version atomically replaces
only the manifest pointer. Previous archives remain available for rollback.
`sha256` identifies exact bytes; it is not a signature or proof of data quality.
`attribution` is plain text. A supplied `style` is a complete, ready-to-serve
MapLibre style URL and remains intact, including additional sources.

Vector PMTiles v3 is the initial supported input. Raster archives, OSM-to-tile
generation, geocoding, routing, terrain, and raster image output are outside
this milestone. Archive metadata cannot prove a style's layer/field schema fits.
Header/metadata inspection is not full archive verification. Record that limit;
use the official PMTiles CLI when full directory verification is needed.

## PM-owned paths

The root package and lockfile, root tool configuration, `src/contract.ts`,
`scripts/`, `test/architecture/`, `test/fixtures/`, `.agent/`, `.github/`,
`AGENTS.md`, `README.md`, `specs/`, and `legacy/` are PM-owned.
Domain builders may update their own SPEC's exports, consumes, verification,
and known gaps. Only the PM changes ownership or frozen contracts.

## Delivery invariants

- Archives stay immutable and are never whole-file HTTP gzip/Brotli encoded.
- Raw Range requests have accurate partial-content headers and bytes.
- Public maps support cross-origin browser reads without credentials. CORS is
  not an access-control or cost-control mechanism.
- No source archive or shared service configuration is compiled into a site's
  JavaScript. Multiple map instances use separate manifest URLs.
- JavaScript and CSS ship locally. External resources in an operator's supplied
  style are that style's explicit dependencies, not hidden fallback resources.
- No empty style, failed read, or synthetic image is accepted as successful map
  delivery. Errors remain visible and actionable.
- No passing test or successful fixture is described as production cartography.

## Milestone acceptance

Check, unit tests, architecture tests, build, fixture publication, actual Caddy
HTTP checks, and an independent browser review must be recorded separately.
Each active domain receives a fresh Gauntlet judgement against its external bar.
The one-polygon fixture proves transport and display only. Real-basemap quality,
large-file performance, deployment TLS, and real object-store behavior require
their actual artifacts and remain explicit gaps until observed.
