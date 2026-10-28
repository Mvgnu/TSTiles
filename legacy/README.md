# Archived SaaS experiment

`saas/` preserves the entire repository at commit
`f595687e74dbf9beabf5d37aee5401a3bca8b000`, before the VPS-first cleanup.
Its subtree must remain byte-for-byte identical to that original tree.

It is historical reference, not a supported alternate deployment. Its old
specs, workflows, dependencies, tests, readiness claims, and startup commands
do not govern the active product. Do not install or execute them as part of
normal development. In particular, its OSM conversion placeholder and
nonempty-byte PMTiles probe do not validate an archive.

The active architecture is described in `../specs/00_system.md`.
Port a narrowly useful module only after an explicit PM decision and a real
boundary test; active code must never import from this directory.
