import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { bytesToHeader, Compression, PMTiles, readVarint, SharedPromiseCache, TileType } from "pmtiles";
import type { BufferPosition, Header } from "pmtiles";
import type { VectorLayer } from "../contract.js";
import { ArchiveError, isErrno } from "./errors.js";
import { BoundedFileSource } from "./file-source.js";
import type { InspectionLimits, InspectionOptions } from "./file-source.js";

const gunzipAsync = promisify(gunzip);
const HEADER_BYTES = 127;

export interface ArchiveInspection {
  readonly inspection: "header-and-metadata";
  readonly formatVersion: 3;
  readonly bytes: number;
  readonly tileType: "mvt";
  readonly internalCompression: "none" | "gzip";
  readonly tileCompression: "none" | "gzip";
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly bounds: readonly [number, number, number, number];
  readonly center: readonly [number, number, number];
  readonly vectorLayers: readonly VectorLayer[];
  readonly addressedTiles: number;
  readonly tileEntries: number;
  readonly tileContents: number;
  readonly attribution?: string;
  readonly warnings: readonly string[];
}

function invalid(message: string): never {
  throw new ArchiveError("INVALID_ARCHIVE", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isZoom(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 26;
}

function isCoordinate(value: number, extent: number): boolean {
  return Number.isFinite(value) && value >= -extent && value <= extent;
}

function compressionName(compression: Compression): "none" | "gzip" {
  if (compression === Compression.None) return "none";
  if (compression === Compression.Gzip) return "gzip";
  throw new ArchiveError("UNSUPPORTED_ARCHIVE", "Only uncompressed or gzip PMTiles sections and tiles are supported by this browser reader.");
}

function validateHeader(header: Header, raw: Uint8Array, bytes: number, limits: InspectionLimits): void {
  if (new TextDecoder().decode(raw.subarray(0, 7)) !== "PMTiles" || header.specVersion !== 3) {
    throw new ArchiveError("UNSUPPORTED_ARCHIVE", "Input must be a PMTiles v3 archive, not OSM, MBTiles, or another file format.");
  }
  if (header.tileType !== TileType.Mvt) {
    throw new ArchiveError("UNSUPPORTED_ARCHIVE", "Only MVT vector PMTiles archives are supported; raster archives need a different viewer.");
  }
  compressionName(header.internalCompression);
  compressionName(header.tileCompression);
  if (raw[96] !== 0 && raw[96] !== 1) invalid("PMTiles clustered flag must be zero or one.");
  if (!isZoom(header.minZoom) || !isZoom(header.maxZoom) || header.minZoom > header.maxZoom || !isZoom(header.centerZoom)) {
    invalid("Archive zooms must be integers from 0 to 26, with minZoom <= maxZoom.");
  }
  if (!isCoordinate(header.minLon, 180) || !isCoordinate(header.maxLon, 180)
    || !isCoordinate(header.minLat, 90) || !isCoordinate(header.maxLat, 90)
    || header.minLon > header.maxLon || header.minLat > header.maxLat
    || !isCoordinate(header.centerLon, 180) || !isCoordinate(header.centerLat, 90)) {
    invalid("Archive bounds or center contain invalid longitude/latitude values.");
  }
  const counts = [header.numAddressedTiles, header.numTileEntries, header.numTileContents];
  if (counts.some(value => !Number.isSafeInteger(value) || value <= 0)
    || header.numTileContents > header.numTileEntries || header.numTileEntries > header.numAddressedTiles) {
    invalid("Archive tile counts must be positive safe integers with contents <= entries <= addressed tiles.");
  }
  const sections = [
    { name: "root directory", offset: header.rootDirectoryOffset, length: header.rootDirectoryLength },
    { name: "JSON metadata", offset: header.jsonMetadataOffset, length: header.jsonMetadataLength },
    { name: "leaf directories", offset: header.leafDirectoryOffset, length: header.leafDirectoryLength ?? 0 },
    { name: "tile data", offset: header.tileDataOffset, length: header.tileDataLength ?? 0 },
  ];
  for (const section of sections) {
    if (!Number.isSafeInteger(section.offset) || section.offset < 0
      || !Number.isSafeInteger(section.length) || section.length < 0
      || !Number.isSafeInteger(section.offset + section.length)
      || section.offset + section.length > bytes
      || (section.length > 0 && section.offset < HEADER_BYTES)) {
      invalid(`Declared ${section.name} section falls outside the archive.`);
    }
    if (section.name !== "leaf directories" && section.length === 0) invalid(`Archive ${section.name} section is empty.`);
  }
  const ordered = sections.filter(section => section.length > 0).sort((left, right) => left.offset - right.offset);
  let previousEnd = HEADER_BYTES;
  for (const section of ordered) {
    if (section.offset < previousEnd) invalid(`Archive ${section.name} section overlaps another section.`);
    previousEnd = section.offset + section.length;
  }
  if (header.rootDirectoryOffset + header.rootDirectoryLength > 16_384) {
    invalid("PMTiles v3 root directory must fit in the first 16 KiB.");
  }
  if (header.jsonMetadataLength > limits.maxReadBytes) {
    throw new ArchiveError("LIMIT_EXCEEDED", `Compressed JSON metadata exceeds the ${limits.maxReadBytes}-byte read limit.`);
  }
}

async function decompressBounded(data: ArrayBuffer, compression: Compression, maxDecodedBytes: number): Promise<ArrayBuffer> {
  compressionName(compression);
  if (compression === Compression.None) {
    if (data.byteLength > maxDecodedBytes) throw new ArchiveError("LIMIT_EXCEEDED", "Uncompressed section exceeds the decoded-byte limit.");
    return data;
  }
  try {
    const result = await gunzipAsync(Buffer.from(data), { maxOutputLength: maxDecodedBytes });
    return Uint8Array.from(result).buffer;
  } catch (error) {
    if (isErrno(error, "ERR_BUFFER_TOO_LARGE")) {
      throw new ArchiveError("LIMIT_EXCEEDED", `Decoded section exceeds ${maxDecodedBytes} bytes.`, error);
    }
    throw new ArchiveError("INVALID_ARCHIVE", "A gzip-compressed archive section is invalid or truncated.", error);
  }
}

function nextVarint(position: BufferPosition): number {
  let terminated = false;
  for (let index = position.pos; index < Math.min(position.pos + 10, position.buf.length); index++) {
    const byte = position.buf[index];
    if (byte !== undefined && byte < 128) {
      terminated = true;
      break;
    }
  }
  if (!terminated) invalid("Archive directory contains a truncated or oversized integer.");
  const value = readVarint(position);
  if (!Number.isSafeInteger(value) || value < 0) invalid("Archive directory contains an unsafe integer.");
  return value;
}

/** Bound entry allocation before the maintained parser reads the directory. */
function validateDirectoryEncoding(data: ArrayBuffer): void {
  const position: BufferPosition = { buf: new Uint8Array(data), pos: 0 };
  const count = nextVarint(position);
  if (count === 0 || count > 100_000 || count > Math.floor((data.byteLength - position.pos) / 4)) {
    invalid("Archive root directory has an invalid or excessive entry count.");
  }
  let tileId = 0;
  for (let index = 0; index < count; index++) {
    const delta = nextVarint(position);
    tileId += delta;
    if (!Number.isSafeInteger(tileId) || (index > 0 && delta === 0)) invalid("Archive directory tile IDs are invalid.");
  }
  for (let index = 0; index < count; index++) nextVarint(position);
  for (let index = 0; index < count; index++) {
    if (nextVarint(position) === 0) invalid("Archive directory contains an empty entry.");
  }
  for (let index = 0; index < count; index++) {
    if (nextVarint(position) === 0 && index === 0) invalid("Archive directory starts with an invalid relative offset.");
  }
  if (position.pos !== data.byteLength) invalid("Archive directory has trailing or incomplete encoded data.");
}

function optionalLayerZoom(layer: Record<string, unknown>, name: "minzoom" | "maxzoom"): number | undefined {
  const value = layer[name];
  if (value === undefined) return undefined;
  if (!isZoom(value)) invalid(`Vector layer ${name} must be an integer from 0 to 26.`);
  return value;
}

function parseLayers(metadata: Record<string, unknown>): VectorLayer[] {
  if (metadata.vector_layers === undefined) return [];
  if (!Array.isArray(metadata.vector_layers) || metadata.vector_layers.length > 4096) {
    invalid("vector_layers metadata must be an array with no more than 4096 entries.");
  }
  const ids = new Set<string>();
  return metadata.vector_layers.map((value: unknown): VectorLayer => {
    if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim() || value.id.length > 256) {
      invalid("Every vector layer must have a nonempty string ID of at most 256 characters.");
    }
    if (ids.has(value.id)) invalid("Vector layer IDs must be unique.");
    ids.add(value.id);
    const minzoom = optionalLayerZoom(value, "minzoom");
    const maxzoom = optionalLayerZoom(value, "maxzoom");
    if (minzoom !== undefined && maxzoom !== undefined && minzoom > maxzoom) invalid("Vector layer minzoom exceeds maxzoom.");
    if (value.description !== undefined && typeof value.description !== "string") invalid("Vector layer description must be a string.");
    let fields: Readonly<Record<string, string>> | undefined;
    if (value.fields !== undefined) {
      if (!isRecord(value.fields) || Object.values(value.fields).some(field => typeof field !== "string")) {
        invalid("Vector layer fields must map field names to string type descriptions.");
      }
      const entries: [string, string][] = [];
      for (const [key, field] of Object.entries(value.fields)) {
        if (typeof field === "string") entries.push([key, field]);
      }
      fields = Object.fromEntries(entries);
    }
    return {
      id: value.id,
      ...(minzoom === undefined ? {} : { minzoom }),
      ...(maxzoom === undefined ? {} : { maxzoom }),
      ...(value.description === undefined ? {} : { description: value.description }),
      ...(fields === undefined ? {} : { fields }),
    };
  });
}

export function isPlainText(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "<" || character === ">" || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return false;
  }
  return true;
}

export async function inspectSource(source: BoundedFileSource): Promise<ArchiveInspection> {
  if (source.byteSize < HEADER_BYTES) invalid("Input is shorter than the 127-byte PMTiles v3 header.");
  try {
    const raw = await source.getBytes(0, HEADER_BYTES);
    if (new TextDecoder().decode(new Uint8Array(raw.data, 0, 7)) !== "PMTiles" || new Uint8Array(raw.data)[7] !== 3) {
      throw new ArchiveError("UNSUPPORTED_ARCHIVE", "Input must be a PMTiles v3 archive; no OSM or MBTiles conversion is performed.");
    }
    const header = bytesToHeader(raw.data, source.etag);
    validateHeader(header, new Uint8Array(raw.data), source.byteSize, source.limits);
    const decompress = (data: ArrayBuffer, compression: Compression) =>
      decompressBounded(data, compression, source.limits.maxDecodedBytes);
    const directoryDecompress = async (data: ArrayBuffer, compression: Compression): Promise<ArrayBuffer> => {
      const decoded = await decompress(data, compression);
      validateDirectoryEncoding(decoded);
      return decoded;
    };
    const archive = new PMTiles(source, new SharedPromiseCache(16, true, directoryDecompress), decompress);
    await archive.getHeader();
    const metadata = await archive.getMetadata();
    if (!isRecord(metadata)) invalid("PMTiles JSON metadata must be an object.");
    const vectorLayers = parseLayers(metadata);
    const warnings = [
      "Header, declared section bounds, root directory encoding and JSON metadata were inspected. Leaf directories and tile payloads were not fully verified.",
      "Layer metadata cannot establish cartographic quality or compatibility with a supplied style.",
    ];
    if (vectorLayers.length === 0) warnings.push("No vector layer inventory is present; publication requires an explicit compatible style.");
    let attribution: string | undefined;
    if (metadata.attribution !== undefined) {
      if (typeof metadata.attribution !== "string") invalid("Archive attribution metadata must be a string.");
      const text = metadata.attribution.trim();
      if (text && text.length <= 4096 && isPlainText(text)) attribution = text;
      else warnings.push("Archive attribution is empty, too long, or contains HTML; supply plain-text --attribution when publishing.");
    }
    await source.assertUnchanged();
    return {
      inspection: "header-and-metadata",
      formatVersion: 3,
      bytes: source.byteSize,
      tileType: "mvt",
      internalCompression: compressionName(header.internalCompression),
      tileCompression: compressionName(header.tileCompression),
      minZoom: header.minZoom,
      maxZoom: header.maxZoom,
      bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
      center: [header.centerLon, header.centerLat, header.centerZoom],
      vectorLayers,
      addressedTiles: header.numAddressedTiles,
      tileEntries: header.numTileEntries,
      tileContents: header.numTileContents,
      ...(attribution === undefined ? {} : { attribution }),
      warnings,
    };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("INVALID_ARCHIVE", "PMTiles header, root directory or JSON metadata could not be decoded.", error);
  }
}

export async function inspectArchive(filePath: string, options: InspectionOptions = {}): Promise<ArchiveInspection> {
  const source = await BoundedFileSource.open(filePath, options);
  try {
    return await inspectSource(source);
  } finally {
    await source.close();
  }
}
