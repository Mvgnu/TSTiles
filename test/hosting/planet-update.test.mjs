import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { build } from "esbuild";
import test from "node:test";
import { repo, requireNginx, serveSite, stopNginx } from "./harness.mjs";

// Drives ops/planet-update.mjs exactly as docs/hosting.md tells an operator to, against a scratch
// same-filesystem layout served by real nginx (ops/nginx/tstiles-routes.conf), with two small
// archives standing in for two Protomaps daily builds.

const script = join(repo, "ops", "planet-update.mjs");
const FLAVORS = ["light", "dark", "white", "grayscale", "black"];
const IDS = ["planet", ...FLAVORS];
// The Protomaps basemap layer inventory the style CLI requires in a manifest.
const PROTOMAPS_LAYERS = ["boundaries", "buildings", "earth", "landcover", "landuse", "places", "pois", "roads", "water"];

/**
 * A valid PMTiles v3 archive derived from test/fixtures/one-tile.pmtiles: same header fields, root
 * directory and tile bytes, with new gzip metadata naming a build and declaring the Protomaps layer
 * ids. The tile itself still holds only the fixture polygon: this proves digest wiring through
 * publication, styles and manifests, not cartography.
 */
async function derivedArchive(build) {
  const source = await readFile(join(repo, "test", "fixtures", "one-tile.pmtiles"));
  const u64 = (offset) => Number(source.readBigUInt64LE(offset));
  const [rootOffset, rootLength, metaOffset, metaLength, , , dataOffset, dataLength] = [8, 16, 24, 32, 40, 48, 56, 64].map(u64);
  assert.equal(source[97], 2, "fixture metadata is gzip-compressed");
  const metadata = JSON.parse(gunzipSync(source.subarray(metaOffset, metaOffset + metaLength)).toString("utf8"));
  metadata.name = `tstiles planet-update test build ${build}`;
  metadata.version = build;
  metadata.vector_layers = [...metadata.vector_layers, ...PROTOMAPS_LAYERS.map((id) => ({ id, minzoom: 0, maxzoom: 0, fields: {} }))];
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));
  const header = Buffer.from(source.subarray(0, 127));
  const root = source.subarray(rootOffset, rootOffset + rootLength);
  const data = source.subarray(dataOffset, dataOffset + dataLength);
  const newMetaOffset = 127 + root.length;
  const newDataOffset = newMetaOffset + meta.length;
  header.writeBigUInt64LE(127n, 8);
  header.writeBigUInt64LE(BigInt(root.length), 16);
  header.writeBigUInt64LE(BigInt(newMetaOffset), 24);
  header.writeBigUInt64LE(BigInt(meta.length), 32);
  header.writeBigUInt64LE(0n, 40);
  header.writeBigUInt64LE(0n, 48);
  header.writeBigUInt64LE(BigInt(newDataOffset), 56);
  header.writeBigUInt64LE(BigInt(data.length), 64);
  return Buffer.concat([header, root, meta, data]);
}

function operator(env, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolveRun({ code, output }));
  });
}

/** What an operator would see with `jq .archive maps/*.json` and `jq .sources.protomaps.url styles/protomaps/*.json`. */
async function servedDigests(site) {
  const digests = {};
  for (const id of IDS) {
    const manifest = JSON.parse(await readFile(join(site, "maps", `${id}.json`), "utf8"));
    digests[`maps/${id}.json`] = /([a-f0-9]{64})\.pmtiles$/.exec(manifest.archive)?.[1];
    if (id !== "planet") assert.equal(manifest.style, `../styles/protomaps/${id}.json`);
  }
  for (const flavor of FLAVORS) {
    const style = JSON.parse(await readFile(join(site, "styles", "protomaps", `${flavor}.json`), "utf8"));
    digests[`styles/protomaps/${flavor}.json`] = /^pmtiles:\/\/http:\/\/127\.0\.0\.1:\d+\/archives\/([a-f0-9]{64})\.pmtiles$/.exec(style.sources.protomaps.url)?.[1];
  }
  return digests;
}

async function assertAllOn(site, digest, label) {
  const digests = await servedDigests(site);
  for (const [file, value] of Object.entries(digests)) assert.equal(value, digest, `${label}: ${file}`);
}

test("one-planet update, rollback and recovery keep every manifest and style on one archive", { timeout: 120_000 }, async (t) => {
  await requireNginx();
  const root = await mkdtemp(join(tmpdir(), "tstiles-planet-"));
  const site = join(root, "volume", "site");
  const incoming = join(root, "volume", "incoming");
  const snapshots = join(root, "volume", "snapshots");
  const app = join(root, "volume", "app");
  const builds = join(root, "builds");
  let server;
  try {
    // Tooling as built by `npm run build` in APP (bundled here so the scratch APP is self-contained).
    for (const [entry, out] of [["src/archive/cli.ts", "dist/archive/cli.js"], ["src/web/styles-cli.ts", "dist/web/styles-cli.js"]]) {
      await build({ absWorkingDir: repo, entryPoints: [entry], outfile: join(app, out), bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "error",
        banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
    }
    for (const dir of [join(site, "maps"), join(site, "archives"), join(site, "styles", "protomaps"), incoming, builds]) await mkdir(dir, { recursive: true });
    await writeFile(join(site, "index.html"), "<!doctype html><title>fixture</title>");

    const archives = {};
    const list = [];
    for (const date of ["20990101", "20990102"]) {
      const bytes = await derivedArchive(date);
      await writeFile(join(builds, `${date}.pmtiles`), bytes);
      archives[date] = createHash("sha256").update(bytes).digest("hex");
      list.push({ key: `${date}.pmtiles`, size: bytes.length, md5sum: createHash("md5").update(bytes).digest("base64"), version: "test" });
    }
    assert.notEqual(archives["20990101"], archives["20990102"]);
    // A third listed build whose published MD5 does not match its bytes.
    await writeFile(join(builds, "20990103.pmtiles"), await derivedArchive("20990103"));
    list.push({ key: "20990103.pmtiles", size: statSync(join(builds, "20990103.pmtiles")).size, md5sum: "AAAAAAAAAAAAAAAAAAAAAA==", version: "test" });
    // Listed but no longer downloadable, as for Protomaps builds older than about a week.
    list.push({ key: "20990105.pmtiles", size: 546, md5sum: "AAAAAAAAAAAAAAAAAAAAAA==", version: "test" });
    await writeFile(join(builds, "builds.json"), JSON.stringify(list));

    server = await serveSite(join(root, "nginx"), site);
    const env = {
      SITE: site, INCOMING: incoming, SNAPSHOTS: snapshots, APP: app, PUBLIC_BASE: server.base,
      DOWNLOAD_BASE: pathToFileURL(builds).href, BUILDS_URL: pathToFileURL(join(builds, "builds.json")).href, RESERVE_BYTES: "0",
    };
    const A = archives["20990101"];
    const B = archives["20990102"];
    const clean = () => {
      assert.deepEqual(readdirSync(incoming).filter((name) => !name.startsWith(".")), [], "incoming names and staging are removed");
      for (const name of readdirSync(join(site, "archives"))) assert.equal(statSync(join(site, "archives", name)).nlink, 1, `${name} has one name`);
    };
    const snapshotsNamed = (fragment) => readdirSync(snapshots).filter((name) => name.includes(fragment)).sort();

    await t.test("first publication of a build (plan two on an empty site) passes the HTTP checks", async () => {
      const result = await operator(env, ["update", "20990101"]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /Chosen: plan two/);
      assert.match(result.output, /MD5 ok/);
      assert.match(result.output, /HTTP checks against .*: ok/);
      await assertAllOn(site, A, "after first update");
      clean();
    });

    await t.test("a plan-two update with --keep-old moves every manifest and style to the new archive", async () => {
      const result = await operator(env, ["update", "20990102", "--keep-old"]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /Styles swapped[\s\S]*Manifests swapped/, "styles before manifests");
      await assertAllOn(site, B, "after update");
      assert.ok(existsSync(join(site, "archives", `${A}.pmtiles`)), "old archive kept");
      const status = JSON.parse((await operator(env, ["status", "--json"])).output);
      assert.equal(status.build, "20990102");
      assert.deepEqual(status.problems, []);
      clean();
    });

    await t.test("rollback restores styles and manifests together while the old archive exists", async () => {
      const [snapshot] = snapshotsNamed("before-20990102");
      assert.ok(snapshot);
      const result = await operator(env, ["rollback", snapshot]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /HTTP checks against .*: ok/);
      await assertAllOn(site, A, "after rollback");
      assert.equal(snapshotsNamed("before-rollback").length, 1, "rollback is itself snapshotted");
    });

    await t.test("refusals change nothing: outage not accepted, no space, bad MD5, unknown build", async () => {
      const cases = [
        [["update", "20990102", "--plan", "one"], {}, /--allow-outage/],
        [["update", "20990102"], { RESERVE_BYTES: String(Number.MAX_SAFE_INTEGER) }, /Not enough space/],
        [["update", "20990103"], {}, /MD5 mismatch/],
        [["update", "20990104"], {}, /not listed/],
        [["update", "20990105", "--plan", "one", "--allow-outage"], {}, /not downloadable/],
        [["update", "20990101"], {}, /already published/],
      ];
      for (const [args, extra, message] of cases) {
        const result = await operator({ ...env, ...extra }, args);
        assert.notEqual(result.code, 0, args.join(" "));
        assert.match(result.output, message, args.join(" "));
        await assertAllOn(site, A, args.join(" "));
      }
      await rm(join(incoming, "20990103.pmtiles"), { force: true });
      await rm(join(snapshots, snapshotsNamed("before-20990103")[0]), { recursive: true, force: true });
    });

    await t.test("a plan-one update deletes the old archive first, then serves only the new one", async () => {
      const result = await operator(env, ["update", "20990102", "--plan", "one", "--allow-outage"]);
      assert.equal(result.code, 0, result.output);
      assert.match(result.output, /OUTAGE STARTS[\s\S]*OUTAGE ENDS/);
      if (process.env.TSTILES_SHOW_OPERATOR_OUTPUT) t.diagnostic(result.output);
      await assertAllOn(site, B, "after plan one");
      assert.ok(!existsSync(join(site, "archives", `${A}.pmtiles`)), "old archive deleted");
      clean();
    });

    await t.test("rollback to a deleted archive is refused with the re-download path; re-downloading restores it", async () => {
      const snapshot = snapshotsNamed("before-20990102").at(-1);
      const refused = await operator(env, ["rollback", snapshot]);
      assert.notEqual(refused.code, 0);
      assert.match(refused.output, /no longer in[\s\S]*update 20990101 --plan one --allow-outage/);
      await assertAllOn(site, B, "refused rollback changes nothing");
      const restored = await operator(env, ["update", "20990101", "--plan", "one", "--allow-outage"]);
      assert.equal(restored.code, 0, restored.output);
      await assertAllOn(site, A, "after re-download rollback");
      assert.deepEqual(readdirSync(join(site, "archives")), [`${A}.pmtiles`]);
      clean();
    });
  } finally {
    await stopNginx(server);
    await rm(root, { recursive: true, force: true });
  }
});
