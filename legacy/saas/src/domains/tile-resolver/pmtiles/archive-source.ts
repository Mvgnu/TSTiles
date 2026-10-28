import { EtagMismatch, PMTiles, TileType, type RangeResponse, type Source } from "pmtiles";
import type { ArtifactVersion } from "../../artifact/types";
import type { ObjectStore } from "../../storage/types";
import type { ResolvedArchiveProfile } from "../types";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

class ObjectStorePmtilesSource implements Source {
  public readonly store: ObjectStore;
  public readonly key: string;

  public constructor(store: ObjectStore, key: string) {
    this.store = store;
    this.key = key;
  }

  public getKey(): string {
    return this.key;
  }

  public async getBytes(offset: number, length: number, _signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const end = offset + Math.max(length, 1) - 1;
    const result = await this.store.getRange({
      key: this.key,
      start: offset,
      end,
    });
    if (etag && result.etag && etag !== result.etag && !etag.startsWith("W/")) {
      throw new EtagMismatch();
    }
    return {
      data: toArrayBuffer(result.bytes),
      etag: result.etag,
    };
  }
}

const archivesByStore = new WeakMap<ObjectStore, Map<string, PMTiles>>();

function getArchive(store: ObjectStore, artifact: ArtifactVersion): PMTiles {
  let storeArchives = archivesByStore.get(store);
  if (!storeArchives) {
    storeArchives = new Map<string, PMTiles>();
    archivesByStore.set(store, storeArchives);
  }
  const existing = storeArchives.get(artifact.key);
  if (existing) {
    return existing;
  }
  const archive = new PMTiles(new ObjectStorePmtilesSource(store, artifact.key));
  storeArchives.set(artifact.key, archive);
  return archive;
}

function resolveTileContentType(tileType: TileType): string {
  if (tileType === TileType.Mvt) {
    return "application/vnd.mapbox-vector-tile";
  }
  if (tileType === TileType.Png) {
    return "image/png";
  }
  if (tileType === TileType.Jpeg) {
    return "image/jpeg";
  }
  if (tileType === TileType.Webp) {
    return "image/webp";
  }
  if (tileType === TileType.Avif) {
    return "image/avif";
  }
  return "application/octet-stream";
}

export async function resolveArchiveTile(
  store: ObjectStore,
  artifact: ArtifactVersion,
  z: number,
  x: number,
  y: number,
): Promise<{
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etagSeed: string;
}> {
  const archive = getArchive(store, artifact);
  const header = await archive.getHeader();
  const tile = await archive.getZxy(z, x, y);
  if (!tile) {
    throw new Error("PMTILES_TILE_NOT_FOUND");
  }
  return {
    bytes: new Uint8Array(tile.data),
    contentType: resolveTileContentType(header.tileType),
    etagSeed: tile.etag ?? header.etag ?? artifact.checksum,
  };
}

export async function resolveArchiveProfile(
  store: ObjectStore,
  artifact: ArtifactVersion,
): Promise<ResolvedArchiveProfile> {
  const archive = getArchive(store, artifact);
  const header = await archive.getHeader();
  return {
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
    center: [header.centerLon, header.centerLat, header.centerZoom],
  };
}
