import { language_script_pairs, layers, namedFlavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";
import { escapeHtml } from "./style.js";

/**
 * Ready-to-serve Protomaps basemap styles for an archive in the Protomaps
 * basemap schema. Pure and browser-safe: file I/O lives in styles-build.ts.
 */

/** Must equal the version pinned in the root package; a test checks it. */
export const BASEMAPS_VERSION = "5.7.2";
export const PROTOMAPS_FLAVORS = ["light", "dark", "white", "grayscale", "black"] as const;
export type ProtomapsFlavor = (typeof PROTOMAPS_FLAVORS)[number];
export const PROTOMAPS_SOURCE = "protomaps";
export const DEFAULT_ATTRIBUTION = "Protomaps © OpenStreetMap contributors";
export const DEFAULT_LANGUAGE = "en";
export const SUPPORTED_LANGUAGES: readonly string[] = language_script_pairs.map((pair) => pair.lang);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class StyleBuildError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StyleBuildError";
  }
}

/**
 * Absolute public URL: HTTPS, or HTTP only on a loopback host for local
 * verification. No credentials, fragment, or (unless allowed) query.
 */
export function parsePublicUrl(value: string, label: string, options: { allowQuery?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StyleBuildError(label + " must be an absolute URL, got: " + JSON.stringify(value));
  }
  const local = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new StyleBuildError(label + " must use https:// (http:// is accepted only for localhost), got: " + url.protocol);
  }
  if (url.username || url.password) throw new StyleBuildError(label + " cannot contain a username or password.");
  if (url.hash) throw new StyleBuildError(label + " cannot contain a #fragment.");
  if (url.search && options.allowQuery !== true) throw new StyleBuildError(label + " cannot contain a ?query.");
  return url;
}

export function parseArchiveUrl(value: string): string {
  const url = parsePublicUrl(value, "Archive URL", { allowQuery: true });
  if (!url.pathname.endsWith(".pmtiles")) {
    throw new StyleBuildError("Archive URL must point to a .pmtiles file, got: " + url.pathname);
  }
  return url.href;
}

/** Normalised without a trailing slash so template braces stay literal. */
export function parseAssetsBase(value: string): string {
  return parsePublicUrl(value, "Assets base URL").href.replace(/\/+$/u, "");
}

export function parseFlavors(value: string): ProtomapsFlavor[] {
  const names = value.split(",").map((name) => name.trim());
  if (names.length === 0 || names.some((name) => name.length === 0)) {
    throw new StyleBuildError("Flavors must be a comma-separated list such as light,dark. Known: " + PROTOMAPS_FLAVORS.join(", ") + ".");
  }
  const flavors = names.map((name) => {
    const flavor = PROTOMAPS_FLAVORS.find((known) => known === name);
    if (flavor === undefined) {
      throw new StyleBuildError("Unknown flavor " + JSON.stringify(name) + ". Known: " + PROTOMAPS_FLAVORS.join(", ") + ".");
    }
    return flavor;
  });
  if (new Set(flavors).size !== flavors.length) throw new StyleBuildError("Flavors cannot repeat.");
  return flavors;
}

export function parseLanguage(value: string): string {
  if (!SUPPORTED_LANGUAGES.includes(value)) {
    throw new StyleBuildError("Unsupported label language " + JSON.stringify(value) + ". Supported by @protomaps/basemaps "
      + BASEMAPS_VERSION + ": " + SUPPORTED_LANGUAGES.join(", ") + ".");
  }
  return value;
}

export function parseAttribution(value: string): string {
  const text = value.trim();
  // eslint-disable-next-line no-control-regex
  if (text.length === 0 || text.length > 500 || /[\u0000-\u001f\u007f]/u.test(text)) {
    throw new StyleBuildError("Attribution must be 1–500 characters of plain text without control characters.");
  }
  return text;
}

export interface BasemapStyleOptions {
  /** Absolute archive URL, already validated by parseArchiveUrl. */
  readonly archiveUrl: string;
  /** Base for fonts/ and sprites/v4/, already validated by parseAssetsBase. */
  readonly assetsBase: string;
  readonly flavor: ProtomapsFlavor;
  readonly lang: string;
  /** Plain text; HTML-escaped into the source attribution. */
  readonly attribution: string;
}

/** A complete MapLibre style. Deterministic: same options, same JSON. */
export function buildBasemapStyle(options: BasemapStyleOptions): StyleSpecification {
  return {
    version: 8,
    name: "Protomaps " + options.flavor + " (" + options.lang + ")",
    metadata: {
      "tstiles:generator": "@protomaps/basemaps@" + BASEMAPS_VERSION,
      "tstiles:flavor": options.flavor,
      "tstiles:lang": options.lang,
    },
    glyphs: options.assetsBase + "/fonts/{fontstack}/{range}.pbf",
    sprite: options.assetsBase + "/sprites/v4/" + options.flavor,
    sources: {
      [PROTOMAPS_SOURCE]: {
        type: "vector",
        url: "pmtiles://" + options.archiveUrl,
        attribution: escapeHtml(options.attribution),
      },
    },
    layers: layers(PROTOMAPS_SOURCE, namedFlavor(options.flavor), { lang: options.lang }),
  };
}

/** Source-layer IDs the generated styles read, across every flavor. */
export function requiredSourceLayers(): string[] {
  const ids = new Set<string>();
  for (const flavor of PROTOMAPS_FLAVORS) {
    for (const layer of layers(PROTOMAPS_SOURCE, namedFlavor(flavor), { lang: DEFAULT_LANGUAGE })) {
      if ("source-layer" in layer && typeof layer["source-layer"] === "string") ids.add(layer["source-layer"]);
    }
  }
  return [...ids].sort();
}

/**
 * Structural checks this generator guarantees. Not a substitute for the
 * MapLibre style-spec validator, which the test suite runs on every flavor.
 */
export function styleProblems(style: StyleSpecification): string[] {
  const problems: string[] = [];
  if (style.version !== 8) problems.push("version must be 8");
  const source = style.sources[PROTOMAPS_SOURCE];
  if (source?.type !== "vector" || typeof source.url !== "string" || !/^pmtiles:\/\/https?:\/\//u.test(source.url)) {
    problems.push("source " + PROTOMAPS_SOURCE + " must be a vector source with an absolute pmtiles:// URL");
  } else if (typeof source.attribution !== "string" || source.attribution.length === 0) {
    problems.push("source " + PROTOMAPS_SOURCE + " needs attribution");
  }
  if (style.layers.length === 0) problems.push("style has no layers");
  const ids = new Set<string>();
  for (const layer of style.layers) {
    if (ids.has(layer.id)) problems.push("duplicate layer id " + layer.id);
    ids.add(layer.id);
    if ("source" in layer && !(layer.source in style.sources)) problems.push("layer " + layer.id + " uses missing source " + layer.source);
    const layout: Record<string, unknown> = "layout" in layer && layer.layout ? layer.layout : {};
    if ("text-field" in layout && !style.glyphs) problems.push("layer " + layer.id + " has labels but the style has no glyphs URL");
    if ("icon-image" in layout && !style.sprite) problems.push("layer " + layer.id + " has icons but the style has no sprite URL");
  }
  if (!style.layers.some((layer) => layer.type !== "background")) problems.push("style has no drawing layers");
  return problems;
}
