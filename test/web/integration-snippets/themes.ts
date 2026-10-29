// src/lib/map-themes.ts — site-specific map themes on top of src/lib/itstiles.ts
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { customStyle, type FlavorOverrides, type ItstilesFlavor } from "./itstiles.js"; // in your app: "@/lib/itstiles"

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
