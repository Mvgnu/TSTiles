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
/** Plain-text credit, as manifests carry it (frozen contract: plain text). */
export const DEFAULT_ATTRIBUTION = "Protomaps © OpenStreetMap contributors";

/** A piece of style attribution: escaped text, or an allowlisted https link. */
export type AttributionPart = string | { readonly text: string; readonly href: string };

/**
 * The served styles' credit. The itstiles.com link is the service's only
 * condition of use, so every generated style carries it.
 */
export const BACKLINK_ATTRIBUTION: readonly AttributionPart[] = [
  { text: "itstiles.com", href: "https://itstiles.com" },
  " · ",
  { text: "Protomaps", href: "https://protomaps.com" },
  " © ",
  { text: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
];

const ATTRIBUTION_HOSTS = new Set(["itstiles.com", "protomaps.com", "www.openstreetmap.org"]);

/**
 * Render attribution HTML. Text is always escaped; links are emitted only
 * for https URLs on an allowlisted host, so no input can inject markup.
 */
export function renderAttribution(parts: readonly AttributionPart[]): string {
  return parts.map((part) => {
    if (typeof part === "string") return escapeHtml(part);
    let url: URL;
    try {
      url = new URL(part.href);
    } catch {
      throw new StyleBuildError("Attribution link is not a URL: " + JSON.stringify(part.href));
    }
    if (url.protocol !== "https:" || !ATTRIBUTION_HOSTS.has(url.hostname) || url.username || url.password) {
      throw new StyleBuildError("Attribution links must be https URLs on " + [...ATTRIBUTION_HOSTS].join(", ") + ".");
    }
    return '<a href="' + escapeHtml(url.href.replace(/\/$/u, "")) + '" target="_blank" rel="noopener">' + escapeHtml(part.text) + "</a>";
  }).join("");
}

export const DEFAULT_ATTRIBUTION_HTML = renderAttribution(BACKLINK_ATTRIBUTION);
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
  /**
   * Optional extra plain-text credit, escaped and appended after the
   * itstiles.com / Protomaps / OpenStreetMap links (which are always present).
   */
  readonly extraAttribution?: string;
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
        attribution: renderAttribution(options.extraAttribution === undefined
          ? BACKLINK_ATTRIBUTION
          : [...BACKLINK_ATTRIBUTION, " · ", options.extraAttribution]),
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
  } else if (typeof source.attribution !== "string" || !source.attribution.startsWith(DEFAULT_ATTRIBUTION_HTML)) {
    problems.push("source " + PROTOMAPS_SOURCE + " attribution must start with the itstiles.com backlink");
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
