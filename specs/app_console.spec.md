---
name: app_console
description: "Authenticated HTML app shell for overview, projects, styles, billing, and settings surfaces"
bar:
  reference: "Cloudflare dashboard"
  property: "System state, hierarchy, and risky actions are calm, explicit, and operationally trustworthy at desktop and mobile widths."
paths:
  types: src/domains/app-console/types.ts
  service: src/domains/app-console/app-console.service.ts
  components: src/domains/app-console/
  tests: src/domains/app-console/__tests__/
exports:
  - AppConsolePageSlug
  - AppConsoleBannerTone
  - AppConsoleNavigationItem
  - AppConsoleBanner
  - AppConsoleBillingStateSummary
  - AppConsoleBillingAction
  - AppConsoleBillingMirrorState
  - AppConsoleStat
  - AppConsoleOnboardingStep
  - AppConsoleSnippet
  - AppConsoleShell
  - AppConsoleSettingsMembersPage
  - AppConsoleSettingsSecurityPage
  - AppConsoleSettingsSecurityMfaPage
  - AppConsoleSettingsSecurityPasswordPage
  - AppConsoleSettingsAccountPage
  - AppConsoleSettingsAccountExportPage
  - AppConsoleSettingsAccountDeletePage
  - AppConsoleNotificationsPage
  - AppConsolePage
  - buildRenderedSnippets
  - getAppOverviewPage
  - getAppProjectsPage
  - getAppProjectNewPage
  - getAppProjectDetailPage
  - getAppProjectUsagePage
  - getAppStylesPage
  - getAppStyleDetailPage
  - getAppBillingPage
  - getAppBillingPageWithIntent
  - getAppSettingsPage
  - getAppSettingsMembersPage
  - getAppSettingsSecurityPage
  - getAppSettingsSecurityMfaPage
  - getAppSettingsSecurityPasswordPage
  - getAppSettingsAccountPage
  - getAppSettingsAccountExportPage
  - getAppSettingsAccountDeletePage
  - getAppNotificationsPage
  - getAppConsolePage
  - renderAppConsoleHtml
  - appConsoleRoute
consumes:
  - identity.requireSession
  - customer_console.getConsoleBootstrap
  - customer_console.getConsoleProject
  - customer_console.getConsoleProjectUsage
  - customer_console.getConsoleSettings
  - customer_console.getConsoleStyle
  - metering.getBillingPlan
  - design_system
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/app-console/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/app-console/"
status: in-review
---

# App Console Domain

Owns the authenticated HTML-first customer product surface that sits on top of `identity`, `customer_console`, and `billing_sync`. This is the thin presentation layer for the existing browser-safe APIs and should not introduce a second business-logic stack.

## Cross-Cutting Mandates (Subagent-Blind Reference)

Canonical source: `specs/_cross_cutting.spec.md`. Subagents working only on this spec MUST treat the following as binding without reading other specs.

- **Design**: light-default minimalist (Linear/Stripe vibe). Light tokens — `bg #FFFFFF`, `surface #FAFAFA`, `border #E5E5E5`, `ink #111111`, `muted #6B7280`, `accent #4F46E5`, `success #16A34A`, `warn #D97706`, `danger #DC2626`. Dark parity uses the matching tokens. Inter sans + JetBrains Mono. Type scale 12/14/16/18/24/32/48. Spacing 4/8/12/16/24/32/48/64. Radii 4/8/12. One shadow token. Motion 120/200ms with `prefers-reduced-motion` honored. WCAG AA contrast, 2px focus ring, keyboard reachable. Voice: precise, calm, no emoji, no exclamation. Reuse only design-system primitives. The app shell uses persistent left `Sidebar` (220px on `lg+`, collapses on smaller) + 56px top bar.
- **Surfaces**: customer routes `/`, `/app`, `/app-api`, `/billing`, `/docs`, `/legal`, `/security`, `/status`, `/v1/*` use `app_session`. Operator routes `/admin/*` and `/ops/*` use `ops_session`. Roles: `customer_member`, `customer_owner`, `operator` — one session is exactly one role. App console requires `requireCustomerSession`; presents an "Operator console" link in the top bar only when the user also holds the `operator` role (linking to `/ops`).
- **Auth**: v1 is first-party email + password + email verification + magic link, owned by `auth_flows`. The app shell sign-out POSTs to `/sign-out` (auth_flows) and clears the `app_session` cookie. Demo sign-out is removed from the production app shell. MFA setup, password change, and email change live at `/app/settings/security/*` and post into endpoints exposed by `auth_flows`.
- **Email**: Brevo only via `email.sendTransactionalEmail`. The app shell triggers (via customer_console) `key_rotated_receipt` after key rotation, `workspace_invitation` after invite, `data_export_ready` after export, `account_deletion_initiated` after delete request. Send failures never block; the success card surfaces "delivery pending" inline.
- **SaaS fundamentals**: app shell exposes Overview, Projects, Styles, Billing, Settings (with sub-pages: Workspace, Members, Security, Account, Notifications). New routes required: `/app/settings/members`, `/app/settings/security`, `/app/settings/security/mfa`, `/app/settings/security/password`, `/app/settings/account`, `/app/settings/account/export`, `/app/settings/account/delete`, `/app/notifications`. Members surface lists current memberships, invite form (owners only), and remove action (owners only, with confirm). Security surface offers password change, MFA enrollment with TOTP, recovery codes, and active-sessions list with revoke. Account surface offers email change (re-verification required), export (async job → email), delete (confirm by typing email, initiates 30-day grace). Notifications surface lists the last 90 days of workspace events with primary action links.

## Public API Contract

- `buildRenderedSnippets(input): AppConsoleSnippet[]`
- `getAppOverviewPage(session): AppConsoleOverviewPage`
- `getAppProjectsPage(session): AppConsoleProjectsPage`
- `getAppProjectNewPage(session): AppConsoleProjectNewPage`
- `getAppProjectDetailPage(session, input): AppConsoleProjectDetailPage`
- `getAppProjectUsagePage(session, input): AppConsoleProjectUsagePage`
- `getAppStylesPage(session): AppConsoleStylesPage`
- `getAppStyleDetailPage(session, input): AppConsoleStyleDetailPage`
- `getAppBillingPage(session): AppConsoleBillingPage`
- `getAppSettingsPage(session): AppConsoleSettingsPage`
- `getAppConsolePage(session, input): AppConsolePage`
- `renderAppConsoleHtml(page): string`
- `appConsoleRoute(input): AppConsoleRouteResponse`

## Endpoint Surface

- `GET /app`
- `GET /app/projects`
- `GET /app/projects/new`
- `GET /app/projects/:projectId`
- `GET /app/projects/:projectId/usage?window=day|month`
- `GET /app/styles`
- `GET /app/styles/:styleId`
- `GET /app/billing`
- `GET /app/settings`
- `HEAD` and `OPTIONS` variants for each route

## Owned Invariants

- App pages are session-gated and redirect unauthenticated users to `/sign-in` instead of leaking backend errors directly to the browser.
- App pages must also honor the production managed-auth bridge exposed by `identity` when trusted provider headers are enabled, so authenticated reverse-proxied requests render the shell without a local demo cookie flow.
- Malformed trusted managed-auth headers must fail closed as a bad-request app page instead of surfacing as a generic app-unavailable error, so production provider integration mistakes stay attributable at the auth boundary.
- The domain stays HTML-first and uses small inline client interactions for copy actions, project creation, settings saves, key rotation, and Stripe-hosted redirects.
- Project creation and key rotation success states keep the onboarding path visible by pairing one-time token reveal with an explicit quickstart link and an unmistakable "will not be shown again" warning.
- Those one-time token success cards stay visible until the user dismisses them, so copied token/snippet workflows do not race against an auto-clearing success state.
- The overview collapses into a typed setup-flow state when the workspace has no projects, using an explicit checklist and progress treatment instead of presenting an empty dashboard first.
- The overview consumes the customer-console first-integration bootstrap state directly, including the `needs_style` branch when a workspace has projects but no published style-backed snippets yet.
- The overview keeps a persistent first-integration status card above its snippet section so bootstrap readiness, quickstart handoff, and project/style next steps stay visible even after the initial zero-project setup state is gone.
- User-facing overview readiness and setup-step chips are rendered as human labels rather than raw internal enum strings.
- Project detail keeps a visible day/month usage snapshot next to settings and key management so quota/debug context does not require a page hop.
- Project usage route query parsing accepts trimmed case-insensitive `day` or `month` values and rejects unsupported `window` values instead of silently defaulting to a different usage view.
- Decoded project and style path segments on `/app/*` must reject slash, backslash, exact dot segments, and embedded traversal markers like `foo..bar` at the HTTP boundary instead of deferring those shapes deeper into dependent domains.
- Styles list cards expose a preview surface derived from the published static-map URL, plus related style, raster, and static URLs directly so integration decisions do not require opening style detail first.
- If the customer-safe shell does not have a real project token available, that preview surface must fail closed to an explicit token-required placeholder instead of embedding a demo token or shared secret in authenticated HTML.
- Style detail keeps that same preview treatment and the style, raster, and static URLs copyable so the focused style page remains integration-complete without leaking live token material.
- The app shell signs out through a `POST /sign-out` form owned by `auth_flows`; it does not use the development-only demo sign-out bridge.
- The shared app sidebar exposes docs, pricing, security, `/status`, terms, privacy, DPA, and acceptable-use links so authenticated users never need to leave the shell blindly when checking trust, legal, or operational state.
- All billing actions stay Stripe-managed. The app only posts to hosted Checkout or Customer Portal session creators and reflects mirrored webhook state.
- `/app/billing` chooses its primary CTA from mirrored Stripe state: `Upgrade with Stripe` for free or canceled workspaces, `Open billing portal` for payment recovery, `Resume in Stripe` for cancel-at-period-end workspaces, and `Manage in Stripe` for routine active subscriptions.
- `/app/billing` keeps mirrored Stripe freshness and references visible by showing last webhook sync time plus Stripe customer/subscription references or their pending states alongside the billing CTA.
- Customer-visible billing status text is humanized for the HTML shell instead of exposing raw underscore-shaped internal enum values.
- Billing can accept an upgrade intent from pricing/signup flows and continue directly into hosted Checkout without rebuilding billing UI in-app, but only for supported billable plan IDs already exposed by the public pricing surface.
- That supported-plan gating applies at the exported app-console service boundary too, so direct `getAppBillingPageWithIntent(...)` consumers cannot route unsupported, unnormalized, or non-string plan IDs into hosted Checkout state.
- Exported billing-page intent helpers also fail closed on malformed non-object runtime input or invalid `checkoutStatus` values instead of leaking raw property-access failures from direct callers.
- `/app/billing` route parsing also fails closed on malformed or incomplete `intent`, `plan`, or `checkout` query values instead of silently dropping them and rendering a default billing page.
- Key rotation requires an explicit in-app confirmation dialog before the rotate request is sent.
- Snippets remain copy-first and expose query-token plus header-token variants where useful.
- The exported `buildRenderedSnippets(...)` helper also fails closed on malformed non-object input, blank snippet prefixes, or non-string snippet URL fields instead of leaking raw string-operation failures from direct callers.
- Header-token snippet variants must strip the query `access_token` placeholder without dropping unrelated query params, so future query-bearing style or image URLs still materialize clean bearer-auth examples.
- The browser-side project create/rotate snippet runtime must preserve that same query-param stripping behavior, so live issued-token cards do not regress from the exported snippet contract.
- The browser-side app runtime must fail closed to the existing inline error/status surfaces when project mutation or hosted billing fetches error, rather than throwing out of the authenticated shell.
- Browser-side copy actions for snippets, one-time tokens, and copyable integration URLs must also fail closed to explicit inline button state when clipboard APIs or legacy copy fallbacks fail, rather than throwing through the authenticated shell.
- The desktop shell uses a 220px persistent workspace rail. At 64rem and below, that rail is replaced by a collapsed native disclosure in a 56px header, so page content appears immediately and navigation remains usable without JavaScript.
- Every rendered app page exposes a first-focus skip link and `<main id="main-content">`; nested grids, long URLs, code, and action rows must not make the document wider than the viewport at 1280px or 390px.
- Customer-visible state uses literal map-infrastructure language. It must not use internal or theatrical terms such as tenant initialization, uplink, perimeter, compute cycles, payload execution, or telemetry stream.
- Style previews distinguish a published style from an image that has actually loaded. A missing project token or failed preview request is shown as unavailable and never presented as live output.
- Risky actions state when access changes and whether the action can be reversed. Billing handoffs name Stripe Checkout or the Stripe Customer Portal and the affected plan before navigation.
- Loading the MFA enrollment page does not create or rotate a secret. Secret creation begins only after the user selects **Start MFA setup**, and recovery codes remain hidden until that request succeeds.
- Empty states always end with a next action, especially for first-project onboarding.
- The exported `getAppConsolePage(...)` helper also fails closed on malformed runtime page input, including non-object direct callers and invalid slugs, with an explicit not-found error instead of returning `undefined` or leaking raw property-access failures outside the route layer.
- The exported app-console page builders also fail closed on malformed runtime session payloads, including path-like nested identifiers or mismatched membership/user/workspace references, instead of trusting `IdentitySession` shape and leaking raw property-access failures from direct callers.
- The exported `appConsoleRoute(...)` helper also fails closed on malformed runtime request objects or non-string `method` / `path` / header values with a bad-request app error page, instead of leaking raw property-access failures from direct callers.

## SaaS Launch Baseline

- The app console is stateless and HTML-first. All workspace, project, key, usage, style, and billing state comes from the persistent-backed customer-console orchestrator; the app shell does not introduce a second business-logic stack or per-instance store.
- Production deployments require the managed-auth bridge enabled in `identity`; the app shell rejects local demo sign-out actions in production so authenticated browsers cannot bypass the production provider via the development cookie path.
- Hosted Stripe Checkout and Customer Portal handoffs are the only billing actions surfaced; the app reflects mirrored webhook state from `billing_sync`'s persistent snapshot and never recomputes billing locally.
- One-time token success cards (project create, key rotate) keep the issued token visible until explicit dismissal, paired with the "will not be shown again" warning, so the customer's only opportunity to capture issued credentials is preserved across slow copy interactions.

## Explicit Current Limitation

- The security page can list active sessions, but the current customer-console contract does not expose per-session revocation. The HTML surface says this plainly and directs the user to sign out or change their password; it must not render a revoke control that cannot work. Closing this gap requires a separately owned `identity` / `customer_console` contract change.

## Dependency Direction

- May depend on `identity`, `customer_console`, and `metering`.
- Must not depend on `control_plane` or operator-only auth paths.
