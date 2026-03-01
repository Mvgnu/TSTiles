import { createHash } from "node:crypto";
import type { ObjectMetadata, RangeReadResult } from "../types";

interface StoredObject {
  readonly data: Uint8Array;
  readonly metadata: Omit<ObjectMetadata, "etag">;
}

const etagFromBytes = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex");
};

export class InMemoryObjectStoreClient {
  private readonly objects = new Map<string, StoredObject>();

  public async get(key: string, start?: number, end?: number): Promise<RangeReadResult> {
    const stored = this.objects.get(key);
    if (!stored) {
      throw new Error(`not found: ${key}`);
    }

    const totalBytes = stored.data.byteLength;
    const resolvedStart = start === undefined ? 0 : start;
    const resolvedEnd = end === undefined ? totalBytes - 1 : end;
    const safeStart = Math.max(0, Math.min(resolvedStart, Math.max(totalBytes - 1, 0)));
    const safeEnd = Math.max(safeStart, Math.min(resolvedEnd, Math.max(totalBytes - 1, 0)));
    const slice = stored.data.slice(safeStart, safeEnd + 1);
    return {
      key,
      bytes: slice,
      start: safeStart,
      end: safeEnd,
      totalBytes,
      contentType: stored.metadata.contentType,
      etag: etagFromBytes(stored.data),
    };
  }

  public async head(key: string): Promise<ObjectMetadata> {
    const stored = this.objects.get(key);
    if (!stored) {
      throw new Error(`not found: ${key}`);
    }
    return {
      ...stored.metadata,
      etag: etagFromBytes(stored.data),
    };
  }

  public async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<ObjectMetadata> {
    const now = new Date().toISOString();
    this.objects.set(key, {
      data: new Uint8Array(bytes),
      metadata: {
        key,
        size: bytes.byteLength,
        contentType,
        lastModified: now,
      },
    });
    return {
      key,
      size: bytes.byteLength,
      contentType,
      lastModified: now,
      etag: etagFromBytes(bytes),
    };
  }

  public async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  public async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }
}
