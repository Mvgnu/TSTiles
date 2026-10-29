import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { StyleSpecification } from "maplibre-gl";
import type { MapManifest } from "../contract.js";
import {
  DEFAULT_ATTRIBUTION_HTML,
  DEFAULT_LANGUAGE,
  PROTOMAPS_FLAVORS,
  StyleBuildError,
  buildBasemapStyle,
  parseArchiveUrl,
  parseAssetsBase,
  parseAttribution,
  parseFlavors,
  parseLanguage,
  parsePublicUrl,
  requiredSourceLayers,
  styleProblems,
  type ProtomapsFlavor,
} from "./basemap.js";
import { MAX_MANIFEST_BYTES, ManifestError, parseManifest, readManifestResponse, resolveHttpUrl } from "./manifest.js";

export const STYLES_USAGE = `Usage: npm run styles:build -- <archive input> --assets-base <url> --out <dir> [options]

Archive input (exactly one):
  --manifest-url <url>          Fetch a published manifest and resolve its archive.
  --manifest <file> --manifest-public-url <url>
                                Read a local manifest; resolve its archive against
                                the URL it is (or will be) served at.
  --archive-url <url>           Absolute .pmtiles URL (no layer-schema check).

Required:
  --assets-base <url>           Serves fonts/{fontstack}/{range}.pbf and sprites/v4/<flavor>.
  --out <dir>                   Writes <flavor>.json atomically.

Options:
  --flavors <list>              Default: ${PROTOMAPS_FLAVORS.join(",")}
  --lang <code>                 Label language. Default: ${DEFAULT_LANGUAGE}
  --attribution <text>          Extra plain-text credit, appended to the fixed
                                credit (always present):
                                ${DEFAULT_ATTRIBUTION_HTML}

URLs must be https:// (http:// only for localhost).`;

export interface StylesBuildRequest {
  readonly input:
    | { readonly kind: "manifest-url"; readonly url: string }
    | { readonly kind: "manifest-file"; readonly path: string; readonly publicUrl: string }
    | { readonly kind: "archive-url"; readonly url: string };
  readonly assetsBase: string;
  readonly outDir: string;
  readonly flavors: readonly ProtomapsFlavor[];
  readonly lang: string;
  readonly extraAttribution?: string;
}

export interface StylesBuildResult {
  readonly archiveUrl: string;
  readonly manifestUrl?: string;
  readonly flavors: readonly ProtomapsFlavor[];
  readonly lang: string;
  readonly files: readonly string[];
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) throw new StyleBuildError("Missing --" + flag + ".\n\n" + STYLES_USAGE);
  return value;
}

export function parseStylesArgs(argv: readonly string[]): StylesBuildRequest {
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        "manifest-url": { type: "string" },
        manifest: { type: "string" },
        "manifest-public-url": { type: "string" },
        "archive-url": { type: "string" },
        "assets-base": { type: "string" },
        out: { type: "string" },
        flavors: { type: "string" },
        lang: { type: "string" },
        attribution: { type: "string" },
      },
    }));
  } catch (error) {
    throw new StyleBuildError((error instanceof Error ? error.message : String(error)) + "\n\n" + STYLES_USAGE);
  }
  const inputs = ["manifest-url", "manifest", "archive-url"].filter((flag) => values[flag] !== undefined);
  if (inputs.length !== 1) {
    throw new StyleBuildError("Give exactly one of --manifest-url, --manifest or --archive-url.\n\n" + STYLES_USAGE);
  }
  if (values.manifest === undefined && values["manifest-public-url"] !== undefined) {
    throw new StyleBuildError("--manifest-public-url is only used with --manifest.");
  }
  let input: StylesBuildRequest["input"];
  if (values["manifest-url"] !== undefined) {
    input = { kind: "manifest-url", url: parsePublicUrl(values["manifest-url"], "Manifest URL").href };
  } else if (values.manifest !== undefined) {
    input = {
      kind: "manifest-file",
      path: resolve(required(values.manifest, "manifest")),
      publicUrl: parsePublicUrl(required(values["manifest-public-url"], "manifest-public-url"), "Manifest public URL").href,
    };
  } else {
    input = { kind: "archive-url", url: parseArchiveUrl(required(values["archive-url"], "archive-url")) };
  }
  return {
    input,
    assetsBase: parseAssetsBase(required(values["assets-base"], "assets-base")),
    outDir: resolve(required(values.out, "out")),
    flavors: parseFlavors(values.flavors ?? PROTOMAPS_FLAVORS.join(",")),
    lang: parseLanguage(values.lang ?? DEFAULT_LANGUAGE),
    extraAttribution: values.attribution === undefined ? undefined : parseAttribution(values.attribution),
  };
}

function archiveFromManifest(manifest: MapManifest, manifestUrl: string): string {
  const present = new Set(manifest.vectorLayers.map((layer) => layer.id));
  const missing = requiredSourceLayers().filter((id) => !present.has(id));
  if (missing.length > 0) {
    throw new StyleBuildError("Manifest " + manifestUrl + " does not list the Protomaps basemap layers "
      + missing.join(", ") + ". These styles need an archive in the Protomaps basemap schema.");
  }
  try {
    return parseArchiveUrl(resolveHttpUrl(manifest.archive, manifestUrl));
  } catch (error) {
    if (error instanceof ManifestError) throw new StyleBuildError("Manifest archive URL: " + error.message);
    throw error;
  }
}

async function loadLocalManifest(path: string): Promise<MapManifest> {
  const info = await stat(path).catch(() => { throw new StyleBuildError("Cannot read manifest file " + path + "."); });
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) throw new StyleBuildError("Manifest " + path + " must be a file of at most 1 MiB.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new StyleBuildError("Manifest " + path + " is not valid JSON.");
  }
  return parseManifest(parsed);
}

export async function resolveArchiveInput(
  input: StylesBuildRequest["input"],
  fetcher: typeof fetch = fetch,
): Promise<{ archiveUrl: string; manifestUrl?: string }> {
  try {
    if (input.kind === "archive-url") return { archiveUrl: input.url };
    if (input.kind === "manifest-file") {
      const manifest = await loadLocalManifest(input.path);
      return { archiveUrl: archiveFromManifest(manifest, input.publicUrl), manifestUrl: input.publicUrl };
    }
    let response: Response;
    try {
      response = await fetcher(input.url, { cache: "no-cache", redirect: "follow" });
    } catch (error) {
      throw new StyleBuildError("Could not fetch " + input.url + ": " + (error instanceof Error ? error.message : String(error)));
    }
    const manifest = await readManifestResponse(response);
    const finalUrl = parsePublicUrl(response.url || input.url, "Manifest URL after redirects").href;
    return { archiveUrl: archiveFromManifest(manifest, finalUrl), manifestUrl: finalUrl };
  } catch (error) {
    if (error instanceof ManifestError) throw new StyleBuildError("Manifest rejected: " + error.message);
    throw error;
  }
}

/** Compact: ~65 KB instead of ~270 KB pretty-printed, for hosts without JSON compression. */
export function serializeStyle(style: StyleSpecification): string {
  return JSON.stringify(style) + "\n";
}

/**
 * Each file is replaced atomically (temp file in the same directory, fsync,
 * rename). All temp files are complete before the first rename, so a failed
 * build leaves no partial JSON and no temp files behind.
 */
export async function writeFilesAtomically(outDir: string, files: ReadonlyMap<string, string>): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const token = process.pid + "-" + crypto.randomUUID();
  const pending: Array<{ temp: string; target: string }> = [];
  try {
    for (const [name, contents] of files) {
      if (!/^[a-z0-9][a-z0-9_-]*\.json$/u.test(name)) throw new StyleBuildError("Refusing to write unexpected file name " + name);
      const target = join(outDir, name);
      const temp = join(outDir, "." + name + "." + token + ".tmp");
      pending.push({ temp, target });
      const handle = await open(temp, "wx", 0o644);
      try {
        await handle.writeFile(contents, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    for (const { temp, target } of pending) await rename(temp, target);
  } finally {
    await Promise.all(pending.map(({ temp }) => rm(temp, { force: true })));
  }
  return pending.map(({ target }) => target);
}

export async function buildStyles(request: StylesBuildRequest, fetcher: typeof fetch = fetch): Promise<StylesBuildResult> {
  const { archiveUrl, manifestUrl } = await resolveArchiveInput(request.input, fetcher);
  const files = new Map<string, string>();
  for (const flavor of request.flavors) {
    const style = buildBasemapStyle({
      archiveUrl, assetsBase: request.assetsBase, flavor, lang: request.lang, extraAttribution: request.extraAttribution,
    });
    const problems = styleProblems(style);
    if (problems.length > 0) throw new StyleBuildError("Generated " + flavor + " style is invalid: " + problems.join("; "));
    files.set(flavor + ".json", serializeStyle(style));
  }
  const written = await writeFilesAtomically(request.outDir, files);
  return { archiveUrl, manifestUrl, flavors: request.flavors, lang: request.lang, files: written };
}

export async function runStylesBuild(argv: readonly string[], fetcher: typeof fetch = fetch): Promise<StylesBuildResult> {
  return buildStyles(parseStylesArgs(argv), fetcher);
}
