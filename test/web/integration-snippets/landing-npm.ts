// npm i -E maplibre-gl@5.24.0 pmtiles@4.3.0
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";

maplibregl.addProtocol("pmtiles", new Protocol().tile); // einmal pro Seite

export const map = new maplibregl.Map({
  container: "karte", // braucht eine Höhe, z. B. 420px
  style: "https://itstiles.com/styles/protomaps/light.json",
  center: [9.0576, 48.5216], // [Länge, Breite]: Tübingen
  zoom: 13,
  cooperativeGestures: true,
});
