# Working in TSTiles

Read `specs/00_system.md`, `.agent/workflows/lop.md`, and
`.agent/workflows/gauntlet.md` before editing. This repository's active goal is
cheap static PMTiles hosting for owned websites. `legacy/saas/` is archived
context and has no authority over active development.

Domain builders use separate branches/worktrees and write only within their
SPEC's `paths.owned` and `paths.tests`. Root configuration, dependency changes,
frozen contracts, architecture checks, workflows, and cross-domain decisions
belong to the PM. Do not widen your own write gate.

Use `npm run scope:check -- <domain> <base-ref>` before handing off a branch.
Run the domain's commands, then `npm run test:architecture`. The PM runs the
composed build and live hosting/browser checks. Checks that were not run are
not green. A zero-test result is a failure.

Report four things: changed paths; commands and observed results; disagreements;
remaining broken behavior or unavailable evidence. Do not hide a wrong contract
with a cast, duplicated type, empty fallback, or synthetic success.

Critics run in a separate fresh context. They inspect the built artifact and
compare it against the named external bar. They may read the goal, spec, frozen
contract, and operational instructions, but not the builder's report. A critic
cannot edit, settle ownership, or pass an artifact they could not reach.
