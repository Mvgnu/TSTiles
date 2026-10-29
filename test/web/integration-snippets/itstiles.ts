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
