# Styleguide: a distinctive map for every site

This guide is for agents building maps on sites that should each feel like
their own brand, all on the free itstiles.com basemap. It assumes the setup
from [docs/integration.md](integration.md): Option B (npm), the helper module
`src/lib/itstiles.ts` and, for Next.js, the `ItstilesMap` component. Every
theme below is plain data plus small layer edits; you never fork the
Protomaps layer code.

**Non-negotiable on every theme:** keep the attribution with the visible
itstiles.com link (`ATTRIBUTION` in the helper; `attributionControl: { compact: false }`).

## 1. How a theme is built

1. Pick a **base flavor** (`light`, `dark`, `white`, `grayscale`, `black`).
   It supplies every colour you do not set, and the sprite sheet (POI icons,
   shields, arrows). Only `light` and `dark` draw POI icons and landcover.
2. Override **flavor keys** with your palette (`FlavorOverrides`, deep-merged
   by `mergeFlavor()`, so `pois` and `landcover` can be set key by key).
3. Optionally **tune layers**: hide POIs, thin out labels, extrude buildings.
4. Build with `themedStyle(archiveUrl, theme, lang)` (below) or pass
   `colors` to the `ItstilesMap` component.

Start from the nearest base: a cream map from `light`, a dark map from
`dark`, a near-monochrome map from `grayscale` or `white`.

## 2. Flavor key reference (`@protomaps/basemaps` 5.7.2)

| Group | Keys | What they colour |
| --- | --- | --- |
| Background | `background` | Behind everything (visible at the poles and while loading) |
| Land | `earth` | All land; your page/paper colour |
| Water | `water` | Sea, lakes, rivers (fill and lines) |
| Green land use | `park_a`, `park_b` (park, low → high zoom), `wood_a`, `wood_b`, `scrub_a`, `scrub_b`, `zoo` | Parks, forests in land use, scrub |
| Other land use | `hospital`, `industrial`, `school`, `pedestrian`, `military`, `aerodrome`, `runway`, `pier`, `sand`, `beach`, `glacier` | Area fills |
| Landcover (nested `landcover`, light/dark only) | `barren`, `farmland`, `forest`, `glacier`, `grassland`, `scrub`, `urban_area` | Low-zoom natural-earth colours |
| Roads by class | `highway` (motorways), `major` (primary/secondary), `minor_a`, `minor_b` (residential, low → high zoom), `minor_service`, `link` (ramps), `other` (paths), `railway` | Road lines |
| Road casings | `highway_casing_early`, `highway_casing_late`, `major_casing_early`, `major_casing_late`, `minor_casing`, `minor_service_casing`, `link_casing` | Outlines (early = low zoom, late = high zoom) |
| Tunnels | `tunnel_highway`, `tunnel_major`, `tunnel_minor`, `tunnel_link`, `tunnel_other` + `tunnel_*_casing` | Usually a lighter/duller road colour |
| Bridges | `bridges_highway`, `bridges_major`, `bridges_minor`, `bridges_link`, `bridges_other` + `bridges_*_casing` | Usually equal to the road colour |
| Boundaries | `boundaries` | Country and region lines |
| Buildings | `buildings` | Building footprints (z14+) |
| Place labels | `country_label`, `state_label`, `state_label_halo`, `city_label`, `city_label_halo`, `subplace_label`, `subplace_label_halo` | Text and halo |
| Other labels | `roads_label_major`, `roads_label_major_halo`, `roads_label_minor`, `roads_label_minor_halo`, `address_label`, `address_label_halo`, `ocean_label` | Street names, house numbers, seas |
| POI icons (nested `pois`, light/dark only) | `blue`, `green`, `lapis`, `pink`, `red`, `slategray`, `tangerine`, `turquoise` | Icon/text colour per POI category group |
| Fonts | `regular`, `bold`, `italic` | Font names (see Typography) |

## 3. Palette recipes from brand tokens

Map 3–5 brand tokens onto the basemap; `brandPalette()` below does exactly this:

| Brand token | Map keys | Rule |
| --- | --- | --- |
| Page background (`paper`) | `earth`, `background`, minor roads, label halos | The map should sit *on* the page, not fight it |
| Body text (`ink`) | all `*_label`, `boundaries` | Contrast ≥ 4.5:1 against `earth` (check with `contrastRatio()`) |
| Brand colour (`accent`) | `highway` (+ casings) | One accent only; never on water or large areas |
| Cool desaturated tone (`water`) | `water` | Lower saturation than the accent; ≥ 1.3:1 against `earth` so coasts read |
| In-between tone (`muted`) | `buildings` | Just visible against `earth` (≈ 1.1–1.3:1) |

Further rules:

- **Few hues.** Land, water, one accent, greys. Parks: mix the paper colour
  with a little green rather than using a saturated green.
- **Roads by hierarchy, not by hue:** motorway (accent) > major (lighter or
  darker than land) > minor (close to land). Casings are 5–15 % darker than
  the land in light themes, darker than the road in dark themes.
- **Labels:** halo = land colour, text = ink. Never coloured text on coloured
  land without checking contrast.
- **Your data wins.** If the site draws its own markers or areas, the basemap
  should be quieter than them (see "Backdrop vs. hero").

## 4. Typography

itstiles.com hosts exactly three glyph sets: **Noto Sans Regular**, **Noto Sans
Medium** and **Noto Sans Italic**. Any other `text-font` produces 404s and
missing labels. Use them like this:

- Heavier labels overall: `colors: { regular: "Noto Sans Medium" }`.
- Water names are already italic; place names use Regular/Medium.
- For your own layers: `layout: { "text-font": ["Noto Sans Medium"], "text-size": 13 }`.
- Text sizes of basemap layers are zoom expressions; to change one, replace
  it in `tune` (e.g. set `text-size` on `places_locality` to your own
  `["interpolate", ["linear"], ["zoom"], 6, 12, 14, 18]`). Do not wrap an
  existing zoom expression in `["*", …]`: zoom expressions must stay top-level.
- A brand typeface on the map needs its own glyph PBFs (build them with
  [font-maker](https://github.com/maplibre/font-maker)) hosted by you, and
  your own `glyphs` URL that serves *both* your font and the Noto fonts.

## 5. Label density and declutter

- `withoutPois` removes POI icons and names (shops, stations, attractions).
- `fewerLabels` removes house numbers, minor street names, neighbourhoods
  and river names.
- Hide one layer at runtime: `map.setLayoutProperty("pois", "visibility", "none")`.
- Show labels only from a zoom: in `tune`, set `minzoom` on a layer.
- Layer ids you will use: `pois`, `address_label`, `roads_labels_minor`,
  `roads_labels_major`, `places_subplace`, `places_locality`,
  `places_region`, `places_country`, `water_label_ocean`, `water_waterway_label`.

## 6. Backdrop vs. hero maps

- **Backdrop** (store finders, data, real-estate listings): `white` or
  `grayscale` base, `withoutPois`, `fewerLabels`, low-contrast roads, and
  your data in the brand colour on top, inserted *below* `address_label`
  (`firstLabelLayerId(map)`) so street names stay readable. Theme: `leise`.
- **Hero** (landing pages, "where we are"): stronger palette, 3D buildings,
  a single marker. Theme: `nacht` or `papier`. Keep it static-looking:
  `cooperativeGestures: true`, no auto-rotation.

## 7. Dark mode

Build a light and a dark theme from the same tokens (paper ↔ ink swapped,
water darker than land in dark mode, accent slightly desaturated) and pass
both to the component: `colors={{ light: {...}, dark: {...} }}` with
`flavor={dark ? "dark" : "light"}`. The component rebuilds the style and
re-adds your layers via `onStyleLoad`. Do not invert colours with CSS filters
(it inverts the attribution and markers too).

## 8. 3D buildings

`with3dBuildings(color, opacity)` replaces the flat `buildings` layer by a
`fill-extrusion` from zoom 14, using the OSM `height` (and `min_height`) where
mapped and ~6 m otherwise. Tilt the camera to see it:
`new maplibregl.Map({ …, pitch: 50 })` and keep `maxPitch` ≤ 60. Use it for
city-centre hero maps; it costs GPU time on phones.

## 9. Markers and popups in the brand

```ts
const el = document.createElement("div");
el.className = "brand-marker";              // style it in your CSS: size, colour, shadow
el.setAttribute("aria-label", "Unser Laden");
new maplibregl.Marker({ element: el, anchor: "bottom" })
  .setLngLat([9.0576, 48.5216])
  .setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setText("Unser Laden · Haaggasse 10"))
  .addTo(map);
```

Style `.maplibregl-popup-content` with your brand font (popups are HTML, so
any web font works there), and `.maplibregl-popup-tip` with the same
background colour. Many points: use a GeoJSON `circle` or `symbol` layer
(with `map.addImage()` icons) instead of hundreds of DOM markers.

## 10. Not available

- **Terrain, hillshade, contours, satellite imagery:** the archive is a
  vector basemap only. Do not add third-party raster sources silently; they
  are separate providers with their own terms and privacy implications.
- Other fonts than the three Noto Sans glyph sets (see Typography).
- Data beyond z15 (overzoom is fine up to ~19).

## 11. Accessibility

- Label text ≥ 4.5:1 against the land colour; the theme tests in this
  repository assert it with `contrastRatio()`.
- Never encode meaning in colour alone on your own layers (add icons, labels
  or patterns).
- Give the map container `role="region"` and an `aria-label`; offer the same
  information (address, list of locations) as text outside the map.
- Respect reduced motion: `const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;`
  then `map.flyTo({ …, animate: !reduce })` or use `jumpTo`.
- Keep `cooperativeGestures: true` in scrolling pages so keyboard and touch
  users are not trapped.

## 12. Performance

- Everything in a theme is client-side data; it costs nothing on the server.
- `fill-extrusion`, many labels and many DOM markers cost GPU/CPU on phones;
  prefer `withoutPois`/`fewerLabels` for maps that are mostly decoration.
- Build the style once per (theme, language); reuse the object.
- See the performance section of [integration.md](integration.md#performance).

## 13. Example themes (tested code)

Copy as `src/lib/map-themes.ts`. In this repository the file is type-checked,
every theme is validated with the MapLibre style-spec validator and its
label contrast is asserted.

```ts
// src/lib/map-themes.ts — site-specific map themes on top of src/lib/itstiles.ts
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { customStyle, type FlavorOverrides, type ItstilesFlavor } from "@/lib/itstiles";

export interface MapTheme {
  name: string;
  /** Base palette whose keys you override; also selects the sprite sheet. */
  base: ItstilesFlavor;
  colors: FlavorOverrides;
  /** Optional layer edits: hide POIs, thin out labels, 3D buildings … */
  tune?: (layers: LayerSpecification[]) => LayerSpecification[];
}

export function themedStyle(archiveUrl: string, theme: MapTheme, lang = "de"): StyleSpecification {
  const style = customStyle({ archiveUrl, flavor: theme.base, lang, colors: theme.colors });
  return { ...style, layers: theme.tune ? theme.tune(style.layers) : style.layers };
}

// ---- Layer recipes ---------------------------------------------------------

/** No POI icons and labels (shops, stations, parks as icons). */
export const withoutPois = (layers: LayerSpecification[]): LayerSpecification[] =>
  layers.filter((layer) => layer.id !== "pois");

/** Calmer maps: drop house numbers, minor street names, neighbourhoods and river names. */
export const fewerLabels = (layers: LayerSpecification[]): LayerSpecification[] =>
  layers.filter((layer) => !["address_label", "roads_labels_minor", "places_subplace", "water_waterway_label"].includes(layer.id));

/** Replace flat buildings by extrusions from zoom 14 (OSM `height`, else ~2 storeys). */
export function with3dBuildings(color: string, opacity = 0.85) {
  return (layers: LayerSpecification[]): LayerSpecification[] => layers.map((layer) => layer.id !== "buildings" ? layer : {
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "protomaps",
    "source-layer": "buildings",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": color,
      "fill-extrusion-height": ["coalesce", ["get", "height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
      "fill-extrusion-opacity": opacity,
    },
  });
}

/** Apply several recipes in order. */
export const pipe = (...steps: Array<(layers: LayerSpecification[]) => LayerSpecification[]>) =>
  (layers: LayerSpecification[]): LayerSpecification[] => steps.reduce((current, step) => step(current), layers);

// ---- Brand tokens → palette --------------------------------------------------

export interface BrandTokens {
  /** Page background, light or dark: becomes the land. */
  paper: string;
  /** Body text colour: becomes labels and boundaries. */
  ink: string;
  /** One brand colour: becomes motorways (use sparingly). */
  accent: string;
  /** A cool, desaturated tone: becomes water. */
  water: string;
  /** A tone between paper and ink: becomes buildings and minor details. */
  muted: string;
}

/** Map 5 brand tokens onto the basemap. Check label contrast with contrastRatio(). */
export function brandPalette(t: BrandTokens): FlavorOverrides {
  return {
    background: t.paper, earth: t.paper, water: t.water,
    buildings: t.muted, pedestrian: t.paper, pier: t.paper,
    highway: t.accent, highway_casing_early: t.accent, highway_casing_late: t.accent,
    major: t.paper, minor_a: t.paper, minor_b: t.paper, minor_service: t.paper, link: t.paper, other: t.paper,
    boundaries: t.ink,
    city_label: t.ink, state_label: t.ink, country_label: t.ink, subplace_label: t.ink,
    roads_label_major: t.ink, roads_label_minor: t.ink, address_label: t.ink, ocean_label: t.ink,
    city_label_halo: t.paper, state_label_halo: t.paper, subplace_label_halo: t.paper,
    roads_label_major_halo: t.paper, roads_label_minor_halo: t.paper, address_label_halo: t.paper,
  };
}

/** WCAG contrast ratio of two #rrggbb colours (≥ 4.5 for label text on land). */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// ---- Example themes --------------------------------------------------------

/** Warm printed-map look for editorial or travel sites. */
export const papier: MapTheme = {
  name: "Papier",
  base: "light",
  colors: {
    background: "#f3eee2", earth: "#f3eee2", water: "#b9cfd6",
    park_a: "#dfe3c8", park_b: "#d6dcbc", wood_a: "#d9dfc3", wood_b: "#d0d8b8",
    buildings: "#e2d9c6", pedestrian: "#efe8d8", sand: "#efe4c8", beach: "#efe4c8",
    highway: "#e8b87d", highway_casing_early: "#c99a62", highway_casing_late: "#c99a62",
    major: "#fbf8f0", major_casing_early: "#d8ccb4", major_casing_late: "#d8ccb4",
    minor_a: "#fbf8f0", minor_b: "#fbf8f0", minor_casing: "#e0d6c2", railway: "#a89f8c",
    boundaries: "#9b8f7a",
    city_label: "#3b3328", city_label_halo: "#f3eee2", state_label: "#5b5140", country_label: "#4a4033",
    subplace_label: "#5b5140", roads_label_major: "#4a4033", roads_label_minor: "#5b5140", address_label: "#5b5140",
    landcover: { forest: "#d3dcbc", grassland: "#e3e6cc", farmland: "#ece6cf", scrub: "#e2e2c6" },
  },
  tune: fewerLabels,
};

/** Dark "hero" map with 3D buildings for landing pages. */
export const nacht: MapTheme = {
  name: "Nacht",
  base: "dark",
  colors: {
    background: "#0f141b", earth: "#0f141b", water: "#0a2233",
    park_a: "#13201b", park_b: "#13201b", wood_a: "#13201b", wood_b: "#13201b",
    buildings: "#1d2633",
    highway: "#3d5573", highway_casing_early: "#0f141b", highway_casing_late: "#0f141b",
    major: "#26303e", minor_a: "#1c2430", minor_b: "#1c2430", minor_service: "#19202a", railway: "#2b3442",
    boundaries: "#4d5b6e",
    city_label: "#d7dee8", city_label_halo: "#0f141b", state_label: "#a9b4c2", country_label: "#c6ceda",
    subplace_label: "#a9b4c2", roads_label_major: "#b9c3cf", roads_label_minor: "#9aa6b5", address_label: "#9aa6b5",
    ocean_label: "#6f8aa3",
  },
  tune: pipe(withoutPois, with3dBuildings("#243042", 0.9)),
};

/** Grey map with one brand accent on motorways. */
export const monoAkzent: MapTheme = {
  name: "Mono-Akzent",
  base: "grayscale",
  colors: {
    highway: "#c8402a", highway_casing_early: "#9e3120", highway_casing_late: "#9e3120",
    city_label: "#2b2b2b", country_label: "#2b2b2b", state_label: "#4a4a4a",
  },
  tune: withoutPois,
};

/** Soft, friendly palette for local services and family brands. */
export const pastell: MapTheme = {
  name: "Pastell",
  base: "light",
  colors: {
    background: "#fbf7f2", earth: "#fbf7f2", water: "#cde7f0",
    park_a: "#dcefd8", park_b: "#d2ead0", wood_a: "#d6ecd2", wood_b: "#cde6ca",
    buildings: "#efe6f2", school: "#f6e8d8", hospital: "#f8e1e4",
    highway: "#f6c9b8", highway_casing_early: "#e8ac98", highway_casing_late: "#e8ac98",
    major: "#ffffff", minor_a: "#ffffff", minor_b: "#ffffff",
    city_label: "#4f4868", city_label_halo: "#fbf7f2", subplace_label: "#5e5679", roads_label_major: "#5e5679",
    roads_label_minor: "#6a6385", address_label: "#6a6385",
    pois: { green: "#3f8a5c", blue: "#3f7fae", red: "#c25670", pink: "#b5569b" },
    landcover: { forest: "#d4ebd0", grassland: "#e2f1dc", farmland: "#f1f0dc" },
  },
};

/** Quiet backdrop for your own data: no icons, few labels, low contrast roads. */
export const leise: MapTheme = {
  name: "Leise",
  base: "white",
  colors: {
    water: "#dfe8ee", buildings: "#efefef", highway: "#e4e4e4", major: "#ededed",
    city_label: "#555555", subplace_label: "#707070", roads_label_major: "#6b6b6b",
  },
  tune: pipe(withoutPois, fewerLabels),
};

/** Built from brand tokens (here: a dark green brand). */
export const marke: MapTheme = {
  name: "Marke",
  base: "light",
  colors: brandPalette({ paper: "#f5f3ec", ink: "#1f3a2e", accent: "#d9822b", water: "#b8d3d9", muted: "#e3e0d4" }),
  tune: fewerLabels,
};

export const themes = [papier, nacht, monoAkzent, pastell, leise, marke];
```

Use a theme:

```ts
// plain MapLibre
const style = themedStyle(await currentArchiveUrl(), papier, "de");
new maplibregl.Map({ container: "map", style, center: [9.0576, 48.5216], zoom: 14, attributionControl: { compact: false } });

// Next.js component: colours only (tune steps need themedStyle with plain MapLibre)
<ItstilesMap center={[9.0576, 48.5216]} zoom={14} flavor="light" lang="de" colors={{ light: papier.colors, dark: nacht.colors }} />
```

The `ItstilesMap` component takes `colors` per flavor; layer `tune` steps
(POI removal, 3D) need `themedStyle()` with plain MapLibre, or hide layers in
`onStyleLoad` (`map.setLayoutProperty("pois", "visibility", "none")`).
