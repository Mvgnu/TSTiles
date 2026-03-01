import { strict as assert } from "node:assert";
import type { StyleDocument } from "../types";
import {
  createStyleVersion,
  getStyle,
  listStyles,
  publishStyleVersion,
  buildDefaultStyleTemplate,
  resolveStyleAssets,
  validateStyleDocument,
} from "../styles.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("style lifecycle and validation contract", (): void => {
  const draft: StyleDocument = {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [],
  };

  const draftVersion = createStyleVersion("demo", draft);
  // Mutating caller-owned input after create must not mutate stored version state.
  draft.layers?.push({
    id: "mutated-after-create",
    type: "fill",
  });
  const publishResult = publishStyleVersion("demo", draftVersion.id);
  assert.equal(publishResult.id, draftVersion.id);
  assert.throws(() => {
    publishStyleVersion("demo", draftVersion.id);
  }, /STYLE_PUBLISH_CONFLICT/);

  const trimmedDraftVersion = createStyleVersion("  demo-trim  ", draft);
  assert.equal(trimmedDraftVersion.styleId, "demo-trim");
  const trimmedPublish = publishStyleVersion(" demo-trim ", ` ${trimmedDraftVersion.id} `);
  assert.equal(trimmedPublish.styleId, "demo-trim");

  const published = getStyle("demo");
  (published.layers as unknown[] | undefined)?.push({
    id: "mutated-return-value",
    type: "line",
  });
  const fetchedAgain = getStyle("demo");
  assert.equal(published.version, 8);
  assert.equal(typeof published.sources, "object");
  assert.equal(Array.isArray(fetchedAgain.layers), true);
  assert.equal((fetchedAgain.layers as unknown[]).some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    return (entry as { id?: unknown }).id === "mutated-return-value";
  }), false);

  const styles = listStyles();
  assert.equal(styles.some((entry) => entry.id === "demo"), true);

  const assets = resolveStyleAssets("demo");
  assert.equal(assets.styleId, "demo");
  assert.equal(assets.versionId, draftVersion.id);
  assert.equal(assets.spritePng.endsWith("/v1/styles/demo/sprites/sprite.png"), true);
  assert.equal(assets.glyphs.includes("{fontstack}"), true);

  const valid = validateStyleDocument(draft);
  assert.equal(valid.valid, true);

  const invalid = validateStyleDocument({
    version: 8,
    sources: {},
    glyphs: "/v1/fonts/{fontstack}/missing",
    sprites: "bad-url",
  });
  assert.equal(invalid.valid, false);

  const missingRange = validateStyleDocument({
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    glyphs: "/v1/fonts/{fontstack}.pbf",
    sprites: "/v1/styles/{styleId}/sprite",
  });
  assert.equal(missingRange.valid, false);

  const template = buildDefaultStyleTemplate({ styleId: "generated-style" });
  const templateVersion = createStyleVersion("generated-style", template);
  publishStyleVersion("generated-style", templateVersion.id);
  const templateStyle = getStyle("generated-style", templateVersion.id);
  assert.equal(templateStyle.version, 8);
  assert.equal(Array.isArray((templateStyle.sources.default as { tiles: unknown[] }).tiles), true);
  assert.equal(validateStyleDocument(template).valid, true);

  assert.throws(() => {
    createStyleVersion("   ", draft);
  }, /STYLE_INVALID_DOCUMENT/);
  assert.throws(() => {
    getStyle("   ");
  }, /STYLE_INVALID_DOCUMENT/);
  assert.throws(() => {
    publishStyleVersion("demo", "   ");
  }, /STYLE_INVALID_DOCUMENT/);
});
