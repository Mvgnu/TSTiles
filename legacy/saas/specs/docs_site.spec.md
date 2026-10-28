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
  - getDocsGuidePage
  - getOpenApiJson
  - getExamples
consumes:
  - styles
  - design_system
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/docs-site/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/docs-site/"
status: ready
---

# Docs Site Domain

Owns public documentation pages, examples, and generated API reference payloads.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives. Docs shell uses persistent left `Sidebar` for guide navigation, container max 1200px, code blocks via design-system `CodeBlock`.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Docs is public and signed-out by default; session-aware CTAs swap `Create project` / `Get API key` / `Open dashboard` once `app_session` resolves. Operator routes `/admin/*` and `/ops/*` are never linked from docs.
- **Auth**: v1 is first-party email + password + email verification + magic link, owned by `auth_flows`. Docs unauthenticated CTAs link to `/sign-up?next=/app/projects/new` (preserving evaluator intent). The Authentication guide must clearly separate **product sign-in** (session, `app_session` cookie, owned by `auth_flows` / `identity`) from **project delivery token** (API key, `access_token` query param or `Authorization` header, owned by `projects` / `access`).
- **Email**: Brevo only via `email.sendTransactionalEmail`. The docs domain does not trigger email itself; no inquiry form or beta signup is part of the v1 docs surface.
- **SaaS fundamentals**: docs examples deterministically use the first lexicographically published style ID when multiple published styles exist. URLs in docs are origin-qualified (host-derived). Footer links to `/legal/*`, `/security`, `/status`, security-contact mailto.

## Component Insertion Points

- `src/domains/docs-site/docs-site.service.ts`

## Public API Contract

- `getDocsIndex(): DocsIndex`
- `getDocsGuidePage(slug?): DocsGuidePage`
- `getOpenApiJson(): OpenApiDocument`
- `getExamples(): ExampleBundle`

## Endpoint Surface

- `GET /docs`
- `GET /docs/quickstart`
- `GET /docs/authentication`
- `GET /docs/maplibre`
- `GET /docs/raster`
- `GET /docs/static-maps`
- `GET /docs/styles`
- `GET /docs/api`
- `GET /docs/examples`
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
- Browser requests to docs routes receive a human-facing HTML docs experience while machine consumers can still request JSON payloads.
- That browser-oriented HTML negotiation includes XHTML-style `Accept: application/xhtml+xml` requests in addition to `text/html`, so real browser document requests do not silently fall back to JSON.
- Auth patterns (`Authorization` header and `access_token` query).
- The authentication guide must clearly separate managed product sign-in from project delivery-token auth so workspace sessions are not confused with public API credentials.
- That quickstart path must also say explicitly that product sign-in is provider-managed and separate from the project token used for delivery requests, so evaluator flows do not confuse product auth state with API credentials at the shortest onboarding path.
- That guide must also describe the current product-side session bridge (`app_session` in development and trusted `x-auth-*` headers in production-style deployments) so the docs match the shipped auth boundary.
- Limits and 429 behavior.
- Public API reference excludes private control-plane endpoints.
- Example payload endpoint (`GET /docs/examples`) for client-ready snippets.

## Owned Invariants

- Examples are copy-paste safe and use placeholder tokens.
- Browser-focused examples explicitly recommend query-token auth for CORS preflight compatibility.
- The human-facing API guide must also call out browser query-token preference plus quota/rate-limit (`429`) behavior, not just the machine-readable docs index payload.
- Browser docs pages include direct product handoff actions (`Create project`, `Open dashboard`, `Get API key`) without importing customer-console internals.
- Guide payloads and exported `getDocsGuidePage(...)` results preserve CTA `action` metadata, so both HTML and JSON consumers can apply the same session-aware product handoff logic.
- Those browser docs handoff actions must attempt the current-session lookup even without an `app_session` cookie precheck, so managed-auth bridges that resolve session server-side still update the docs shell correctly.
- That session-aware docs handoff must also fail closed to the signed-out CTA targets when the session lookup itself errors, so public docs rendering does not depend on a successful background auth probe.
- Browser copy actions in the HTML docs shell must also fail closed to explicit inline UI state when clipboard APIs or legacy copy fallbacks fail, rather than throwing unhandled promise rejections through the public docs runtime.
- Signed-in docs handoff keeps both `Create project` and `Get API key` pointed at the project issuance flow (`/app/projects/new`) instead of a generic list page.
- Integration-focused guides such as MapLibre and Authentication expose `Get API key` handoffs at the guide CTA level, not only in the shared sidebar action panel.
- Unauthenticated page-level docs CTAs that start project issuance must point into signup with `next=/app/projects/new` so docs-first evaluator flows preserve intent instead of relying on a later auth redirect.
- The quickstart guide itself must end in the same project-issuance handoff, rather than a generic `Open app` CTA, so the shortest evaluator path remains docs -> signup -> create project.
- Guide-level CTA rows must use the same session-aware product handoff model as the sidebar action panel, so signed-in users do not keep stale signup links on quickstart or examples pages.
- Code blocks stay copy-first and may offer query-token versus header-token toggles where the example supports both modes.
- Header-token code variants must remove the query `access_token` placeholder without dropping unrelated query params or fragments, so query-bearing example URLs still render clean bearer-auth snippets.
- `/docs/examples` groups the main evaluator paths explicitly: MapLibre browser bootstrap, direct request debugging, and image-delivery examples, while repeating query-token guidance at the decision point.
- The HTML docs shell includes legal, `/legal/dpa`, `/security`, `/status`, and security-contact footer links so docs can stand alone as a public product surface.
- Leaflet and raster/static example URLs are resolved against current published style IDs.
- Docs examples must deterministically use the first lexicographically published style ID when multiple published styles exist, rather than relying on hidden hard-coded demo-style preferences.
- That default-style selection also skips malformed published-style dependency rows instead of trusting upstream style-list payload shape and emitting broken example URLs.
- When current published style IDs contain URL-unsafe characters such as spaces, docs examples and guide code blocks must path-encode those IDs so copy-paste URLs remain valid.
- If published-style lookup fails, docs examples and guide code blocks must fail closed to the built-in `basic` placeholder style instead of taking down the public docs surface.
- API reference output stays compatible with exported contracts.
- Public docs never expose admin-only endpoints without auth notes.
- OpenAPI output reflects all public method variants supported by runtime handlers (`GET`, `HEAD`, `OPTIONS` where applicable).
- The exported `getDocsGuidePage(...)` helper also fails closed on malformed runtime slugs with an explicit unknown-guide error instead of falling through into generic undefined-page lookup behavior for direct callers.
- The exported docs route helpers also fail closed on malformed runtime request objects or non-string `method` / `path` fields with `DOCS_BAD_REQUEST`, instead of leaking raw property-access failures from direct callers.
- Those exported docs route helpers also reject malformed non-string header values instead of silently dropping bad entries and continuing with partially-normalized request state.

## SaaS Launch Baseline

- Docs are stateless and rendered/served from in-process content plus the persistent style catalog (for live published-style URLs in examples).
- The HTML docs shell, OpenAPI payload, and examples bundle never expose admin-only endpoints, never embed live customer tokens, and never depend on per-instance ephemeral state.
- Session-aware product handoffs in the docs shell call into the customer-console session probe and must fail closed to the public signed-out CTA when that probe errors, so docs availability never regresses on a transient identity outage.

## Dependency Direction

- May depend on `styles`.
- Must not depend on control-plane or metering internals.
