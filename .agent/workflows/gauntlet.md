---
description: Build, inspect against an external bar, and repeat until the gap is resolved or explicitly accepted.
---

# Gauntlet: independent quality review

Lop enforces intent and boundaries. Gauntlet asks whether the result is useful
against a named external reference. A passing test suite cannot answer that.
No numerical success story from another repository is evidence for this one.

## Loop

1. The PM sets one separately judgeable goal and the domain's external bar.
2. A Lop builder implements inside the frozen ownership gate.
3. The PM creates a fresh critic with no builder conversation/history. Supply
   the goal, spec/bar, frozen contract, artifact location, and minimal commands
   needed to run it. Withhold the builder's account and reasoning.
4. The critic inspects the actual built CLI, published bytes, live HTTP service,
   or rendered page appropriate to that domain. Compare the same input/task
   with the external reference; use blind A/B when feasible and disclose when
   labels or different interfaces prevent it.
5. If the reference wins, report the **single largest remaining gap**, with
   concrete evidence and a reproducible acceptance condition. The builder fixes
   that gap within its scope; a structural disagreement returns to the PM.
6. Repeat without a preset round count. Stop with an argued pass, diminishing
   practical gains explained, or an explicit PM stop decision with the gap
   recorded. Lack of tool access is a failed/blocked round, never a pass.
7. A fresh smoothing reviewer follows the whole operator-to-second-site flow.
   The onboarding drill starts from a clean checkout and another site origin;
   every required source edit is a product gap.

## Domain artifacts and external bars

| Domain | Actual artifact | Required comparison |
| --- | --- | --- |
| archive | Built CLI, published immutable archive, manifest | Official PMTiles reader/CLI: same header/metadata and exact bytes; rejected bad input; interrupted/duplicate publication |
| web | Built page served over HTTP, desktop + mobile | Official PMTiles MapLibre example: visible features, pan/zoom, attribution, errors, second-site embedding without source edits |
| hosting | Running Caddy with prepared files | Official Caddy file_server / PMTiles hosting: exact 206 ranges, HEAD/conditional/CORS/cache behavior, update + rollback procedure |

Do not substitute reading source, a diff, or a report for these artifacts.
Archive/HTTP critics may inspect raw bytes and protocol traces; web critics
must actually render and interact with the page. Use `CADDY_BIN` with
`npm run test:hosting`; it fails if Caddy is missing. Browser automation can
use Playwright or an available real browser. Check the environment before
declaring a tool limitation; a failed invocation proves only that invocation.

The reference is not a production map provider contract. `pmtiles` is an archive
format and reader; the owner must supply compatible data, style, and attribution.

## Critic rules

- No edits. An editing critic becomes a second builder and forfeits independence.
- One largest gap per round, not a defensive list of twelve.
- A pass gives observed evidence and explains why the chosen property holds.
- State precisely which artifact/version was inspected and which commands,
  URLs, requests, screenshots, and interactions support the judgement.
- Separate observed success, inference, and untested scope.
- Do not invent a full visual pass from the one-polygon fixture. Roads, labels,
  glyphs, sprites, and actual user geography need the real archive/style.

## Review record

PM-owned review records live under `specs/reviews/`. Record domain, artifact
identity (commit plus build/fixture hash where practical), reference/property,
critic independence, actual inspection, verdict, largest gap if any, and PM
disposition. Reports must not include secrets or credentials.

Known limits are milestones, not permanent excuses: production TLS, traffic
capacity, live S3 behavior, actual costs, and the owner's map quality each need
their actual artifact before they can receive a pass.

## Done

Check clean; domain tests pass with nonzero coverage of real behavior;
architecture and ownership gates pass; build succeeds; live hosting and browser
evidence exists; the spec is satisfied; and a fresh critic argues for a pass
against the declared bar. Otherwise the PM explicitly stops with the single
remaining gap and unavailable evidence recorded. Never silently redefine done.
