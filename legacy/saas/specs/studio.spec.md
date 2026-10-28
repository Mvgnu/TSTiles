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

Owns admin-only style editing workflows and publish controls. Studio surfaces sit inside the operator HTML console at `/ops/styles/*` (see `admin_console.spec.md`) rather than exposing a standalone admin-only domain UI. The Studio service exports remain the API surface for those operator pages.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Reuse design-system primitives only. The Studio JSON editor sits inside the `admin_console` shell at `/ops/styles/*` and follows the same shell as the rest of the operator console.
- **Surfaces**: customer routes use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session`. Studio is exposed exclusively on the operator surface at `/ops/styles/*` — it is never reachable from `/app/*` or any customer route. Customer-facing style authoring remains out of scope until permissions and revision ownership are designed for customer usage.
- **Auth**: Studio mutations require an operator session OR `ADMIN_API_TOKEN`. When triggered via `ops_session` the resulting `AdminAuditEvent` row is attributable to a specific operator user; when triggered via `ADMIN_API_TOKEN` the actor is `machine:<hashed_token>`. MFA is mandatory for operators.
- **Email**: Studio itself triggers no transactional mail. If an operator publishes a style change that materially affects customer integrations (rare, scope-gated), the operator can issue a follow-up `abuse_warning`-style ad hoc notification via `admin_console`.
- **SaaS fundamentals**: Studio orchestrates `styles` and shares the control-plane audit boundary. Draft, version creation, and publish all run as Prisma transactions on `Style`/`StyleVersion` rows.

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
- Admin style and version identifiers must reject path separators and traversal markers, including embedded `..` markers, instead of relying on downstream style lookups to fail later.
- Those exported studio APIs must also fail closed on non-string runtime style/version identifiers with `STUDIO_BAD_REQUEST`, instead of leaking raw string-operation failures from direct callers.
- Studio admin-auth input must also fail closed on malformed runtime token values with `STUDIO_UNAUTHORIZED`, instead of leaking raw `.trim()` failures from shared admin-token normalization.

## Error Taxonomy

- `STUDIO_UNAUTHORIZED`
- `STUDIO_BAD_REQUEST`
- `STUDIO_NOT_FOUND`
- `STUDIO_CONFLICT`
- `STUDIO_DEPENDENCY_FAILED`

## SaaS Launch Baseline

- Studio is intentionally an internal/operator-only domain at launch. Customer-facing style authoring and version history are out of scope until permissions, revision ownership, and conflict rules are designed for customer usage.
- Studio orchestrates the `styles` domain and shares the control-plane admin auth boundary; it does not introduce its own persistent store. All draft and published state is read/written through Prisma-backed `Style`/`StyleVersion` rows.
- All studio mutations (draft save, publish) require the same `ADMIN_API_TOKEN`-backed auth used by `/admin/*` and produce audit records on the control-plane side.

## Dependency Direction

- May depend on `styles` and control-plane auth boundary.
- Must not depend on vector/raster delivery request paths.
