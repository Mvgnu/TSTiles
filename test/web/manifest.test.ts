import { describe, expect, it } from "vitest";
import type { MapManifest } from "../../src/contract.js";
import {
  MAX_MANIFEST_BYTES,
  parseManifest,
  readManifestResponse,
  resolveHttpUrl,
  resolveManifest,
} from "../../src/web/manifest.js";
import { buildEmbedUrl, buildPreviewStyle, iframeSnippet, parseEmbedView } from "../../src/web/style.js";

function fixture(overrides: Partial<MapManifest> = {}): MapManifest {
  return {
    schemaVersion: 1,
    id: "fixture",
    name: "Fixture polygon",
    archive: "../archives/" + "a".repeat(64) + ".pmtiles",
    sha256: "a".repeat(64),
    bytes: 468,
    tileType: "mvt",
    minZoom: 0,
    maxZoom: 0,
    bounds: [0, 0, 1, 1],
    center: [0.5, 0.5, 8],
    vectorLayers: [{ id: "test_fixture_1pmtiles", minzoom: 0, maxzoom: 0, fields: {} }],
    attribution: "Synthetic test data — no basemap coverage",
    ...overrides,
  };
}

describe("manifest boundary", () => {
  it("accepts the shared contract while preserving the complete style reference", () => {
    const input = fixture({ style: "../styles/city/style.json?language=de" });
    const parsed = parseManifest(input);
    expect(parsed).toMatchObject(input);
    expect(parsed.center[2]).toBe(8); // A z0 archive can be overzoomed in the viewer.
    expect(parsed).not.toBe(input);
    expect(parsed.vectorLayers[0]).not.toBe(input.vectorLayers[0]);
  });

  it.each([
    [null, "Manifest"],
    [[], "Manifest"],
    [{ ...fixture(), schemaVersion: 2 }, "schemaVersion"],
    [{ ...fixture(), tileType: "png" }, "vector PMTiles"],
    [{ ...fixture(), sha256: "made-up" }, "sha256"],
    [{ ...fixture(), bytes: 0 }, "bytes"],
    [{ ...fixture(), bytes: Number.MAX_SAFE_INTEGER + 1 }, "bytes"],
    [{ ...fixture(), minZoom: 3, maxZoom: 1 }, "minZoom"],
    [{ ...fixture(), maxZoom: 27 }, "maxZoom"],
    [{ ...fixture(), bounds: [1, 0, 0, 1] }, "bounds"],
    [{ ...fixture(), bounds: [0, -91, 1, 1] }, "bounds"],
    [{ ...fixture(), center: [Infinity, 0, 1] }, "center"],
    [{ ...fixture(), center: [0, 0] }, "center"],
    [{ ...fixture(), attribution: "" }, "attribution"],
    [{ ...fixture(), vectorLayers: [{ id: "a" }, { id: "a" }] }, "unique"],
    [{ ...fixture(), vectorLayers: [{ id: "a", fields: { name: 123 } }] }, "fields.name"],
    [{ ...fixture(), vectorLayers: [{ id: "a", minzoom: 2, maxzoom: 1 }] }, "minzoom"],
    [{ ...fixture(), vectorLayers: [] }, "layer metadata"],
  ])("rejects invalid input with an actionable field error %#", (input, error) => {
    expect(() => parseManifest(input)).toThrow(String(error));
  });

  it("allows a complete style to handle an archive without layer metadata", () => {
    expect(parseManifest(fixture({ vectorLayers: [], style: "../styles/custom.json" })).vectorLayers).toEqual([]);
  });

  it("treats field names as data, including prototype-like names", () => {
    const fieldsInput: unknown = JSON.parse('{"__proto__":"String","constructor":"String"}');
    const input = { ...fixture(), vectorLayers: [{ id: "example", fields: fieldsInput }] };
    const parsed = parseManifest(input);
    const fields = parsed.vectorLayers[0]?.fields;
    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect(Object.hasOwn(fields ?? {}, "__proto__")).toBe(true);
    expect(fields?.constructor).toBe("String");
  });

  it("reads JSON delivered in separate UTF-8 chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(fixture()));
    const response = new Response(new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
        controller.close();
      },
    }));
    expect((await readManifestResponse(response)).name).toBe("Fixture polygon");
  });

  it("rejects HTTP failures and an HTML shell served instead of a manifest", async () => {
    await expect(readManifestResponse(new Response("not found", { status: 404 }))).rejects.toThrow("HTTP 404");
    await expect(readManifestResponse(new Response("<!doctype html>"))).rejects.toThrow("not valid JSON");
  });

  it("bounds unknown-length response bodies and cancels the stream", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_MANIFEST_BYTES + 1)); },
      cancel() { cancelled = true; },
    }));
    await expect(readManifestResponse(response)).rejects.toThrow("1 MiB");
    expect(cancelled).toBe(true);
  });
});

describe("independent site configuration", () => {
  it("resolves archive and style URLs against the manifest, not the embedding page", () => {
    const resolved = resolveManifest(fixture({ style: "../styles/streets/style.json" }), "https://maps.example/maps/region.json");
    expect(resolved.archiveUrl).toBe("https://maps.example/archives/" + "a".repeat(64) + ".pmtiles");
    expect(resolved.styleUrl).toBe("https://maps.example/styles/streets/style.json");
    expect(resolveHttpUrl("./maps/region.json", "https://other.example/viewer/")).toBe("https://other.example/viewer/maps/region.json");
  });

  it.each(["javascript:alert(1)", "data:application/json,{}", "file:///maps.json", "https://user:password@example.com/map.json", "https://example.com/map.json#data"])(
    "rejects unsupported or credential-bearing URLs: %s",
    (url) => expect(() => resolveHttpUrl(url, "https://maps.example/")).toThrow(),
  );

  it("does not capture the first site's archive in later preview styles", () => {
    const first = buildPreviewStyle(fixture(), "https://one.example/a.pmtiles");
    const second = buildPreviewStyle(fixture({ name: "Another map", vectorLayers: [{ id: "roads" }] }), "https://two.example/b.pmtiles");
    expect(first.sources.archive).toMatchObject({ url: "pmtiles://https://one.example/a.pmtiles" });
    expect(second.sources.archive).toMatchObject({ url: "pmtiles://https://two.example/b.pmtiles" });
    expect(second.layers.flatMap((layer) => "source-layer" in layer ? [layer["source-layer"]] : [])).toEqual(["roads", "roads", "roads"]);
    expect(first.layers.flatMap((layer) => "source-layer" in layer ? [layer["source-layer"]] : [])).toEqual([
      "test_fixture_1pmtiles", "test_fixture_1pmtiles", "test_fixture_1pmtiles",
    ]);
    expect(first.glyphs).toBeUndefined();
    expect(first.sprite).toBeUndefined();
  });

  it("escapes plain-text attribution before sending it to MapLibre's HTML field", () => {
    const style = buildPreviewStyle(fixture({ attribution: '<img src=x onerror="alert(1)"> & data owner' }), "https://maps.example/a.pmtiles");
    expect(style.sources.archive).toMatchObject({ attribution: "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; data owner" });
  });

  it("makes an embed URL portable and quotes its HTML attributes", () => {
    const url = buildEmbedUrl("https://maps.example/index.html?manifest=old&other=ignored#5/1/2", "https://data.example/maps/city.json");
    expect(new URL(url).searchParams.get("manifest")).toBe("https://data.example/maps/city.json");
    expect(new URL(url).searchParams.get("embed")).toBe("1");
    expect(new URL(url).searchParams.has("other")).toBe(false);
    expect(new URL(url).hash).toBe("");
    const snippet = iframeSnippet("https://maps.example/", "https://data.example/maps/city.json", 'City "map" <test>');
    expect(snippet).toContain('title="City &quot;map&quot; &lt;test&gt;"');
    expect(snippet).toContain("&amp;embed=1");
  });
});

describe("embed view parameters", () => {
  it("round-trips center/zoom through the iframe URL", () => {
    const url = buildEmbedUrl("https://itstiles.com/?x=1", "https://itstiles.com/maps/dark.json", { center: [13.405, 52.52], zoom: 11 });
    expect(url).toBe("https://itstiles.com/?manifest=https%3A%2F%2Fitstiles.com%2Fmaps%2Fdark.json&embed=1&center=13.405%2C52.52&zoom=11");
    expect(parseEmbedView(new URL(url).searchParams)).toEqual({ center: [13.405, 52.52], zoom: 11 });
    expect(parseEmbedView(new URLSearchParams(""))).toEqual({ center: undefined, zoom: undefined });
    expect(() => parseEmbedView(new URLSearchParams("center=13"))).toThrow(RangeError);
    expect(() => parseEmbedView(new URLSearchParams("center=a,b"))).toThrow(RangeError);
    expect(() => parseEmbedView(new URLSearchParams("zoom="))).toThrow(RangeError);
  });
});
