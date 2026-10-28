import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
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

test("style lifecycle and validation contract", async (): Promise<void> => {
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

  const draftVersion = await createStyleVersion("demo", draft);
  // Mutating caller-owned input after create must not mutate stored version state.
  draft.layers?.push({
    id: "mutated-after-create",
    type: "fill",
  });
  const publishResult = await publishStyleVersion("demo", draftVersion.id);
  assert.equal(publishResult.id, draftVersion.id);
  await assert.rejects(async () => {
    await publishStyleVersion("demo", draftVersion.id);
  }, /STYLE_PUBLISH_CONFLICT/);

  const trimmedDraftVersion = await createStyleVersion("  demo-trim  ", draft);
  assert.equal(trimmedDraftVersion.styleId, "demo-trim");
  const trimmedPublish = await publishStyleVersion(" demo-trim ", ` ${trimmedDraftVersion.id} `);
  assert.equal(trimmedPublish.styleId, "demo-trim");

  const published = await getStyle("demo");
  (published.layers as unknown[] | undefined)?.push({
    id: "mutated-return-value",
    type: "line",
  });
  const fetchedAgain = await getStyle("demo");
  assert.equal(published.version, 8);
  assert.equal(typeof published.sources, "object");
  assert.equal(Array.isArray((published.sources.osm as { tiles?: unknown[] }).tiles), true);
  assert.equal("url" in (published.sources.osm as Record<string, unknown>), false);
  assert.equal(Array.isArray(fetchedAgain.layers), true);
  assert.equal((fetchedAgain.layers as unknown[]).some((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    return (entry as { id?: unknown }).id === "mutated-return-value";
  }), false);

  const styles = await listStyles();
  assert.equal(styles.some((entry) => entry.id === "demo"), true);

  const assets = await resolveStyleAssets("demo");
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

  const emptySources = validateStyleDocument({
    version: 8,
    sources: {},
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    sprites: "/v1/styles/{styleId}/sprites/sprite",
    layers: [],
  });
  assert.equal(emptySources.valid, false);
  assert.equal(emptySources.reason?.includes("at least one source"), true);

  const template = buildDefaultStyleTemplate({ styleId: "generated-style" });
  const templateVersion = await createStyleVersion("generated-style", template);
  await publishStyleVersion("generated-style", templateVersion.id);
  const templateStyle = await getStyle("generated-style", templateVersion.id);
  assert.equal(templateStyle.version, 8);
  assert.equal(Array.isArray((templateStyle.sources.default as { tiles: unknown[] }).tiles), true);
  assert.equal(validateStyleDocument(template).valid, true);

  assert.throws(() => {
    buildDefaultStyleTemplate(null as unknown as Parameters<typeof buildDefaultStyleTemplate>[0]);
  }, /STYLE_INVALID_DOCUMENT/);

  assert.throws(() => {
    buildDefaultStyleTemplate(42 as unknown as Parameters<typeof buildDefaultStyleTemplate>[0]);
  }, /STYLE_INVALID_DOCUMENT/);

  assert.throws(() => {
    buildDefaultStyleTemplate({
      styleId: "generated-style",
      sourceName: 42 as unknown as string,
    });
  }, /STYLE_INVALID_DOCUMENT/);

  assert.throws(() => {
    buildDefaultStyleTemplate({
      styleId: 42 as unknown as string,
    });
  }, /STYLE_INVALID_DOCUMENT/);

  assert.throws(() => {
    buildDefaultStyleTemplate({
      styleId: "style/invalid",
    });
  }, /STYLE_INVALID_DOCUMENT/);

  await assert.rejects(async () => {
    await createStyleVersion("   ", draft);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await createStyleVersion("foo/bar", draft);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await createStyleVersion("demo..style", draft);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await createStyleVersion(42 as unknown as string, draft);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await getStyle("   ");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await getStyle(42 as unknown as string);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await getStyle("demo\\style");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await publishStyleVersion("demo", "   ");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await publishStyleVersion("demo", 42 as unknown as string);
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await publishStyleVersion("demo", "version\\id");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await publishStyleVersion("demo", "version..id");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await resolveStyleAssets("..");
  }, /STYLE_INVALID_DOCUMENT/);
  await assert.rejects(async () => {
    await resolveStyleAssets(42 as unknown as string);
  }, /STYLE_INVALID_DOCUMENT/);

  await assert.rejects(async () => {
    await createStyleVersion("empty-sources", {
      version: 8,
      sources: {},
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
      sprites: "/v1/styles/{styleId}/sprites/sprite",
      layers: [],
    });
  }, /STYLE_INVALID_DOCUMENT/);

  await assert.rejects(async () => {
    await createStyleVersion("empty-source-name", {
      version: 8,
      sources: {
        "": {
          type: "vector",
          url: "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}",
        },
      },
      glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
      sprites: "/v1/styles/{styleId}/sprites/sprite",
      layers: [],
    });
  }, /STYLE_INVALID_DOCUMENT/);
});

test("concurrent first-version creation for a new style remains transactional", async (): Promise<void> => {
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

  const [first, second] = await Promise.all([
    createStyleVersion("concurrent-style", draft),
    createStyleVersion("concurrent-style", draft),
  ]);

  assert.equal(first.styleId, "concurrent-style");
  assert.equal(second.styleId, "concurrent-style");
  assert.equal(first.id === second.id, false);

  const styles = await listStyles();
  const concurrent = styles.find((entry) => entry.id === "concurrent-style");
  assert.equal(concurrent?.latestVersionId === first.id || concurrent?.latestVersionId === second.id, true);

  const latest = await getStyle("concurrent-style");
  assert.equal(latest.version, 8);
  assert.equal(Array.isArray((latest.sources.osm as { tiles?: unknown[] }).tiles), true);
});

test("style listing is deterministic newest-first with stable id tie-breaks", async (): Promise<void> => {
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

  await createStyleVersion("listing-style-a", draft);
  await createStyleVersion("listing-style-b", draft);

  const originalFindMany = prisma.style.findMany.bind(prisma.style);
  const capturedArgs: Array<Parameters<typeof prisma.style.findMany>[0]> = [];
  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = (async (...args: Parameters<typeof prisma.style.findMany>) => {
    capturedArgs.push(args[0]);
    return await originalFindMany(...args);
  }) as typeof prisma.style.findMany;

  try {
    await listStyles();
    assert.deepEqual(capturedArgs[0]?.orderBy, [
      { createdAt: "desc" },
      { id: "asc" },
    ]);
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("style listing skips malformed persisted style rows", async (): Promise<void> => {
  const originalFindMany = prisma.style.findMany.bind(prisma.style);

  (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = ((async (...args: Parameters<typeof prisma.style.findMany>) => {
    if (args[0]?.orderBy) {
      return [
        {
          id: "valid-style-row",
          name: "Valid Style Row",
          latestVersionId: "valid-style-row-v1",
          publishedVersionId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "",
          name: "Broken Style Row",
          latestVersionId: "broken-style-row-v1",
          publishedVersionId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "broken-style-row-2",
          name: "Broken Style Row 2",
          latestVersionId: 42,
          publishedVersionId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
    }
    return await originalFindMany(...args);
  }) as unknown) as typeof prisma.style.findMany;

  try {
    const styles = await listStyles();
    assert.equal(styles.length, 1);
    assert.equal(styles[0]?.id, "valid-style-row");
    assert.equal(styles[0]?.latestVersionId, "valid-style-row-v1");
  } finally {
    (prisma.style as { findMany: typeof prisma.style.findMany }).findMany = originalFindMany;
  }
});

test("style read surfaces fail closed on malformed persisted style documents", async (): Promise<void> => {
  const originalFindUniqueStyleVersion = prisma.styleVersion.findUnique.bind(prisma.styleVersion);

  (prisma.styleVersion as { findUnique: typeof prisma.styleVersion.findUnique }).findUnique = ((async (...args: Parameters<typeof prisma.styleVersion.findUnique>) => {
    const versionId = args[0]?.where && "id" in args[0].where ? args[0].where.id : undefined;
    if (versionId === "broken-style-json-version") {
      return {
        id: "broken-style-json-version",
        styleId: "broken-style-json",
        createdAt: "2026-01-01T00:00:00.000Z",
        version: 1,
        document: "{bad json",
      };
    }
    if (versionId === "broken-style-shape-version") {
      return {
        id: "broken-style-shape-version",
        styleId: "broken-style-shape",
        createdAt: "2026-01-01T00:00:00.000Z",
        version: 1,
        document: JSON.stringify({
          version: 8,
          sources: {
            osm: {
              type: "vector",
              tiles: ["/v1/tiles/{z}/{x}/{y}.mvt"],
            },
          },
          glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
          sprites: "/v1/styles/{styleId}/sprites/sprite",
          layers: [],
        }),
      };
    }
    return await originalFindUniqueStyleVersion(...args);
  }) as unknown) as typeof prisma.styleVersion.findUnique;

  try {
    await prisma.style.upsert({
      where: { id: "broken-style-json" },
      update: {
        latestVersionId: "broken-style-json-version",
        publishedVersionId: "broken-style-json-version",
      },
      create: {
        id: "broken-style-json",
        name: "broken-style-json",
        createdAt: "2026-01-01T00:00:00.000Z",
        latestVersionId: "broken-style-json-version",
        publishedVersionId: "broken-style-json-version",
      },
    });

    await prisma.style.upsert({
      where: { id: "broken-style-shape" },
      update: {
        latestVersionId: "broken-style-shape-version",
        publishedVersionId: "broken-style-shape-version",
      },
      create: {
        id: "broken-style-shape",
        name: "broken-style-shape",
        createdAt: "2026-01-01T00:00:00.000Z",
        latestVersionId: "broken-style-shape-version",
        publishedVersionId: "broken-style-shape-version",
      },
    });

    await assert.rejects(async () => {
      await getStyle("broken-style-json");
    }, /STYLE_INVALID_DOCUMENT:stored style document is invalid/);

    await assert.rejects(async () => {
      await publishStyleVersion("broken-style-shape", "broken-style-shape-version");
    }, /STYLE_INVALID_DOCUMENT:source osm tile source must include \{access_token\} placeholder/);

    await assert.rejects(async () => {
      await resolveStyleAssets("broken-style-shape");
    }, /STYLE_INVALID_DOCUMENT:source osm tile source must include \{access_token\} placeholder/);
  } finally {
    (prisma.styleVersion as { findUnique: typeof prisma.styleVersion.findUnique }).findUnique = originalFindUniqueStyleVersion;
  }
});

test("style read surfaces fail closed on malformed persisted style rows", async (): Promise<void> => {
  const originalFindUniqueStyle = prisma.style.findUnique.bind(prisma.style);

  (prisma.style as { findUnique: typeof prisma.style.findUnique }).findUnique = ((async (...args: Parameters<typeof prisma.style.findUnique>) => {
    const styleId = args[0]?.where && "id" in args[0].where ? args[0].where.id : undefined;
    if (styleId === "broken-style-row") {
      return {
        id: "",
        name: "Broken Style Row",
        createdAt: "2026-01-01T00:00:00.000Z",
        latestVersionId: "broken-style-row-v1",
        publishedVersionId: "broken-style-row-v1",
        versions: [],
      };
    }
    return await originalFindUniqueStyle(...args);
  }) as unknown) as typeof prisma.style.findUnique;

  try {
    await assert.rejects(async () => {
      await getStyle("broken-style-row");
    }, /STYLE_NOT_FOUND:Style not found/);

    await assert.rejects(async () => {
      await publishStyleVersion("broken-style-row", "broken-style-row-v1");
    }, /STYLE_NOT_FOUND:Style not found/);

    await assert.rejects(async () => {
      await resolveStyleAssets("broken-style-row");
    }, /STYLE_NOT_FOUND:Style not found/);
  } finally {
    (prisma.style as { findUnique: typeof prisma.style.findUnique }).findUnique = originalFindUniqueStyle;
  }
});
