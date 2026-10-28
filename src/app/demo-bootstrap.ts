import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config/load-config";
import { DEVELOPMENT_ONLY_SECURITY_DEFAULTS } from "../config/security-secrets";
import { listArtifacts, promoteArtifact, registerArtifact } from "../domains/artifact/artifact.service";
import { createObjectStore } from "../domains/storage/storage.service";
import type { ObjectStore } from "../domains/storage/types";
import {
  buildDefaultStyleTemplate,
  createStyleVersion,
  listStyles,
  publishStyleVersion,
} from "../domains/styles/styles.service";
import type { StyleInput } from "../domains/styles/types";

const defaultPmtilesPath = resolve(
  __dirname,
  "../../src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles",
);
const defaultStyleFiles = [
  "assets/styles/seed/style.json",
  "assets/styles/seed/style-dark.json",
  "assets/styles/seed/style-black.json",
  "assets/styles/seed/style-grey.json",
  "assets/styles/seed/style-white.json",
];

const tileTemplate = "/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}";
const spriteTemplate = "/v1/styles/{styleId}/sprites/sprite";
const glyphTemplate = "/v1/fonts/{fontstack}/{range}.pbf";

interface ResolvedPmtilesSource {
  readonly artifactKey: string;
  readonly artifactLabel: string;
  readonly location: string;
  readonly localPath?: string;
}

type StyleSeedSource =
  | {
      readonly kind: "files";
      readonly values: ReadonlyArray<string>;
    }
  | {
      readonly kind: "objectKeys";
      readonly values: ReadonlyArray<string>;
    };

export interface DemoBootstrapState {
  readonly artifactId: string;
  readonly artifactKey: string;
  readonly artifactByteSize: number;
  readonly artifactAvailable: boolean;
  readonly styleIds: ReadonlyArray<string>;
  readonly accessToken: string;
  readonly adminToken: string;
  readonly pmtilesLocation: string;
  readonly pmtilesLocalPath?: string;
}

function isDevelopmentEnvironment(): boolean {
  return (process.env.NODE_ENV ?? "development").trim() === "development";
}

function ensureRuntimeEnvDefaults(): void {
  if (!process.env.NODE_ENV || process.env.NODE_ENV.trim().length === 0) {
    process.env.NODE_ENV = "development";
  }
  if (!isDevelopmentEnvironment()) {
    return;
  }
  if (!process.env.OBJECT_STORE_MODE || process.env.OBJECT_STORE_MODE.trim().length === 0) {
    process.env.OBJECT_STORE_MODE = "memory";
  }
  if (!process.env.OBJECT_STORE_BUCKET || process.env.OBJECT_STORE_BUCKET.trim().length === 0) {
    process.env.OBJECT_STORE_BUCKET = "tileserver-demo";
  }
  if (
    (!process.env.ADMIN_API_TOKEN || process.env.ADMIN_API_TOKEN.trim().length === 0) &&
    (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.trim().length === 0)
  ) {
    process.env.ADMIN_TOKEN = DEVELOPMENT_ONLY_SECURITY_DEFAULTS.adminToken;
  }
  if (!process.env.ALLOWED_TILES_TOKENS || process.env.ALLOWED_TILES_TOKENS.trim().length === 0) {
    process.env.ALLOWED_TILES_TOKENS = "demo-public-token";
  }
  if (!process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS.trim().length === 0) {
    process.env.ALLOWED_ORIGINS = "*";
  }
}

function normalizeDelimitedList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeStyleIdFromIdentifier(identifier: string): string {
  const source = basename(identifier).replace(/\.json$/i, "");
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "demo-style";
}

function normalizeArtifactLabel(value: string): string {
  const source = basename(value)
    .replace(/\.pmtiles$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return source.length > 0 ? source : "artifact";
}

function resolvePmtilesSource(): ResolvedPmtilesSource {
  const configuredObjectKey = process.env.DEMO_PMTILES_KEY?.trim();
  if (configuredObjectKey && configuredObjectKey.length > 0) {
    return {
      artifactKey: configuredObjectKey,
      artifactLabel: normalizeArtifactLabel(configuredObjectKey),
      location: configuredObjectKey,
    };
  }

  const configuredLocalPath = process.env.DEMO_PMTILES_PATH?.trim();
  if (configuredLocalPath && configuredLocalPath.length > 0) {
    const resolvedPath = resolve(configuredLocalPath);
    return {
      artifactKey: pathToFileURL(resolvedPath).toString(),
      artifactLabel: normalizeArtifactLabel(resolvedPath),
      location: resolvedPath,
      localPath: resolvedPath,
    };
  }

  if (!isDevelopmentEnvironment()) {
    throw new Error("DEMO_PMTILES_PATH or DEMO_PMTILES_KEY is required outside development");
  }
  return {
    artifactKey: pathToFileURL(defaultPmtilesPath).toString(),
    artifactLabel: normalizeArtifactLabel(defaultPmtilesPath),
    location: defaultPmtilesPath,
    localPath: defaultPmtilesPath,
  };
}

function resolveStyleSeedSource(): StyleSeedSource {
  const configuredObjectKeys = normalizeDelimitedList(process.env.STYLE_SEED_KEYS ?? process.env.DEMO_STYLE_SEED_KEYS);
  if (configuredObjectKeys.length > 0) {
    return {
      kind: "objectKeys",
      values: configuredObjectKeys,
    };
  }

  const configuredFiles = normalizeDelimitedList(process.env.DEMO_STYLE_FILES);
  if (configuredFiles.length > 0) {
    return {
      kind: "files",
      values: configuredFiles.map((entry) => resolve(entry)),
    };
  }

  if (!isDevelopmentEnvironment()) {
    throw new Error("STYLE_SEED_KEYS (or DEMO_STYLE_SEED_KEYS) is required outside development");
  }
  return {
    kind: "files",
    values: defaultStyleFiles.map((entry) => resolve(entry)),
  };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourceRecord(source: unknown): Record<string, unknown> {
  if (!isObjectRecord(source)) {
    return {
      type: "vector",
      tiles: [tileTemplate],
    };
  }
  const normalized: Record<string, unknown> = {
    ...source,
    tiles: [tileTemplate],
  };
  delete normalized.url;
  return normalized;
}

function normalizeExternalStyleDocument(input: unknown): StyleInput {
  if (!isObjectRecord(input)) {
    throw new Error("style document must be a JSON object");
  }
  const normalized: Record<string, unknown> = {
    ...input,
    version: typeof input.version === "number" ? input.version : 8,
    sprites: spriteTemplate,
    glyphs: glyphTemplate,
  };
  delete normalized.sprite;
  const sourceInput = input.sources;
  if (!isObjectRecord(sourceInput)) {
    normalized.sources = {
      map: {
        type: "vector",
        tiles: [tileTemplate],
      },
    };
    return normalized;
  }
  const sources: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(sourceInput)) {
    sources[name] = normalizeSourceRecord(source);
  }
  if (Object.keys(sources).length === 0) {
    sources.map = {
      type: "vector",
      tiles: [tileTemplate],
    };
  }
  normalized.sources = sources;
  return normalized;
}

async function registerParsedStyle(styleIdentifier: string, parsed: unknown): Promise<string | null> {
  const styleId = normalizeStyleIdFromIdentifier(styleIdentifier);
  try {
    const style = normalizeExternalStyleDocument(parsed);
    const version = await createStyleVersion(styleId, style);
    await publishStyleVersion(styleId, version.id);
    return styleId;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown style import error";
    console.warn(`Skipping style ${styleId}: ${reason}`);
    return null;
  }
}

async function importStyleFromFile(stylePath: string): Promise<string | null> {
  let parsed: unknown;
  try {
    const content = await readFile(stylePath, "utf8");
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    console.warn(`Skipping style file ${stylePath}: ${reason}`);
    return null;
  }
  return await registerParsedStyle(stylePath, parsed);
}

async function readObjectAsUtf8(store: ObjectStore, key: string): Promise<string> {
  const head = await store.head(key);
  if (head.size <= 0) {
    throw new Error("empty object");
  }
  const result = await store.getRange({
    key,
    start: 0,
    end: head.size - 1,
  });
  return new TextDecoder().decode(result.bytes);
}

async function importStyleFromObjectKey(store: ObjectStore, key: string): Promise<string | null> {
  try {
    const content = await readObjectAsUtf8(store, key);
    const parsed = JSON.parse(content) as unknown;
    return await registerParsedStyle(key, parsed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    console.warn(`Skipping style key ${key}: ${reason}`);
    return null;
  }
}

async function defaultStyleFallback(): Promise<string> {
  const styleId = "demo-default";
  const version = await createStyleVersion(styleId, buildDefaultStyleTemplate({ styleId }));
  await publishStyleVersion(styleId, version.id);
  return styleId;
}

async function registerArtifactForSource(
  source: ResolvedPmtilesSource,
  store: ObjectStore,
): Promise<{
  readonly id: string;
  readonly key: string;
  readonly size: number;
} | null> {
  if (source.localPath) {
    try {
      await access(source.localPath, fsConstants.R_OK);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unavailable";
      console.warn(`Demo PMTiles source unavailable at ${source.localPath}: ${reason}`);
      return null;
    }
  }
  let head;
  try {
    head = await store.head(source.artifactKey);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unavailable";
    console.warn(`Demo PMTiles object unavailable at ${source.location}: ${reason}`);
    return null;
  }
  if (head.size <= 0) {
    console.warn(`Demo PMTiles source is empty: ${source.location}`);
    return null;
  }
  const artifactId = `artifact-${source.artifactLabel}-${head.size}`;
  const checksum = createHash("sha256")
    .update(`${source.artifactKey}:${head.size}:${head.lastModified}:${head.etag}`)
    .digest("hex");

  const existing = (await listArtifacts()).find((entry) => entry.id === artifactId);
  if (!existing) {
    await registerArtifact({
      id: artifactId,
      key: source.artifactKey,
      checksum,
      byteSize: head.size,
      createdAt: new Date().toISOString(),
      validated: true,
    });
  }
  try {
    await promoteArtifact(artifactId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("already active")) {
      throw error;
    }
  }
  return {
    id: artifactId,
    key: source.artifactKey,
    size: head.size,
  };
}

function resolveAccessToken(tokens: readonly string[]): string {
  const token = tokens.find((entry) => entry.length > 0);
  if (token === undefined) {
    throw new Error("ALLOWED_TILES_TOKENS must include a token for the demo surface");
  }
  return token;
}

export async function bootstrapDemoData(): Promise<DemoBootstrapState> {
  ensureRuntimeEnvDefaults();
  const config = loadConfig();
  const store = createObjectStore(config);
  const pmtilesSource = resolvePmtilesSource();
  const artifact = await registerArtifactForSource(pmtilesSource, store);
  const styleSeedSource = resolveStyleSeedSource();

  const loaded: string[] = [];
  if (styleSeedSource.kind === "files") {
    for (const styleFile of styleSeedSource.values) {
      const imported = await importStyleFromFile(styleFile);
      if (imported !== null) {
        loaded.push(imported);
      }
    }
  } else {
    for (const styleKey of styleSeedSource.values) {
      const imported = await importStyleFromObjectKey(store, styleKey);
      if (imported !== null) {
        loaded.push(imported);
      }
    }
  }

  const styleIds = loaded.length > 0 ? loaded : [await defaultStyleFallback()];
  return {
    artifactId: artifact?.id ?? "artifact-unavailable",
    artifactKey: artifact?.key ?? pmtilesSource.artifactKey,
    artifactByteSize: artifact?.size ?? 0,
    artifactAvailable: artifact !== null,
    styleIds: styleIds.length > 0 ? styleIds : (await listStyles()).map((entry) => entry.id),
    accessToken: resolveAccessToken(config.security.allowedTokens),
    adminToken: config.security.adminToken,
    pmtilesLocation: pmtilesSource.location,
    pmtilesLocalPath: pmtilesSource.localPath,
  };
}
