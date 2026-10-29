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
