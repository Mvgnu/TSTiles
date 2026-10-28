import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import type { MapManifest } from "../../src/contract.js";

const renderer = vi.hoisted(() => {
  class MapStub {
    public static instances: MapStub[] = [];
    public readonly listeners = new Map<string, (event?: unknown) => void>();
    public features: unknown[] = [];
    public style: StyleSpecification = { version: 8, sources: {}, layers: [] };
    public removed = false;
    public resetCount = 0;
    public constructor(public readonly options: { style: unknown }) { MapStub.instances.push(this); }
    public addControl(): void { /* Controls are independent of the readiness lifecycle. */ }
    public fitBounds(): void { this.resetCount += 1; }
    public jumpTo(): void { this.resetCount += 1; }
    public on(name: string, listener: (event?: unknown) => void): void { this.listeners.set(name, listener); }
    public queryRenderedFeatures(): unknown[] { return this.features; }
    public getStyle(): StyleSpecification { return this.style; }
    public remove(): void { this.removed = true; }
    public idle(): void { this.listeners.get("idle")?.(); }
    public fail(): void { this.listeners.get("error")?.({ error: new Error("Tile fetch failed") }); }
  }
  return { MapStub };
});

vi.mock("maplibre-gl", () => ({ default: {
  Map: renderer.MapStub,
  NavigationControl: class {},
  ScaleControl: class {},
  addProtocol: vi.fn(),
} }));
vi.mock("pmtiles", () => ({ Protocol: class { public tile = vi.fn(); } }));

import { createMapViewer, type ViewerStatus } from "../../src/web/embed.js";

const manifest: MapManifest = {
  schemaVersion: 1, id: "fixture", name: "Fixture", archive: "../archives/fixture.pmtiles",
  sha256: "a".repeat(64), bytes: 468, tileType: "mvt", minZoom: 0, maxZoom: 0,
  bounds: [0, 0, 1, 1], center: [0.5, 0.5, 8], vectorLayers: [{ id: "fixture" }],
  attribution: "Synthetic fixture", style: "../styles/custom.json",
};

async function create(style: StyleSpecification) {
  const history: ViewerStatus[] = [];
  const viewer = await createMapViewer({
    container: "map", manifestUrl: "https://maps.example/maps/fixture.json",
    baseUrl: "https://another-site.example/", onStatus: (status) => history.push(status),
  });
  const map = renderer.MapStub.instances.at(-1);
  if (!map) throw new Error("Viewer did not construct a map.");
  map.style = style;
  return { viewer, map, history };
}

const vectorStyle: StyleSpecification = {
  version: 8,
  sources: { archive: { type: "vector", url: "pmtiles://https://maps.example/archives/fixture.pmtiles" } },
  layers: [{ id: "shape", type: "fill", source: "archive", "source-layer": "fixture" }],
};

describe("public viewer readiness lifecycle", () => {
  beforeEach(() => {
    renderer.MapStub.instances = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(manifest))));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("does not announce a valid but empty style as a loaded map", async () => {
    const { map, history, viewer } = await create({ version: 8, sources: {}, layers: [] });
    expect(history.at(-1)?.state).toBe("loading");
    map.idle();
    expect(history.at(-1)?.state).toBe("error");
    expect(history.some((status) => status.state === "ready")).toBe(false);
    expect(history.at(-1)?.message).toContain("no drawing layers");
    viewer.resetView();
    expect(map.resetCount).toBe(2);
    viewer.destroy();
    expect(map.removed).toBe(true);
  });

  it("requires matching rendered features after a supplied vector style becomes idle", async () => {
    const { map, history } = await create({
      ...vectorStyle,
      layers: [{ id: "missing", type: "fill", source: "archive", "source-layer": "does-not-exist" }],
    });
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "empty", visibleFeatures: 0 });
    expect(history.at(-1)?.message).toContain("source-layer");
    expect(history.some((status) => status.state === "ready")).toBe(false);
  });

  it("updates readiness when features enter and leave the view", async () => {
    const { map, history } = await create(vectorStyle);
    map.features = [{ source: "archive" }];
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "ready", visibleFeatures: 1 });
    map.features = [];
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "empty", visibleFeatures: 0 });
    map.features = [{ source: "archive" }, { source: "archive" }];
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "ready", visibleFeatures: 2 });
  });

  it("preserves the complete supplied style and accepts its visible GeoJSON features", async () => {
    const { map, history } = await create({
      version: 8,
      sources: { places: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [{ id: "points", type: "circle", source: "places" }],
    });
    expect(map.options.style).toBe("https://maps.example/styles/custom.json");
    map.features = [{ source: "places" }];
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "ready", visibleFeatures: 1 });
  });

  it.each<StyleSpecification>([
    { version: 8, sources: {}, layers: [{ id: "background", type: "background" }] },
    { version: 8, sources: { imagery: { type: "raster", tiles: ["https://maps.example/imagery/{z}/{x}/{y}.png"] } }, layers: [{ id: "imagery", type: "raster", source: "imagery" }] },
    { version: 8, sources: { dem: { type: "raster-dem", tiles: ["https://maps.example/terrain/{z}/{x}/{y}.png"] } }, terrain: { source: "dem" }, layers: [{ id: "shade", type: "hillshade", source: "dem" }] },
  ])("preserves non-queryable style content without claiming vector archive proof %#", async (style) => {
    const { map, history } = await create(style);
    map.idle();
    expect(history.at(-1)).toMatchObject({ state: "unverified", visibleFeatures: 0 });
    expect(history.some((status) => status.state === "ready" || status.state === "error")).toBe(false);
    expect(map.getStyle()).toBe(style);
    expect(map.options.style).toBe("https://maps.example/styles/custom.json");
  });

  it("does not let idle events hide a resource error, even if another source has features", async () => {
    const { map, history } = await create(vectorStyle);
    map.fail();
    map.features = [{ source: "archive" }];
    map.idle();
    expect(history.at(-1)?.state).toBe("error");
    expect(history.some((status) => status.state === "ready")).toBe(false);
  });
});
