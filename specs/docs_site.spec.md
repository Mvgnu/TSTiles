---
name: docs_site
description: "Public docs + examples + API reference for tile/raster/style endpoints"
paths:
  types: src/domains/docs-site/types.ts
  service: src/domains/docs-site/docs-site.service.ts
  components: src/domains/docs-site/
  tests: src/domains/docs-site/__tests__/
exports:
  - getDocsIndex
  - getOpenApiJson
  - getExamples
consumes:
  - styles
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/docs-site/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/docs-site/"
status: ready
---

# Docs Site Domain

Owns public documentation pages, examples, and generated API reference payloads.

## Component Insertion Points

- `src/domains/docs-site/docs-site.service.ts`

## Public API Contract

- `getDocsIndex(): DocsIndex`
- `getOpenApiJson(): OpenApiDocument`
- `getExamples(): ExampleBundle`

## Endpoint Surface

- `GET /docs`
- `HEAD /docs`
- `OPTIONS /docs`
- `GET /docs/openapi.json`
- `HEAD /docs/openapi.json`
- `OPTIONS /docs/openapi.json`
- `GET /docs/examples`
- `HEAD /docs/examples`
- `OPTIONS /docs/examples`

## Docs MVP Scope

- Quickstart with MapLibre style URL example.
- Raster usage example for Leaflet-like clients using raster tile service.
- Static map URL examples and query parameter guide.
- Auth patterns (`Authorization` header and `access_token` query).
- Limits and 429 behavior.
- Public API reference excludes private control-plane endpoints.
- Example payload endpoint (`GET /docs/examples`) for client-ready snippets.

## Owned Invariants

- Examples are copy-paste safe and use placeholder tokens.
- Leaflet and raster/static example URLs are resolved against current published style IDs.
- API reference output stays compatible with exported contracts.
- Public docs never expose admin-only endpoints without auth notes.
- OpenAPI output reflects all public method variants supported by runtime handlers (`GET`, `HEAD`, `OPTIONS` where applicable).

## Dependency Direction

- May depend on `styles`.
- Must not depend on control-plane or metering internals.
