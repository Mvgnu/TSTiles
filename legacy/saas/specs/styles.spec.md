---
name: styles
description: "Style JSON registry, validation, versioning, and sprite/glyph asset resolution"
paths:
  types: src/domains/styles/types.ts
  service: src/domains/styles/styles.service.ts
  components: src/domains/styles/
  tests: src/domains/styles/__tests__/
exports:
  - StyleId
  - StyleVersion
  - StyleDocument
  - StyleError
  - StyleErrorCode
  - StyleInput
  - StyleAssets
  - StyleTemplateConfig
  - StyleListItem
  - StyleValidation
  - StyleRecord
  - validateStyleDocument
  - listStyles
  - getStyle
  - buildDefaultStyleTemplate
  - createStyleVersion
  - publishStyleVersion
  - resolveStyleAssets
consumes:
  - config.RuntimeConfig
  - tile_resolver.resolveArchiveProfile
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/styles/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/styles/"
status: ready
---

# Styles Domain

Owns versioned style JSON documents and style-linked asset resolution.

## Component Insertion Points

- `src/domains/styles/styles.service.ts`
- `src/domains/styles/__tests__/styles-service.test.ts`

## Public API Contract

- `listStyles(): Array<{ id, name, latestVersionId, publishedVersionId? }>`
- `getStyle(id: string, versionId?: string): StyleDocument`
- `createStyleVersion(id: string, input): StyleVersion`
- `publishStyleVersion(id: string, versionId: string): StyleVersion`
- `resolveStyleAssets(styleId: string, versionId?: string): StyleAssets`
- `buildDefaultStyleTemplate(config): StyleDocument` (helper for bootstrap)

Style IDs are versioned and scoped by published document content; rendering and style endpoints consume stable style version references only.
Style seed inputs may come from object-store keys (production/staging) or local files during development bootstrap.

## Public Style Endpoints

- `GET /v1/styles` or `/styles`
- `GET /v1/styles/{styleId}/style.json`
- `GET /v1/styles/{styleId}/sprites/{name}(@2x)?.(png|json)`
- `GET /v1/fonts/{fontstack}/{range}.pbf`
- `OPTIONS` preflight for `style.json`, `sprites/*`, and `fonts` paths.

## Style Document Invariants

- Must not contain secrets or raw access tokens.
- Style listing surfaces are deterministic newest-first, with a stable secondary style identifier sort when multiple rows share the same creation timestamp.
- Style listing surfaces also fail closed on malformed persisted style rows, skipping invalid stored identifiers or version references instead of leaking malformed list items out of the domain.
- Direct style read surfaces also fail closed on malformed persisted style rows instead of trusting broken stored identifiers or version references around otherwise valid version documents.
- Exported style and version identifiers must reject path-like or traversal-style values, including embedded traversal markers, at the source boundary.
- Those exported style APIs must also fail closed on non-string runtime style/version identifiers instead of leaking raw string-operation failures from direct callers.
- The exported `buildDefaultStyleTemplate(...)` helper also fails closed on malformed non-object config input, invalid runtime `styleId`, or non-string template fields instead of leaking raw string-operation failures from direct callers.
- Persisted style-version documents are re-validated on read, so malformed stored JSON or invalid stored style shape fails with owned `STYLE_INVALID_DOCUMENT` errors instead of leaking raw JSON parse or document-shape failures through `getStyle(...)`, `publishStyleVersion(...)`, or `resolveStyleAssets(...)`.
- Stored and published style documents must include at least one source definition; empty `sources` objects are rejected at the source boundary instead of persisting unusable published styles.
- Stored and published style documents must also reject blank source names instead of silently accepting unnamed source entries.
- Must reference service endpoints through placeholders:
  - `https://<host>/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}`
- Stored style documents may keep service placeholder routes for glyphs and sprites, but the published browser-facing `style.json` must materialize browser-valid asset URLs instead of placeholder endpoints or bytes.
- Published browser-facing `style.json` must also materialize origin-qualified asset and tile URLs when the incoming request provides a host, so browser MapLibre workers can resolve sprite, glyph, and vector tile requests without page-specific URL rewriting.
- That public URL materialization must derive from the request origin, not a page path prefix, so absolute base URLs like `https://host/app` still emit `https://host/v1/...` asset and tile URLs.
- Relative path-bearing base URLs such as `/app/projects` must also fail closed to host-rooted public asset paths instead of prefixing `/app/...` into published tile, sprite, or glyph URLs.
- Malformed or non-web `baseUrl` values such as `javascript:` URLs or hostless relative strings must also fail closed to host-rooted public asset paths instead of being prefixed into published tile, sprite, or glyph URLs.
- Service-owned `sprites/*` and `fonts/*` endpoints must resolve to browser-valid local assets shipped with the repo, not placeholder bytes.
- Public style, sprite, and font route path segments must reject path separators and traversal markers, including exact `.`.
- Published browser-facing style JSON must materialize vector tile sources as `tiles: [...]`, not `url: ...`, so the emitted document is directly consumable by MapLibre clients.
- Published browser-facing vector sources should inherit `minzoom` and `maxzoom` from the active PMTiles archive when that header is available, so clients overzoom cleanly instead of requesting tiles beyond the archive ceiling.
- When the request does not provide a browser token, published `style.json` must remove the `access_token` placeholder without dropping unrelated query params on tile templates.
- Raw path query tokens remain authoritative when callers also pass a sparse `query` object, so `access_token` embedded in `path` is not erased by `query.access_token: undefined`.
- Token selection on the public style route also skips blank leading `access_token[]` entries, so a later valid browser token in the same normalized query payload still materializes into published `style.json`.
- The exported `handleStyleRequest(...)` route helper also fails closed on malformed runtime request objects or non-string `method` / `path` / `baseUrl` values and malformed query payloads, returning `STYLE_BAD_REQUEST` instead of leaking raw property-access failures from direct callers.

## Error Taxonomy

- `STYLE_NOT_FOUND`
- `STYLE_VERSION_NOT_FOUND`
- `STYLE_INVALID_DOCUMENT`
- `STYLE_PUBLISH_CONFLICT`

## Data Stores

- Prisma `Style` model holds the style record, the latest authored version pointer, and the published version pointer.
- Prisma `StyleVersion` model holds individual immutable version documents (stored as JSON strings) keyed by style.
- Style version creation and publish transitions run inside a single Prisma transaction so latest/published pointers cannot diverge from the underlying version row.

## SaaS Launch Baseline

- Style listings, lookups, version creation, and publish flows must be served by the `Style` and `StyleVersion` Prisma models so customer console, docs, render, and tile delivery all observe the same persisted style state.
- In-memory style state is forbidden as a source of truth; bootstrap helpers may seed Prisma rows but must not be queried directly by runtime style consumers.
- Published browser-facing style URLs are materialized at request time from the persisted document so multi-instance deployments emit consistent absolute URLs without snapshotting per-process.

## Dependency Direction

- May depend on `config` and `tile_resolver`.
- Must not depend on `tile_api`, `raster_api`, or `access`.
