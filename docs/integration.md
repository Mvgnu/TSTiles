# Using itstiles.com maps in another project

This guide is for people, and coding agents, adding a map to a website or app
(Next.js, React, plain HTML) using the free public map service at
**https://itstiles.com**. You only need public URLs. There is no API key,
account, SDK registration or server-side code.

The map is a vector basemap of the whole planet (Protomaps daily build, basemap
schema 4.x, OpenStreetMap data). Tiles are read straight from one PMTiles file
with HTTP Range requests, and the visitor's browser draws the map with
[MapLibre GL JS](https://maplibre.org/).

**The one condition of use:** every map shows the attribution
`itstiles.com · Protomaps © OpenStreetMap`, with a visible, clickable link to
https://itstiles.com (see [Attribution](#attribution-required)). The served
styles include it automatically.

Pick one option:

| Option | Use it when | Code |
| --- | --- | --- |
| [A. `createMapViewer`](#option-a-createmapviewer-from-assetsembedjs) | A plain site without a bundler | One `<script type="module">` |
| [B. npm packages](#option-b-recommended-for-apps-maplibre-gl--pmtiles--protomapsbasemaps) | **Next.js / React / any bundled app**, custom colours, your own data | A helper module and a component, copied unchanged |

For distinctive, per-site map designs see [docs/styleguide.md](styleguide.md).

---

## 1. What is served

Everything below is public, read-only and allows cross-origin reads
(`Access-Control-Allow-Origin: *`, no credentials).

| URL | What it is | Browser caching |
| --- | --- | --- |
| `https://itstiles.com/maps/light.json` | Map manifest for the **light** flavor | `no-cache` (always revalidated) |
| `https://itstiles.com/maps/dark.json` | Manifest, **dark** flavor | `no-cache` |
| `https://itstiles.com/maps/white.json` | Manifest, **white** flavor | `no-cache` |
| `https://itstiles.com/maps/grayscale.json` | Manifest, **grayscale** flavor | `no-cache` |
| `https://itstiles.com/maps/black.json` | Manifest, **black** flavor | `no-cache` |
| `https://itstiles.com/styles/protomaps/<flavor>.json` | Complete MapLibre style per flavor (`light`, `dark`, `white`, `grayscale`, `black`), English labels | Short, revalidated |
| `https://itstiles.com/styles/fonts/{fontstack}/{range}.pbf` | Glyphs (Noto Sans Regular / Medium / Italic) | Short, revalidated |
| `https://itstiles.com/styles/sprites/v4/<flavor>` | Sprite sheets (`.json`, `.png`, `@2x.json`, `@2x.png`) | Short, revalidated |
| `https://itstiles.com/archives/<sha256>.pmtiles` | The planet archive (~139 GB, read with Range requests only) | 1 year, `immutable` |
| `https://itstiles.com/assets/embed.js` | ES module exporting `createMapViewer` (bundles MapLibre + PMTiles, ~1 MB) | Short, revalidated |
| `https://itstiles.com/assets/maplibre-gl.css` | MapLibre's stylesheet, same version as `embed.js` | Short, revalidated |

"Short, revalidated" means a few minutes at the origin. A CDN (Cloudflare)
sits in front of itstiles.com and may currently let browsers keep these files
somewhat longer, so after a change allow for a delay. Do not depend on an
exact duration. The landing page at `https://itstiles.com/` shows a live map;
there is no separate viewer or iframe page.

All five manifests point at the **same** archive; they differ only in their
`style` field (`../styles/protomaps/<flavor>.json`). A manifest looks like this
(abridged; `<sha256>` stands for the current 64-character digest):

```json
{
  "schemaVersion": 1,
  "id": "light",
  "name": "…",
  "archive": "../archives/<sha256>.pmtiles",
  "sha256": "<sha256>",
  "tileType": "mvt",
  "minZoom": 0,
  "maxZoom": 15,
  "bounds": [-180, -90, 180, 90],
  "center": [0, 0, 0],
  "vectorLayers": [{ "id": "boundaries" }, { "id": "buildings" }, { "id": "earth" }, { "id": "landcover" }, { "id": "landuse" }, { "id": "places" }, { "id": "pois" }, { "id": "roads" }, { "id": "water" }],
  "attribution": "Protomaps © OpenStreetMap contributors",
  "style": "../styles/protomaps/light.json"
}
```

`archive` and `style` are **relative to the manifest URL**: resolve them with
`new URL(value, manifestUrl)`. The manifest `attribution` is plain text; the
linked credit lives in the styles.

### Rules that always apply

- **Never hard-code the archive URL or its digest.** The file name changes
  whenever the planet is updated, and the old file may be deleted the same day
  (the server disk holds one planet). Use a served style URL (it is regenerated
  on update) or fetch a manifest at runtime and resolve `archive` from it. Do
  not read the manifest at build time (for example in Next.js static
  generation): that freezes the digest into your build. Pages that stay open
  for hours should re-check (see [Long-open pages](#long-open-pages-and-planet-updates)).
- **Attribution is required**, including the itstiles.com link. Details below.
- **Zoom:** the archive holds zoom levels 0–15. Beyond 15 MapLibre overzooms
  the z15 tiles (sharp vectors, no extra detail), so a `maxZoom` around 18–20
  is sensible.
- The planet manifest's `center` is `[0, 0, 0]` (whole world). Always pass
  your own `center` and `zoom`.
- **Public service:** there is no key and no access control. Do not put
  private data in requests to itstiles.com. Mass downloading of the archive
  needs prior permission (see the
  [Nutzungsbedingungen](https://itstiles.com/nutzungsbedingungen)).

### Attribution (required)

Keep MapLibre's attribution control visible and not collapsed. It must show a
clickable link to itstiles.com, plus Protomaps and OpenStreetMap. The served
styles (`/styles/protomaps/<flavor>.json`) and `createMapViewer` already do
this. If you build a style yourself, set this exact HTML as the attribution
of your `protomaps` source (it is the `ATTRIBUTION` constant in the helper
module below):

```html
<a href="https://itstiles.com" target="_blank" rel="noopener">itstiles.com</a> · <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
```

Do not set `attributionControl: false`, do not hide `.maplibregl-ctrl-attrib`
with CSS, and prefer `attributionControl: { compact: false }`: MapLibre's
default collapses the credit into an "i" button on narrow maps.

---

## Option A: `createMapViewer` from `/assets/embed.js`

For plain sites without a bundler. The module includes MapLibre and the
PMTiles protocol; it validates the manifest, loads the manifest's style,
keeps the attribution visible and reports clear status messages.

```html
<link rel="stylesheet" href="https://itstiles.com/assets/maplibre-gl.css">
<div id="map" style="height:420px"></div>
<p id="map-status" role="status"></p>

<script type="module">
  import { createMapViewer } from "https://itstiles.com/assets/embed.js";

  const statusLine = document.getElementById("map-status");
  try {
    const viewer = await createMapViewer({
      container: "map",                                   // element or element id
      manifestUrl: "https://itstiles.com/maps/light.json", // pick a flavor
      center: [13.405, 52.52],                            // [longitude, latitude]
      zoom: 11,                                           // 0–24
      cooperativeGestures: true,                          // recommended inside scrolling pages
      onStatus: (status) => {
        // status.state: "loading" | "ready" | "empty" | "unverified" | "error"
        statusLine.textContent = status.message;
        statusLine.dataset.state = status.state;
      },
    });

    // viewer.map is the MapLibre map. Add your own data after the style loads:
    viewer.map.on("load", () => {
      viewer.map.addSource("shops", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [
          { type: "Feature", geometry: { type: "Point", coordinates: [13.405, 52.52] }, properties: { name: "Mitte" } },
        ] },
      });
      viewer.map.addLayer(
        { id: "shops", type: "circle", source: "shops", paint: { "circle-radius": 7, "circle-color": "#d6336c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
        "address_label", // insert below the basemap labels
      );
    });

    // viewer.resetView() returns to center/zoom; viewer.destroy() removes the map.
  } catch (error) {
    // A missing, non-JSON or invalid manifest (or a bad center/zoom) rejects here.
    // onStatus has already received { state: "error", message } with the same text,
    // and the message is also shown inside the map container.
    statusLine.textContent = error.message;
  }
</script>
```

`createMapViewer(options)` options:

| Option | Type | Notes |
| --- | --- | --- |
| `container` | `HTMLElement \| string` | Must have a height |
| `manifestUrl` | `string` | Absolute, or relative to `baseUrl` |
| `baseUrl` | `string` | Default `document.baseURI` |
| `center` | `[lng, lat]` | Initial view; also used by `resetView()` |
| `zoom` | `number` | Initial zoom 0–24 |
| `cooperativeGestures` | `boolean` | Default `false` |
| `signal` | `AbortSignal` | Aborting destroys the map |
| `onStatus` | `(status) => void` | `ready` means features are actually drawn; every failure, including a missing or invalid manifest, ends in `error` with a readable message |
| `showErrors` | `boolean` | Default `true`: error messages are also shown inside the map container (`.tstiles-error`, `role="alert"`) |

It resolves to `{ map, manifest, manifestUrl, archiveUrl, styleUrl, resetView, destroy }`
and rejects with a readable error for a missing, non-JSON or invalid manifest or
a bad `center`/`zoom`. Before rejecting it calls `onStatus({ state: "error", message })`
with the same message and shows it in the container, so a page that forgets
the `try`/`catch` still shows what went wrong. A single failed tile request
(for example during a brief network hiccup) is retried and does not turn a
rendering map into an error; style, sprite, glyph and archive failures report
`error` with the failing URL. Rotation is disabled; zoom buttons, a metric
scale bar and a non-collapsing attribution are added.

**With a Content Security Policy:** a strict CSP blocks the inline
`<script type="module">` and the inline `style="height:420px"` above. Move the
script into a same-origin file (`<script type="module" src="/js/map.js">`) or
give it a `nonce`, and set the height in your stylesheet (`#map { height: 420px }`).
Then add `script-src https://itstiles.com`, `style-src https://itstiles.com`
and the [map CSP](#content-security-policy).

Caveats: `embed.js` is not versioned (it can change on deploy) and carries its
own MapLibre copy. Do not mix `viewer.map` with a separately installed
`maplibre-gl`. Apps with a bundler should use Option B.

---

## Option B (recommended for apps): `maplibre-gl` + `pmtiles` + `@protomaps/basemaps`

Install exactly the versions itstiles.com is built with (`-E` pins them
without a `^` range):

```sh
npm i -E maplibre-gl@5.24.0 pmtiles@4.3.0 @protomaps/basemaps@5.7.2
```

`@protomaps/basemaps` builds and recolours styles client-side. Pin it: its
layer output must match the archive's basemap schema, and the itstiles.com
styles are generated with 5.7.2.

### The helper module

Copy this file unchanged into your project. With `create-next-app --src-dir`
it is `src/lib/itstiles.ts` (imported as `@/lib/itstiles`); otherwise
`lib/itstiles.ts`. It type-checks against the versions above and is tested
in the itstiles repository.

```ts
// src/lib/itstiles.ts — shared helpers for maps served by https://itstiles.com
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor, type Flavor, type Pois } from "@protomaps/basemaps";

export const ITSTILES = "https://itstiles.com";
export type ItstilesFlavor = "light" | "dark" | "white" | "grayscale" | "black";

/**
 * Required credit for every map built on itstiles.com (condition of use):
 * the visible itstiles.com link plus Protomaps and OpenStreetMap.
 */
export const ATTRIBUTION =
  '<a href="https://itstiles.com" target="_blank" rel="noopener">itstiles.com</a> · '
  + '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © '
  + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

/** Register the pmtiles:// protocol once per page (safe to call repeatedly). */
let pmtilesRegistered = false;
export function registerPmtiles(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

/** A ready-made style served by itstiles.com. Use it directly as `style:`. */
export function servedStyleUrl(flavor: ItstilesFlavor = "light"): string {
  return `${ITSTILES}/styles/protomaps/${flavor}.json`;
}

/**
 * The current planet archive URL. Always resolve it through the manifest:
 * the digest in the file name changes when the planet is updated, and the
 * old archive may be deleted.
 */
export async function currentArchiveUrl(signal?: AbortSignal): Promise<string> {
  const manifestUrl = `${ITSTILES}/maps/light.json`;
  const response = await fetch(manifestUrl, { cache: "no-cache", signal });
  if (!response.ok) throw new Error(`${manifestUrl} returned HTTP ${response.status}`);
  const manifest: unknown = await response.json();
  if (typeof manifest !== "object" || manifest === null || !("archive" in manifest) || typeof manifest.archive !== "string") {
    throw new Error(`${manifestUrl} is not a map manifest (missing "archive")`);
  }
  return new URL(manifest.archive, response.url || manifestUrl).href;
}

/** Colour overrides. `pois` and `landcover` are nested objects and merge key by key. */
export type FlavorOverrides = Partial<Omit<Flavor, "pois" | "landcover">> & {
  pois?: Partial<Pois>;
  landcover?: Partial<NonNullable<Flavor["landcover"]>>;
};

/**
 * Deep-merge overrides into a base flavor. `white`, `grayscale` and `black`
 * draw no POI icons or landcover, so their `pois`/`landcover` overrides are ignored.
 */
export function mergeFlavor(base: Flavor, overrides: FlavorOverrides = {}): Flavor {
  const { pois, landcover, ...flat } = overrides;
  return {
    ...base,
    ...flat,
    pois: base.pois === undefined ? undefined : { ...base.pois, ...pois },
    landcover: base.landcover === undefined ? undefined : { ...base.landcover, ...landcover },
  };
}

/** Build your own style from the same archive, fonts and sprites. */
export function customStyle(options: {
  archiveUrl: string;
  flavor?: ItstilesFlavor;
  lang?: string;
  colors?: FlavorOverrides;
}): StyleSpecification {
  const flavorName = options.flavor ?? "light";
  return {
    version: 8,
    glyphs: `${ITSTILES}/styles/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ITSTILES}/styles/sprites/v4/${flavorName}`,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${options.archiveUrl}`, attribution: ATTRIBUTION },
    },
    layers: layers("protomaps", mergeFlavor(namedFlavor(flavorName), options.colors), { lang: options.lang ?? "en" }),
  };
}

/** Insert your own layers before this id so basemap labels stay on top. */
export function firstLabelLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}

/**
 * Keep a long-open page on the current planet. After a planet update the old
 * archive can disappear (404). On such an error, and when the tab becomes
 * visible again, re-read the manifest; if the archive changed, `onChange`
 * receives the new URL (rebuild the style and call map.setStyle). Returns a
 * cleanup function.
 */
export function keepArchiveCurrent(map: MapLibreMap, archiveUrl: string, onChange: (archiveUrl: string) => void): () => void {
  let current = archiveUrl;
  let lastCheck = 0;
  const check = (): void => {
    if (Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    currentArchiveUrl().then((next) => {
      if (next === current) return;
      current = next;
      onChange(next);
    }).catch(() => undefined);
  };
  // Any "error" listener silences MapLibre's own logging, so log here.
  const onError = (event: { error?: { message?: string } }): void => {
    console.error(event.error);
    if (/\b404\b/u.test(event.error?.message ?? "")) check();
  };
  const onVisible = (): void => { if (document.visibilityState === "visible") check(); };
  map.on("error", onError);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    map.off("error", onError);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
```

### B1. Use a served style (simplest)

```ts
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { registerPmtiles, servedStyleUrl } from "@/lib/itstiles";

registerPmtiles(); // before the first map is created
const map = new maplibregl.Map({
  container: "map",                 // must have a height
  style: servedStyleUrl("light"),   // https://itstiles.com/styles/protomaps/light.json
  center: [13.405, 52.52],
  zoom: 11,
  maxZoom: 19,
  attributionControl: { compact: false },
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
```

The served style already contains the current archive URL, glyphs, sprites
and the attribution with the itstiles.com link. **`registerPmtiles()` is still
required**: the style's source URL is `pmtiles://https://itstiles.com/archives/…`,
which MapLibre can only read through the PMTiles protocol.

### B2. Build or recolour the style yourself

```ts
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { currentArchiveUrl, customStyle, registerPmtiles } from "@/lib/itstiles";

registerPmtiles();
const archiveUrl = await currentArchiveUrl(); // resolved from /maps/light.json at runtime
const map = new maplibregl.Map({
  container: "map",
  style: customStyle({
    archiveUrl,
    flavor: "light",          // base palette: light | dark | white | grayscale | black
    lang: "de",               // label language, see "Labels and languages"
    colors: {                 // FlavorOverrides: any Flavor key; pois/landcover merge key by key
      water: "#9cc3df",
      earth: "#f4f1ea",
      park_a: "#cfe6c4",
      park_b: "#bfe0b1",
      buildings: "#e4ded3",
      highway: "#f0b04a",
      major: "#ffffff",
      minor_a: "#ffffff",
      railway: "#a0a0a0",
      boundaries: "#9e9cab",
      city_label: "#3d3d3d",
      landcover: { forest: "#cfe3c8" },
      pois: { green: "#2f7a4d" },
    },
  }),
  center: [13.405, 52.52],
  zoom: 11,
  maxZoom: 19,
  attributionControl: { compact: false },
});
```

`colors` is deep-merged by `mergeFlavor()`: `pois` and `landcover` are nested
objects in the `Flavor` type, so a plain `{ ...namedFlavor("light"), ...colors }`
would replace them entirely. `white`, `grayscale` and `black` draw neither POI
icons nor landcover; their `pois`/`landcover` overrides have no effect.

All `Flavor` keys (5.7.2):

| Group | Keys |
| --- | --- |
| Base | `background`, `earth`, `water` |
| Land use | `park_a`, `park_b`, `wood_a`, `wood_b`, `scrub_a`, `scrub_b`, `glacier`, `sand`, `beach`, `hospital`, `industrial`, `school`, `pedestrian`, `aerodrome`, `runway`, `zoo`, `military`, `pier` |
| Landcover (nested `landcover`) | `barren`, `farmland`, `forest`, `glacier`, `grassland`, `scrub`, `urban_area` |
| Roads | `other`, `minor_service`, `minor_a`, `minor_b`, `link`, `major`, `highway`, `railway`; casings `minor_service_casing`, `minor_casing`, `link_casing`, `major_casing_early`, `major_casing_late`, `highway_casing_early`, `highway_casing_late` |
| Tunnels | `tunnel_other`, `tunnel_minor`, `tunnel_link`, `tunnel_major`, `tunnel_highway` and `tunnel_*_casing` for each |
| Bridges | `bridges_other`, `bridges_minor`, `bridges_link`, `bridges_major`, `bridges_highway` and `bridges_*_casing` for each |
| Boundaries, buildings | `boundaries`, `buildings` |
| Labels | `city_label`, `city_label_halo`, `state_label`, `state_label_halo`, `country_label`, `subplace_label`, `subplace_label_halo`, `roads_label_minor`, `roads_label_minor_halo`, `roads_label_major`, `roads_label_major_halo`, `ocean_label`, `address_label`, `address_label_halo` |
| POI icon colours (nested `pois`) | `blue`, `green`, `lapis`, `pink`, `red`, `slategray`, `tangerine`, `turquoise` |
| Fonts (optional) | `regular`, `bold`, `italic`: font names; only `Noto Sans Regular`, `Noto Sans Medium`, `Noto Sans Italic` are hosted |

Calling `layers("protomaps", flavor)` yourself without `lang` gives the
basemap without labels; `layers("protomaps", flavor, { lang: "en", labelsOnly: true })`
gives only the labels (for example to draw your data between the two).

Sprite icon names are those of the Protomaps v4 sprite; for your own icons
call `map.addImage()` or use `maplibregl.Marker`.

### Your own data on top

```ts
import { firstLabelLayerId } from "@/lib/itstiles";

function addOverlays(map: maplibregl.Map): void {
  map.addSource("deliveries", { type: "geojson", data: "/api/deliveries.geojson" });
  map.addLayer(
    { id: "delivery-areas", type: "fill", source: "deliveries", paint: { "fill-color": "#d6336c", "fill-opacity": 0.25 } },
    firstLabelLayerId(map), // beforeId: under the basemap labels ("address_label")
  );
}

map.on("style.load", () => addOverlays(map)); // runs again after every setStyle
new maplibregl.Marker({ color: "#d6336c" }).setLngLat([13.405, 52.52]).addTo(map); // markers survive setStyle
```

Basemap layer ids you can insert before: `water`, `buildings`,
`roads_tunnels_other_casing` (start of roads), `boundaries_country`,
`address_label` (first label layer). The source id is `protomaps`; its
source-layers are `boundaries`, `buildings`, `earth`, `landcover`,
`landuse`, `places`, `pois`, `roads`, `water`
([schema](https://docs.protomaps.com/basemaps/layers)).

### Dark mode / switching flavors

```ts
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const styleFor = (isDark: boolean) => servedStyleUrl(isDark ? "dark" : "light");
// new maplibregl.Map({ ..., style: styleFor(dark.matches) })
dark.addEventListener("change", (event) => {
  map.setStyle(styleFor(event.matches), { diff: false }); // full reload fires "style.load"
});
```

`setStyle` replaces all sources and layers, so re-add your own in a
`style.load` handler (above). With a custom style rebuild it with every
option, not only the flavor:
`customStyle({ archiveUrl, flavor: "dark", lang, colors: colorsFor.dark })`.

### Long-open pages and planet updates

When the planet is updated, the archive URL changes and the old file may be
deleted. A tab left open since before the update then gets 404s for new
tiles. `keepArchiveCurrent()` (helper module) re-reads the manifest when such
an error occurs and when the tab becomes visible again, at most once a
minute, and hands you the new archive URL:

```ts
const stop = keepArchiveCurrent(map, archiveUrl, (nextArchiveUrl) => {
  map.setStyle(customStyle({ archiveUrl: nextArchiveUrl, flavor, lang, colors }), { diff: false });
});
// later: stop();
```

With a served style, reload the style instead: in the callback call
`map.setStyle(servedStyleUrl(flavor), { diff: false })` (the served style is
regenerated with the new archive URL; allow for its short cache).

---

## Next.js (App Router or Pages Router)

MapLibre needs `window`, WebGL and a sized DOM element: render it only on the
client. This component covers recolouring per flavor, label language and your
own layers, and survives React Strict Mode and client navigations. Copy it
unchanged to `src/components/ItstilesMap.tsx`; it needs the helper module at
`src/lib/itstiles.ts` and passes `next lint` without warnings.

```tsx
"use client";

// src/components/ItstilesMap.tsx — copy unchanged. Needs src/lib/itstiles.ts.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  currentArchiveUrl,
  customStyle,
  keepArchiveCurrent,
  registerPmtiles,
  type FlavorOverrides,
  type ItstilesFlavor,
} from "@/lib/itstiles";

export interface ItstilesMapProps {
  /** [longitude, latitude]. Changing it moves the map. */
  center: [number, number];
  zoom: number;
  flavor?: ItstilesFlavor;
  /** Label language, e.g. "de". */
  lang?: string;
  /** Colour overrides per flavor, e.g. { light: { water: "#9cc3df" }, dark: { water: "#0b2a3a" } }. */
  colors?: Partial<Record<ItstilesFlavor, FlavorOverrides>>;
  /** Runs after every style load (first load and each flavor/lang/colour change): add your sources/layers here. */
  onStyleLoad?: (map: maplibregl.Map) => void;
  maxZoom?: number;
  className?: string;
  /** The map needs a height; default 420px. */
  height?: number | string;
}

export default function ItstilesMap({
  center, zoom, flavor = "light", lang = "en", colors, onStyleLoad, maxZoom = 19, className, height = 420,
}: ItstilesMapProps) {
  const [lng, lat] = center;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const archiveRef = useRef<string | null>(null);
  // Latest props for callbacks, updated after render (never read during render).
  const latest = useRef({ lng, lat, zoom, flavor, lang, colors, onStyleLoad, maxZoom });
  useEffect(() => {
    latest.current = { lng, lat, zoom, flavor, lang, colors, onStyleLoad, maxZoom };
  });
  const colorsKey = JSON.stringify(colors ?? {});

  // Create the map once per mount (Strict Mode mounts twice in dev: cleanup handles it).
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const abort = new AbortController();
    let map: maplibregl.Map | null = null;
    let stopWatching: (() => void) | undefined;
    const styleFor = (archiveUrl: string) => {
      const p = latest.current;
      return customStyle({ archiveUrl, flavor: p.flavor, lang: p.lang, colors: p.colors?.[p.flavor] });
    };
    registerPmtiles();
    currentArchiveUrl(abort.signal).then((archiveUrl) => {
      if (abort.signal.aborted) return;
      archiveRef.current = archiveUrl;
      const p = latest.current;
      const created = new maplibregl.Map({
        container: element,
        style: styleFor(archiveUrl),
        center: [p.lng, p.lat],
        zoom: p.zoom,
        maxZoom: p.maxZoom,
        cooperativeGestures: true,
        attributionControl: { compact: false },
      });
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      created.on("style.load", () => latest.current.onStyleLoad?.(created));
      stopWatching = keepArchiveCurrent(created, archiveUrl, (next) => {
        archiveRef.current = next;
        created.setStyle(styleFor(next), { diff: false });
      });
      map = created;
      mapRef.current = created;
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) console.error("itstiles map failed to start:", error);
    });
    return () => {
      abort.abort();
      stopWatching?.();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Flavor, language or colours changed: rebuild the style; "style.load" re-adds your layers.
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) { firstStyle.current = false; return; }
    const map = mapRef.current;
    const archiveUrl = archiveRef.current;
    if (!map || !archiveUrl) return;
    const p = latest.current;
    map.setStyle(customStyle({ archiveUrl, flavor, lang, colors: p.colors?.[flavor] }), { diff: false });
  }, [flavor, lang, colorsKey]);

  // Center/zoom props changed: move the existing map.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [lng, lat], zoom });
  }, [lng, lat, zoom]);

  return <div ref={container} className={className} style={{ width: "100%", height }} />;
}
```

`src/components/ItstilesMapLazy.tsx` keeps MapLibre out of the server bundle
and the first page load:

```tsx
"use client";

import dynamic from "next/dynamic";

export const ItstilesMapLazy = dynamic(() => import("./ItstilesMap"), {
  ssr: false,
  loading: () => <div style={{ height: 420, background: "#e9edf0", borderRadius: 12 }} aria-label="Loading map" />,
});
```

Use it from a page. Props that are functions or objects (`onStyleLoad`,
`colors`) must come from a Client Component, so wrap them in one:

```tsx
"use client";

import type maplibregl from "maplibre-gl";
import { firstLabelLayerId } from "@/lib/itstiles";
import { ItstilesMapLazy } from "@/components/ItstilesMapLazy";

const colors = {
  light: { water: "#9cc3df", earth: "#f4f1ea" },
  dark: { water: "#0b2a3a", earth: "#1c1f22" },
};

function addShops(map: maplibregl.Map): void {
  map.addSource("shops", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [13.405, 52.52] }, properties: { name: "Mitte" } },
    ] },
  });
  map.addLayer(
    { id: "shops", type: "circle", source: "shops", paint: { "circle-radius": 7, "circle-color": "#d6336c", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } },
    firstLabelLayerId(map),
  );
}

export default function ShopMap({ dark }: { dark: boolean }) {
  return <ItstilesMapLazy center={[13.405, 52.52]} zoom={12} flavor={dark ? "dark" : "light"} lang="de" colors={colors} onStyleLoad={addShops} />;
}
```

Notes:

- Define `colors` and `onStyleLoad` outside the component (or memoise them);
  the component only rebuilds the style when the flavor, language or the
  colours' contents change.
- `dynamic(..., { ssr: false })` is only allowed inside a Client Component in
  the App Router, so the wrapper file has `"use client"`.
- Importing `maplibre-gl/dist/maplibre-gl.css` from a component is allowed in
  both routers. Without it the controls and attribution render unstyled.
- The component fetches the manifest in the browser at mount; never call
  `currentArchiveUrl()` in a Server Component or at build time.
- For served styles only (no recolouring), B1 inside a `useEffect` with
  `return () => map.remove()` is enough.

---

## Content Security Policy

If your site sends a CSP, the map needs:

```
connect-src 'self' https://itstiles.com;
img-src 'self' data: blob: https://itstiles.com;
worker-src blob:;
child-src blob:;
```

- `connect-src`: manifests, styles, glyphs, sprites and archive Range
  requests are all `fetch` calls.
- `worker-src blob:` (and `child-src blob:` for older Safari): MapLibre starts
  its tile workers from a `blob:` URL. Without it the map stays blank.
- Option A additionally needs `script-src https://itstiles.com` and
  `style-src https://itstiles.com`, and no inline script/style (see Option A).
- No `unsafe-eval` is needed.

---

## Performance

- Create the map only when it is about to be visible (the `dynamic` import
  above, or an `IntersectionObserver` that mounts the component).
- Use `cooperativeGestures: true` for maps inside scrolling pages.
- Call `registerPmtiles()` once; all maps on the page then share one PMTiles
  header/directory cache.
- Prefer one map per page; each map has its own WebGL context (browsers cap
  them at roughly 16).
- Start at the zoom you need: a city view loads a handful of tiles.
- Always `map.remove()` on unmount.

## Labels and languages

The served styles use English labels (`name:en`, falling back to the local
name). For another language, build the style yourself (B2, or the Next.js
component's `lang`): `ar`, `bg`, `cs`, `da`, `de`, `el`, `en`, `es`, `et`,
`fa`, `fi`, `fr`, `ga`, `he`, `hi`, `hr`, `hu`, `id`, `it`, `ja`, `ko`, `lt`,
`lv`, `mr`, `mt`, `ne`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`,
`tr`, `uk`, `ur`, `vi`, `zh-Hans`, `zh-Hant`. Latin, Cyrillic and Greek labels
are covered by the hosted Noto Sans fonts. Arabic and Hebrew need MapLibre's
RTL text plugin (`maplibregl.setRTLTextPlugin(...)`, an external script you
host or load). Check other scripts visually before shipping.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank/grey area, no errors | Container has 0 px height | Give the container an explicit height |
| Blank map, console `pmtiles` / "unknown protocol" / failed to fetch `pmtiles://…` | Protocol not registered (or registered on a different `maplibre-gl` copy) | Call `registerPmtiles()` before `new Map`, using the same `maplibre-gl` import |
| Blank map, CSP violation for `blob:` | `worker-src` missing | Add `worker-src blob:; child-src blob:` |
| Option A does nothing, CSP violation for an inline script | Inline module script blocked | Move it to a same-origin `.js` file or add a `nonce` |
| CORS error | Request blocked by your CSP `connect-src`, a proxy rewriting URLs, or a typo (http/other host). itstiles.com sends `Access-Control-Allow-Origin: *` | Allow `https://itstiles.com` in `connect-src`; use exact `https://itstiles.com/...` URLs |
| 404 on `/archives/<sha256>.pmtiles` | A hard-coded, cached or long-open old archive URL after a planet update | Use a served style URL or resolve the archive from `/maps/<flavor>.json` at runtime; `keepArchiveCurrent()` for long-open pages |
| 404 on `…/fonts/<name>/…pbf` | A `text-font` that is not hosted | Use `Noto Sans Regular`, `Noto Sans Medium` or `Noto Sans Italic` |
| Icons missing, "Image … could not be loaded" | Custom style without `sprite`, or a custom icon name | Keep `sprite: https://itstiles.com/styles/sprites/v4/<flavor>`; `map.addImage()` your own icons |
| Recoloured POIs/forests ignored | Overrides for nested `pois`/`landcover` replaced instead of merged, or flavor `white`/`grayscale`/`black` | Use `mergeFlavor()` / `customStyle({ colors })`; use `light` or `dark` |
| Labels switch back to English after dark mode | Style rebuilt without `lang` | Pass `lang` (and `colors`) on every rebuild |
| Map at null island / whole world | No `center`/`zoom` passed (planet manifest centre is `[0, 0, 0]`) | Pass `center` and `zoom` |
| Attribution missing, collapsed or without itstiles.com link | `attributionControl: false`, default compact mode, CSS hiding `.maplibregl-ctrl-attrib`, or a custom source without `ATTRIBUTION` | `attributionControl: { compact: false }`; source `attribution: ATTRIBUTION` |
| Your layers vanish after dark-mode switch | `setStyle` replaces all layers | Re-add them in `map.on("style.load", ...)` (the component's `onStyleLoad`) |
| React dev: two maps / "map already removed" | Strict Mode double mount without cleanup | Return `() => map.remove()` from the effect (the component does) |
| `window is not defined` during build | MapLibre imported in a Server Component / SSR | `"use client"` + `dynamic(..., { ssr: false })` |

## Checklist for agents

1. Choose A (`/assets/embed.js`) or B (npm). Apps with a bundler: B.
2. B: `npm i -E maplibre-gl@5.24.0 pmtiles@4.3.0 @protomaps/basemaps@5.7.2`.
3. Copy the helper module unchanged to `src/lib/itstiles.ts` (or `lib/itstiles.ts`),
   and for Next.js the `ItstilesMap` component unchanged.
4. Call `registerPmtiles()` before creating any map (the component does).
5. Use `servedStyleUrl(flavor)`, or `customStyle({ archiveUrl: await currentArchiveUrl(), flavor, lang, colors })`.
   Never hard-code `/archives/<sha256>.pmtiles`; never resolve it at build time.
6. Pass `center` `[lng, lat]` and `zoom`; set `maxZoom` ≈ 19.
7. Next.js: `"use client"`, `dynamic(..., { ssr: false })`, explicit container height.
8. Own data: add in `style.load` / `onStyleLoad`, before `firstLabelLayerId(map)`.
9. CSP: `connect-src https://itstiles.com`, `img-src data: blob: https://itstiles.com`, `worker-src blob:`, `child-src blob:`; no inline script for Option A.
10. Keep the attribution with the **itstiles.com link** visible (`compact: false`).
11. Verify in a browser: tiles load (206 responses from `/archives/…`), labels
    render (glyph requests 200), no console errors, map works at 390 px width.
