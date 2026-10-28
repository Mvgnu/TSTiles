# VPS-first structural cleanup

Date: 2026-10-28. Original commit: `f595687e74dbf9beabf5d37aee5401a3bca8b000`.
The full original tree SHA is `61aa8495f4e66119ec4f1b6b78974da76e86d7d5`.
`legacy/saas/` retains that exact tree, including its prior specs and assets.

## Why a different default was necessary

The owner asked for very inexpensive maps from an existing PMTiles file,
running on a VPS and usable across multiple owned sites. The old product's
requirements instead described a multi-tenant SaaS with accounts, billing,
email, quotas, multiple consoles, and a persistent database. Cleaning names or
adding another spec would not reconcile those goals.

Three independent audits examined archive/delivery, integration, and hosting
economics. The following are code observations, not guesses about performance:

| Original defect | Evidence in archived source | Decision |
| --- | --- | --- |
| Conversion returned input unchanged | `src/domains/ingest/pipeline/convert-to-pmtiles.ts` | Accept existing PMTiles only; no OSM conversion claim |
| PMTiles validation meant nonempty bytes | `src/domains/ingest/pipeline/probe-output.ts` | Parse actual header/metadata and name the verification limit |
| Ingest success test used plain text | `src/domains/ingest/__tests__/ingest-pipeline.test.ts` | Invalid input must fail at the real CLI boundary |
| Import buffered the source with a 10 GiB configured default | `src/domains/ingest/pipeline/fetch-planet.ts`, `src/config/load-config.ts` | Bounded positional inspection and streaming publication |
| Only executable composed the whole SaaS | `src/app/demo-server.ts`, `src/app/demo-bootstrap.ts` | Serve static files with Caddy; no per-request app/database |
| All style sources were rewritten to one archive | `src/app/demo-bootstrap.ts` | A supplied style stays intact |
| Missing styles could become empty layers | `src/domains/styles/styles.service.ts` | Explicit data-preview mode and visible failures |
| Fixture proved one polygon, not a real basemap | `src/domains/tile-resolver/__fixtures__/test_fixture_1.pmtiles` | Fixture success never becomes a cartography claim |
| Default startup invoked destructive schema sync | Original `package.json` | No database in the active install/startup path |
| Lop referenced a missing Gauntlet file | Original `.agent/workflows/lop.md` | Supply both workflows, machine-readable ownership and independent reviews |

All source paths in that table are relative to `legacy/saas/`. These defects
remain historical; this milestone does not claim to repair the archived SaaS.

## Structural decisions

1. Preserve the old tree exactly. No active code imports it or silently forks
   its domain contracts. It is recoverable reference rather than a second
   supported server.
2. Keep one npm package with three genuine ownership domains. Package-manager
   migration is not needed to enforce the user's Lop pattern.
3. Use the official PMTiles JavaScript implementation for archive reading and
   MapLibre integration; use Caddy's existing HTTP implementation for ranges.
   No new tile protocol decoder or request-time Node server is justified.
4. Store immutable complete archives named by SHA-256. Publish small manifests
   last, preserve old archives, and make rollback a pointer change.
5. Separate correctness from usefulness. Public-boundary checks run before a
   fresh critic inspects the built CLI, live HTTP service, or rendered map.
6. Scope the first milestone honestly. A real archive and compatible full style
   are prerequisites for judging roads, labels, glyphs, sprites, and map design.

## External basis

- [PMTiles static/cloud hosting](https://docs.protomaps.com/pmtiles/cloud-storage)
  supports intact archives on Range-capable servers and S3-compatible stores.
- [PMTiles MapLibre integration](https://docs.protomaps.com/pmtiles/maplibre)
  uses the maintained protocol adapter in the browser.
- [Caddy file_server](https://caddyserver.com/docs/caddyfile/directives/file_server)
  provides partial content and conditional requests.
- [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli) supplies additional
  verification, extraction, upload, and optional XYZ serving operations.

No actual production archive, paid service, cloud credential, or VPS was used
in this cleanup. The review record states exactly what was exercised locally.
