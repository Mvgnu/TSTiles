---
name: web
description: Render an independently configured MapLibre map on each consuming site.
paths:
  owned:
    - src/web/
    - public/
    - docs/integration.md
  tests:
    - test/web/
exports:
  - createMapViewer
  - static viewer
consumes:
  - contract.MapManifest
  - contract.VectorLayer
  - pmtiles.Protocol
  - maplibre-gl
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

The static example selects its manifest with `?manifest=` and defaults to
`./maps/fixture.json`. Without a supplied style it renders a clearly labelled
data preview using the archive's vector layer IDs. It must draw the fixture's
polygon. This is a data inspector, not a finished basemap. With a supplied style
use its complete URL intact; do not rewrite unrelated vector/raster/GeoJSON
sources or silently replace missing glyphs/sprites with remote providers.

Bundle JavaScript and CSS locally. The integration must expose a small reusable
map constructor and a static embedding path. Loading, error, and data-preview
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
