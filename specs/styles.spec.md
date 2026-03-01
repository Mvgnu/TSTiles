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
- Must reference service endpoints through placeholders:
  - `https://<host>/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}`
- Must pin glyph and sprite URLs to service-owned endpoints.

## Error Taxonomy

- `STYLE_NOT_FOUND`
- `STYLE_VERSION_NOT_FOUND`
- `STYLE_INVALID_DOCUMENT`
- `STYLE_PUBLISH_CONFLICT`

## Dependency Direction

- May depend on `config`.
- Must not depend on `tile_api`, `raster_api`, or `access`.
