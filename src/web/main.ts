import { createMapViewer, type MapViewer, type ViewerStatus } from "./embed.js";
import { resolveHttpUrl } from "./manifest.js";
import { iframeSnippet, parseEmbedView, PREVIEW_COLORS, type EmbedView } from "./style.js";

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error("Missing viewer element: " + id);
  return node;
}

const mapElement = element("map", HTMLDivElement);
const statusElement = element("map-status", HTMLParagraphElement);
const badge = element("status-badge", HTMLSpanElement);
const mapName = element("map-name", HTMLHeadingElement);
const note = element("preview-note", HTMLParagraphElement);
const manifestInput = element("manifest-url", HTMLInputElement);
const snippet = element("embed-code", HTMLElement);
const copyButton = element("copy-embed", HTMLButtonElement);
const parameters = new URLSearchParams(location.search);
const isEmbedded = parameters.get("embed") === "1";
document.documentElement.dataset.embed = String(isEmbedded);
const selectedManifest = parameters.get("manifest") || "./maps/fixture.json";
let viewer: MapViewer | undefined;
let controller: AbortController | undefined;

function setStatus(status: ViewerStatus): void {
  statusElement.textContent = status.message;
  statusElement.dataset.state = status.state;
  mapElement.dataset.state = status.state;
  if ("visibleFeatures" in status && status.visibleFeatures !== undefined) {
    mapElement.dataset.visibleFeatures = String(status.visibleFeatures);
  }
  badge.dataset.state = status.state;
  badge.textContent = { loading: "Loading", ready: "Map loaded", empty: "Empty view", unverified: "Style only", error: "Needs attention" }[status.state];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KiB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MiB";
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GiB";
}

async function start(): Promise<void> {
  controller?.abort();
  viewer?.destroy();
  viewer = undefined;
  controller = new AbortController();
  const currentController = controller;
  copyButton.disabled = true;
  try {
    manifestInput.value = resolveHttpUrl(selectedManifest, document.baseURI);
    const view: EmbedView = parseEmbedView(parameters);
    const loaded = await createMapViewer({
      ...view,
      container: mapElement,
      manifestUrl: selectedManifest,
      baseUrl: document.baseURI,
      cooperativeGestures: isEmbedded,
      signal: currentController.signal,
      onStatus: setStatus,
    });
    if (currentController.signal.aborted) { loaded.destroy(); return; }
    viewer = loaded;
    const { manifest } = loaded;
    mapName.textContent = manifest.name;
    document.title = manifest.name + " · TSTiles";
    element("map-mode", HTMLSpanElement).textContent = manifest.style ? "Supplied style" : "Data preview";
    note.textContent = manifest.style
      ? "This map uses the complete style configured in its manifest. Attribution and style assets stay with their sources."
      : "Data preview · These are the archive's raw features, not a finished basemap. Add a compatible MapLibre style for roads, labels and a complete map design.";
    element("archive-size", HTMLElement).textContent = formatBytes(manifest.bytes);
    element("archive-zoom", HTMLElement).textContent = manifest.minZoom + "–" + manifest.maxZoom;
    element("archive-layers", HTMLElement).textContent = String(manifest.vectorLayers.length);
    element("archive-attribution", HTMLParagraphElement).textContent = manifest.attribution;
    const layers = element("layer-list", HTMLUListElement);
    layers.replaceChildren();
    manifest.vectorLayers.forEach((layer, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.backgroundColor = PREVIEW_COLORS[index % PREVIEW_COLORS.length] ?? "#087f8c";
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("span");
      name.textContent = layer.id;
      item.append(swatch, name);
      layers.append(item);
    });
    if (manifest.vectorLayers.length === 0) {
      const item = document.createElement("li");
      item.textContent = "Layer metadata is not included in this archive.";
      layers.append(item);
    }
    snippet.textContent = iframeSnippet(location.href, loaded.manifestUrl, manifest.name, view);
    copyButton.disabled = false;
  } catch (error) {
    if (currentController.signal.aborted) return;
    setStatus({ state: "error", message: error instanceof Error ? error.message : "Map setup failed. Check the manifest URL and try again." });
  }
}

element("manifest-form", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const next = new URL(location.href);
    next.searchParams.set("manifest", resolveHttpUrl(manifestInput.value, document.baseURI));
    // A different map has its own default view.
    next.searchParams.delete("center");
    next.searchParams.delete("zoom");
    location.assign(next.href);
  } catch (error) {
    setStatus({ state: "error", message: error instanceof Error ? error.message : "Enter an HTTP or HTTPS manifest URL." });
  }
});
element("reset-view", HTMLButtonElement).addEventListener("click", () => viewer?.resetView());
element("retry-map", HTMLButtonElement).addEventListener("click", () => { void start(); });
copyButton.addEventListener("click", () => {
  if (!navigator.clipboard) {
    copyButton.textContent = "Select the snippet to copy";
    return;
  }
  void navigator.clipboard.writeText(snippet.textContent ?? "").then(() => {
    copyButton.textContent = "Copied";
  }).catch(() => {
    copyButton.textContent = "Select the snippet to copy";
  });
});
window.addEventListener("pagehide", () => { controller?.abort(); viewer?.destroy(); });
void start();
