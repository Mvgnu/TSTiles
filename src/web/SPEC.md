---
name: web
description: Render an independently configured MapLibre map on each consuming site.
paths:
  owned:
    - src/web/
    - public/
    - docs/integration.md
    - docs/styleguide.md
  tests:
    - test/web/
exports:
  - createMapViewer
  - landing page and legal pages
  - styles CLI (npm run styles:build)
  - docs/integration.md
  - docs/styleguide.md
consumes:
  - contract.MapManifest
  - contract.VectorLayer
  - pmtiles.Protocol
  - maplibre-gl
  - "@protomaps/basemaps"
verification:
  check: npm run check
  test: npm run test:web
  build: npm run build
bar:
  reference: Official Protomaps MapLibre PMTiles example
  property: A second site can render and interact with visible archive features by changing configuration URLs alone, with attribution, clear errors, and usable phone and desktop layouts.
---

# Browser integration

Read `../../specs/00_system.md` and the Lop/Gauntlet workflows first.
Own only the declared paths; frozen types and build configuration are PM-owned.

Validate the manifest as unknown JSON at the boundary. Resolve HTTP(S) URLs
relative to the manifest URL. Register the official PMTiles protocol once per
MapLibre instance. Configuration belongs to each map instance, never a site
constant. Keep attribution visible; treat manifest attribution as plain text.

The public site (ruling 2026-10-29, later; owner scope change) is exactly a
German landing page (`public/index.html`, live hero map of `./maps/light.json`
via `createMapViewer`, flavor switcher, copy snippets) and three legal pages
(`impressum.html`, `datenschutz.html`, `nutzungsbedingungen.html`). There is
no standalone viewer page and no `?manifest=`/`?embed=1` iframe path. The
landing script is `src/web/main.ts`, still bundled as `assets/viewer.js` by the
PM-owned build entry `viewer`. Without a supplied style `createMapViewer`
renders a clearly labelled data preview using the archive's vector layer IDs
(not a finished basemap). With a supplied style use its complete URL intact;
do not rewrite unrelated sources or silently replace missing glyphs/sprites.

Bundle JavaScript and CSS locally; the site makes no third-party requests and
sets no cookies. The integration exposes a small reusable map constructor
(`/assets/embed.js`). Loading, error, and data-preview
states must remain legible on 390px phones and 1440px desktops. Never claim a
map loaded merely because the HTML shell or WebGL context exists.

## Evidence required

Boundary tests for valid/invalid manifests and URL resolution; a fresh critic
must use the served built page, inspect its network behavior and visible map,
pan/zoom, and test a second manifest/site configuration. Screenshots alone do
not prove interaction; source inspection does not prove rendering.

## Known gaps

The fixture contains one polygon, no roads or labels. A real basemap needs the
user's archive, compatible style, glyphs/sprites where used, and provenance.

Readiness requires rendered vector or GeoJSON features in the current view.
A supplied style with no drawing layers reports an error; feature layers with
no matching visible features report an empty view. Raster, terrain, and
background-only styles remain intact but report `unverified` ("Style only"):
their content cannot establish that the configured vector archive rendered.
`ready` is transport/display evidence, not a cartographic quality judgement.

### Protomaps basemap styles (2026-10-29)

`src/web/basemap.ts` (pure) and `src/web/styles-build.ts` (Node file I/O,
entry `styles-cli.ts`) write one complete style per official flavor with an
absolute `pmtiles://` archive URL, self-hosted glyph/sprite URLs and plain-text
attribution. Each file is replaced by temp-file + fsync + rename; a failed
build leaves no temp files, but a multi-flavor run is not one transaction.
Input from a manifest is rejected unless its `vectorLayers` list every
Protomaps source-layer the styles read; `--archive-url` input cannot be
schema-checked. The MapLibre style-spec validator runs in the test suite only:
`@maplibre/maplibre-gl-style-spec` is a transitive, undeclared package, so the
CLI performs its own structural checks instead.

Architecture gate: per the PM ruling, `@protomaps/basemaps` is allowed in
`src/web/`, and `node:` imports only in `styles-build.ts`/`styles-cli.ts`.

`createMapViewer` reports every failure through `onStatus({ state: "error" })`:
manifest-phase failures (fetch, HTTP status, JSON, validation, initial view)
emit it with the exact message the promise rejects with; map/source errors
name the failing source URL. By default (`showErrors`) the message is also
shown in the container as `.tstiles-error[role=alert]`. Caller aborts are not
errors. A failed request for a single tile (event with `tile`) is transient:
it is retried up to twice via `map.refreshTiles` and reported only if the view
then draws nothing; style/sprite/glyph/source-header failures stay fatal. This
fixed concurrent loads of two viewers (identical Range requests in one browser
context) turning a rendering map into "error".

Attribution: served styles carry fixed HTML credit (itstiles.com · Protomaps ©
OpenStreetMap links; allowlisted https hosts, all text escaped); `--attribution`
only appends escaped plain text. `createMapViewer` adds a never-compact
attribution control; a supplied style's own credits take precedence, the
manifest's plain-text attribution is shown (escaped) only when the style has
none. `createMapViewer` accepts per-instance `center`/`zoom`.

Legal texts are templates from the owner's facts, marked as unreviewed in each
file; they need the owner's (legal) review. Non-Latin label scripts remain
unobserved.
