import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import type { MapManifest } from "../contract.js";

export const PREVIEW_COLORS = ["#087f8c", "#c86c3c", "#6d5ba6", "#64803e", "#b54f75", "#306dba"];

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** A geometry inspector, deliberately independent of any basemap layer schema. */
export function buildPreviewStyle(manifest: MapManifest, archiveUrl: string): StyleSpecification {
  const layers: LayerSpecification[] = [{
    id: "preview-background",
    type: "background",
    paint: { "background-color": "#edf2ee" },
  }];
  manifest.vectorLayers.forEach((layer, index) => {
    const color = PREVIEW_COLORS[index % PREVIEW_COLORS.length] ?? "#087f8c";
    const common = { source: "archive", "source-layer": layer.id };
    layers.push(
      {
        ...common,
        id: "preview-fill-" + index,
        type: "fill",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": color, "fill-opacity": 0.28 },
      },
      {
        ...common,
        id: "preview-line-" + index,
        type: "line",
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
        paint: { "line-color": color, "line-width": 2 },
      },
      {
        ...common,
        id: "preview-point-" + index,
        type: "circle",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-color": color, "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 },
      },
    );
  });
  return {
    version: 8,
    name: manifest.name + " — data preview",
    sources: {
      archive: {
        type: "vector",
        url: "pmtiles://" + archiveUrl,
        attribution: escapeHtml(manifest.attribution),
        minzoom: manifest.minZoom,
        maxzoom: manifest.maxZoom,
      },
    },
    layers,
  };
}

/** Optional per-embed initial view, carried as `center=lng,lat` and `zoom=z`. */
export interface EmbedView {
  readonly center?: readonly [number, number];
  readonly zoom?: number;
}

export function buildEmbedUrl(viewerUrl: string, manifestUrl: string, view: EmbedView = {}): string {
  const result = new URL(viewerUrl);
  result.search = "";
  result.hash = "";
  result.searchParams.set("manifest", manifestUrl);
  result.searchParams.set("embed", "1");
  if (view.center !== undefined) result.searchParams.set("center", view.center[0] + "," + view.center[1]);
  if (view.zoom !== undefined) result.searchParams.set("zoom", String(view.zoom));
  return result.href;
}

/** Parse `center=lng,lat` / `zoom=z` query values; range checks happen in createMapViewer. */
export function parseEmbedView(parameters: URLSearchParams): EmbedView {
  const rawCenter = parameters.get("center");
  const rawZoom = parameters.get("zoom");
  const number = (value: string, label: string): number => {
    const parsed = value.trim() === "" ? Number.NaN : Number(value);
    if (!Number.isFinite(parsed)) throw new RangeError(label + " must be a number. Use center=longitude,latitude and zoom=0…24.");
    return parsed;
  };
  let center: [number, number] | undefined;
  if (rawCenter !== null) {
    const parts = rawCenter.split(",");
    if (parts.length !== 2) throw new RangeError("center must be longitude,latitude, for example center=13.405,52.52.");
    center = [number(parts[0] ?? "", "center longitude"), number(parts[1] ?? "", "center latitude")];
  }
  const zoom = rawZoom === null ? undefined : number(rawZoom, "zoom");
  return { center, zoom };
}

export function iframeSnippet(viewerUrl: string, manifestUrl: string, title: string, view: EmbedView = {}): string {
  return '<iframe\n  src="' + escapeHtml(buildEmbedUrl(viewerUrl, manifestUrl, view))
    + '"\n  title="' + escapeHtml(title)
    + '"\n  width="100%" height="420"\n  style="border:0;border-radius:12px"\n  loading="lazy"\n></iframe>';
}
