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
