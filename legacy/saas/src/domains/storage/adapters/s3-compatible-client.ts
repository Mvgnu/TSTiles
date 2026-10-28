import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { AwsCredentialIdentity } from "@aws-sdk/types";
import type { RuntimeConfig } from "../../../config/types";
import type { ObjectMetadata, RangeReadResult } from "../types";

interface StoredObject {
  readonly data: Uint8Array;
  readonly metadata: Omit<ObjectMetadata, "etag">;
}

export interface KeyValueObjectStoreClient {
  get(key: string, start?: number, end?: number): Promise<RangeReadResult>;
  head(key: string): Promise<ObjectMetadata>;
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<ObjectMetadata>;
}

class MissingObjectError extends Error {
  public readonly code = "ENOENT";

  public constructor(key: string) {
    super(`not found: ${key}`);
    this.name = "MissingObjectError";
  }
}

const etagFromBytes = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex");
};

function buildMissingObjectError(key: string): MissingObjectError {
  return new MissingObjectError(key);
}

export class InMemoryObjectStoreClient {
  private readonly objects = new Map<string, StoredObject>();

  public async get(key: string, start?: number, end?: number): Promise<RangeReadResult> {
    const stored = this.objects.get(key);
    if (!stored) {
      throw buildMissingObjectError(key);
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
      throw buildMissingObjectError(key);
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

function normalizeEtag(value: string | undefined, fallback: Uint8Array): string {
  if (!value || value.trim().length === 0) {
    return etagFromBytes(fallback);
  }
  return value.replaceAll("\"", "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractByteArrayTransformer(value: unknown): (() => Promise<Uint8Array>) | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const transformer = Reflect.get(value, "transformToByteArray");
  if (typeof transformer !== "function") {
    return undefined;
  }
  return transformer.bind(value) as () => Promise<Uint8Array>;
}

function hasAsyncIterator(value: unknown): value is AsyncIterable<Uint8Array | string> {
  if (!isRecord(value)) {
    return false;
  }
  return typeof Reflect.get(value, Symbol.asyncIterator) === "function";
}

async function readBodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body;
  }
  const transformToByteArray = extractByteArrayTransformer(body);
  if (transformToByteArray) {
    return transformToByteArray();
  }
  if (hasAsyncIterator(body)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      if (typeof chunk === "string") {
        chunks.push(new TextEncoder().encode(chunk));
      } else {
        chunks.push(chunk);
      }
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }
  return new Uint8Array();
}

interface ParsedContentRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

function parseContentRange(value: string | undefined): ParsedContentRange | undefined {
  if (!value) {
    return undefined;
  }
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim().toLowerCase());
  if (!match) {
    return undefined;
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || !Number.isFinite(total)
    || start < 0
    || end < start
    || total < end + 1
  ) {
    return undefined;
  }
  return {
    start,
    end,
    total,
  };
}

function buildCredentials(config: RuntimeConfig["storage"]): AwsCredentialIdentity {
  const accessKeyId = config.accessKeyId?.trim();
  const secretAccessKey = config.secretAccessKey?.trim();
  if (!accessKeyId || !secretAccessKey) {
    const missingCredentialsError = new Error("s3 credentials missing");
    Reflect.set(missingCredentialsError, "code", "PRECONDITIONFAILED");
    throw missingCredentialsError;
  }
  return {
    accessKeyId,
    secretAccessKey,
  };
}

export class S3CompatibleObjectStoreClient implements KeyValueObjectStoreClient {
  private readonly client: S3Client;
  private readonly bucketName: string;

  public constructor(config: RuntimeConfig["storage"]) {
    this.bucketName = config.bucketName;
    this.client = new S3Client({
      region: config.region ?? "us-east-1",
      endpoint: config.endpoint,
      forcePathStyle: true,
      credentials: buildCredentials(config),
    });
  }

  public async get(key: string, start?: number, end?: number): Promise<RangeReadResult> {
    const range = start === undefined || end === undefined ? undefined : `bytes=${start}-${end}`;
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Range: range,
    }));
    const bytes = await readBodyBytes(response.Body);
    const parsedContentRange = parseContentRange(response.ContentRange);
    const resolvedStart = parsedContentRange?.start ?? (start ?? 0);
    const resolvedEnd = parsedContentRange?.end ?? (resolvedStart + Math.max(bytes.byteLength - 1, 0));
    const totalBytes = parsedContentRange?.total ?? Number(response.ContentLength ?? bytes.byteLength);
    return {
      key,
      bytes,
      start: resolvedStart,
      end: resolvedEnd,
      totalBytes,
      contentType: response.ContentType ?? "application/octet-stream",
      etag: normalizeEtag(response.ETag, bytes),
    };
  }

  public async head(key: string): Promise<ObjectMetadata> {
    const response = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    }));
    const size = Number(response.ContentLength ?? 0);
    return {
      key,
      size,
      etag: normalizeEtag(response.ETag, new Uint8Array()),
      contentType: response.ContentType ?? "application/octet-stream",
      lastModified: (response.LastModified ?? new Date(0)).toISOString(),
    };
  }

  public async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<ObjectMetadata> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    }));
    return this.head(key);
  }
}
