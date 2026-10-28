---
description: Domain-scoped development with isolated writes and executable contracts.
---

# Lop: domain-scoped development

Lop answers whether a domain built what its spec describes. Read `gauntlet.md`
as well: the external quality bar and independent critic answer whether it is
useful. Green checks are the entry condition for judgement.

## Domains and authority

TSTiles is one npm package with three ownership bubbles. Do not introduce a
monorepo merely to reproduce a workflow's example directory names.

| Domain | Spec | Owned behavior |
| --- | --- | --- |
| archive | `src/archive/SPEC.md` | Inspect and publish exact PMTiles bytes |
| web | `src/web/SPEC.md` | Render and embed independently configured maps |
| hosting | `ops/SPEC.md` | Static HTTP delivery and operations |

System intent and cross-domain rulings live in `specs/00_system.md`.
`src/contract.ts` is the single public manifest/type contract. Each spec has
machine-readable `name`, `description`, `paths.owned`, `paths.tests`, `exports`,
`consumes`, `verification.check/test/build`, and `bar.reference/property`.

The spec's bar must name external work and one property that can be inspected.
A reference alone is a mood board; a property alone is self-assessment.

## Write gate

Builders may change only their spec's owned/test paths. Updating their SPEC's
exports, consumes, verification, and known gaps is permitted. Changing path
ownership or the frozen contract requires a PM ruling first.

PM-owned: root package/lockfile and tool configuration; `src/contract.ts`;
`scripts/`; `test/architecture/`; `test/fixtures/`; `.agent/`; `.github/`;
`AGENTS.md`; `README.md`; `specs/`; `legacy/`. Generated `dist/`, `site/`, caches,
screenshots, logs, and dependency installs are verification output, never source
patches. Nothing may import from the archived SaaS implementation.

Read access covers the repository. There are no sibling-repository dependencies.
No paid service, production deploy, email, or message is part of a builder cycle.

## Cycle

1. Read the domain spec, its external bar, frozen contract, system rulings, and
   directly consumed modules.
2. Create an isolated worktree/branch from the PM's current integration point.
3. State the owned paths and smallest independently judgeable outcome.
4. Implement inside those paths. Test the public boundary, not just helpers.
5. Run the spec's checks and `npm run test:architecture`. Run
   `npm run scope:check -- <domain> <base-ref>` to reject escaped writes.
6. Update exports/consumes if behavior changed. Ask the PM for cross-domain work
   rather than silently widening a bubble or copying a contract.
7. Report disagreements plainly. A bad contract remains a recorded defect;
   do not make a workaround look like compliance.
8. End with changed paths, exact commands/results, disagreements, and remaining
   gaps. Commit the bounded patch. The PM integrates at a milestone.
9. Hand the built artifact to a fresh Gauntlet critic. Do not grade yourself.

## Anti-patterns

| Anti-pattern | Required response |
| --- | --- |
| Writing outside ownership | Split the change; PM updates contracts first |
| A site-specific global in shared code | Instance configuration or explicit parameter |
| Copied manifest types or broad casts | Import the frozen type; validate unknown JSON |
| Turning any nonempty file into a "validated" archive | Parse the real format; state the verification limit |
| Requiring billing/database for public static maps | Keep the static delivery boundary |
| Downloading or buffering a planet to inspect its header | Bounded range reads or streaming publication |
| Empty styles or provider fallbacks hide failure | Surface the actual error and missing dependency |
| A fixture proves beautiful cartography | Separate transport/display proof from real-map judgement |
| A green suite includes zero tests or skipped infrastructure | Fail that gate and name the missing evidence |
| Builder evaluates its own report | Fresh critic inspects real artifacts |
