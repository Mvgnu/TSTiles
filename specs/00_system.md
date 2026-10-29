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

## Ruling 2026-10-29: itstiles.com production on the shared VPS

The first production host is `https://itstiles.com` on the owner's existing
VPS (87.58.154.89, Ubuntu, 4 vCPU). That machine already runs nginx 1.28 on
80/443 for unrelated sites, has no Docker, and has a nearly full root disk.
Following the hosting runbook's rule to integrate with an existing proxy, the
**production delivery server is that nginx**, serving `/mnt/tstiles/site` (a
dedicated 147 GB ext4 volume) as static files. Caddy remains the local
verification server and the documented alternative for a dedicated host.
The hosting domain owns the nginx site file and its HTTP evidence, which must
match the same route/Range/CORS/cache table as `ops/public.caddy`. Other sites'
nginx files on that machine are not ours and are not modified.

The archive is the Protomaps daily planet build `20261029.pmtiles`
(139,191,612,225 bytes, basemap schema 4.15.2), downloaded on the VPS from
`build.protomaps.com` and checked against the published MD5. The owner's
earlier local `20260228.pmtiles` is not used: a 1 MB/s uplink made it 33 hours.

**Capacity:** the volume holds one planet. Publication must not make a second
copy. The archive domain adds a same-filesystem hard-link publication mode
(hash in place, link to `archives/<sha256>.pmtiles`, manifest last) that never
copies bytes and fails clearly across filesystems. Updating the planet needs
either a larger volume or a deliberate removal of the old archive first; that
retention decision is the operator's. Consumers therefore must resolve the
archive through a manifest or a served style, never by hard-coding a digest URL.

**Basemap styles:** this archive uses the Protomaps basemap schema, so
finished cartography uses the maintained `@protomaps/basemaps` 5.x layer
generator (pinned in the root package). The web domain owns a style CLI
(`src/web/styles-cli.ts`, built to `dist/web/styles-cli.js`, `npm run
styles:build`) that writes complete ready-to-serve MapLibre styles for the
official flavors, with absolute `pmtiles://` archive URLs and self-hosted
glyph/sprite URLs under `/styles/`. Glyphs and sprites are the official
`protomaps/basemaps-assets` files, fetched at deploy time, never committed.
Each flavor is published as its own manifest (`maps/<flavor>.json`) for the
same archive. Attribution: `Protomaps © OpenStreetMap contributors`.

The web domain also owns `docs/integration.md`: the step-by-step guide that
another project (or an agent working in it) follows to embed and style these
maps on the same server, using only public URLs.

Follow-up ruling (same day): `@protomaps/basemaps` is an approved web-domain
import. `node:` imports in the web domain are allowed only in the operator CLI
files `src/web/styles-build.ts` and `src/web/styles-cli.ts`; browser bundles
must never import them. The style-spec validator stays a test-time check.

## Ruling 2026-10-29 (later): public landing page, legal pages, backlink

itstiles.com is a free public service. `/` becomes a German landing page
("Map Tiles kostenlos, in Deutschland gehostet"); the map viewer moves to
`/viewer` (same query parameters, including `embed=1`). Legal pages
`/impressum`, `/datenschutz`, `/nutzungsbedingungen` are static HTML from
`public/` (web domain); the hosting domain adds their routes with the same
header policy as `/`. The only condition of use is a visible backlink: every
served style's attribution names and links `itstiles.com` alongside
Protomaps and OpenStreetMap. Manifest `attribution` stays plain text (frozen
contract); the link lives in the served styles and the embed viewer. The
operator identity is the owner's (Magnus Ohle, Tübingen), as on the owner's
other sites. No cookies, analytics, or third-party requests on these pages.
The web domain also owns `docs/styleguide.md`, a guide to distinctive per-site
map styling.
