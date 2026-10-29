/**
 * Fault injection at the filesystem boundary for link publication. This machine
 * has no second writable POSIX filesystem available to the test, so EXDEV and
 * a foreign device are simulated by wrapping node:fs/promises `link`/`stat`;
 * everything else, including the real link(), runs against the real disk.
 */
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import type * as FsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

type LinkFn = (existingPath: string, newPath: string) => Promise<void>;
type StatFn = (path: string, options: { bigint: true }) => Promise<BigIntStats>;

const faults: { link?: (real: LinkFn, from: string, to: string) => Promise<void>; foreignArchivesDevice?: boolean } = {};

vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof FsPromises>();
  const realLink: LinkFn = (from, to) => real.link(from, to);
  return {
    ...real,
    link: (from: string, to: string) => faults.link ? faults.link(realLink, from, to) : real.link(from, to),
    stat: async (...args: Parameters<StatFn>) => {
      const result = await real.stat(...args);
      if (faults.foreignArchivesDevice && basename(String(args[0])) === "archives" && typeof result.dev === "bigint") {
        return Object.assign(Object.create(Object.getPrototypeOf(result) as object) as BigIntStats, result, { dev: result.dev + 1n });
      }
      return result;
    },
  };
});

const { publishArchive } = await import("../../src/archive/index.js");

const fixture = resolve("test/fixtures/one-tile.pmtiles");
const temporary: string[] = [];

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "tstiles-link-"));
  temporary.push(path);
  return path;
}

async function linkableFixture(): Promise<string> {
  const path = join(await workspace(), "planet.pmtiles");
  await copyFile(fixture, path);
  return path;
}

function options(outDir: string) {
  return { outDir, id: "fixture", name: "Fixture map", attribution: "Existing repository test fixture", mode: "link" as const };
}

afterEach(async () => {
  delete faults.link;
  delete faults.foreignArchivesDevice;
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe("link publication faults", () => {
  test("EXDEV from link() fails clearly and never falls back to copying", async () => {
    const source = await linkableFixture();
    const outDir = await workspace();
    faults.link = () => Promise.reject(Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" }));
    const failure = publishArchive(source, options(outDir));
    await expect(failure).rejects.toMatchObject({ code: "CROSS_FILESYSTEM" });
    await expect(failure).rejects.toThrow(/same filesystem/);
    expect(await readdir(join(outDir, "archives"))).toEqual([]);
    expect(await readdir(join(outDir, "maps"))).toEqual([]);
    expect((await stat(source)).nlink).toBe(1);
  });

  test("a foreign destination device is rejected before hashing or linking", async () => {
    const source = await linkableFixture();
    const outDir = await workspace();
    faults.foreignArchivesDevice = true;
    let linkCalls = 0;
    faults.link = (real, from, to) => { linkCalls += 1; return real(from, to); };
    await expect(publishArchive(source, options(outDir))).rejects.toMatchObject({ code: "CROSS_FILESYSTEM" });
    expect(linkCalls).toBe(0);
    expect(await readdir(join(outDir, "archives"))).toEqual([]);
  });

  test("a source rewritten after hashing is caught after link(); the link is removed and the prior manifest kept", async () => {
    const source = await linkableFixture();
    const outDir = await workspace();
    await mkdir(join(outDir, "maps"), { recursive: true });
    const manifestPath = join(outDir, "maps", "fixture.json");
    const previous = '{"previous":"pointer"}\n';
    await writeFile(manifestPath, previous);
    faults.link = async (real, from, to) => {
      await real(from, to);
      // Same-size in-place write. mtime is also moved explicitly so the change
      // is visible on filesystems with coarse timestamp granularity.
      const handle = await open(from, "r+");
      try {
        await handle.write(Buffer.from([0xff]), 0, 1, 300);
      } finally {
        await handle.close();
      }
      const later = new Date(Date.now() + 10_000);
      await utimes(from, later, later);
    };
    await expect(publishArchive(source, { ...options(outDir), name: "Must not replace" }))
      .rejects.toMatchObject({ code: "INPUT_CHANGED" });
    expect(await readFile(manifestPath, "utf8")).toBe(previous);
    expect(await readdir(join(outDir, "archives"))).toEqual([]);
    expect(await readdir(join(outDir, "maps"))).toEqual(["fixture.json"]);
    expect((await stat(source)).nlink).toBe(1);
  });
});
