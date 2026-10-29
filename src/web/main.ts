// Landing page script (bundled as assets/viewer.js): live hero map, flavor
// switcher and copy buttons. Uses the same public createMapViewer as embed.js.
import { createMapViewer, type MapViewer, type ViewerStatus } from "./embed.js";
import { loadManifest } from "./manifest.js";

const FLAVORS = ["light", "dark", "white", "grayscale", "black"] as const;
type Flavor = (typeof FLAVORS)[number];
const START = { center: [9.0576, 48.5216] as [number, number], zoom: 12.5 };

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof constructor)) throw new Error("Missing page element: " + id);
  return node;
}

const mapElement = element("hero-map", HTMLDivElement);
const statusElement = element("map-status", HTMLSpanElement);
const coordsElement = element("map-coords", HTMLSpanElement);
const number = (value: number, digits: number): string =>
  value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function setStatus(status: ViewerStatus): void {
  statusElement.dataset.state = status.state;
  mapElement.dataset.state = status.state;
  statusElement.textContent = status.state === "loading" ? "Karte wird geladen …"
    : status.state === "error" ? "Karte konnte nicht geladen werden."
      : status.state === "ready" ? "Live · Strg/⌘ + Mausrad zum Zoomen"
        : "Keine Kartendaten in diesem Ausschnitt.";
}

function showPosition(viewer: MapViewer): void {
  const { lng, lat } = viewer.map.getCenter();
  coordsElement.textContent = number(Math.abs(lat), 4) + "° " + (lat >= 0 ? "N" : "S") + " · "
    + number(Math.abs(lng), 4) + "° " + (lng >= 0 ? "O" : "W") + " · Zoom " + number(viewer.map.getZoom(), 1);
}

async function start(): Promise<void> {
  let viewer: MapViewer;
  try {
    viewer = await createMapViewer({
      container: mapElement,
      manifestUrl: "./maps/light.json",
      baseUrl: document.baseURI,
      center: START.center,
      zoom: START.zoom,
      cooperativeGestures: true,
      onStatus: setStatus,
    });
  } catch {
    return; // createMapViewer already reported the error in the map and via onStatus.
  }
  viewer.map.on("moveend", () => showPosition(viewer));
  let request = 0;
  for (const input of Array.from(document.querySelectorAll<HTMLInputElement>('input[name="flavor"]'))) {
    input.addEventListener("change", () => {
      const flavor = FLAVORS.find((name) => name === input.value);
      if (!input.checked || flavor === undefined) return;
      void switchFlavor(viewer, flavor, ++request, () => request);
    });
  }
}

/** Each flavor's manifest names its style; the manifest stays the authority. */
async function switchFlavor(viewer: MapViewer, flavor: Flavor, id: number, latest: () => number): Promise<void> {
  try {
    const { styleUrl } = await loadManifest("./maps/" + flavor + ".json", document.baseURI);
    if (id !== latest()) return;
    if (styleUrl === undefined) throw new Error("Manifest for " + flavor + " has no style.");
    viewer.map.setStyle(styleUrl);
  } catch (error) {
    setStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-copy]"))) {
  button.addEventListener("click", () => {
    const source = document.getElementById(button.dataset.copy ?? "");
    const text = source?.textContent ?? "";
    const done = (label: string): void => {
      button.textContent = label;
      window.setTimeout(() => { button.textContent = "Kopieren"; }, 2000);
    };
    if (!navigator.clipboard) { done("Bitte markieren"); return; }
    navigator.clipboard.writeText(text).then(() => done("Kopiert ✓"), () => done("Bitte markieren"));
  });
}

void start();
