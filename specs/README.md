# Active specifications

Start at [00_system.md](00_system.md). Active specs describe one small product:
existing vector PMTiles archives, static hosting, and independently configured
browser maps. The previous SaaS specs live in `legacy/saas/specs/` and are not
active requirements.

| Domain | Spec | Writes |
| --- | --- | --- |
| archive | [Archive](../src/archive/SPEC.md) | `src/archive/`, `test/archive/` |
| web | [Web](../src/web/SPEC.md) | `src/web/`, `public/`, `test/web/` |
| hosting | [Hosting](../ops/SPEC.md) | `ops/`, `docs/hosting.md`, `test/hosting/` |

Shared contracts, tooling, CI, architecture tests, workflow definitions, and
this directory are PM-owned. [Lop](../.agent/workflows/lop.md) specifies the write
gate. [Gauntlet](../.agent/workflows/gauntlet.md) defines independent judgement.

The [migration record](migration.md) records the original problems and design
decisions. [Reviews](reviews/2026-10-28.md) record observed artifacts and limits.
