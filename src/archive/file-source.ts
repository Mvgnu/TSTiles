import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { resolve } from "node:path";
import type { RangeResponse, Source } from "pmtiles";
import { ArchiveError, archiveError, checkAbort } from "./errors.js";

export const DEFAULT_MAX_READ_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_DECODED_BYTES = 64 * 1024 * 1024;

export interface InspectionOptions {
  readonly maxReadBytes?: number;
  readonly maxDecodedBytes?: number;
  readonly signal?: AbortSignal;
}

export interface InspectionLimits {
  readonly maxReadBytes: number;
  readonly maxDecodedBytes: number;
}

export function inspectionLimits(options: InspectionOptions = {}): InspectionLimits {
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES;
  const maxDecodedBytes = options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
  if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 16_384 || maxReadBytes > 64 * 1024 * 1024) {
    throw new ArchiveError("INVALID_OPTIONS", "maxReadBytes must be an integer between 16 KiB and 64 MiB.");
  }
  if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes < 1024 || maxDecodedBytes > 256 * 1024 * 1024) {
    throw new ArchiveError("INVALID_OPTIONS", "maxDecodedBytes must be an integer between 1 KiB and 256 MiB.");
  }
  return { maxReadBytes, maxDecodedBytes };
}

function sameContent(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs;
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameContent(left, right) && left.ctimeNs === right.ctimeNs;
}

/** Device and inode of the opened file, used to prove a hard link names it. */
export interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
}

/** A stable open file, bounded positional reads, and HTTP-like EOF clipping. */
export class BoundedFileSource implements Source {
  private closed = false;
  public readonly byteSize: number;
  public readonly etag: string;

  private constructor(
    public readonly filePath: string,
    private readonly handle: FileHandle,
    private readonly initial: BigIntStats,
    public readonly limits: InspectionLimits,
    private readonly signal?: AbortSignal,
  ) {
    this.byteSize = Number(initial.size);
    this.etag = `${initial.dev}-${initial.ino}-${initial.size}-${initial.mtimeNs}-${initial.ctimeNs}`;
  }

  public static async open(filePath: string, options: InspectionOptions = {}): Promise<BoundedFileSource> {
    const limits = inspectionLimits(options);
    checkAbort(options.signal);
    let handle: FileHandle | undefined;
    try {
      const path = resolve(filePath);
      handle = await open(path, "r");
      const initial = await handle.stat({ bigint: true });
      if (!initial.isFile()) throw new ArchiveError("INVALID_ARCHIVE", "Input must be a regular local file.");
      if (initial.size <= 0n || initial.size > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new ArchiveError("INVALID_ARCHIVE", "Archive size must be positive and safely addressable.");
      }
      return new BoundedFileSource(path, handle, initial, limits, options.signal);
    } catch (error) {
      await handle?.close();
      throw archiveError(error, "Cannot open archive");
    }
  }

  public getKey(): string {
    return `${this.filePath}:${this.etag}`;
  }

  public get identity(): FileIdentity {
    return { dev: this.initial.dev, ino: this.initial.ino };
  }

  /** Full identity check: device, inode, size, mtime and ctime. */
  public async assertUnchanged(): Promise<void> {
    await this.compare(sameFile);
  }

  /**
   * Device, inode, size and mtime only. Creating a hard link legitimately
   * changes the inode's ctime (link count), so link publication uses this
   * after its own link() call; every read still uses the full check.
   */
  public async assertContentUnchanged(): Promise<void> {
    await this.compare(sameContent);
  }

  private async compare(same: (left: BigIntStats, right: BigIntStats) => boolean): Promise<void> {
    checkAbort(this.signal);
    if (this.closed) throw new ArchiveError("IO_ERROR", "Archive source is closed.");
    try {
      const current = await this.handle.stat({ bigint: true });
      const atPath = await stat(this.filePath, { bigint: true });
      if (!same(this.initial, current) || !same(this.initial, atPath)) {
        throw new ArchiveError("INPUT_CHANGED", "Input changed while being read; retry with an immutable source file.");
      }
    } catch (error) {
      if (error instanceof ArchiveError) throw error;
      throw new ArchiveError("INPUT_CHANGED", "Input is no longer available at its original path.", error);
    }
  }

  public async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    checkAbort(signal);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0
      || !Number.isSafeInteger(offset + length)) {
      throw new ArchiveError("INVALID_ARCHIVE", "Archive requested an invalid byte range.");
    }
    if (length > this.limits.maxReadBytes) {
      throw new ArchiveError("LIMIT_EXCEEDED", `Requested range exceeds ${this.limits.maxReadBytes} bytes; no partial data was returned.`);
    }
    if (offset >= this.byteSize) throw new ArchiveError("INVALID_ARCHIVE", "Archive byte range starts beyond end of file.");
    if (etag !== undefined && etag !== this.etag) throw new ArchiveError("INPUT_CHANGED", "Archive identity changed between reads.");
    await this.assertUnchanged();
    const actualLength = Math.min(length, this.byteSize - offset);
    const bytes = new Uint8Array(actualLength);
    let read = 0;
    try {
      while (read < actualLength) {
        checkAbort(signal);
        checkAbort(this.signal);
        const result = await this.handle.read(bytes, read, actualLength - read, offset + read);
        if (result.bytesRead === 0) throw new ArchiveError("INPUT_CHANGED", "Input was truncated while being read.");
        read += result.bytesRead;
      }
      await this.assertUnchanged();
      return { data: bytes.buffer, etag: this.etag };
    } catch (error) {
      throw archiveError(error, "Cannot read archive range");
    }
  }

  public async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      await this.handle.close();
    }
  }
}
