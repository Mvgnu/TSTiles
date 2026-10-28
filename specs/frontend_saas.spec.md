---
name: frontend_saas
description: "Customer-facing mini SaaS product spec for marketing, docs, app console, identity, and Stripe-managed billing"
paths:
  app: frontend/app/
  lib: frontend/lib/domains/
  components: frontend/components/
  tests: frontend/tests/
exports:
  - route map
  - surface specifications
  - user flows
  - product domain boundaries
  - Stripe billing boundary
consumes:
  - docs_site.getDocsIndex
  - docs_site.getOpenApiJson
  - docs_site.getExamples
  - projects.listProjects
  - projects.createProject
  - projects.rotateApiKey
  - metering.getUsageSummary
  - styles.listStyles
  - styles.getStyle
  - control_plane.createProjectEndpoint (transitional only; never browser-direct)
  - control_plane.rotateApiKeyEndpoint (transitional only; never browser-direct)
  - studio.getStyleDraft (internal/admin only; not customer-facing in v1)
  - identity
  - billing_sync
  - customer_console
verification:
  product_review: "Spec review against existing backend domains and Stripe-managed billing constraint"
  implementation_readiness: "Approve route map, roles, and phase split before scaffolding frontend app"
status: ready
---

# Frontend SaaS Product Spec

## Purpose

Define the smallest credible customer-facing product that turns the current backend into a lightweight tile-hosting SaaS without inventing a second platform. The backend already covers delivery, styles, raster/static rendering, project-scoped API keys, quota metering, operator control plane, and public docs payloads. The missing layer is customer presentation, customer-safe orchestration, identity, and Stripe-backed billing state.

This spec keeps the product intentionally narrow:

- One public marketing site.
- One customer console.
- One docs experience.
- Managed auth instead of custom auth.
- Stripe Checkout and Stripe Customer Portal instead of custom billing UIs.
- Existing operator-only domains remain operator-only.

## Current Baseline

The current repo already provides:

- Public API delivery for vector tiles, styles, fonts, raster tiles, static maps, and health.
- Public docs payloads at `/docs`, `/docs/openapi.json`, and `/docs/examples`.
- Project creation, API key rotation, and usage summaries via admin control-plane routes.
- Metering with explicit `free` and `pro` plan IDs plus monthly billing estimate helpers.
- Published style registry plus an admin-only style studio flow.
- A local `/demo` surface proving MapLibre and PMTiles integration end to end.

The current repo does not yet provide:

- End-user identity, sessions, or workspace membership.
- A customer-safe dashboard/API surface separate from `/admin/*`.
- Stripe checkout session creation, billing portal linking, or webhook-driven plan sync.
- Public marketing, pricing, or legal pages for a commercial product.
- A customer-friendly docs UI; current docs are payload-first and API-reference-first.

## Product Goals

- Let a new user sign up, create a workspace, create a project, get a token, and load a map with minimal friction.
- Make the first successful integration the center of the product, not account administration.
- Let users see current plan, current usage, and upgrade state without building custom billing logic.
- Keep all billing truth in Stripe.
- Reuse existing backend domains rather than exposing operator routes directly to customers.
- Ship a polished but narrow product surface suitable for a "mini SaaS" first release.

## Non-Goals

- No custom invoicing, proration, plan mutation, or subscription lifecycle logic outside Stripe.
- No browser access to `/admin/*` endpoints.
- No custom-built auth stack.
- No customer-facing full JSON style editor in v1.
- No advanced org hierarchy, seat billing, or granular RBAC in v1.
- No marketplace, credits system, support chat console, or custom sales CRM workflows.

## Product Principles

- The app should feel like developer infrastructure with map-native presentation, not a generic SaaS dashboard.
- Every page should lead users toward a working map, style URL, raster URL, or static image URL.
- Customer-facing state must be read from customer-safe read models, never from raw operator surfaces.
- API keys are shown exactly once when issued or rotated.
- Workspace billing state is mirrored from Stripe webhooks and never hand-edited in the app.
- Style editing remains internal until permissions and revision ownership are designed properly.

## New Product Domains

| Domain | Type | Responsibility | Notes |
| --- | --- | --- | --- |
| `identity` | new support domain | User accounts, sessions, workspace membership, route protection | Prefer managed auth provider with hosted or near-hosted flows |
| `billing_sync` | new support domain | Create Stripe Checkout/Portal sessions and mirror subscription state from Stripe webhooks | No custom billing calculations beyond reflecting Stripe state |
| `customer_console` | new support domain | Customer-safe API/read model for workspace, projects, usage, styles, and billing surfaces | Must aggregate existing `projects`, `metering`, `styles` domains |
| `marketing_site` | new frontend domain | Landing, pricing, legal, and conversion surfaces | SSR/SSG friendly |
| `docs_experience` | new frontend domain | Human-friendly docs UI over existing docs payloads | Can reuse current `/docs` data generators |
| `app_console` | new frontend domain | Authenticated dashboard, onboarding, project management, billing, snippets | Main logged-in product surface |
| `map_preview` | shared frontend capability | Interactive preview cards, style previews, static map previews, token-aware snippet generation | Reuse existing demo concepts, not the demo route itself |

## Required Supporting Backend Shape

The frontend cannot safely sit directly on top of the current operator endpoints. The minimum new backend shape is:

- `identity`
  - Resolves current user and current workspace.
  - Handles workspace membership.
  - Protects `/app/*`.
- `billing_sync`
  - Creates Stripe Checkout session URLs.
  - Creates Stripe Customer Portal session URLs.
  - Subscribes to Stripe webhook events and updates a local billing read model.
  - Owns the mapping from Stripe customer/subscription to internal workspace.
- `customer_console`
  - Returns workspace bootstrap data for the app shell.
  - Exposes customer-safe project CRUD and token rotation actions.
  - Exposes usage summaries and plan-aware onboarding data.
  - Exposes published styles for preview/snippet generation.

`/admin/*` remains operator-only and should be treated as internal tooling, not the product API.

## Billing Boundary

Stripe is the source of truth for billing. The product should not implement custom subscription state machines.

Allowed server responsibilities:

- Create hosted Checkout sessions.
- Create hosted Customer Portal sessions.
- Receive Stripe webhook events.
- Persist a mirrored billing read model for the workspace.
- Map Stripe price/product to internal plan IDs such as `free` and `pro`.
- Gate app UI based on mirrored subscription status.

Explicitly disallowed responsibilities:

- Custom cancellation, resume, downgrade, or proration logic.
- Custom invoice pages.
- Server-owned billing calculations that compete with Stripe invoices.
- Editable billing state in internal admin panels except emergency support tooling.

Webhook events to subscribe to in v1:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

The local read model only needs enough data to drive UX:

- `workspaceId`
- `stripeCustomerId`
- `stripeSubscriptionId`
- `planId`
- `subscriptionStatus`
- `billingEmail`
- `currentPeriodEnd`
- `cancelAtPeriodEnd`
- `lastWebhookAt`

## Workspace and Plan Rules

- Billing belongs to the workspace, not to individual projects.
- Projects inherit their effective plan from the workspace billing state.
- Customers may name projects, manage allowed origins, and choose which endpoint groups are enabled.
- Customers must not be allowed to edit arbitrary quotas or cache overrides in v1.
- If the current `projects` domain continues storing `planId` directly on each project, webhook sync must propagate the workspace plan change to all workspace-owned projects until the model is refactored.

## Roles

| Role | Allowed surfaces | Not allowed |
| --- | --- | --- |
| Visitor | marketing, docs, pricing, legal | app console, project data, billing data |
| Authenticated workspace member | app console, project management, usage views, billing links, snippet generation | operator-only artifact ingest, publish controls, admin health |
| Operator/admin | existing `/admin/*`, internal studio, internal ops | n/a |

## Route and Surface Map

### Recommended DNS / host split

- `www.<domain>`: marketing, pricing, legal
- `app.<domain>`: authenticated console
- `docs.<domain>` or `www.<domain>/docs`: docs experience
- `api.<domain>`: delivery endpoints and app/customer API routes

### MVP simplification

The first release can run as one frontend app with route groups:

- `/(marketing)`
- `/docs`
- `/app`
- `/legal`

and one backend/API origin for:

- `/v1/*`
- `/app-api/*`
- `/billing/*`
- `/webhooks/stripe`

## Navigation Model

### Marketing navigation

- Product
- Pricing
- Docs
- Sign in
- Start free

### App navigation

- Overview
- Projects
- Styles
- Billing
- Docs
- Settings

The app nav should stay narrow. Avoid adding empty analytics, team, support, or audit tabs in v1.

## Detailed Surface Specifications

### 1. Landing Page

**Route:** `/`

**Purpose:** turn a visitor into a signed-up user or a docs-first evaluator.

**Primary CTA:** `Start free`

**Secondary CTA:** `Read the docs`

**Required sections:**

- Hero with live or pre-rendered map scene plus concise value statement.
- Short "what you get" strip: vector tiles, styles, raster/static maps, project keys, usage visibility.
- Code snippet panel showing a MapLibre style URL and token placeholder.
- Three product pillars:
  - ship vector tiles fast
  - use hosted styles and raster/static APIs
  - manage projects and billing with minimal overhead
- "How it works" section: sign up -> create project -> copy snippet -> ship map.
- Pricing teaser with Free and Pro.
- Docs preview section linking into quickstart, authentication, raster/static, and style reference.
- Footer with legal links and status/security contact links.

**Design direction:**

- Infrastructure-grade, map-first, and editorial rather than glossy.
- Use large cartographic imagery or styled map snapshots as the visual anchor.
- Prefer a warm off-white background with dark ink, muted green/blue map accents, and strong contrast panels.
- Typography should feel deliberate and technical; pair a modern sans with a restrained mono for code and endpoint labels.
- Motion should be limited to map reveal/loading states and section transitions, not generic dashboard micro-animations.

### 2. Pricing Page

**Route:** `/pricing`

**Purpose:** explain packaging and route paid conversion into Stripe Checkout.

**Plans to expose in v1:**

- `free`
- `pro`

Initial copy should align with the current metering model:

- `free`: 100,000 included monthly requests
- `pro`: 500,000 included monthly requests

The page should present these as configuration-backed product data, not hardcoded marketing copy, so plan values can evolve without rewriting the page.

**Required sections:**

- Simple plan comparison table.
- Explanation of what counts as a request across `tiles`, `raster`, and `static`.
- Overage explanation in plain language.
- Billing policy note: checkout and subscription management are handled by Stripe.
- FAQ covering plan changes, billing portal, and usage visibility.

**Primary actions:**

- Visitor on `free`: `Start free`
- Visitor on `pro`: `Upgrade with Stripe`
- Existing signed-in user on `pro`: `Open Checkout`
- Existing paid user: `Manage in Stripe`

### 3. Docs Experience

**Routes:**

- `/docs`
- `/docs/quickstart`
- `/docs/authentication`
- `/docs/maplibre`
- `/docs/raster`
- `/docs/static-maps`
- `/docs/styles`
- `/docs/api`
- `/docs/examples`

**Purpose:** make the existing docs payloads usable as a real developer onboarding surface.

**Must reuse existing backend outputs where possible:**

- `getDocsIndex`
- `getOpenApiJson`
- `getExamples`

**Required docs UX:**

- Sidebar navigation with stable sections.
- Copyable snippets with placeholder token handling.
- Tabs for MapLibre, curl, raster/static examples when useful.
- Visible note that browser clients should prefer query-token auth for preflight compatibility.
- Style examples resolved from currently published styles.
- Strong link between docs and app actions: `Create project`, `Open dashboard`, `Get API key`.

**Important constraint:**

Do not fork the docs content model unnecessarily. The frontend docs layer should mostly format and organize existing docs payloads plus a small number of handwritten guide pages.

### 4. Legal Surfaces

**Routes:**

- `/legal/terms`
- `/legal/privacy`
- `/legal/acceptable-use`

**Purpose:** provide the minimum trustworthy legal surface for a paid developer product.

**Requirements:**

- Static, versioned pages with last-updated date.
- Pricing and signup flows must link to Terms and Privacy.
- Acceptable Use should cover abusive scraping, illegal content, credential misuse, and service abuse.
- If analytics or session tooling adds cookies, Privacy must mention them.

Optional later additions:

- `/legal/dpa`
- `/security`

### 5. Authentication Surfaces

**Routes:**

- `/sign-in`
- `/sign-up`
- `/accept-invite` (phase 2 if multi-member workspaces ship early)

**Approach:**

- Prefer managed auth with hosted or near-hosted pages.
- Passwordless email link is sufficient for v1.
- Social login is optional, not required.

**UX rules:**

- After sign-up, route directly into workspace bootstrap, not a generic profile page.
- Auth success should continue the original intent:
  - pricing -> checkout
  - docs -> create project
  - direct app link -> overview

### 6. App Overview

**Route:** `/app`

**Purpose:** show state, not marketing.

**Required modules:**

- Current plan and subscription status.
- Current month request usage with a simple trend or percent-of-allowance view.
- Project count and quick links.
- Published style count and preview shortcut.
- Onboarding checklist when the workspace has no projects.
- "First integration" snippet card with MapLibre, raster, and static variants.

**Empty state behavior:**

- If no project exists, the page should collapse into a setup flow rather than a blank dashboard.
- The primary task is `Create first project`.

### 7. Project Creation Flow

**Route:** `/app/projects/new`

**Purpose:** take a user from zero to a working API token quickly.

**Fields in v1:**

- Project name
- Allowed origins
- Endpoint toggles:
  - vector tiles
  - raster tiles
  - static maps

**Not editable in v1:**

- raw quota numbers
- cache overrides
- plan ID

Those are derived from the workspace plan and internal defaults.

**Success state must include:**

- Project created confirmation.
- Newly issued API token shown once.
- Copyable snippets for:
  - MapLibre style URL
  - raster tile URL
  - static map URL
- Explicit warning that the token will not be shown again.

### 8. Projects Index

**Route:** `/app/projects`

**Purpose:** give a compact operational list, not a spreadsheet.

**Each row/card should show:**

- Project name
- plan badge
- enabled endpoint groups
- latest day usage
- latest month usage
- allowed origin count
- last key rotation date

**Actions:**

- Open project
- Create project
- Rotate key

### 9. Project Detail

**Route:** `/app/projects/[projectId]`

**Required sections:**

- Project identity header.
- Endpoint group toggles summary.
- Allowed origins editor.
- Usage snapshot.
- Key management card.
- Quickstart snippets.

**Key management rules:**

- Existing raw key material is never redisplayed.
- Rotation requires an explicit confirmation modal.
- New token success state is persistent until dismissed or copied.

### 10. Usage Surface

**Route:** `/app/projects/[projectId]/usage`

**Purpose:** answer "am I close to plan limits?" without turning into a BI product.

**Views in v1:**

- `day`
- `month`

**Breakdowns:**

- total requests
- by endpoint group: `tiles`, `raster`, `static`

**Design rules:**

- Use a simple stacked bar or segmented summary.
- Show percent of included allowance for the current workspace plan.
- When on `free`, the upgrade CTA belongs here but should not dominate the page.

### 11. Styles Surface

**Routes:**

- `/app/styles`
- `/app/styles/[styleId]`

**Purpose:** expose available published styles and make them easy to use.

**V1 scope:**

- List published styles.
- Show preview screenshot or live mini-map.
- Show style URL and copy action.
- Show related raster/static example URLs.

**Out of scope for v1:**

- Customer-authored style editing.
- Version history editing.
- Publish controls.

Those remain internal under the existing studio and control-plane flows until ownership, permissions, and conflict rules are redesigned for customer usage.

### 12. Billing Surface

**Route:** `/app/billing`

**Purpose:** reflect Stripe state and provide links, not recreate Stripe.

**Required modules:**

- Current plan.
- Subscription status.
- Current billing email.
- Renewal or period-end date.
- Request usage for current month.
- `Upgrade`, `Open billing portal`, or `Resume in Stripe` actions depending on state.

**Rules:**

- All plan changes route through Checkout or Stripe Customer Portal.
- If the workspace is `past_due`, show a clear banner and billing portal CTA.
- If the workspace downgrades or cancels, the effective internal plan changes only after webhook confirmation.

### 13. Settings Surface

**Route:** `/app/settings`

**Purpose:** hold the few workspace-level settings that do not deserve their own nav item.

**V1 scope:**

- Workspace name
- billing contact email display
- member list if multi-user ships
- delete workspace is not required in v1

## Shared UX Requirements

- Snippets must be copy-first and available wherever a user makes an integration decision.
- All code examples should swap between query-token and header-token modes where relevant.
- Token exposure must be rare, explicit, and auditable.
- Empty states should always end with a specific next action.
- Loading states should use skeletons and preserve layout to avoid dashboard jitter.
- Mobile layout matters for docs and billing, but the app can remain desktop-first.

## Key User Flows

### Flow 1: Visitor to first working map

1. User lands on `/` or `/pricing`.
2. User clicks `Start free`.
3. Managed auth completes sign-up.
4. App creates or prompts for a default workspace.
5. User lands on `/app/projects/new`.
6. User creates a project and receives a token.
7. User copies the MapLibre snippet and published style URL.
8. User sees a success note and link to docs quickstart.

### Flow 2: Docs-first evaluator to signup

1. User lands on `/docs/quickstart`.
2. User reads example using placeholder token.
3. User clicks `Create project`.
4. Sign-up completes.
5. App returns user to project creation.

### Flow 3: Free to paid upgrade

1. User reaches pricing or billing page.
2. User clicks `Upgrade`.
3. Backend creates a Stripe Checkout session URL.
4. User completes Stripe Checkout.
5. Stripe webhook updates local billing read model.
6. App reflects new `pro` plan state and updated included allowance.

### Flow 4: Subscription management

1. User opens `/app/billing`.
2. User clicks `Manage in Stripe`.
3. Backend creates a Stripe Customer Portal session URL.
4. User changes or cancels subscription in Stripe.
5. Stripe webhooks update local state.
6. App reflects new status after webhook sync.

### Flow 5: Rotate compromised key

1. User opens project detail.
2. User clicks `Rotate key`.
3. Confirmation modal warns that the previous key will stop working.
4. Rotation completes.
5. New token is shown once with copy actions and updated snippets.

### Flow 6: Approaching quota or allowance

1. Usage surface detects the workspace is near included monthly allowance.
2. App shows warning state on overview and billing.
3. CTA routes to pricing or billing page depending on auth state.
4. Upgrade runs through Stripe Checkout only.

## App Bootstrap Data

The app shell should have a single bootstrap payload for first render. It should include:

- current user
- current workspace
- current plan and subscription status
- top-level usage summary for current month
- project summaries
- published styles summary
- onboarding state flags

Avoid issuing many small waterfall requests on first load.

## Customer-Safe API Surface

Proposed internal route shape:

- `GET /app-api/bootstrap`
- `GET /app-api/session`
- `GET /app-api/settings`
- `PATCH /app-api/settings`
- `GET /app-api/projects`
- `POST /app-api/projects`
- `GET /app-api/projects/:projectId`
- `PATCH /app-api/projects/:projectId`
- `POST /app-api/projects/:projectId/keys/rotate`
- `GET /app-api/projects/:projectId/usage?window=day|month`
- `GET /app-api/styles`
- `GET /app-api/styles/:styleId`
- `GET /app-api/billing`
- `POST /billing/checkout`
- `POST /billing/portal`
- `POST /webhooks/stripe`

These routes may initially delegate to existing service-domain functions internally, but the browser must never receive admin credentials or talk to `/admin/*` directly.

## Visual System

### Tone

- Calm, precise, technical.
- Not playful.
- Not enterprise-grey and not neon-startup.

### Visual language

- Base palette: warm paper, charcoal ink, mineral blue, terrain green, muted rust for warnings.
- Use map tiles, linework, coordinate grids, and legend-like micro-details as brand texture.
- Use mono labels for endpoints, plans, and token metadata.
- Use dense but readable information cards with strong hierarchy.

### Component priorities

- App shell with persistent left nav.
- Copyable code block component.
- Preview map card.
- Plan badge.
- Usage meter.
- Key reveal card with danger-safe affordances.
- Stripe state banner.

## Technical Implementation Direction

- Create the frontend as a separate `frontend/` app inside this repo or as a sibling workspace.
- Prefer SSR/SSG for marketing and docs.
- Use server-rendered app shell plus thin client islands for map previews, snippet copy, and charts.
- Keep frontend business logic close to route domains instead of a single global store.
- Use shared generated types or narrowly typed client contracts for `app-api` responses.

## Suggested Frontend Insertion Roots

- `frontend/app/(marketing)/`
- `frontend/app/docs/`
- `frontend/app/app/`
- `frontend/components/primitives/`
- `frontend/components/maps/`
- `frontend/lib/domains/identity/`
- `frontend/lib/domains/billing/`
- `frontend/lib/domains/projects/`
- `frontend/lib/domains/usage/`
- `frontend/lib/domains/styles/`
- `frontend/lib/domains/snippets/`

## Phased Delivery

### Phase 1: Public product shell + basic app

- landing
- pricing
- legal
- docs experience wrapper
- managed auth
- workspace bootstrap
- projects create/list/detail
- key rotation
- usage day/month summaries
- billing page with Stripe Checkout and Portal links

### Phase 2: Refinement

- richer usage visualizations
- workspace members
- better onboarding checklist and quickstart generation
- style preview pages with richer map interactions

### Phase 3: Advanced customer features

- customer-safe style customization
- project templates
- better notifications around billing/usage events

## Decision Summary

The right next step is not "build a frontend on top of `/admin/*`". It is to introduce one customer-safe console layer, one Stripe sync layer, and one polished frontend app that organizes the already-solid backend into a coherent product. The first release should emphasize fast onboarding, clear docs, visible usage, and Stripe-managed billing, while keeping style authoring and operator tooling separate.
