import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MapManifest } from "../contract.js";
import { ArchiveError, archiveError, checkAbort, isErrno } from "./errors.js";
import { BoundedFileSource } from "./file-source.js";
import type { InspectionOptions } from "./file-source.js";
import { inspectSource, isPlainText } from "./inspect.js";

/**
 * `copy` streams the bytes into a new digest-named file (needs free space for
 * a second copy). `link` hashes the source in place and hard-links it to the
 * digest name: no bytes are copied, source and `--out` must share a
 * filesystem, and both names then refer to one inode.
 */
export type PublishMode = "copy" | "link";

export interface PublishOptions extends InspectionOptions {
  readonly outDir: string;
  readonly id: string;
  readonly name: string;
  readonly attribution?: string;
  readonly style?: string;
  /** Defaults to `copy`. */
  readonly mode?: PublishMode;
}

export interface Publication {
  readonly mode: PublishMode;
  readonly manifest: MapManifest;
  readonly manifestPath: string;
  readonly archivePath: string;
  readonly reusedArchive: boolean;
  /** Operator-facing consequences of this publication, e.g. a shared inode. */
  readonly notes: readonly string[];
}

const COPY_CHUNK_BYTES = 1024 * 1024;

function textOption(value: string, name: string, maxLength: number): string {
  const result = value.trim();
  if (!result || result.length > maxLength || !isPlainText(result)) {
    throw new ArchiveError("INVALID_OPTIONS", `${name} must be nonempty plain text, without HTML, and at most ${maxLength} characters.`);
  }
  return result;
}

function styleOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const result = value.trim();
  try {
    if (!result || result.length > 4096 || Array.from(result).some(character => character.charCodeAt(0) <= 32 || character === "\\")) {
      throw new Error("invalid URL characters");
    }
    const parsed = new URL(result, "https://tstiles.invalid/maps/map.json");
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password || parsed.hash) {
      throw new Error("unsupported URL");
    }
    return result;
  } catch (error) {
    throw new ArchiveError("INVALID_OPTIONS", "style must be an HTTP(S) or relative URL without credentials, fragments, spaces, or backslashes.", error);
  }
}

function modeOption(value: unknown): PublishMode {
  if (value === undefined || value === "copy") return "copy";
  if (value === "link") return "link";
  throw new ArchiveError("INVALID_OPTIONS", "mode must be \"copy\" or \"link\".");
}

async function transfer(source: BoundedFileSource, destination?: FileHandle): Promise<string> {
  const hash = createHash("sha256");
  const chunkSize = Math.min(COPY_CHUNK_BYTES, source.limits.maxReadBytes);
  for (let offset = 0; offset < source.byteSize; offset += chunkSize) {
    const range = await source.getBytes(offset, Math.min(chunkSize, source.byteSize - offset));
    const bytes = new Uint8Array(range.data);
    hash.update(bytes);
    if (destination) {
      let written = 0;
      while (written < bytes.byteLength) {
        const result = await destination.write(bytes, written, bytes.byteLength - written, offset + written);
        if (result.bytesWritten === 0) throw new ArchiveError("IO_ERROR", "Archive publication stopped making write progress.");
        written += result.bytesWritten;
      }
    }
  }
  await source.assertUnchanged();
  return hash.digest("hex");
}

async function verifyExisting(path: string, expectedHash: string, expectedBytes: number, options: InspectionOptions): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isFile() || entry.size !== expectedBytes) {
    throw new ArchiveError("DESTINATION_CORRUPT", "The digest-named destination is not an ordinary file with the expected size; the existing manifest was not changed.");
  }
  const source = await BoundedFileSource.open(path, options);
  try {
    if (await transfer(source) !== expectedHash) {
      throw new ArchiveError("DESTINATION_CORRUPT", "The existing digest-named archive has different bytes; quarantine it before retrying. The manifest was not changed.");
    }
  } finally {
    await source.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function removeTemporary(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  try {
    await unlink(path);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

/** Maps a failed link(source, archive) to an actionable operator error. Never falls back to copying. */
export function linkFailure(error: unknown, sourcePath: string, archivesDir: string): ArchiveError {
  if (error instanceof ArchiveError) return error;
  if (isErrno(error, "EXDEV")) {
    return new ArchiveError(
      "CROSS_FILESYSTEM",
      `Link publication needs ${sourcePath} and the --out directory (${archivesDir}) on the same filesystem; hard links cannot cross filesystems. Move the source onto the publication volume or use copy mode. Nothing was copied and no manifest was changed.`,
      error,
    );
  }
  if (isErrno(error, "EPERM") || isErrno(error, "ENOTSUP") || isErrno(error, "EOPNOTSUPP") || isErrno(error, "EMLINK")) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
    return new ArchiveError(
      "LINK_UNSUPPORTED",
      `The filesystem refused a hard link from ${sourcePath} into ${archivesDir} (${code}); link publication needs a POSIX filesystem such as ext4 or APFS. Nothing was copied and no manifest was changed.`,
      error,
    );
  }
  return archiveError(error, "Cannot hard-link archive");
}

/** Throws unless `path` is an ordinary file whose device/inode is the opened source. */
async function assertNamesSource(path: string, source: BoundedFileSource): Promise<void> {
  const entry = await lstat(path, { bigint: true });
  if (!entry.isFile() || entry.dev !== source.identity.dev || entry.ino !== source.identity.ino) {
    throw new ArchiveError("INPUT_CHANGED", "The linked archive no longer names the hashed source inode; the link was removed and no manifest was changed.");
  }
}

function linkNotes(sourcePath: string, archivePath: string, fileMode: bigint): string[] {
  const notes = [
    `${archivePath} and ${sourcePath} are hard links to one inode. Published bytes are immutable: remove the original name (or never write to it), because modifying either name changes the published archive and invalidates its sha256.`,
  ];
  if ((fileMode & 0o004n) === 0n) {
    notes.push(`The shared inode has mode ${(fileMode & 0o777n).toString(8)} and is not world-readable; the static server may need read access (e.g. chmod 0644).`);
  }
  return notes;
}

/** Exact archive bytes first; a small manifest is the only replaceable pointer. */
export async function publishArchive(filePath: string, options: PublishOptions): Promise<Publication> {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(options.id)) {
    throw new ArchiveError("INVALID_OPTIONS", "id must be 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.");
  }
  if (!options.outDir.trim()) throw new ArchiveError("INVALID_OPTIONS", "outDir must name the publication directory.");
  const mode = modeOption(options.mode);
  const name = textOption(options.name, "name", 256);
  const style = styleOption(options.style);
  if (mode === "link") {
    let entry;
    try {
      entry = await lstat(resolve(filePath));
    } catch (error) {
      throw archiveError(error, "Cannot open archive");
    }
    if (!entry.isFile()) {
      throw new ArchiveError("INVALID_OPTIONS", "Link publication requires an ordinary file, not a symbolic link or special file; pass the real file path.");
    }
  }
  const source = await BoundedFileSource.open(filePath, options);
  let archiveTemp: string | undefined;
  let manifestTemp: string | undefined;
  let createdLink: string | undefined;
  let output: FileHandle | undefined;
  try {
    const inspection = await inspectSource(source);
    const attributionInput = options.attribution ?? inspection.attribution;
    if (attributionInput === undefined) {
      throw new ArchiveError("INVALID_OPTIONS", "Attribution is missing. Supply --attribution with the data provider's required plain-text credit.");
    }
    const attribution = textOption(attributionInput, "attribution", 4096);
    if (inspection.vectorLayers.length === 0 && style === undefined) {
      throw new ArchiveError("INVALID_OPTIONS", "Archive has no vector layer inventory; supply a compatible --style URL before publication.");
    }
    const root = resolve(options.outDir);
    const archives = join(root, "archives");
    const maps = join(root, "maps");
    await mkdir(archives, { recursive: true });
    await mkdir(maps, { recursive: true });
    let sha256: string;
    let archivePath: string;
    let reusedArchive = false;
    let notes: string[] = [];
    if (mode === "link") {
      // Fail before hashing a planet when a link is impossible anyway.
      if ((await stat(archives, { bigint: true })).dev !== source.identity.dev) {
        throw linkFailure(Object.assign(new Error("source and destination devices differ"), { code: "EXDEV" }), source.filePath, archives);
      }
      sha256 = await transfer(source);
      checkAbort(options.signal);
      archivePath = join(archives, `${sha256}.pmtiles`);
      let sharesInode = true;
      try {
        // Atomic; cannot overwrite a competing publisher's archive.
        await link(source.filePath, archivePath);
        createdLink = archivePath;
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw linkFailure(error, source.filePath, archives);
        const existing = await lstat(archivePath, { bigint: true });
        // The same inode was hashed above; its content check follows. Anything else is verified in full.
        if (!(existing.isFile() && existing.dev === source.identity.dev && existing.ino === source.identity.ino)) {
          await verifyExisting(archivePath, sha256, source.byteSize, options);
          sharesInode = false;
        }
        reusedArchive = true;
      }
      // After the link so a write during hashing or before link() is caught.
      await source.assertContentUnchanged();
      if (sharesInode) {
        await assertNamesSource(archivePath, source);
        notes = linkNotes(source.filePath, archivePath, (await lstat(archivePath, { bigint: true })).mode);
      }
    } else {
      archiveTemp = join(archives, `.publish-${randomUUID()}.tmp`);
      output = await open(archiveTemp, "wx", 0o644);
      sha256 = await transfer(source, output);
      await output.sync();
      await output.close();
      output = undefined;
      checkAbort(options.signal);
      archivePath = join(archives, `${sha256}.pmtiles`);
      try {
        // Hard-link creation is atomic and cannot overwrite a competing publisher.
        await link(archiveTemp, archivePath);
      } catch (error) {
        if (!isErrno(error, "EEXIST")) throw error;
        await verifyExisting(archivePath, sha256, source.byteSize, options);
        reusedArchive = true;
      }
      await removeTemporary(archiveTemp);
      archiveTemp = undefined;
    }
    await syncDirectory(archives);
    const manifest: MapManifest = {
      schemaVersion: 1,
      id: options.id,
      name,
      archive: `../archives/${sha256}.pmtiles`,
      sha256,
      bytes: inspection.bytes,
      tileType: "mvt",
      minZoom: inspection.minZoom,
      maxZoom: inspection.maxZoom,
      bounds: inspection.bounds,
      center: inspection.center,
      vectorLayers: inspection.vectorLayers,
      attribution,
      ...(style === undefined ? {} : { style }),
    };
    const manifestPath = join(maps, `${options.id}.json`);
    manifestTemp = join(maps, `.${options.id}-${randomUUID()}.tmp`);
    output = await open(manifestTemp, "wx", 0o644);
    await output.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await output.sync();
    await output.close();
    output = undefined;
    if (mode === "link") {
      await source.assertContentUnchanged();
      if (createdLink !== undefined) await assertNamesSource(createdLink, source);
    } else {
      await source.assertUnchanged();
    }
    checkAbort(options.signal);
    await rename(manifestTemp, manifestPath);
    manifestTemp = undefined;
    createdLink = undefined;
    await syncDirectory(maps);
    return { mode, manifest, manifestPath, archivePath, reusedArchive, notes };
  } catch (error) {
    throw archiveError(error, "Cannot publish archive");
  } finally {
    await output?.close();
    await source.close();
    await removeTemporary(archiveTemp);
    await removeTemporary(manifestTemp);
    // A link this run created is removed on any failure before the manifest rename.
    await removeTemporary(createdLink);
  }
}
