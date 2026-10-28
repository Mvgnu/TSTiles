---
name: archive
description: Inspect and publish an existing PMTiles archive without loading it into RAM.
paths:
  owned:
    - src/archive/
  tests:
    - test/archive/
exports:
  - inspectArchive
  - ArchiveInspection
  - InspectionOptions
  - publishArchive
  - PublishOptions
  - Publication
  - ArchiveError
  - archive CLI
consumes:
  - contract.MapManifest
  - contract.VectorLayer
  - pmtiles.PMTiles
verification:
  check: npm run check
  test: npm run test:archive
  build: npm run build
bar:
  reference: Official Protomaps PMTiles JavaScript reader and CLI inspection workflow
  property: An operator can reject unsuitable input and publish exact immutable archive bytes with a recoverable manifest, using bounded memory and without editing source.
---

# Archive preparation

Read `../../specs/00_system.md` and the Lop/Gauntlet workflows first.
Own only the declared paths. `src/contract.ts` is PM-owned.

## Behavior

Inspect existing vector PMTiles v3 using the maintained library, bounded
positional reads, declared section bounds, and validated metadata. Reject
unsupported compression and tile types explicitly. Never call nonempty bytes
PMTiles. Report the difference between header/metadata inspection and full
directory/tile verification.

Publish by streaming to a temporary file while computing SHA-256. Do not
materialize a planet archive in memory. Publish a digest-named archive before
atomically replacing the map manifest. An interrupted publication must retain
the previous manifest. Do not overwrite an existing archive with different
bytes. Verify identical content before deduplication. Require attribution from
the operator or valid archive metadata.

The CLI accepts `inspect <file>` and `publish <file> --out <directory> --id <slug>
--name <name> --attribution <text> [--style <url>]`. Errors exit nonzero with a
specific explanation. No cloud credentials or infrastructure are created.

## Evidence required

Inspect/publish the fixture through the built CLI; compare published bytes and
hash. Reject plain text and a truncated archive. Check failed publication does
not damage a prior manifest. Exercise a large declared range without allocating
the whole archive. Unit tests must include actual PMTiles decoding.

## Known gaps

The user's production archive is not supplied. Inspection cannot establish
every tile's validity or cartographic quality. Full archive verification and a
large-file resource measurement need actual data.

Default limits are 16 MiB per compressed read, 64 MiB per decoded section,
100,000 root-directory entries, and 4,096 vector-layer descriptions. The
TypeScript inspection options can lower limits or raise read/decode limits up
to 64/256 MiB. Unsupported or excessive input fails explicitly; ranges are
never shortened to fit a configured limit. The only clipping is at file EOF,
as required for the official reader's initial 16 KiB range request.

Publication copies in chunks of at most 1 MiB. Identical publication verifies
the entire existing destination digest before reuse. It requires enough disk
for a temporary archive copy; it is not an in-place registration command.
Old digest-named archives remain available after a manifest update. A hard
process kill may leave an unreferenced `.tmp` file; no manifest points to it.
The hosting domain must keep these temporary paths unservable.

An absent layer inventory is reported by inspection and requires an explicit
style at publication. HTML attribution is not silently stripped: an operator
must provide plain-text credit. Neither publication nor a supplied style URL
establishes that style sources, layers, glyphs or sprites are compatible.
