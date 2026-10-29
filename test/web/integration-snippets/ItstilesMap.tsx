"use client";

// src/components/ItstilesMap.tsx — copy unchanged. Needs src/lib/itstiles.ts.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  currentArchiveUrl,
  customStyle,
  keepArchiveCurrent,
  registerPmtiles,
  type FlavorOverrides,
  type ItstilesFlavor,
} from "@/lib/itstiles";

export interface ItstilesMapProps {
  /** [longitude, latitude]. Changing it moves the map. */
  center: [number, number];
  zoom: number;
  flavor?: ItstilesFlavor;
  /** Label language, e.g. "de". */
  lang?: string;
  /** Colour overrides per flavor, e.g. { light: { water: "#9cc3df" }, dark: { water: "#0b2a3a" } }. */
  colors?: Partial<Record<ItstilesFlavor, FlavorOverrides>>;
  /** Runs after every style load (first load and each flavor/lang/colour change): add your sources/layers here. */
  onStyleLoad?: (map: maplibregl.Map) => void;
  maxZoom?: number;
  className?: string;
  /** The map needs a height; default 420px. */
  height?: number | string;
}

export default function ItstilesMap({
  center, zoom, flavor = "light", lang = "en", colors, onStyleLoad, maxZoom = 19, className, height = 420,
}: ItstilesMapProps) {
  const [lng, lat] = center;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const archiveRef = useRef<string | null>(null);
  // Latest props for callbacks, updated after render (never read during render).
  const latest = useRef({ lng, lat, zoom, flavor, lang, colors, onStyleLoad, maxZoom });
  useEffect(() => {
    latest.current = { lng, lat, zoom, flavor, lang, colors, onStyleLoad, maxZoom };
  });
  const colorsKey = JSON.stringify(colors ?? {});

  // Create the map once per mount (Strict Mode mounts twice in dev: cleanup handles it).
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const abort = new AbortController();
    let map: maplibregl.Map | null = null;
    let stopWatching: (() => void) | undefined;
    const styleFor = (archiveUrl: string) => {
      const p = latest.current;
      return customStyle({ archiveUrl, flavor: p.flavor, lang: p.lang, colors: p.colors?.[p.flavor] });
    };
    registerPmtiles();
    currentArchiveUrl(abort.signal).then((archiveUrl) => {
      if (abort.signal.aborted) return;
      archiveRef.current = archiveUrl;
      const p = latest.current;
      const created = new maplibregl.Map({
        container: element,
        style: styleFor(archiveUrl),
        center: [p.lng, p.lat],
        zoom: p.zoom,
        maxZoom: p.maxZoom,
        cooperativeGestures: true,
        attributionControl: { compact: false },
      });
      created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      created.on("style.load", () => latest.current.onStyleLoad?.(created));
      stopWatching = keepArchiveCurrent(created, archiveUrl, (next) => {
        archiveRef.current = next;
        created.setStyle(styleFor(next), { diff: false });
      });
      map = created;
      mapRef.current = created;
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) console.error("itstiles map failed to start:", error);
    });
    return () => {
      abort.abort();
      stopWatching?.();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Flavor, language or colours changed: rebuild the style; "style.load" re-adds your layers.
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) { firstStyle.current = false; return; }
    const map = mapRef.current;
    const archiveUrl = archiveRef.current;
    if (!map || !archiveUrl) return;
    const p = latest.current;
    map.setStyle(customStyle({ archiveUrl, flavor, lang, colors: p.colors?.[flavor] }), { diff: false });
  }, [flavor, lang, colorsKey]);

  // Center/zoom props changed: move the existing map.
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [lng, lat], zoom });
  }, [lng, lat, zoom]);

  return <div ref={container} className={className} style={{ width: "100%", height }} />;
}
