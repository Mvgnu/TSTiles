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
  /**
   * Initial view for this instance as [longitude, latitude]; overrides the
   * manifest center. resetView() returns to this view instead of the bounds.
   */
  readonly center?: readonly [number, number];
  /** Initial zoom (0–24) for this instance; overrides the manifest zoom. */
  readonly zoom?: number;
  readonly signal?: AbortSignal;
  /**
   * Show error messages inside the map container (default true), so an
   * integration without an onStatus handler is never silently blank.
   */
  readonly showErrors?: boolean;
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

const MAX_LATITUDE = 85.05112878;

function checkInitialView(options: ViewerOptions): void {
  const inRange = (value: unknown, min: number, max: number): boolean =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  if (options.center !== undefined
      && !(Array.isArray(options.center) && options.center.length === 2
        && inRange(options.center[0], -180, 180) && inRange(options.center[1], -90, 90))) {
    throw new RangeError("center must be [longitude, latitude] with longitude -180…180 and latitude -90…90.");
  }
  if (options.zoom !== undefined && !inRange(options.zoom, 0, 24)) {
    throw new RangeError("zoom must be a number from 0 to 24.");
  }
}

/** The failing source's URL (pmtiles:// prefix removed), when MapLibre names a source. */
function sourceUrlOf(map: LibreMap, event: unknown): string | undefined {
  if (typeof event !== "object" || event === null || !("sourceId" in event) || typeof event.sourceId !== "string") return undefined;
  const source = map.getStyle()?.sources?.[event.sourceId];
  const url = source !== undefined && "url" in source && typeof source.url === "string" ? source.url : undefined;
  return url?.replace(/^pmtiles:\/\//u, "");
}

function containerElement(container: HTMLElement | string): HTMLElement | undefined {
  if (typeof container !== "string") return container;
  if (typeof document === "undefined") return undefined;
  return document.getElementById(container) ?? undefined;
}

export const ERROR_CLASS = "tstiles-error";

/** Plain-text, self-styled message box; works without any page CSS. */
function showError(container: HTMLElement | string, message: string, overlay: boolean): void {
  const host = containerElement(container);
  if (!host) return;
  let box = host.querySelector<HTMLElement>(":scope > ." + ERROR_CLASS);
  if (!box) {
    box = document.createElement("div");
    box.className = ERROR_CLASS;
    box.setAttribute("role", "alert");
    host.append(box);
  }
  box.style.cssText = (overlay
    ? "position:absolute;top:8px;left:8px;right:56px;z-index:3;"
    : "min-height:100%;box-sizing:border-box;display:flex;align-items:center;")
    + "padding:12px 14px;background:#fff4f2;color:#7a1c12;border:1px solid #e8b4ac;border-radius:8px;"
    + "font:14px/1.4 system-ui,-apple-system,sans-serif;overflow-wrap:anywhere;";
  box.textContent = message;
}

function clearError(container: HTMLElement | string): void {
  containerElement(container)?.querySelector(":scope > ." + ERROR_CLASS)?.remove();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

export async function createMapViewer(options: ViewerOptions): Promise<MapViewer> {
  const showErrors = options.showErrors ?? true;
  let resolved: ResolvedManifest;
  try {
    checkInitialView(options);
    options.onStatus?.({ state: "loading", message: "Loading map manifest…" });
    resolved = await loadManifest(options.manifestUrl, options.baseUrl ?? document.baseURI, options.signal);
    options.signal?.throwIfAborted();
  } catch (error) {
    // Manifest-phase failures reach onStatus and the page with the same
    // message the promise rejects with. Aborts are the caller's own action.
    if (!isAbort(error, options.signal)) {
      const message = error instanceof Error ? error.message : "Map setup failed: " + String(error);
      options.onStatus?.({ state: "error", message });
      if (showErrors) showError(options.container, message, false);
    }
    throw error;
  }
  clearError(options.container);
  registerProtocol();
  const { manifest, archiveUrl, styleUrl } = resolved;
  options.onStatus?.({ state: "loading", message: styleUrl === undefined ? "Reading archive tiles…" : "Loading map resources…" });
  const hasInitialView = options.center !== undefined || options.zoom !== undefined;
  const [initialLng, initialLat] = options.center ?? [manifest.center[0], manifest.center[1]];
  const initialCenter: [number, number] = [initialLng, Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, initialLat))];
  const initialZoom = options.zoom ?? Math.min(manifest.center[2], 24);
  const map = new maplibregl.Map({
    container: options.container,
    style: styleUrl ?? buildPreviewStyle(manifest, archiveUrl),
    center: initialCenter,
    zoom: initialZoom,
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
    if (hasInitialView) {
      map.jumpTo({ center: initialCenter, zoom: initialZoom });
      return;
    }
    const [west, south, east, north] = manifest.bounds;
    if (west < east && south < north) {
      map.fitBounds([[west, Math.max(-MAX_LATITUDE, south)], [east, Math.min(MAX_LATITUDE, north)]], {
        padding: 48,
        maxZoom: 22,
        duration: 0,
      });
    } else {
      map.jumpTo({ center: initialCenter, zoom: initialZoom });
    }
  };
  resetView();

  map.on("error", (event) => {
    if (destroyed) return;
    failed = true;
    let cause = (event.error?.message ?? "Unknown map error").slice(0, 350).replace(/\.\s*$/u, "");
    const sourceUrl = sourceUrlOf(map, event);
    if (sourceUrl !== undefined && !cause.includes(sourceUrl)) cause += " (" + sourceUrl + ")";
    const message = "Map resource failed: " + cause + ". Check archive Range/CORS support and the style's source layers and asset URLs, then retry.";
    options.onStatus?.({ state: "error", message });
    if (showErrors) showError(options.container, message, true);
  });
  const gestureHint = options.cooperativeGestures === true
    ? "Use Ctrl/⌘ + scroll or + / − to zoom; two fingers to pan on touch screens."
    : "Drag to pan; use + / − to zoom.";
  map.on("idle", () => {
    if (destroyed || failed) return;
    const visibleFeatures = map.queryRenderedFeatures().length;
    if (visibleFeatures > 0) {
      options.onStatus?.({
        state: "ready",
        message: (styleUrl === undefined ? "Archive features visible. " : "Styled features visible. ") + gestureHint,
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
    clearError(options.container);
    map.remove();
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  return { ...resolved, map, resetView, destroy };
}
