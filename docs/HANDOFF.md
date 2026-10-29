# Handoff: put an itstiles.com map into one of our sites

Give this file to the agent working in the other project. It is the entry
point; the two detailed guides it links are the source of truth for code.

- **Integration guide** (URLs, both integration options, Next.js component,
  CSP, troubleshooting): [`docs/integration.md`](integration.md)
- **Styleguide** (making each site's map look unique, tested themes):
  [`docs/styleguide.md`](styleguide.md)

Both live in this repository on the same machine:
`/Users/magnusohle/cursorprojects/tilesserver/docs/` and on GitHub under
`Mvgnu/TSTiles/docs/`.

## What itstiles.com is (state on 2026-10-29)

| | |
| --- | --- |
| Data | Protomaps daily planet build `20261029` (OpenStreetMap), vector tiles z0–15, overzoom beyond. Basemap schema 4.15.2 |
| Delivery | Static PMTiles over HTTPS from one VPS in Frankfurt (nginx), Cloudflare in front. No API key, no login, no cookies |
| Styles | `light`, `dark`, `white`, `grayscale`, `black`, served at `https://itstiles.com/styles/protomaps/<flavor>.json`; fonts (Noto Sans Regular/Medium/Italic) and sprites are self-hosted under `/styles/` |
| Manifests | `https://itstiles.com/maps/<flavor>.json`, plus `planet.json` (no style). They name the current archive and are revalidated on every use |
| JS | `https://itstiles.com/assets/embed.js` (`createMapViewer`) and `/assets/maplibre-gl.css` (MapLibre 5.24.0) |
| Condition of use | Keep the attribution visible: **itstiles.com · Protomaps © OpenStreetMap**, with the itstiles.com link. Served styles and `embed.js` already include it; custom styles must use the `ATTRIBUTION` constant from the integration guide's helper |

## Steps for the agent

1. **Choose the integration.**
   - Plain site / CMS / no bundler → Option A, `createMapViewer` from
     `/assets/embed.js` (integration guide, section "Option A").
   - Next.js / React / any bundled app → Option B, npm with exact pins:
     `npm i -E maplibre-gl@5.24.0 pmtiles@4.3.0 @protomaps/basemaps@5.7.2`.
     Copy the helper `src/lib/itstiles.ts` and the component
     `src/components/ItstilesMap.tsx` **unchanged** from the guide.
2. **Never hard-code the archive URL** (`/archives/<sha256>.pmtiles`). The
   disk holds one planet; an update replaces it and the old URL starts
   returning 404. Resolve it from a manifest or use a served style. Use
   `keepArchiveCurrent()` on pages that stay open a long time.
3. **Give the site its own look.** Pick or derive a theme from the
   styleguide (section 13 has tested themes; sections 3–9 explain palette from
   brand tokens, typography, label density, backdrop vs hero maps, dark mode,
   3D buildings, branded markers). Put brand themes in `src/lib/map-themes.ts`.
   Keep place labels at ≥ 4.5:1 contrast. Only the three Noto Sans fonts exist
   on itstiles.com; other fonts need their own glyph hosting.
4. **Layer own data correctly.** Add GeoJSON sources/layers in
   `onStyleLoad(map)` (they must be re-added after every style switch) and
   insert them `beforeId` the first label layer so labels stay on top.
5. **Set labels to German** where the site is German: `lang: "de"`.
6. **CSP** (if the site sends one): `connect-src https://itstiles.com`,
   `img-src data: blob: https://itstiles.com`, `worker-src blob:`, plus
   `script-src`/`style-src` for `embed.js` (Option A only). Details in the guide.
7. **Performance.** Give the container an explicit height, lazy-load the map
   when it scrolls into view, use `cooperativeGestures` for maps inside
   scrolling pages, call `map.remove()` / `viewer.destroy()` on unmount.
8. **Verify before calling it done.**
   - `npm run build` and lint pass with no warnings.
   - In a real browser at 390 px and 1440 px the map shows roads, water and
     labels; no console errors; the itstiles.com link is visible in the
     attribution (not collapsed).
   - Switching light/dark keeps the site's colours, language and own layers.
   - Navigating away and back leaves exactly one `.maplibregl-map`.

## Limits to tell the site owner

- Free, no SLA. One server; if it is down, every map is down.
- Planet updates (a few times a year at most) take the maps offline for about
  an hour, because only one planet fits on the disk. Pages using manifests or
  served styles recover automatically after the update.
- No geocoding, routing, terrain/hillshade, or raster image tiles.
- Label scripts other than Latin/Cyrillic/Greek/CJK (e.g. Arabic, Hebrew,
  Indic) are not verified.

## For the operator (not for site agents)

Server layout, update and rollback: `docs/hosting.md`, section "One planet:
update and rollback", and `node ops/planet-update.mjs status` on the VPS
(`/mnt/tstiles/app`). Legal pages are templates and need the owner's review.
