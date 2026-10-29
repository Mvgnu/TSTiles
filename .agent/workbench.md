# Tileserver quality workbench

Updated: 2026-09-04

## Product thesis

A developer should be able to understand the service, run it without a planet
download, complete one real tile request, and operate a workspace without the
product overstating what is live or safe.

## Active pieces

| Piece | External bar | Current state | Largest gap / next gate |
|---|---|---|---|
| Auth and session truth | OWASP Password Storage + Session Management guidance | Canonical byte-collision hardening complete; fresh code Gauntlet active | Inspect the centralized secret policy and Node 20 executable-boundary evidence against raw-material reuse across encodings |
| HTTP composition | Fastify plugin/route architecture | Audit failed | 1,683-line executable owns parsing, routing, UI, telemetry, and lifecycle; build one composed app with bounded bodies and safe errors |
| First successful request | Stripe developer quickstart | Builder complete; integration rerun pending | Fixture is now the default and composed delivery returned 200/MVT/49 bytes; wider smoke is blocked by non-destructive schema/database drift handling |
| Public evaluation surface | MapTiler Cloud public site | Visual Gauntlet failed | Live-preview claim renders a blank rectangle while announcing success; landing overflows by 199px at 390px |
| Customer operation surface | Cloudflare dashboard | Builder complete; browser Gauntlet pending | Responsive shell, plain operating language, honest preview states, and renderer split pass the scoped code gate; verify at 1280px and 390px |
| Shared interface boundary | Stripe Dashboard design-system discipline | Builder complete | Surface adoption and browser proof remain; shared exports intentionally cover only real downstream imports |

## Confirmed blockers

- `/ops/*` and `/webhooks/brevo` implementations are not registered by the
  current executable despite readiness claims that they ship.
- Request bodies are buffered without a limit and raw exception messages can be
  returned to clients.
- The executable composition still makes implemented operator and webhook routes
  difficult to prove reachable as one supported application.
- The checked-in development database predates the hashed-session schema; any
  compatibility fix must preserve its rows rather than deleting the database.
- Public and app surfaces have not yet passed a fresh browser Gauntlet after the
  responsive and truth-state changes.

## Review gates

1. Baseline audit: complete — lint/typecheck/build pass; readiness and domain tests fail; shell smoke produces a false pass.
2. Auth/security builder: complete.
3. Fresh auth/code critic: failed on missing boot-time production secret validation.
4. Production-secret follow-up builder: complete; repeated, low-variation, sequential, and common-placeholder values now fail in the centralized loader. Pairwise-distinct enforcement compares normalized admin-token UTF-8 bytes with hex-decoded scoped-key bytes in production and staging, rejecting reuse of the same raw material across encodings with errors naming both purposes. Development still permits admin/scoped reuse while enforcing scoped-key distinctness. Node 20.19.5 evidence for the canonical-byte follow-up: focused secret suite 40/40 and executable startup suite 2/2 pass using disposable database copies; the executable refuses admin-vs-CSRF encoded reuse before listening, while the generated-secret control listens successfully; scoped lint and typecheck pass. Fresh code critic pending.
5. Deterministic fixture/readiness builder: complete; full readiness rerun pending.
6. HTTP composition builder: queued.
7. Fresh code-architecture critic: queued.
8. Design-system and app-console builders: complete; public builder queued from the live visual verdict.
9. Fresh visual/UX critic at desktop and mobile widths: queued.
10. Whole-product smoothing and final separate code + visual gauntlets: queued.

## Evidence policy

- Core smoke success requires an actual 2xx tile response from the checked-in
  fixture. Error responses may be recorded separately as degraded-mode checks.
- Browser critics inspect running routes, not checked-in screenshots.
- “Ready” requires executable evidence. External-provider and real-data checks
  remain explicit blockers until actually run.
- Secret-startup evidence uses only disposable copies of `prisma/dev.db`; the
  checked-in database is never the executable test's write target.
