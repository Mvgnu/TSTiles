# TSTiles

**Host your own vector maps from an existing PMTiles archive.** Prepare the file
once, serve it with Caddy, and embed a MapLibre map on as many of your websites
as you need. The default deployment is one static server and disk; Node is used
to build the viewer and publish archives, not to handle visitor requests.

```text
existing .pmtiles → streamed publication → static HTTPS host → MapLibre on each site
```

This repository was simplified from a larger SaaS experiment. That entire tree
is preserved under [`legacy/saas`](legacy/README.md), excluded from active
dependencies, builds, tests, and deployment. The [migration record](specs/migration.md)
explains the decision and the defects that motivated it.

## First local map

Requirements: Node 22 or 24, npm, and [Caddy](https://caddyserver.com/docs/install).
The deployment configs and HTTP checks are verified against Caddy 2.11.7.

```bash
npm ci
npm run check
npm test
npm run test:architecture
npm run build
npm run demo:prepare

TSTILES_ROOT="$PWD/site" TSTILES_LISTEN=127.0.0.1:8080 \
  caddy run --config ops/Caddyfile.local --adapter caddyfile
```

Open <http://127.0.0.1:8080/>. The included archive contains one polygon. The
page labels it as a **data preview**, exposes the real archive metadata, and
provides a copyable embed. This proves publication, transport, and rendering;
it is not a finished geographical basemap.

`npm run test:hosting` runs actual HTTP checks with Caddy. Set `CADDY_BIN` when
the binary is outside PATH. Missing Caddy fails the test; it is not a skipped pass.

## Use your own archive

Inspect the existing file before publication:

```bash
npm run archive:inspect -- /path/to/your-map.pmtiles
```

The JSON report identifies PMTiles v3 header/metadata, vector layers, bounds,
zoom levels, compression, and the precise inspection limits. The initial
supported format is vector MVT with none/gzip compression. No OSM conversion
is performed. Header/metadata inspection does not traverse every leaf directory
or decode every tile; [the official PMTiles CLI](https://docs.protomaps.com/pmtiles/cli)
provides additional archive verification.

Publish to the static site directory:

```bash
npm run archive:publish -- /path/to/your-map.pmtiles \
  --out site --id basemap --name "My basemap" \
  --attribution "The attribution required by your dataset"
```

The publisher streams the file while computing SHA-256 and writes:

```text
site/archives/<sha256>.pmtiles   immutable exact archive bytes
site/maps/basemap.json          atomically updated map manifest
```

Open <http://127.0.0.1:8080/?manifest=./maps/basemap.json>. Without a style, the
viewer draws the archive's declared layers using a generic inspection palette.
For a finished map, supply a **compatible complete MapLibre style**:

```bash
npm run archive:publish -- /path/to/your-map.pmtiles \
  --out site --id basemap --name "My basemap" \
  --attribution "The attribution required by your dataset" \
  --style https://maps.example.com/styles/basemap/style.json
```

The style is used intact. Its sources must point to the intended archive(s),
and any glyph/sprite URLs must be reachable. TSTiles does not rewrite unrelated
sources or silently fetch fallback assets. A PMTiles container does not tell us
whether its features match a Protomaps, OpenMapTiles, or custom style schema.

Publication retains older digest-named archives. Updating or rolling back a
map changes its manifest; do not overwrite bytes under an existing archive URL.
The [hosting runbook](docs/hosting.md) covers disk headroom and manifest-last
transfer to a live host.

## Embed on another site

The viewer provides a copyable iframe after loading a manifest:

```html
<iframe
  title="Map"
  src="https://maps.example.com/?embed=1&manifest=https%3A%2F%2Fmaps.example.com%2Fmaps%2Fbasemap.json"
  width="100%"
  height="420"
  loading="lazy"
  style="border:0;border-radius:12px"
></iframe>
```

For direct JavaScript integration, the build also exports `createMapViewer`
from `/assets/embed.js`. Load `/assets/maplibre-gl.css` and give the map container
an explicit height:

```html
<link rel="stylesheet" href="https://maps.example.com/assets/maplibre-gl.css">
<div id="map" style="height:420px"></div>
<script type="module">
  import { createMapViewer } from "https://maps.example.com/assets/embed.js";
  const viewer = await createMapViewer({
    container: "map",
    manifestUrl: "https://maps.example.com/maps/basemap.json",
    cooperativeGestures: true,
    onStatus: ({ state, message }) => console.log(state, message),
  });
  // On teardown, call viewer.destroy().
</script>
```

Each map has its own manifest/configuration. No service source edits are needed
for another site. JavaScript and CSS are built locally; the default preview
requires no external style, font, sprite, or commercial map API.

## VPS or S3?

Start with VPS disk when the archive, update headroom, and traffic fit an
existing server. Caddy provides the byte ranges browsers need, and no archive
has to be unpacked into individual tile objects. That is a recommendation based
on this product's cost goal, not a throughput benchmark.

If disk or distribution becomes the constraint, upload the same immutable
archive to S3-compatible storage using a maintained multipart tool. AWS S3 is
one provider, not a requirement. R2 is an option with no Internet egress charge;
requests and storage still cost money. Large PMTiles objects do not automatically
fit Cloudflare's cacheable-object limits. See [hosting and cost tradeoffs](docs/hosting.md)
and the [official PMTiles hosting guide](https://docs.protomaps.com/pmtiles/cloud-storage).

Public map CORS settings allow embedding. They are not private authentication
or a bandwidth spending cap. No cloud resources are created by this repository.

## Development and quality

| Domain | Scope and contract | Independent bar |
| --- | --- | --- |
| Archive | [SPEC](src/archive/SPEC.md) | Official PMTiles reader/CLI: exact publication, bounded resources, honest validation |
| Browser | [SPEC](src/web/SPEC.md) | Official PMTiles MapLibre example: visible usable maps and second-site integration |
| Hosting | [SPEC](ops/SPEC.md) | Official Caddy static hosting: correct ranges, caching, updates and rollback |

Read [system rulings](specs/00_system.md), [Lop](.agent/workflows/lop.md), and
[Gauntlet](.agent/workflows/gauntlet.md). Builders use disjoint worktrees; a fresh
critic inspects the built artifact. Specs declare external references and a
single compared property. [`test/architecture`](test/architecture) checks
ownership metadata, import boundaries, frozen types, and legacy isolation.

```bash
npm run check
npm test
npm run test:architecture
npm run build
npm run demo:prepare
CADDY_BIN=/path/to/caddy npm run test:hosting
npx playwright install chromium
CADDY_BIN=/path/to/caddy npm run test:browser
npm run scope:check -- archive <base-ref>
```

`test:browser` uses real Chromium and Caddy, verifies visible features on phone
and desktop, tests two independent maps on a second origin, and rejects false
success for empty/incompatible supplied styles. Set `CHROMIUM_BIN` to use an
existing Chromium installation. It writes screenshots/evidence under
`test-results/browser/`; CI preserves them as a review artifact.

The [review record](specs/reviews/2026-10-28.md) separates executed checks from
independent judgement and remaining gaps. The user's real archive, finished
style, production domain/TLS, large-file capacity, and live object store require
their actual artifacts before anyone can call them verified.
