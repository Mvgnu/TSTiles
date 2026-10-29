# Using itstiles.com maps in another project

This guide is for people, and coding agents, adding a map to a website or app
(Next.js, React, plain HTML) using the public map service at
**https://itstiles.com**. You only need public URLs. There is no API key,
account, SDK registration or server-side code.

The map is a vector basemap of the whole planet (Protomaps daily build, basemap
schema 4.x, OpenStreetMap data). Tiles are read straight from one PMTiles file
with HTTP Range requests, and the visitor's browser draws the map with
[MapLibre GL JS](https://maplibre.org/).

Pick one option:

| Option | Use it when | Code |
| --- | --- | --- |
| [A. iframe](#option-a-iframe-no-code) | A static page needs a map and nothing else | One HTML tag |
| [B. `createMapViewer`](#option-b-createmapviewer-from-assetsembedjs) | A plain site without a bundler wants a scriptable map | One `<script type="module">` |
| [C. npm packages](#option-c-recommended-for-apps-maplibre-gl--pmtiles--protomapsbasemaps) | **Next.js / React / any bundled app**, custom colours, your own data | A small helper module and component |

---

## 1. What is served

Everything below is public, read-only and allows cross-origin reads
(`Access-Control-Allow-Origin: *`, no credentials). "Short, revalidated"
means a few minutes at the origin; a CDN in front of itstiles.com may
currently let browsers keep `/assets/` files somewhat longer, so after a
deploy allow for a delay or hard-reload. Do not depend on an exact duration.

| URL | What it is | Caching |
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
| `https://itstiles.com/?embed=1&manifest=./maps/<flavor>.json` | Ready-made iframe viewer | `no-cache` |

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
`new URL(value, manifestUrl)`.

### Rules that always apply

- **Never hard-code the archive URL or its digest.** The file name changes
  whenever the planet is updated, and the old file may be deleted the same day
  (the server disk holds one planet). Use a served style URL (it is regenerated
  on update) or fetch a manifest at runtime and resolve `archive` from it. Do
  not read the manifest at build time (for example in Next.js static
  generation) — that freezes the digest into your build.
- **Attribution is required.** Keep MapLibre's attribution control visible; it
  shows `Protomaps © OpenStreetMap contributors` from the style. OpenStreetMap
  data is licensed under the ODbL. Do not set `attributionControl: false`
  unless you show the same text visibly on the map yourself.
- **Zoom:** the archive holds zoom levels 0–15. Beyond 15 MapLibre overzooms
  the z15 tiles (sharp vectors, no extra detail), so a `maxZoom` around 18–20
  is sensible.
- The planet manifest's `center` is `[0, 0, 0]` (whole world). Always pass
  your own `center` and `zoom`.
- **Public service:** there is no key and no access control. CORS is not a
  security boundary. Do not put private data in requests to itstiles.com.

---

## Option A: iframe (no code)

```html
<iframe
  src="https://itstiles.com/?embed=1&manifest=./maps/light.json&center=13.405,52.52&zoom=11"
  title="Map of Berlin"
  width="100%" height="420"
  style="border:0;border-radius:12px"
  loading="lazy"
></iframe>
```

- `manifest`: `./maps/<flavor>.json` (resolved against itstiles.com) or the
  absolute manifest URL.
- `center=<longitude>,<latitude>` and `zoom=<0–24>` set the initial view.
  Invalid values show an error in the frame instead of a map.
- Embedded maps use cooperative gestures (Ctrl/⌘ + scroll to zoom, two
  fingers to pan on phones) so the page still scrolls.
- CSP on your page: `frame-src https://itstiles.com`.

You cannot add your own data to an iframe map. Use B or C for that.

---

## Option B: `createMapViewer` from `/assets/embed.js`

For plain sites without a bundler. The module includes MapLibre and the
PMTiles protocol; it validates the manifest, loads the manifest's style and
reports clear status messages.

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
the `try`/`catch` still shows what went wrong. Failed tile, style or archive
requests later report `error` the same way (with the failing source URL).
Rotation is disabled; zoom buttons and a metric scale bar are added.

Caveats: `embed.js` is not versioned (it can change on deploy; browsers keep
it for a short, revalidated period) and carries its own MapLibre copy. Do not mix `viewer.map` with a
separately installed `maplibre-gl`. Apps with a bundler should use Option C.
CSP: `script-src https://itstiles.com`, `style-src https://itstiles.com`, plus
the [map CSP](#content-security-policy).

---

## Option C (recommended for apps): `maplibre-gl` + `pmtiles` + `@protomaps/basemaps`

Install the same versions itstiles.com is built with:

```sh
npm i maplibre-gl@5.24.0 pmtiles@4.3.0 @protomaps/basemaps@5.7.2
```

`@protomaps/basemaps` is only needed if you build or recolour the style
yourself (C2). Pin it: its layer output must match the archive's basemap
schema, and the itstiles.com styles are generated with 5.7.2.

### The helper module

Copy this file as-is into your project (for example `lib/itstiles.ts`). It
type-checks against the versions above and is tested in this repository.

```ts
// lib/itstiles.ts — shared helpers for maps served by https://itstiles.com
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";

export const ITSTILES = "https://itstiles.com";
export const ATTRIBUTION = "Protomaps © OpenStreetMap contributors";
export type ItstilesFlavor = "light" | "dark" | "white" | "grayscale" | "black";

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

/** Build your own style from the same archive, fonts and sprites. */
export function customStyle(options: {
  archiveUrl: string;
  flavor?: ItstilesFlavor;
  lang?: string;
  colors?: Partial<Flavor>;
}): StyleSpecification {
  const flavorName = options.flavor ?? "light";
  const flavor: Flavor = { ...namedFlavor(flavorName), ...options.colors };
  return {
    version: 8,
    glyphs: `${ITSTILES}/styles/fonts/{fontstack}/{range}.pbf`,
    sprite: `${ITSTILES}/styles/sprites/v4/${flavorName}`,
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${options.archiveUrl}`, attribution: ATTRIBUTION },
    },
    layers: layers("protomaps", flavor, { lang: options.lang ?? "en" }),
  };
}

/** Insert your own layers before this id so basemap labels stay on top. */
export function firstLabelLayerId(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}
```

### C1. Use a served style (simplest)

```ts
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { registerPmtiles, servedStyleUrl } from "./lib/itstiles";

registerPmtiles(); // before the first map is created
const map = new maplibregl.Map({
  container: "map",                 // must have a height
  style: servedStyleUrl("light"),   // https://itstiles.com/styles/protomaps/light.json
  center: [13.405, 52.52],
  zoom: 11,
  maxZoom: 19,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
```

The served style already contains the current archive URL, glyphs, sprites
and attribution. **`registerPmtiles()` is still required**: the style's
source URL is `pmtiles://https://itstiles.com/archives/…`, which MapLibre can
only read through the PMTiles protocol.

### C2. Build or recolour the style yourself

```ts
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { currentArchiveUrl, customStyle, registerPmtiles } from "./lib/itstiles";

registerPmtiles();
const archiveUrl = await currentArchiveUrl(); // resolved from /maps/light.json at runtime
const map = new maplibregl.Map({
  container: "map",
  style: customStyle({
    archiveUrl,
    flavor: "light",          // base palette: light | dark | white | grayscale | black
    lang: "de",               // label language, see "Labels and languages"
    colors: {                 // any key of the Flavor type from @protomaps/basemaps
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
    },
  }),
  center: [13.405, 52.52],
  zoom: 11,
  maxZoom: 19,
});
```

`colors` overrides keys of `namedFlavor(flavor)`. Useful keys: `background`,
`earth`, `water`, `park_a`/`park_b`, `wood_a`/`wood_b`, `sand`, `glacier`,
`buildings`, `highway`, `major`, `minor_a`/`minor_b`, `minor_service`, `link`,
`railway`, `boundaries`, `*_casing*`, `tunnel_*`, `bridges_*`, and the label
colours `city_label`, `state_label`, `country_label`, `subplace_label`,
`roads_label_minor`, `roads_label_major`, `ocean_label`, `address_label` (with
matching `*_halo` keys). The TypeScript `Flavor` type lists all of them.
Calling `layers("protomaps", flavor)` yourself without `lang` gives the
basemap without labels; `layers("protomaps", flavor, { lang: "en", labelsOnly: true })`
gives only the labels (for example to draw your data between the two).

Fonts are limited to what is hosted: `Noto Sans Regular`, `Noto Sans Medium`,
`Noto Sans Italic`. Use one of these in your own `text-font`. Sprite icon
names are those of the Protomaps v4 sprite; for your own icons call
`map.addImage()` or use `maplibregl.Marker`.

### Your own data on top

```ts
import { firstLabelLayerId } from "./lib/itstiles";

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
`style.load` handler (above). With a custom style pass
`customStyle({ archiveUrl, flavor: "dark" })` instead of the URL.

---

## Next.js (App Router or Pages Router)

MapLibre needs `window`, WebGL and a sized DOM element. Render it only on the
client.

`components/ItstilesMap.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { registerPmtiles, servedStyleUrl, type ItstilesFlavor } from "@/lib/itstiles";

export interface ItstilesMapProps {
  center: [number, number]; // [longitude, latitude]
  zoom: number;
  flavor?: ItstilesFlavor;
  className?: string;
}

export default function ItstilesMap({ center, zoom, flavor = "light", className }: ItstilesMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleRef = useRef(flavor);

  // Create the map once per mount; later prop changes move or restyle it.
  useEffect(() => {
    if (!container.current) return;
    registerPmtiles();
    const map = new maplibregl.Map({
      container: container.current,
      style: servedStyleUrl(styleRef.current),
      center,
      zoom,
      maxZoom: 19,
      cooperativeGestures: true,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {          // React Strict Mode mounts twice in dev: always clean up
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint may ask for center/zoom here: they are applied by the effect below

  useEffect(() => {
    if (styleRef.current === flavor) return;
    styleRef.current = flavor;
    mapRef.current?.setStyle(servedStyleUrl(flavor), { diff: false });
  }, [flavor]);

  useEffect(() => { mapRef.current?.jumpTo({ center, zoom }); }, [center[0], center[1], zoom]);

  // The container needs an explicit height, or the map is 0 px tall.
  return <div ref={container} className={className} style={{ width: "100%", height: 420 }} />;
}
```

`components/ItstilesMapLazy.tsx` (keeps MapLibre out of the server bundle and
the first page load):

```tsx
"use client";

import dynamic from "next/dynamic";

export const ItstilesMapLazy = dynamic(() => import("./ItstilesMap"), {
  ssr: false,
  loading: () => <div style={{ height: 420, background: "#e9edf0", borderRadius: 12 }} aria-label="Loading map" />,
});
```

Use it from any page or Server Component:

```tsx
import { ItstilesMapLazy } from "@/components/ItstilesMapLazy";

export default function Page() {
  return <ItstilesMapLazy center={[13.405, 52.52]} zoom={11} flavor="light" />;
}
```

Notes:

- `dynamic(..., { ssr: false })` is only allowed inside a Client Component in
  the App Router, so the wrapper file has `"use client"`.
- Importing `maplibre-gl/dist/maplibre-gl.css` from a component is allowed in
  both routers. Without it the controls and attribution render unstyled and
  markers misplace.
- Pass a stable `center` (not a new array literal on every render), or rely on
  the `[center[0], center[1], zoom]` dependency as above.
- If you use C2 (`currentArchiveUrl()`), call it inside the effect, abort it
  with an `AbortController` in the cleanup, and create the map after it
  resolves. Never call it in a Server Component or at build time.

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
- Option A adds `frame-src https://itstiles.com`. Option B adds
  `script-src https://itstiles.com` and `style-src https://itstiles.com`.
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
- Start at the zoom you need: a city view loads a handful of tiles; the world
  view at zoom 0–2 is also cheap. Panning across many cities loads many tiles.
- Always `map.remove()` on unmount.

## Labels and languages

The served styles use English labels (`name:en`, falling back to the local
name). For another language, build the style yourself (C2) with `lang`:
`ar`, `bg`, `cs`, `da`, `de`, `el`, `en`, `es`, `et`, `fa`, `fi`, `fr`,
`ga`, `he`, `hi`, `hr`, `hu`, `id`, `it`, `ja`, `ko`, `lt`, `lv`, `mr`, `mt`,
`ne`, `nl`, `no`, `pl`, `pt`, `ro`, `ru`, `sk`, `sl`, `sv`, `tr`, `uk`, `ur`,
`vi`, `zh-Hans`, `zh-Hant`. Latin, Cyrillic and Greek labels are covered by
the hosted Noto Sans fonts. Arabic and Hebrew need MapLibre's RTL text plugin
(`maplibregl.setRTLTextPlugin(...)`, an external script you host or load).
Check other scripts visually before shipping.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank/grey area, no errors | Container has 0 px height | Give the container an explicit height |
| Blank map, console `pmtiles` / "unknown protocol" / failed to fetch `pmtiles://…` | Protocol not registered (or registered on a different `maplibre-gl` copy) | Call `registerPmtiles()` before `new Map`, using the same `maplibre-gl` import |
| Blank map, CSP violation for `blob:` | `worker-src` missing | Add `worker-src blob:; child-src blob:` |
| CORS error | Request blocked by your CSP `connect-src`, a proxy rewriting URLs, or a typo (http/other host). itstiles.com sends `Access-Control-Allow-Origin: *` | Allow `https://itstiles.com` in `connect-src`; use exact `https://itstiles.com/...` URLs |
| 404 on `/archives/<sha256>.pmtiles` | A hard-coded or cached old archive URL after a planet update | Use a served style URL or resolve the archive from `/maps/<flavor>.json` at runtime |
| 404 on `…/fonts/<name>/…pbf` | A `text-font` that is not hosted | Use `Noto Sans Regular`, `Noto Sans Medium` or `Noto Sans Italic` |
| Icons missing, "Image … could not be loaded" | Custom style without `sprite`, or a custom icon name | Keep `sprite: https://itstiles.com/styles/sprites/v4/<flavor>`; `map.addImage()` your own icons |
| No roads/labels, only land and water | Zoomed out (detail appears with zoom) or style layer filters changed | Zoom in; compare with the served style |
| Map at null island / whole world | No `center`/`zoom` passed (planet manifest centre is `[0, 0, 0]`) | Pass `center` and `zoom` |
| Attribution missing or wrong | `attributionControl: false`, CSS hiding `.maplibregl-ctrl-attrib`, or a custom source without `attribution` | Keep the control visible; source `attribution: "Protomaps © OpenStreetMap contributors"` |
| Your layers vanish after dark-mode switch | `setStyle` replaces all layers | Re-add them in `map.on("style.load", ...)` |
| React dev: two maps / "map already removed" | Strict Mode double mount without cleanup | Return `() => map.remove()` from the effect |
| `window is not defined` during build | MapLibre imported in a Server Component / SSR | `"use client"` + `dynamic(..., { ssr: false })` |

## Checklist for agents

1. Choose A (iframe), B (`/assets/embed.js`) or C (npm). Apps with a bundler: C.
2. C: install exactly `maplibre-gl@5.24.0 pmtiles@4.3.0` (plus
   `@protomaps/basemaps@5.7.2` only for custom styles).
3. Copy `lib/itstiles.ts` from this guide unchanged.
4. Call `registerPmtiles()` before creating any map.
5. Use `servedStyleUrl(flavor)`, or `customStyle({ archiveUrl: await currentArchiveUrl(), ... })`.
   Never hard-code `/archives/<sha256>.pmtiles`; never resolve it at build time.
6. Pass `center` `[lng, lat]` and `zoom`; set `maxZoom` ≈ 19.
7. Next.js: `"use client"`, `dynamic(..., { ssr: false })`, import
   `maplibre-gl/dist/maplibre-gl.css`, explicit container height, `map.remove()` in cleanup.
8. Own data: add on `style.load`, insert before `firstLabelLayerId(map)`.
9. CSP: `connect-src https://itstiles.com`, `img-src data: blob: https://itstiles.com`, `worker-src blob:`, `child-src blob:`.
10. Keep the attribution `Protomaps © OpenStreetMap contributors` visible.
11. Verify in a browser: tiles load (206 responses from `/archives/…`), labels
    render (glyph requests 200), no console errors, map works at 390 px width.
