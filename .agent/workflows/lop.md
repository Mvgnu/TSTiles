---
description: Domain-scoped development with explicit ownership and verification
---

# Lop: domain-scoped delivery

Lop is the implementation half of this repository's quality process. Each
builder owns a small, named slice, reads the rest of the repository for context,
and writes only inside the paths assigned by the PM. Gauntlet is the independent
quality half; read `.agent/workflows/gauntlet.md` as well.

## Source of truth

- Domain intent and boundaries live in `specs/<domain>.spec.md`.
- Cross-cutting rules live in `specs/_cross_cutting.spec.md`.
- Runtime truth lives in executable tests and the composed application, not in
  a readiness checkbox or a direct service test alone.
- A builder brief may narrow a spec's write paths. It may not silently widen
  them.

If a spec contradicts the implementation or asks for something unsafe, report
the disagreement plainly. Do not make the code pretend that the spec is true.

## Builder cycle

1. Read this file, the assigned domain spec, its `bar`, and the PM ruling.
2. Read canonical types and direct dependencies before editing.
3. State the owned write paths. Everything else is read-only.
4. Implement the smallest coherent change that closes the assigned gap.
5. Test through the public boundary. Direct unit tests are useful but cannot
   prove that an HTTP route is registered or a page is usable.
6. Run the domain verification commands plus the narrowest relevant
   integration check.
7. Report changed files, evidence, remaining risk, and any disagreement.
8. Stop. A fresh Gauntlet critic judges the artifact; builders do not grade
   their own work.

## Write gate

Builders may write only to paths listed in the PM brief. A required change
outside the bubble is a PM escalation. Shared files such as `package.json`,
`prisma/schema.prisma`, `src/app/**`, and cross-cutting specs need explicit PM
ownership in the brief.

Do not overwrite unrelated working-tree changes. This repository may be dirty;
assume existing changes belong to the owner.

## TypeScript baseline

- Keep strict TypeScript. Model boundary input as `unknown` and narrow it once
  at the boundary.
- Do not use `any`, double casts, non-null assertions, or copied validators to
  silence design problems.
- Prefer explicit dependencies over ambient singletons and service locators.
- Keep one application composition root. Domain services own behavior; the app
  owns routing, lifecycle, limits, and error presentation.
- Do not invent cryptographic formats, compatibility labels, or production
  claims. Use maintained implementations and interoperable encodings.
- Keep request bodies, caches, queries, and file reads bounded.
- User-facing errors are stable and non-sensitive; detailed causes stay in
  redacted server logs.

## Verification baseline

Use the commands in the assigned spec. The repository-wide baseline is:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The PMTiles planet file is not required for local work. A checked-in fixture
must prove at least one successful end-to-end tile request. Tests that accept an
error response as success are degraded-mode checks, not delivery evidence.

Green gates are the entry condition for judgement, not the finish line.

## Anti-patterns

| Anti-pattern | Required response |
|---|---|
| A god-file owns parsing, routing, lifecycle, UI, and telemetry | Split at real responsibilities and keep one composition root |
| Every service re-validates already parsed transport input | Parse once at the HTTP boundary; keep service contracts typed |
| A direct handler test stands in for route reachability | Exercise the composed app |
| A smoke check accepts 4xx/5xx for the core success path | Add a deterministic fixture-backed 2xx assertion |
| A spec says `ready` because unit tests pass | Record actual integration evidence and remaining external blockers |
| Pseudo-technical copy tries to sound sophisticated | Use calm, specific language a developer can act on |
| The builder declares its own work good | Dispatch a fresh critic with the real artifact |
