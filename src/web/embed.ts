import maplibregl, { type Map as LibreMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { loadManifest, type ResolvedManifest } from "./manifest.js";
import { buildPreviewStyle, escapeHtml } from "./style.js";

export type ViewerStatus =
  | { readonly state: "loading"; readonly message: string }
  | { readonly state: "ready"; readonly message: string; readonly visibleFeatures?: number }
  | { readonly state: "empty"; readonly message: string; readonly visibleFeatures: 0 }
  | { readonly state: "unverified"; readonly message: string; readonly visibleFeatures: 0 }
  | { readonly state: "error"; readonly message: string };

export interface ViewerOptions {
  readonly container: HTMLElement | string;
  readonly manifestUrl: string;
  readonly baseUrl?: string;
  readonly cooperativeGestures?: boolean;
  readonly signal?: AbortSignal;
  readonly onStatus?: (status: ViewerStatus) => void;
}

export interface MapViewer extends ResolvedManifest {
  readonly map: LibreMap;
  resetView(): void;
  destroy(): void;
}

// The only shared state is MapLibre's protocol registration. Map configuration
// and lifecycle belong to each createMapViewer call.
let protocol: Protocol | undefined;

function registerProtocol(): void {
  if (protocol !== undefined) return;
  protocol = new Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);
}

export async function createMapViewer(options: ViewerOptions): Promise<MapViewer> {
  options.onStatus?.({ state: "loading", message: "Loading map manifest…" });
  const resolved = await loadManifest(options.manifestUrl, options.baseUrl ?? document.baseURI, options.signal);
  options.signal?.throwIfAborted();
  registerProtocol();
  const { manifest, archiveUrl, styleUrl } = resolved;
  options.onStatus?.({ state: "loading", message: styleUrl === undefined ? "Reading archive tiles…" : "Loading map resources…" });
  const map = new maplibregl.Map({
    container: options.container,
    style: styleUrl ?? buildPreviewStyle(manifest, archiveUrl),
    center: [manifest.center[0], Math.max(-85.05112878, Math.min(85.05112878, manifest.center[1]))],
    zoom: Math.min(manifest.center[2], 24),
    maxZoom: 24,
    attributionControl: { compact: false, customAttribution: styleUrl === undefined ? undefined : escapeHtml(manifest.attribution) },
    cooperativeGestures: options.cooperativeGestures ?? false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
  let failed = false;
  let destroyed = false;

  const resetView = (): void => {
    const [west, south, east, north] = manifest.bounds;
    if (west < east && south < north) {
      map.fitBounds([[west, Math.max(-85.05112878, south)], [east, Math.min(85.05112878, north)]], {
        padding: 48,
        maxZoom: 22,
        duration: 0,
      });
    } else {
      map.jumpTo({ center: [manifest.center[0], manifest.center[1]], zoom: Math.min(manifest.center[2], 24) });
    }
  };
  resetView();

  map.on("error", (event) => {
    if (destroyed) return;
    failed = true;
    const cause = event.error?.message ?? "Unknown map error";
    options.onStatus?.({
      state: "error",
      message: "Map resource failed: " + cause.slice(0, 350) + " Check archive Range/CORS support and the style's source layers and asset URLs, then retry.",
    });
  });
  map.on("idle", () => {
    if (destroyed || failed) return;
    const visibleFeatures = map.queryRenderedFeatures().length;
    if (visibleFeatures > 0) {
      options.onStatus?.({
        state: "ready",
        message: styleUrl === undefined
          ? "Archive features visible. Drag to pan; use + / − to zoom."
          : "Styled features visible. Drag to pan; use + / − to zoom.",
        visibleFeatures,
      });
      return;
    }
    if (styleUrl !== undefined) {
      const style = map.getStyle();
      if (style.layers.length === 0) {
        options.onStatus?.({
          state: "error",
          message: "The supplied style has no drawing layers. Add layers for your archive's source-layer IDs, then retry. Loading an empty style does not verify a map.",
        });
        return;
      }
      const featureLayerTypes = new Set(["fill", "line", "symbol", "circle", "heatmap", "fill-extrusion"]);
      const hasFeatureLayers = style.layers.some((layer) => {
        const source = "source" in layer ? style.sources[layer.source] : undefined;
        return featureLayerTypes.has(layer.type) && (source?.type === "vector" || source?.type === "geojson");
      });
      if (!hasFeatureLayers) {
        options.onStatus?.({
          state: "unverified",
          message: "Style content loaded, but it has no vector or GeoJSON drawing layers. Raster, terrain and background content are preserved; they do not verify this vector archive. Add a compatible vector layer to verify it.",
          visibleFeatures: 0,
        });
        return;
      }
      options.onStatus?.({
        state: "empty",
        message: "No vector or GeoJSON features are visible. Reset the view, or check style filters and source-layer names against the archive's layer metadata.",
        visibleFeatures: 0,
      });
      return;
    }
    options.onStatus?.({ state: "empty", message: "No archive features in this view. Reset the view or check the archive's layer metadata.", visibleFeatures: 0 });
  });

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    options.signal?.removeEventListener("abort", destroy);
    map.remove();
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  return { ...resolved, map, resetView, destroy };
}
