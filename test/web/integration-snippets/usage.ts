// Type-checked mirror of the C1/C2, overlay and dark-mode examples in
// docs/integration.md (those blocks are split for reading; this keeps their
// API calls honest against the pinned maplibre-gl and basemaps versions).
import maplibregl from "maplibre-gl";
import { currentArchiveUrl, customStyle, firstLabelLayerId, registerPmtiles, servedStyleUrl } from "./itstiles.js";

export function servedMap(container: HTMLElement): maplibregl.Map {
  registerPmtiles();
  const map = new maplibregl.Map({
    container,
    style: servedStyleUrl("light"),
    center: [13.405, 52.52],
    zoom: 11,
    maxZoom: 19,
  });
  map.addControl(new maplibregl.NavigationControl(), "top-right");
  return map;
}

export async function customMap(container: HTMLElement): Promise<maplibregl.Map> {
  registerPmtiles();
  const archiveUrl = await currentArchiveUrl();
  const map = new maplibregl.Map({
    container,
    style: customStyle({
      archiveUrl,
      flavor: "light",
      lang: "de",
      colors: {
        water: "#9cc3df",
        earth: "#f4f1ea",
        park_a: "#cfe6c4",
        park_b: "#bfe0b1",
        buildings: "#e4ded3",
        highway: "#f0b04a",
        major: "#ffffff",
        minor_a: "#ffffff",
        railway: "#a0a0a0",
        boundaries: "#9e9cab",
        city_label: "#3d3d3d",
      },
    }),
    center: [13.405, 52.52],
    zoom: 11,
    maxZoom: 19,
  });
  return map;
}

export function addOverlays(map: maplibregl.Map): void {
  map.addSource("deliveries", { type: "geojson", data: "/api/deliveries.geojson" });
  map.addLayer(
    { id: "delivery-areas", type: "fill", source: "deliveries", paint: { "fill-color": "#d6336c", "fill-opacity": 0.25 } },
    firstLabelLayerId(map),
  );
}

export function wireOverlaysAndDarkMode(map: maplibregl.Map): void {
  map.on("style.load", () => addOverlays(map));
  new maplibregl.Marker({ color: "#d6336c" }).setLngLat([13.405, 52.52]).addTo(map);
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const styleFor = (isDark: boolean) => servedStyleUrl(isDark ? "dark" : "light");
  dark.addEventListener("change", (event) => {
    map.setStyle(styleFor(event.matches), { diff: false });
  });
}
