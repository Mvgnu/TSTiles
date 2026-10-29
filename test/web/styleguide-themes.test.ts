import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { namedFlavor } from "@protomaps/basemaps";
import { DEFAULT_ATTRIBUTION_HTML } from "../../src/web/basemap.js";
import { mergeFlavor } from "./integration-snippets/itstiles.js";
import { brandPalette, contrastRatio, themedStyle, themes } from "./integration-snippets/themes.js";

const ARCHIVE = "https://itstiles.com/archives/" + "a".repeat(64) + ".pmtiles";

describe("docs/styleguide.md example themes", () => {
  it("embeds the tested theme module verbatim (import path adapted to the app alias)", async () => {
    const docs = await readFile("docs/styleguide.md", "utf8");
    const source = (await readFile("test/web/integration-snippets/themes.ts", "utf8")).trimEnd()
      .replace('from "./itstiles.js"; // in your app: "@/lib/itstiles"', 'from "@/lib/itstiles";');
    expect(docs).toContain("```ts\n" + source + "\n```");
    expect(docs).toContain("integration.md");
  });

  it.each(themes.map((theme) => [theme.name, theme] as const))("%s generates a valid style with the backlink", (_name, theme) => {
    const style = themedStyle(ARCHIVE, theme, "de");
    expect(validateStyleMin(style)).toEqual([]);
    expect(style.sources.protomaps).toMatchObject({ attribution: DEFAULT_ATTRIBUTION_HTML });
    expect(style.layers.length).toBeGreaterThan(40);
    expect(JSON.stringify(style.layers)).toContain("name:de");
    for (const layer of style.layers) {
      const font = "layout" in layer && layer.layout && "text-font" in layer.layout ? JSON.stringify(layer.layout["text-font"]) : "";
      for (const name of font.match(/Noto Sans [A-Za-z]+/gu) ?? []) expect(["Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic"]).toContain(name);
    }
  });

  it.each(themes.map((theme) => [theme.name, theme] as const))("%s keeps place labels at ≥ 4.5:1 against the land", (_name, theme) => {
    const flavor = mergeFlavor(namedFlavor(theme.base), theme.colors);
    expect(contrastRatio(flavor.city_label, flavor.earth)).toBeGreaterThanOrEqual(4.5);
  });

  it("applies its layer recipes", () => {
    const [papier, nacht, monoAkzent, , leise] = themes;
    if (!papier || !nacht || !monoAkzent || !leise) throw new Error("missing themes");
    const ids = (theme: typeof papier) => themedStyle(ARCHIVE, theme).layers.map((layer) => layer.id);
    expect(ids(nacht)).toContain("buildings-3d");
    expect(ids(nacht)).not.toContain("pois");
    expect(ids(leise)).not.toContain("address_label");
    expect(ids(papier)).not.toContain("roads_labels_minor");
    const highway = themedStyle(ARCHIVE, monoAkzent).layers.find((layer) => layer.id === "roads_highway");
    expect(JSON.stringify(highway)).toContain("#c8402a");
  });

  it("brandPalette maps tokens and contrastRatio matches WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(brandPalette({ paper: "#fff", ink: "#111", accent: "#f00", water: "#0af", muted: "#eee" })).toMatchObject({
      earth: "#fff", city_label: "#111", highway: "#f00", water: "#0af", buildings: "#eee",
    });
  });
});
