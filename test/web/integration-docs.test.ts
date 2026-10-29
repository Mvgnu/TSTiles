import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import maplibregl from "maplibre-gl";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { namedFlavor } from "@protomaps/basemaps";
import { DEFAULT_ATTRIBUTION_HTML, PROTOMAPS_FLAVORS } from "../../src/web/basemap.js";
import {
  ATTRIBUTION, currentArchiveUrl, customStyle, keepArchiveCurrent, mergeFlavor, registerPmtiles, servedStyleUrl,
} from "./integration-snippets/itstiles.js";

const DIGEST = "e".repeat(64);
const docs = await readFile("docs/integration.md", "utf8");

describe("docs/integration.md", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("embeds the tested helper module and the lint-clean Next.js component verbatim", async () => {
    const helper = (await readFile("test/web/integration-snippets/itstiles.ts", "utf8")).trimEnd();
    expect(docs).toContain("```ts\n" + helper + "\n```");
    const component = (await readFile("test/web/integration-snippets/ItstilesMap.tsx", "utf8")).trimEnd();
    expect(docs).toContain("```tsx\n" + component + "\n```");
  });

  it("has no iframe/viewer path and requires the itstiles.com backlink", () => {
    expect(docs).not.toMatch(/embed=1|<iframe|\/viewer/u);
    expect(ATTRIBUTION).toBe(DEFAULT_ATTRIBUTION_HTML);
    expect(docs).toContain(DEFAULT_ATTRIBUTION_HTML);
    expect(docs).not.toMatch(/5 minutes|five minutes/u);
  });

  it("deep-merges nested pois/landcover overrides and ignores them where a flavor has none", () => {
    const merged = mergeFlavor(namedFlavor("light"), { water: "#010203", pois: { green: "#00ff00" }, landcover: { forest: "#112233" } });
    expect(merged).toMatchObject({ water: "#010203", pois: { green: "#00ff00", blue: namedFlavor("light").pois?.blue }, landcover: { forest: "#112233", farmland: namedFlavor("light").landcover?.farmland } });
    expect(mergeFlavor(namedFlavor("white"), { pois: { green: "#00ff00" } }).pois).toBeUndefined();
  });

  it("keepArchiveCurrent re-reads the manifest after an archive 404 and reports a new archive once", async () => {
    const handlers = new Map<string, (event: { error?: { message?: string } }) => void>();
    const map = { on: (name: string, fn: (event: { error?: { message?: string } }) => void) => handlers.set(name, fn), off: (name: string) => handlers.delete(name) };
    vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => {
      const response = new Response(JSON.stringify({ archive: "../archives/" + "9".repeat(64) + ".pmtiles" }));
      Object.defineProperty(response, "url", { value: "https://itstiles.com/maps/light.json" });
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const changes: string[] = [];
    const stop = keepArchiveCurrent(map as unknown as Parameters<typeof keepArchiveCurrent>[0], "https://itstiles.com/archives/" + DIGEST + ".pmtiles", (next) => changes.push(next));
    handlers.get("error")?.({ error: { message: "Tile fetch failed" } });
    expect(fetchMock).not.toHaveBeenCalled();
    handlers.get("error")?.({ error: { message: "Bad response code: 404" } });
    await vi.waitFor(() => expect(changes).toEqual(["https://itstiles.com/archives/" + "9".repeat(64) + ".pmtiles"]));
    handlers.get("error")?.({ error: { message: "Bad response code: 404" } });
    expect(fetchMock).toHaveBeenCalledTimes(1); // throttled
    stop();
    expect(handlers.has("error")).toBe(false);
  });

  it("pins the same package versions this repository builds with", async () => {
    const lock: unknown = JSON.parse(await readFile("package-lock.json", "utf8"));
    const version = (name: string): string => {
      const entry = typeof lock === "object" && lock !== null && "packages" in lock && typeof lock.packages === "object" && lock.packages !== null
        ? Object.entries(lock.packages).find(([path]) => path === "node_modules/" + name)?.[1] : undefined;
      if (typeof entry !== "object" || entry === null || !("version" in entry) || typeof entry.version !== "string") throw new Error("No lock entry for " + name);
      return entry.version;
    };
    expect(docs).toContain("npm i -E maplibre-gl@" + version("maplibre-gl") + " pmtiles@" + version("pmtiles") + " @protomaps/basemaps@" + version("@protomaps/basemaps"));
  });

  it("documents every served flavor and the public URLs", () => {
    for (const flavor of PROTOMAPS_FLAVORS) {
      expect(docs).toContain("https://itstiles.com/maps/" + flavor + ".json");
      expect(servedStyleUrl(flavor)).toBe("https://itstiles.com/styles/protomaps/" + flavor + ".json");
    }
    for (const url of ["https://itstiles.com/assets/embed.js", "https://itstiles.com/assets/maplibre-gl.css", "worker-src blob:", "connect-src 'self' https://itstiles.com"]) {
      expect(docs).toContain(url);
    }
    expect(docs).not.toMatch(/archives\/[a-f0-9]{64}\.pmtiles/u); // no real digest is hard-coded
  });

  it("resolves the archive through the manifest, never a fixed digest", async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(JSON.stringify({ archive: "../archives/" + DIGEST + ".pmtiles" }));
      Object.defineProperty(response, "url", { value: "https://itstiles.com/maps/light.json" });
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(currentArchiveUrl()).resolves.toBe("https://itstiles.com/archives/" + DIGEST + ".pmtiles");
    expect(fetchMock).toHaveBeenCalledWith("https://itstiles.com/maps/light.json", expect.objectContaining({ cache: "no-cache" }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 404 })));
    await expect(currentArchiveUrl()).rejects.toThrow(/HTTP 404/u);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    await expect(currentArchiveUrl()).rejects.toThrow(/missing "archive"/u);
  });

  it("builds a valid recoloured client-side style", () => {
    const archiveUrl = "https://itstiles.com/archives/" + DIGEST + ".pmtiles";
    const style = customStyle({ archiveUrl, flavor: "dark", lang: "de", colors: { water: "#123456", earth: "#abcdef" } });
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources.protomaps).toEqual({ type: "vector", url: "pmtiles://" + archiveUrl, attribution: ATTRIBUTION });
    expect(style.sprite).toBe("https://itstiles.com/styles/sprites/v4/dark");
    const water = style.layers.find((layer) => layer.id === "water");
    expect(water && "paint" in water ? water.paint : undefined).toMatchObject({ "fill-color": "#123456" });
    expect(JSON.stringify(style.layers)).toContain("name:de");
    expect(JSON.stringify(style.layers)).toContain(namedFlavor("dark").highway);
  });

  it("registers the pmtiles protocol only once", () => {
    const addProtocol = vi.spyOn(maplibregl, "addProtocol").mockImplementation(() => undefined);
    registerPmtiles();
    registerPmtiles();
    expect(addProtocol).toHaveBeenCalledTimes(1);
    expect(addProtocol.mock.calls[0]?.[0]).toBe("pmtiles");
  });
});
