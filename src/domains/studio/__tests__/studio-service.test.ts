import { strict as assert } from "node:assert";
import { createStyleVersion } from "../../styles/styles.service";
import {
  getStyleDraft,
  listStylesAdmin,
  publishStyle,
  updateStyleDraft,
} from "../studio.service";
import { StudioError, StudioErrorCode } from "../types";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "admin-token";
process.env.ALLOWED_ORIGINS = "https://example.com";
process.env.NODE_ENV = "development";

test("studio operations enforce admin auth", (): void => {
  try {
    listStylesAdmin("bad-token");
    assert.fail("expected studio unauthorized");
  } catch (error) {
    assert.equal(error instanceof StudioError, true);
    if (error instanceof StudioError) {
      assert.equal(error.code, StudioErrorCode.UNAUTHORIZED);
    }
  }

  assert.throws(() => {
    listStylesAdmin("bad-token-2");
  }, /STUDIO_UNAUTHORIZED/);

  assert.throws(() => {
    updateStyleDraft("no-style", {
      version: 8,
      sources: {},
      sprites: "/v1/styles/{styleId}/sprite",
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    }, "bad-token");
  }, /STUDIO_UNAUTHORIZED/);
});

test("studio flow creates draft, publishes, and exposes draft state", (): void => {
  const token = "Bearer admin-token";

  const initial = createStyleVersion("studio-style", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
  });

  const published = publishStyle("studio-style", initial.id, token);
  assert.equal(published.versionId, initial.id);

  const list = listStylesAdmin(token);
  assert.equal(list.some((entry) => entry.id === "studio-style"), true);

  const draft = updateStyleDraft("studio-style", {
    version: 8,
    sources: {
      osm: {
        type: "vector",
        url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "draft-layer",
        type: "line",
        source: "osm",
      },
    ],
  }, token);

  assert.equal(draft.styleId, "studio-style");
  assert.equal(draft.versionId !== initial.id, true);
  assert.equal(draft.previewUrl.includes("/v1/styles/studio-style/style.json"), true);

  const fetchedDraft = getStyleDraft("studio-style", token);
  assert.equal(fetchedDraft.versionId, draft.versionId);
  assert.equal(fetchedDraft.previewUrl.includes("/v1/styles/studio-style/style.json"), true);
  assert.equal(JSON.stringify(fetchedDraft.document), JSON.stringify(draft.document));
  assert.equal(JSON.stringify(fetchedDraft.document) === JSON.stringify(published.document), false);
});

test("studio rejects invalid style docs on draft save", (): void => {
  const token = "admin-token";
  assert.throws(() => {
    updateStyleDraft("studio-invalid", {
      version: "bad",
      sources: "missing-structure",
      sprites: "bad",
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    } as unknown as {
      version: number;
      sources: unknown;
      sprites: string;
      glyphs: string;
    }, token);
  }, /STUDIO_BAD_REQUEST/);
});

test("studio surfaces missing drafts as STUDIO_NOT_FOUND", (): void => {
  const token = "admin-token";
  assert.throws(() => {
    getStyleDraft("missing-style", token);
  }, /STUDIO_NOT_FOUND/);
});

test("studio rejects blank identifiers with STUDIO_BAD_REQUEST", (): void => {
  const token = "admin-token";
  assert.throws(() => {
    getStyleDraft("   ", token);
  }, /STUDIO_BAD_REQUEST/);

  assert.throws(() => {
    updateStyleDraft("   ", {
      version: 8,
      sources: {
        osm: {
          type: "vector",
          url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
        },
      },
      sprites: "/v1/styles/{styleId}/sprite",
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    }, token);
  }, /STUDIO_BAD_REQUEST/);

  assert.throws(() => {
    publishStyle("studio-style", "   ", token);
  }, /STUDIO_BAD_REQUEST/);
});
