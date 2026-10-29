import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import maplibregl from "maplibre-gl";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { namedFlavor } from "@protomaps/basemaps";
import { PROTOMAPS_FLAVORS } from "../../src/web/basemap.js";
import { ATTRIBUTION, currentArchiveUrl, customStyle, registerPmtiles, servedStyleUrl } from "./integration-snippets/itstiles.js";

const DIGEST = "e".repeat(64);
const docs = await readFile("docs/integration.md", "utf8");

describe("docs/integration.md", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("embeds the tested helper module verbatim", async () => {
    const helper = (await readFile("test/web/integration-snippets/itstiles.ts", "utf8")).trimEnd();
    expect(docs).toContain("```ts\n" + helper + "\n```");
  });

  it("pins the same package versions this repository builds with", async () => {
    const lock: unknown = JSON.parse(await readFile("package-lock.json", "utf8"));
    const version = (name: string): string => {
      const entry = typeof lock === "object" && lock !== null && "packages" in lock && typeof lock.packages === "object" && lock.packages !== null
        ? Object.entries(lock.packages).find(([path]) => path === "node_modules/" + name)?.[1] : undefined;
      if (typeof entry !== "object" || entry === null || !("version" in entry) || typeof entry.version !== "string") throw new Error("No lock entry for " + name);
      return entry.version;
    };
    expect(docs).toContain("npm i maplibre-gl@" + version("maplibre-gl") + " pmtiles@" + version("pmtiles") + " @protomaps/basemaps@" + version("@protomaps/basemaps"));
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
