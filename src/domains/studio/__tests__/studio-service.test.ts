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

function decodePreviewDocument(previewUrl: string): unknown {
  const prefix = "data:application/json;charset=utf-8,";
  assert.equal(previewUrl.startsWith(prefix), true);
  return JSON.parse(decodeURIComponent(previewUrl.slice(prefix.length))) as unknown;
}

test("studio operations enforce admin auth", async (): Promise<void> => {
  try {
    await listStylesAdmin("bad-token");
    assert.fail("expected studio unauthorized");
  } catch (error) {
    assert.equal(error instanceof StudioError, true);
    if (error instanceof StudioError) {
      assert.equal(error.code, StudioErrorCode.UNAUTHORIZED);
    }
  }

  await assert.rejects(async () => {
    await listStylesAdmin("bad-token-2");
  }, /STUDIO_UNAUTHORIZED/);

  await assert.rejects(async () => {
    await updateStyleDraft("no-style", {
      version: 8,
      sources: {},
      sprites: "/v1/styles/{styleId}/sprite",
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    }, "bad-token");
  }, /STUDIO_UNAUTHORIZED/);

  await assert.rejects(async () => {
    await listStylesAdmin(42 as unknown as string);
  }, /STUDIO_UNAUTHORIZED/);

  await assert.rejects(async () => {
    await getStyleDraft("studio-style", { token: "admin-token" } as unknown as string);
  }, /STUDIO_UNAUTHORIZED/);
});

test("studio flow creates draft, publishes, and exposes draft state", async (): Promise<void> => {
  const token = "Bearer admin-token";

  const initial = await createStyleVersion("studio-style", {
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

  const published = await publishStyle("studio-style", initial.id, token);
  assert.equal(published.versionId, initial.id);

  const list = await listStylesAdmin(token);
  assert.equal(list.some((entry) => entry.id === "studio-style"), true);

  const draft = await updateStyleDraft("studio-style", {
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
  assert.deepEqual(decodePreviewDocument(draft.previewUrl), draft.document);

  const fetchedDraft = await getStyleDraft("studio-style", token);
  assert.equal(fetchedDraft.versionId, draft.versionId);
  assert.deepEqual(decodePreviewDocument(fetchedDraft.previewUrl), fetchedDraft.document);
  assert.equal(JSON.stringify(fetchedDraft.document), JSON.stringify(draft.document));
  assert.equal(JSON.stringify(fetchedDraft.document) === JSON.stringify(published.document), false);
  assert.equal(fetchedDraft.previewUrl === published.previewUrl, false);
});

test("studio rejects invalid style docs on draft save", async (): Promise<void> => {
  const token = "admin-token";
  await assert.rejects(async () => {
    await updateStyleDraft("studio-invalid", {
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

test("studio surfaces missing drafts as STUDIO_NOT_FOUND", async (): Promise<void> => {
  const token = "admin-token";
  await assert.rejects(async () => {
    await getStyleDraft("missing-style", token);
  }, /STUDIO_NOT_FOUND/);
});

test("studio rejects blank identifiers with STUDIO_BAD_REQUEST", async (): Promise<void> => {
  const token = "admin-token";
  await assert.rejects(async () => {
    await getStyleDraft("   ", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getStyleDraft("foo/bar", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateStyleDraft("   ", {
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

  await assert.rejects(async () => {
    await updateStyleDraft("studio\\draft", {
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

  await assert.rejects(async () => {
    await updateStyleDraft("studio..draft", {
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

  await assert.rejects(async () => {
    await publishStyle("studio-style", "   ", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await publishStyle("..", "version-1", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await publishStyle("studio-style", "version/1", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await publishStyle("studio-style", "version..1", token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await getStyleDraft(42 as unknown as string, token);
  }, /STUDIO_BAD_REQUEST/);

  await assert.rejects(async () => {
    await updateStyleDraft(42 as unknown as string, {
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

  await assert.rejects(async () => {
    await publishStyle("studio-style", 42 as unknown as string, token);
  }, /STUDIO_BAD_REQUEST/);
});
