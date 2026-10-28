import { createHash } from "node:crypto";
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { PMTiles } from "pmtiles";
import { afterEach, describe, expect, test, vi } from "vitest";
import { inspectArchive, publishArchive } from "../../src/archive/index.js";
import { BoundedFileSource } from "../../src/archive/file-source.js";
import { runCli } from "../../src/archive/cli.js";

const fixture = resolve("test/fixtures/one-tile.pmtiles");
const temporary: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "tstiles-archive-"));
  temporary.push(path);
  return path;
}

async function input(bytes: Uint8Array): Promise<string> {
  const path = join(await workspace(), "input.pmtiles");
  await writeFile(path, bytes);
  return path;
}

async function mutatedHeader(mutate: (bytes: Buffer) => void): Promise<string> {
  const bytes = await readFile(fixture);
  mutate(bytes);
  return input(bytes);
}

async function withMetadata(metadata: unknown): Promise<string> {
  const bytes = await readFile(fixture);
  const start = Number(bytes.readBigUInt64LE(24));
  const length = Number(bytes.readBigUInt64LE(32));
  const encoded = gzipSync(JSON.stringify(metadata));
  const prefix = Buffer.from(bytes.subarray(0, start));
  prefix.writeBigUInt64LE(BigInt(encoded.byteLength), 32);
  prefix.writeBigUInt64LE(bytes.readBigUInt64LE(56) + BigInt(encoded.byteLength - length), 56);
  return input(Buffer.concat([prefix, encoded, bytes.subarray(start + length)]));
}

function options(outDir: string) {
  return { outDir, id: "fixture", name: "Fixture map", attribution: "Existing repository test fixture" };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("real PMTiles inspection", () => {
  test("reports actual archive metadata and states the verification limit", async () => {
    const report = await inspectArchive(fixture);
    expect(report).toMatchObject({
      inspection: "header-and-metadata", formatVersion: 3, bytes: 468, tileType: "mvt",
      minZoom: 0, maxZoom: 0, addressedTiles: 1, tileEntries: 1, tileContents: 1,
      vectorLayers: [{ id: "test_fixture_1pmtiles", minzoom: 0, maxzoom: 0, fields: {} }],
    });
    expect(report.warnings.join(" ")).toContain("not fully verified");
  });

  test("official reader decodes the fixture through bounded positional reads", async () => {
    const source = await BoundedFileSource.open(fixture);
    try {
      const archive = new PMTiles(source);
      const tile = await archive.getZxy(0, 0, 0);
      expect(tile).toBeDefined();
      if (tile === undefined) throw new Error("Known fixture tile is missing");
      expect(Buffer.from(tile.data).toString("hex")).toBe(
        "1a2f78020a15746573745f666978747572655f31706d74696c657328802012111803220d099620e81f1a0018150000170f",
      );
      expect(await archive.getZxy(1, 0, 0)).toBeUndefined();
    } finally {
      await source.close();
    }
  });

  test("rejects plain text and truncated archives", async () => {
    await expect(inspectArchive(await input(Buffer.from("hello-ingest")))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
    const bytes = await readFile(fixture);
    await expect(inspectArchive(await input(bytes.subarray(0, bytes.length - 1)))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
  });

  test("rejects wrong magic, unsupported versions and raster archives", async () => {
    for (const [offset, byte] of [[4, 0], [7, 2], [99, 2]]) {
      if (offset === undefined || byte === undefined) throw new Error("Invalid test case");
      const path = await mutatedHeader(bytes => { bytes[offset] = byte; });
      await expect(inspectArchive(path)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" });
    }
  });

  test("rejects compression the browser reader cannot decode", async () => {
    for (const compression of [0, 3, 4]) {
      const path = await mutatedHeader(bytes => { bytes[98] = compression; });
      await expect(inspectArchive(path)).rejects.toMatchObject({ code: "UNSUPPORTED_ARCHIVE" });
    }
  });

  test("rejects overlapping sections, unsafe offsets and invalid zooms", async () => {
    const mutations = [
      (bytes: Buffer) => { bytes.writeBigUInt64LE(127n, 24); },
      (bytes: Buffer) => { bytes.writeBigUInt64LE(2n ** 54n, 56); },
      (bytes: Buffer) => { bytes[101] = 27; },
    ];
    for (const mutate of mutations) {
      await expect(inspectArchive(await mutatedHeader(mutate))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
    }
  });

  test("rejects malformed root directory before allocating entries", async () => {
    const path = await mutatedHeader(bytes => {
      bytes[97] = 1;
      bytes[127] = 127;
    });
    await expect(inspectArchive(path)).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
  });

  test("validates metadata objects and unique vector layer identities", async () => {
    for (const metadata of [[], { vector_layers: 1 }, { vector_layers: [{ id: "roads" }, { id: "roads" }] }, { vector_layers: [{ id: "roads", minzoom: 1.5 }] }]) {
      await expect(inspectArchive(await withMetadata(metadata))).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
    }
  });

  test("bounds decoded metadata, including highly compressible input", async () => {
    const path = await withMetadata({ vector_layers: [{ id: "roads" }], description: "x".repeat(5000) });
    await expect(inspectArchive(path, { maxDecodedBytes: 1024 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  });

  test("rejects oversized reads before allocating and detects input changes", async () => {
    const path = await input(await readFile(fixture));
    const source = await BoundedFileSource.open(path);
    try {
      await expect(source.getBytes(0, 2 ** 40)).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
      await appendFile(path, "changed");
      await expect(source.getBytes(0, 127)).rejects.toMatchObject({ code: "INPUT_CHANGED" });
    } finally {
      await source.close();
    }
  });
});

describe("immutable publication", () => {
  test("publishes byte-for-byte data and reuses only verified matching content", async () => {
    const outDir = await workspace();
    const original = await readFile(fixture);
    const hash = createHash("sha256").update(original).digest("hex");
    const first = await publishArchive(fixture, options(outDir));
    expect(first.reusedArchive).toBe(false);
    expect(first.manifest.archive).toBe(`../archives/${hash}.pmtiles`);
    expect(first.manifest.sha256).toBe(hash);
    expect(await readFile(first.archivePath)).toEqual(original);
    expect(JSON.parse(await readFile(first.manifestPath, "utf8"))).toEqual(first.manifest);
    const second = await publishArchive(fixture, { ...options(outDir), name: "Second site" });
    expect(second.reusedArchive).toBe(true);
    expect(second.archivePath).toBe(first.archivePath);
    expect(JSON.parse(await readFile(second.manifestPath, "utf8")).name).toBe("Second site");
    expect(await readdir(join(outDir, "archives"))).toEqual([`${hash}.pmtiles`]);
    expect(await readdir(join(outDir, "maps"))).toEqual(["fixture.json"]);
  });

  test("a failed replacement preserves the prior manifest and removes temporary files", async () => {
    const outDir = await workspace();
    const first = await publishArchive(fixture, options(outDir));
    const previous = await readFile(first.manifestPath);
    const corrupt = await readFile(first.archivePath);
    corrupt[200] = (corrupt[200] ?? 0) ^ 255;
    await writeFile(first.archivePath, corrupt);
    await expect(publishArchive(fixture, { ...options(outDir), name: "Must not replace" }))
      .rejects.toMatchObject({ code: "DESTINATION_CORRUPT" });
    expect(await readFile(first.manifestPath)).toEqual(previous);
    expect(await readFile(first.archivePath)).toEqual(corrupt);
    expect((await readdir(join(outDir, "archives"))).filter(name => name.endsWith(".tmp"))).toEqual([]);
    expect(await readdir(join(outDir, "maps"))).toEqual(["fixture.json"]);
  });

  test("interrupting a streaming copy leaves the old manifest and archive intact", async () => {
    const outDir = await workspace();
    const first = await publishArchive(fixture, options(outDir));
    const previous = await readFile(first.manifestPath);
    const padded = Buffer.concat([await readFile(fixture), Buffer.alloc(3 * 1024 * 1024)]);
    const path = await input(padded);
    const controller = new AbortController();
    const originalRead = BoundedFileSource.prototype.getBytes;
    vi.spyOn(BoundedFileSource.prototype, "getBytes").mockImplementation(async function (
      this: BoundedFileSource, offset, length, signal, etag,
    ) {
      const result = await originalRead.call(this, offset, length, signal, etag);
      if (length === 1024 * 1024) controller.abort();
      return result;
    });
    await expect(publishArchive(path, { ...options(outDir), signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
    expect(await readFile(first.manifestPath)).toEqual(previous);
    expect(await readFile(first.archivePath)).toEqual(await readFile(fixture));
    expect(await readdir(join(outDir, "archives"))).toEqual([`${first.manifest.sha256}.pmtiles`]);
  });

  test("requires explicit credit when metadata attribution is absent or HTML", async () => {
    const outDir = await workspace();
    await expect(publishArchive(fixture, { outDir, id: "fixture", name: "Fixture" }))
      .rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    const path = await withMetadata({ attribution: '<a href="https://example.com">Data provider</a>', vector_layers: [{ id: "roads" }] });
    const report = await inspectArchive(path);
    expect(report.attribution).toBeUndefined();
    await expect(publishArchive(path, { outDir, id: "html", name: "HTML metadata" })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    const publication = await publishArchive(path, { ...options(outDir), attribution: "Data provider" });
    expect(publication.manifest.attribution).toBe("Data provider");
  });

  test("uses plain metadata attribution and preserves an explicit style URL", async () => {
    const path = await withMetadata({ attribution: "Data provider", vector_layers: [] });
    const outDir = await workspace();
    await expect(publishArchive(path, { outDir, id: "example", name: "Example" })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    const publication = await publishArchive(path, { outDir, id: "example", name: "Example", style: "../styles/region/style.json" });
    expect(publication.manifest.attribution).toBe("Data provider");
    expect(publication.manifest.style).toBe("../styles/region/style.json");
    expect(publication.manifest.vectorLayers).toEqual([]);
  });

  test("rejects path traversal and credential-bearing or executable style URLs", async () => {
    const outDir = await workspace();
    for (const id of ["../escape", "UpperCase", "", "x".repeat(65)]) {
      await expect(publishArchive(fixture, { ...options(outDir), id })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    }
    for (const style of ["javascript:alert(1)", "https://user:password@example.com/style.json", "file:///etc/passwd", "../style with spaces.json"]) {
      await expect(publishArchive(fixture, { ...options(outDir), style })).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    }
    expect(await readdir(outDir)).toEqual([]);
  });

  test("rejects style fragments before changing a prior publication", async () => {
    const outDir = await workspace();
    const first = await publishArchive(fixture, options(outDir));
    const previous = await readFile(first.manifestPath);
    for (const style of ["../styles/map.json#part", "https://example.com/styles/map.json#part"]) {
      await expect(publishArchive(fixture, { ...options(outDir), name: "Must not replace", style }))
        .rejects.toMatchObject({ code: "INVALID_OPTIONS" });
      expect(await readFile(first.manifestPath)).toEqual(previous);
    }
    expect(await readdir(join(outDir, "archives"))).toEqual([`${first.manifest.sha256}.pmtiles`]);
    expect(await readdir(join(outDir, "maps"))).toEqual(["fixture.json"]);
  });
});

describe("CLI boundary", () => {
  test("emits parseable inspection and publication results", async () => {
    expect(JSON.parse(await runCli(["inspect", fixture])).formatVersion).toBe(3);
    const outDir = await workspace();
    const result = JSON.parse(await runCli(["publish", fixture, "--out", outDir, "--id", "cli", "--name", "CLI example", "--attribution", "Fixture"]));
    expect(result.manifest.id).toBe("cli");
    expect(await readFile(result.archivePath)).toEqual(await readFile(fixture));
  });

  test("rejects missing, duplicate and unknown arguments", async () => {
    for (const args of [[], ["inspect", fixture, "extra"], ["publish", fixture], ["publish", fixture, "--out"], ["publish", fixture, "--out", "one", "--out", "two"], ["publish", fixture, "--wat", "x"]]) {
      await expect(runCli(args)).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
    }
  });
});
