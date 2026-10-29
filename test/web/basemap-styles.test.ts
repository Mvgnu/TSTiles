import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { MapManifest } from "../../src/contract.js";
import {
  BASEMAPS_VERSION,
  DEFAULT_ATTRIBUTION,
  DEFAULT_ATTRIBUTION_HTML,
  PROTOMAPS_FLAVORS,
  StyleBuildError,
  buildBasemapStyle,
  parseArchiveUrl,
  parseAssetsBase,
  parseFlavors,
  parseLanguage,
  renderAttribution,
  requiredSourceLayers,
  styleProblems,
} from "../../src/web/basemap.js";
import { parseStylesArgs, runStylesBuild, writeFilesAtomically } from "../../src/web/styles-build.js";

const DIGEST = "b".repeat(64);
const ARCHIVE = "https://itstiles.com/archives/" + DIGEST + ".pmtiles";
const ASSETS = "https://itstiles.com/styles";

function planetManifest(overrides: Partial<MapManifest> = {}): MapManifest {
  return {
    schemaVersion: 1, id: "light", name: "Planet (light)", archive: "../archives/" + DIGEST + ".pmtiles",
    sha256: DIGEST, bytes: 139191612225, tileType: "mvt", minZoom: 0, maxZoom: 15,
    bounds: [-180, -90, 180, 90], center: [0, 0, 0],
    vectorLayers: ["boundaries", "buildings", "earth", "landcover", "landuse", "places", "pois", "roads", "water"].map((id) => ({ id })),
    attribution: DEFAULT_ATTRIBUTION, style: "../styles/protomaps/light.json",
    ...overrides,
  };
}

function manifestFetch(body: unknown, url = "https://itstiles.com/maps/light.json"): typeof fetch {
  return async () => {
    const response = new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
}

describe("basemap style inputs", () => {
  it.each([
    ["relative", "archives/x.pmtiles"],
    ["plain http on a public host", "http://itstiles.com/archives/x.pmtiles"],
    ["credentials", "https://user:pw@itstiles.com/archives/x.pmtiles"],
    ["fragment", "https://itstiles.com/archives/x.pmtiles#z"],
    ["non-archive path", "https://itstiles.com/maps/light.json"],
    ["other scheme", "ftp://itstiles.com/archives/x.pmtiles"],
    ["pmtiles scheme already applied", "pmtiles://https://itstiles.com/archives/x.pmtiles"],
  ])("rejects an archive URL with %s", (_label, url) => {
    expect(() => parseArchiveUrl(url)).toThrow(StyleBuildError);
  });

  it("accepts https archives and http only on loopback for local verification", () => {
    expect(parseArchiveUrl(ARCHIVE)).toBe(ARCHIVE);
    expect(parseArchiveUrl("http://127.0.0.1:8080/archives/a.pmtiles")).toBe("http://127.0.0.1:8080/archives/a.pmtiles");
  });

  it("normalises the assets base and rejects queries", () => {
    expect(parseAssetsBase("https://itstiles.com/styles/")).toBe(ASSETS);
    expect(() => parseAssetsBase("https://itstiles.com/styles?v=1")).toThrow(/query/u);
    expect(() => parseAssetsBase("http://itstiles.com/styles")).toThrow(/https/u);
  });

  it("validates flavor lists and languages", () => {
    expect(parseFlavors("light, dark")).toEqual(["light", "dark"]);
    expect(() => parseFlavors("light,sepia")).toThrow(/Unknown flavor "sepia"/u);
    expect(() => parseFlavors("light,light")).toThrow(/repeat/u);
    expect(() => parseFlavors("light,")).toThrow(StyleBuildError);
    expect(parseLanguage("de")).toBe("de");
    expect(() => parseLanguage("xx")).toThrow(/Unsupported label language/u);
  });

  it("requires exactly one archive input and the output flags", () => {
    const base = ["--assets-base", ASSETS, "--out", "/tmp/x"];
    expect(() => parseStylesArgs(base)).toThrow(/exactly one/u);
    expect(() => parseStylesArgs(["--archive-url", ARCHIVE, "--manifest-url", "https://itstiles.com/maps/light.json", ...base])).toThrow(/exactly one/u);
    expect(() => parseStylesArgs(["--archive-url", ARCHIVE, "--out", "/tmp/x"])).toThrow(/--assets-base/u);
    expect(() => parseStylesArgs(["--manifest", "m.json", ...base])).toThrow(/--manifest-public-url/u);
    expect(() => parseStylesArgs(["--archive-url", ARCHIVE, "--bogus", "1", ...base])).toThrow(StyleBuildError);
    expect(parseStylesArgs(["--archive-url", ARCHIVE, ...base])).toMatchObject({
      flavors: [...PROTOMAPS_FLAVORS], lang: "en", extraAttribution: undefined,
    });
    expect(parseStylesArgs(["--archive-url", ARCHIVE, "--attribution", "Daten: Stadt", ...base]).extraAttribution).toBe("Daten: Stadt");
    expect(() => parseStylesArgs(["--archive-url", ARCHIVE, "--attribution", "a\u0007b", ...base])).toThrow(/control characters/u);
  });
});

describe("generated Protomaps styles", () => {
  it("pins the generator version to the installed package", async () => {
    const pkg: unknown = JSON.parse(await readFile("node_modules/@protomaps/basemaps/package.json", "utf8"));
    expect(pkg).toMatchObject({ version: BASEMAPS_VERSION });
    const root: unknown = JSON.parse(await readFile("package.json", "utf8"));
    expect(root).toMatchObject({ dependencies: { "@protomaps/basemaps": BASEMAPS_VERSION } });
  });

  it.each(PROTOMAPS_FLAVORS)("%s is a complete style that passes the MapLibre style-spec validator", (flavor) => {
    const style = buildBasemapStyle({ archiveUrl: ARCHIVE, assetsBase: ASSETS, flavor, lang: "en" });
    expect(style.sources.protomaps).toEqual({ type: "vector", url: "pmtiles://" + ARCHIVE, attribution: DEFAULT_ATTRIBUTION_HTML });
    expect(style.glyphs).toBe("https://itstiles.com/styles/fonts/{fontstack}/{range}.pbf");
    expect(style.sprite).toBe("https://itstiles.com/styles/sprites/v4/" + flavor);
    expect(style.layers.length).toBeGreaterThan(50);
    expect(style.layers.some((layer) => layer.type === "symbol")).toBe(true);
    expect(styleProblems(style)).toEqual([]);
    expect(validateStyleMin(style)).toEqual([]);
  });

  it("always links itstiles.com, Protomaps and OpenStreetMap", () => {
    expect(DEFAULT_ATTRIBUTION_HTML).toBe('<a href="https://itstiles.com" target="_blank" rel="noopener">itstiles.com</a> · '
      + '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © '
      + '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>');
  });

  it.each([
    [{ text: "x", href: "javascript:alert(1)" }],
    [{ text: "x", href: "http://itstiles.com" }],
    [{ text: "x", href: "https://evil.example" }],
    [{ text: "x", href: "not a url" }],
  ])("refuses attribution links outside the allowlist %#", (link) => {
    expect(() => renderAttribution([link])).toThrow(StyleBuildError);
  });

  it("escapes link text and extra plain-text credit, so no input injects markup", () => {
    expect(renderAttribution([{ text: "<img src=x onerror=alert(1)>", href: "https://itstiles.com" }, ' "<b>"']))
      .toBe('<a href="https://itstiles.com" target="_blank" rel="noopener">&lt;img src=x onerror=alert(1)&gt;</a> &quot;&lt;b&gt;&quot;');
    const style = buildBasemapStyle({ archiveUrl: ARCHIVE, assetsBase: ASSETS, flavor: "dark", lang: "de", extraAttribution: "A <script>&</script> B" });
    expect(style.sources.protomaps).toMatchObject({ attribution: DEFAULT_ATTRIBUTION_HTML + " · A &lt;script&gt;&amp;&lt;/script&gt; B" });
    expect(styleProblems({ ...style, sources: { protomaps: { type: "vector", url: "pmtiles://" + ARCHIVE, attribution: "Protomaps" } } }))
      .toContain("source protomaps attribution must start with the itstiles.com backlink");
    expect(JSON.stringify(style.layers)).toContain("name:de");
  });

  it("names the Protomaps schema layers it reads", () => {
    expect(requiredSourceLayers()).toEqual(["boundaries", "buildings", "earth", "landcover", "landuse", "places", "pois", "roads", "water"]);
  });
});

describe("styles CLI boundary", () => {
  let work: string;
  beforeEach(async () => { work = await mkdtemp(join(tmpdir(), "tstiles-styles-")); });
  afterEach(async () => { await rm(work, { recursive: true, force: true }); });

  const args = (out: string, ...extra: string[]) => ["--assets-base", ASSETS, "--out", out, ...extra];

  it("writes one style per flavor with no temp files, byte-identical on rerun", async () => {
    const out = join(work, "styles/protomaps");
    const first = await runStylesBuild(args(out, "--archive-url", ARCHIVE));
    expect(first.files.map((file) => file.slice(out.length + 1))).toEqual(PROTOMAPS_FLAVORS.map((flavor) => flavor + ".json"));
    expect((await readdir(out)).sort()).toEqual(PROTOMAPS_FLAVORS.map((flavor) => flavor + ".json").sort());
    const before = await Promise.all(first.files.map((file) => readFile(file, "utf8")));
    await runStylesBuild(args(out, "--archive-url", ARCHIVE));
    const after = await Promise.all(first.files.map((file) => readFile(file, "utf8")));
    expect(after).toEqual(before);
    const light: unknown = JSON.parse(before[0] ?? "");
    expect(light).toMatchObject({ version: 8, sources: { protomaps: { url: "pmtiles://" + ARCHIVE } } });
  });

  it("resolves the archive relative to a fetched manifest URL", async () => {
    const out = join(work, "out");
    const result = await runStylesBuild(
      args(out, "--manifest-url", "https://itstiles.com/maps/light.json", "--flavors", "light,dark"),
      manifestFetch(planetManifest()),
    );
    expect(result).toMatchObject({ archiveUrl: ARCHIVE, manifestUrl: "https://itstiles.com/maps/light.json", flavors: ["light", "dark"] });
    expect((await readdir(out)).sort()).toEqual(["dark.json", "light.json"]);
  });

  it("reads a local manifest and resolves it against its public URL", async () => {
    const manifestPath = join(work, "planet.json");
    await writeFile(manifestPath, JSON.stringify(planetManifest()));
    const result = await runStylesBuild(args(join(work, "out"),
      "--manifest", manifestPath, "--manifest-public-url", "https://itstiles.com/maps/planet.json", "--flavors", "white"));
    expect(result.archiveUrl).toBe(ARCHIVE);
  });

  it("rejects archives outside the Protomaps basemap schema and leaves existing styles intact", async () => {
    const out = join(work, "out");
    await mkdir(out);
    await writeFile(join(out, "light.json"), "previous");
    const fixture = planetManifest({ vectorLayers: [{ id: "test_fixture_1pmtiles" }] });
    await expect(runStylesBuild(args(out, "--manifest-url", "https://itstiles.com/maps/fixture.json"), manifestFetch(fixture)))
      .rejects.toThrow(/does not list the Protomaps basemap layers .*earth/u);
    await expect(runStylesBuild(args(out, "--manifest-url", "https://itstiles.com/maps/x.json"), manifestFetch({ schemaVersion: 2 })))
      .rejects.toThrow(/Manifest rejected/u);
    await expect(runStylesBuild(args(out, "--manifest-url", "https://itstiles.com/maps/x.json"),
      manifestFetch(planetManifest({ archive: "http://elsewhere.example/a.pmtiles" })))).rejects.toThrow(/https/u);
    expect(await readFile(join(out, "light.json"), "utf8")).toBe("previous");
    expect(await readdir(out)).toEqual(["light.json"]);
  });

  it("removes temp files when an atomic replacement fails", async () => {
    const out = join(work, "out");
    await mkdir(join(out, "dark.json"), { recursive: true }); // rename onto a directory fails
    await expect(writeFilesAtomically(out, new Map([["light.json", "{}"], ["dark.json", "{}"]]))).rejects.toThrow();
    expect((await readdir(out)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await expect(writeFilesAtomically(out, new Map([["../escape.json", "{}"]]))).rejects.toThrow(/unexpected file name/u);
  });
});
