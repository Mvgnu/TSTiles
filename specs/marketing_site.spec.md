---
name: marketing_site
description: "Public marketing, pricing, legal, and auth entry pages for the customer-facing SaaS shell"
bar:
  reference: "MapTiler Cloud public site"
  property: "A developer can understand the map-infrastructure offer, see honest evidence of what is live, and choose the next integration step from the first viewport."
paths:
  types: src/domains/marketing-site/types.ts
  service: src/domains/marketing-site/marketing-site.service.ts
  components: src/domains/marketing-site/
  tests: src/domains/marketing-site/__tests__/
exports:
  - MarketingPageSlug
  - MarketingPlanCard
  - MarketingCodeSnippet
  - MarketingSection
  - MarketingPage
  - getMarketingPage
  - marketingSiteRoute
consumes:
  - docs_site.getExamples
  - metering.listBillingPlans
  - design_system
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/marketing-site/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/marketing-site/"
status: in-review
---

# Marketing Site Domain

Owns the public product shell needed before a dedicated frontend workspace exists.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives. Replace any prior brutalist / cyberpunk / glassmorphism / neon directives — those are obsolete.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session` (or `ADMIN_API_TOKEN` for automation on `/admin/*` only). Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. The marketing shell is the public anonymous surface; sign-in/sign-up redirect into `auth_flows`.
- **Auth**: v1 is first-party email + password + email verification + magic link, owned by `auth_flows`. Managed-auth header bridge stays available for enterprise SSO. `/sign-in` and `/sign-up` always link into the `auth_flows` surface; the marketing domain never embeds password forms itself. Demo bridge gated to `NODE_ENV=development`.
- **Email**: Brevo only via `email.sendTransactionalEmail`. The marketing domain does not trigger email itself (no contact form sends here in v1); the public `Security contact` link routes to `mailto:` with the configured `SECURITY_CONTACT_EMAIL` until a contact form ships.
- **SaaS fundamentals**: pricing CTA preserves `plan` intent through auth (allowlisted to known plans), legal pages are static and versioned, status page resolves `/v1/health` client-side. The marketing shell never embeds production tokens; the landing preview uses `LANDING_PREVIEW_TOKEN` (browser-safe public token) or fails closed with explicit messaging.

## Public API Contract

- `getMarketingPage(slug: MarketingPageSlug): Promise<MarketingPage>`
- `marketingSiteRoute(input): MarketingRouteResponse`

## Endpoint Surface

- `GET /`
- `GET /pricing`
- `GET /legal/terms`
- `GET /legal/privacy`
- `GET /legal/dpa`
- `GET /legal/acceptable-use`
- `GET /security`
- `GET /status`
- `GET /sign-in`
- `GET /sign-up`
- `HEAD` and `OPTIONS` variants for each route

## Owned Invariants

- Landing and pricing copy pull live plan data from the metering domain instead of hardcoding product allowances.
- The landing page exposes a real docs-preview link cluster for quickstart, authentication, raster, static maps, and styles instead of only mentioning docs generically.
- The landing hero keeps a real live browser map preview that exercises the public style and tile delivery path with a browser-safe token, not a `/demo/data.pmtiles` shortcut, plus an explicit capability strip for vector tiles, published styles, raster/static delivery, project keys, and usage visibility.
- The landing preview must use a plain published `style.json` URL in MapLibre and rely on the real `/v1/styles` -> `/v1/tiles` path, without homepage-specific style rewriting or `/demo/data.pmtiles` shortcuts.
- That landing preview URL must be derived from the same current published style URL surfaced in the landing integration snippet/docs path, rather than a separate hard-coded homepage style ID.
- The landing preview token must come from the configured browser-safe public token source for the environment instead of a homepage-specific hardcoded demo token literal.
- That landing preview token must also be URL-encoded and injected into the browser runtime as a real JS string literal, so valid reserved characters in configured tokens do not mutate the preview request path or query shape.
- If no browser-safe public token is configured, the landing preview must fail closed with explicit public-shell messaging instead of silently embedding a fallback demo token.
- The landing preview also depends on the same local sprite and glyph assets published by the styles domain, so the browser-visible request waterfall remains entirely on the product host.
- The pricing page renders a real FAQ-style section covering plan changes, billing portal management, and usage visibility instead of collapsing those topics into a single paragraph.
- Auth entry pages must not expose a local sign-in or sign-out bypass in the public shell.
- Auth entry pages must reflect whether the production managed-auth bridge is enabled instead of always claiming auth is unconfigured once a supported provider handoff path exists.
- Auth entry pages must also say explicitly that product sign-in is provider-managed and separate from project-token issuance, so public conversion flows do not confuse workspace auth state with delivery credentials.
- Auth entry pages surface the post-auth continuation intent in-page for pricing, docs, and direct app flows instead of hiding that handoff entirely in redirect script logic.
- Auth entry pages also preserve `plan` and `next` intent when users switch between sign-in and sign-up, so pricing and docs-originated flows do not silently reset mid-conversion.
- Auth entry pages only preserve supported pricing intent (`plan=pro`) and safe in-product `/app` continuations when carrying `plan` and `next` through auth-switch links or the future managed-auth handoff.
- Pricing CTAs may resolve session and billing state in the browser through existing customer-safe endpoints, but the domain must not import billing or console services directly.
- Public navigation may resolve current session state in the browser to swap sign-in/up affordances for dashboard and billing actions.
- Public navigation must attempt that current-session lookup even without an `app_session` cookie check, so managed-auth provider bridges that resolve session server-side are still reflected in the shell.
- Those browser-side session, billing, and hosted-session probes must fail closed to the public signed-out/default CTA state when fetches error, so the marketing shell does not depend on successful background auth or billing requests.
- Browser-side hosted Stripe handoffs must also fail closed if navigation itself throws, so pricing CTA runtime does not escape the public-shell fallback path after a successful session-creation response.
- Legal pages are static, versioned by last-updated date, and linked from public conversion flows.
- The acceptable-use surface spells out separate abuse categories for scraping, illegal content, credential misuse, and service abuse instead of collapsing them into one generic warning block.
- Privacy copy must describe the currently shipped authenticated session bridge, including the development `app_session` cookie and the production managed-auth header path, instead of implying cookie-only auth forever.
- Auth entry pages include direct Terms, Privacy, DPA, and Acceptable Use links so signup intent always carries the public legal context already exposed elsewhere in the shell.
- The shared public footer includes both service status and a security contact link.
- The shared public footer must only link to public routes actually surfaced by this domain and must not advertise removed demo-only paths.
- The public shell exposes `/legal/dpa` as the minimum buyer-facing processor/legal handoff so paid-evaluation flows do not dead-end on privacy-only copy.
- The public shell also exposes a `/security` page that explains reporting scope and the Stripe-managed billing boundary in product terms.
- The public shell also exposes a `/status` page so operational navigation does not drop users directly onto raw health JSON.
- The `/status` page may resolve `/v1/health` client-side to show a live human-readable check while still keeping raw health JSON as the automation surface.
- Public product routes are HTML-first and should not depend on operator-only domains.
- The exported `getMarketingPage(...)` helper also fails closed on malformed runtime slugs with an explicit not-found error instead of cloning an undefined page record for direct callers.
- The exported `marketingSiteRoute(...)` helper also fails closed on malformed runtime request objects or non-string `method` / `path` fields with `MARKETING_BAD_REQUEST`, instead of leaking raw property-access failures from direct callers.

## SaaS Launch Baseline

- The marketing site is server-rendered and stateless. It pulls live billing-plan data from the `metering` domain (which is Prisma-backed) and live published-style references from the `styles` domain when needed for previews/snippets.
- The public shell never embeds production tokens, never exposes admin-only routes, and never depends on per-instance ephemeral state.
- The landing-preview browser-safe public token must come from the configured `LANDING_PREVIEW_TOKEN` (or equivalent runtime config) and must URL-encode safely into the embedded JS literal. If no public token is configured, the preview fails closed with explicit messaging instead of embedding a fallback demo token.
- Auth entry pages reflect whether the production managed-auth bridge is enabled at runtime so the public conversion surface stops advertising auth as "unconfigured" once a real provider handoff is wired.
- Trust pages (`/legal/*`, `/security`, `/status`) are part of the launch surface, are static and versioned, and link from every conversion flow so paid evaluation has the legal/processor/incident posture available without a sales conversation.

## Dependency Direction

- May depend on `docs_site` and `metering`.
- Must not depend on `control_plane`, `billing_sync`, or `customer_console`.
