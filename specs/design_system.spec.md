---
name: design_system
description: "Small shared visual boundary for public and operational HTML surfaces"
bar:
  reference: "Stripe Dashboard design system"
  property: "Shared primitives make dense technical information calm, legible, accessible, and consistent without making public and operational surfaces identical."
paths:
  types: src/domains/design-system/types.ts
  service: src/domains/design-system/styles.ts
  components: src/domains/design-system/components.ts
  tests: src/domains/design-system/__tests__/
exports:
  - SystemTheme
  - CodeSnippetRecord
  - ButtonVariant
  - ButtonSize
  - InputType
  - BannerTone
  - CardVariant
  - DefaultTheme
  - DarkTheme
  - getGlobalCss
  - getDesignTokens
  - escapeHtml
  - UniversalHeaderActiveItem
  - getUniversalHeaderCss
  - renderUniversalHeader
  - renderButton
  - renderInput
  - renderCard
  - renderBanner
  - renderCodeCard
consumes: []
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run src/domains/design-system/__tests__/ --globals --passWithNoTests"
  lint: "eslint src/domains/design-system/"
status: in-review
---

# Design system

This domain owns the deliberately small shared boundary used by server-rendered
HTML. It is not a component catalogue. A new primitive belongs here only after
two real surfaces need the same semantics; otherwise the surface owns its
layout.

## Direction

- Calm developer infrastructure: crisp neutral surfaces, one indigo accent,
  hairline borders, restrained radii, and no decorative effects competing with
  status or code.
- Public and operational pages share tokens and basic controls. They do not
  share page silhouettes: public pages optimize for evaluation; the app and ops
  consoles optimize for orientation and action.
- Copy is precise and literal. No cyberpunk, military, or pseudo-technical
  metaphors.

## Supported boundary

- `getGlobalCss` emits light/dark tokens, typography, focus, motion, overflow,
  media, code, form, card, banner, table, tab, and stat-grid foundations.
- `renderUniversalHeader` is the public navigation only. App and operator
  navigation remain surface-owned.
- Button, input, card, banner, and code-card helpers cover the primitives
  currently imported by more than one surface.
- Caller-authored HTML slots in cards and banners are trusted template content;
  all plain text and attribute inputs are escaped at this boundary.

## Accessibility and responsive invariants

- Body text is 1rem; interactive labels and controls are at least 0.875rem / 14px.
- Every focusable control has a visible 2px focus ring.
- Form inputs have visible labels, deterministic IDs, linked hint/error text,
  and `aria-invalid` when appropriate.
- Code, tables, tabs, media, and nested grid/flex children cannot force the
  document wider than its viewport; intentional wide content scrolls inside its
  own region.
- Font scaling to 200% preserves content and actions without clipping.
- Reduced-motion preferences collapse transitions and animations.
- Shared public navigation emits the first-focus skip link. Every consuming
  surface must expose `<main id="main-content">`.

## Ownership rule

Downstream surfaces consume tokens or these supported helpers and may own
experience-specific layout classes. They must not copy the token palette or
reintroduce removed speculative components locally merely to preserve the old
catalogue.
