---
name: studio
description: "Admin-only style editor + style JSON validation and publish controls"
paths:
  types: src/domains/studio/types.ts
  service: src/domains/studio/studio.service.ts
  components: src/domains/studio/
  tests: src/domains/studio/__tests__/
exports:
  - listStylesAdmin
  - updateStyleDraft
  - publishStyle
  - getStyleDraft
  - StudioError
  - StudioErrorCode
  - StyleAdminDraft
  - StudioStyleListItem
consumes:
  - styles.createStyleVersion
  - styles.listStyles
  - styles.getStyle
  - styles.publishStyleVersion
  - control_plane.auth
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/studio/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/studio/"
status: ready
---

# Studio Domain

Owns admin-only style editing workflows and publish controls.

## Component Insertion Points

- `src/domains/studio/studio.service.ts`

## Public API Contract

- `listStylesAdmin(): StudioStyleListItem[]`
- `getStyleDraft(styleId: string): StyleAdminDraft`
- `updateStyleDraft(styleId: string, draft): StyleAdminDraft`
- `publishStyle(styleId: string, versionId: string): StyleAdminDraft`

`StyleAdminDraft` includes:
- `previewUrl`: absolute or relative URL for a style JSON URL usable by MapLibre.

## UI MVP

- JSON editor with validate action.
- Publish action for selected draft version.
- Preview link for MapLibre demo wired to style URL.

## Owned Invariants

- Admin auth is mandatory for all state-changing operations.
- Validation runs before draft save and publish.
- Published version changes are auditable.

## Error Taxonomy

- `STUDIO_UNAUTHORIZED`
- `STUDIO_BAD_REQUEST`
- `STUDIO_NOT_FOUND`
- `STUDIO_CONFLICT`
- `STUDIO_DEPENDENCY_FAILED`

## Dependency Direction

- May depend on `styles` and control-plane auth boundary.
- Must not depend on vector/raster delivery request paths.
