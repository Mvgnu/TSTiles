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
  - PublishMode
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

Link publication (`PublishOptions.mode: "link"`, CLI `--link`; ruling
2026-10-29) copies no bytes. The source must be an ordinary file (symlinks are
rejected) on the same device as `<out>/archives`; a different device is
rejected before hashing, and EXDEV from `link()` becomes `CROSS_FILESYSTEM`
(EPERM/ENOTSUP/EMLINK become `LINK_UNSUPPORTED`). There is no fallback to
copying. The source is hashed in place through the same bounded chunked
reads, then hard-linked atomically to `archives/<sha256>.pmtiles`. After the
link the source's device, inode, size and mtime are re-checked against the
opened file, and the digest name must still be that inode; on mismatch the
link created by this run is removed and the manifest is not touched. The check
repeats before the manifest rename; any failure before that rename removes the
created link. EEXIST with the same inode is reused (those bytes were just
hashed); EEXIST with another inode is verified in full like copy mode. The
result reports `mode` and operator `notes` (shared inode; not world-readable).

The CLI accepts `inspect <file>` and `publish <file> --out <directory> --id <slug>
--name <name> --attribution <text> [--style <url>] [--link]`. `--link` is
valueless and unique. Errors exit nonzero with a specific explanation. No
cloud credentials or infrastructure are created.

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
the entire existing destination digest before reuse. Copy mode requires
enough disk for a temporary archive copy; link mode copies nothing.
Old digest-named archives remain available after a manifest update.

Link mode: after publication the original name and the digest name share one
inode, so immutability depends on the operator removing the original name or
never writing to it; nothing in the tool can enforce that afterwards. ctime
necessarily changes when a link is made, so the post-link check uses size and
mtime (plus device/inode): a writer that restores mtime in the short window
between the last full read check and `link()` would not be detected. A
concurrent publisher that reuses a link in the instant before this run fails
and removes it would be left with a dangling manifest; publications should not
be run concurrently against one `--out`. EXDEV is exercised by fault injection
(wrapped `link`/`stat`), not a real second filesystem. Directories `archives/`
and `maps/` are created before the device check, so a rejected cross-device
attempt may leave them empty. A hard
process kill may leave an unreferenced `.tmp` file; no manifest points to it.
The hosting domain must keep these temporary paths unservable.

An absent layer inventory is reported by inspection and requires an explicit
style at publication. HTML attribution is not silently stripped: an operator
must provide plain-text credit. Neither publication nor a supplied style URL
establishes that style sources, layers, glyphs or sprites are compatible.
