---
trigger: always_on
---

# Tileserver project rules

This repository is a TypeScript map-delivery service built around PMTiles,
versioned styles, raster/static rendering, project-scoped access, and small web
surfaces. Use Lop write bubbles and separate Gauntlet critics.

## Trust before breadth

- The default local path must work without a planet PMTiles download by using a
  deterministic checked-in fixture. Missing large real-world data is shown as
  a capability state, never hidden behind a success claim.
- Product and readiness copy must describe only behavior the composed app can
  demonstrate. Do not call the project production-ready while routes, secrets,
  providers, migrations, or deployment checks remain unverified.
- Password hashes, session storage, signatures, and encryption use standard,
  maintained primitives with honest formats. Production refuses missing keys.
- Public errors reveal stable codes and safe messages. Logs redact bearer
  tokens, cookies, API keys, provider secrets, and personal data.

## Architecture

- `src/app` is the composition root. It owns HTTP registration, limits,
  lifecycle, and dependency wiring.
- Domains own business behavior and typed contracts. They do not create a
  second router, reach through unrelated domains, or repeatedly parse the same
  raw request.
- Prefer direct code over factories, wrappers, and registries that have only
  one implementation. Keep files cohesive and request flow traceable.
- Prisma and object-store lifecycles are explicit dependencies of the composed
  app. Test seams must not rely on mutation of ambient global state when an
  injected dependency is practical.

## Interface language

- Write for developers operating map infrastructure. Use precise nouns and
  verbs: project, token, request, style, tile, usage, invoice, incident.
- No pseudo-technical theatre such as “uplink,” “matrix,” “perimeter,” “God-tier,”
  or “telemetry stream.”
- Risky actions say what changes, when it changes, and whether it is reversible.
- Empty states end with the next useful action. Status surfaces distinguish
  live observations from configured or unavailable capabilities.
- Marketing and product surfaces share a restrained visual system but optimize
  for different jobs: evaluation on public pages, operation in the app.

## Required quality loop

At significant gates dispatch fresh, separate critics for:

1. code architecture, correctness, and security; and
2. visual design, usability, hierarchy, responsive behavior, and trust.

Critics inspect the real artifact and return one largest gap per round. They do
not edit.
