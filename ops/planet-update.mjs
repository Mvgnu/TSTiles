#!/usr/bin/env node
// TSTiles one-planet operator script: snapshot, update, rollback and status for a host whose
// publication volume holds one Protomaps planet (itstiles.com: /mnt/tstiles, 147 GB, ~139 GB archive).
//
//   node ops/planet-update.mjs status [--offline] [--json]
//   node ops/planet-update.mjs snapshot [label]
//   node ops/planet-update.mjs update <YYYYMMDD> [--plan auto|two|one] [--allow-outage] [--keep-old] [--dry-run] [--offline]
//   node ops/planet-update.mjs rollback <snapshot> [--offline]
//   (--offline skips the HTTP checks against PUBLIC_BASE; the on-disk checks always run)
//
// Environment (defaults are the itstiles.com layout):
//   SITE=/mnt/tstiles/site            published tree served by nginx
//   INCOMING=/mnt/tstiles/incoming    downloads and staging; must be on SITE's filesystem
//   SNAPSHOTS=/mnt/tstiles/snapshots  small copies of maps/*.json and styles/protomaps/*.json
//   APP=/mnt/tstiles/app              TSTiles checkout with built dist/archive/cli.js, dist/web/styles-cli.js
//   PUBLIC_BASE=https://itstiles.com  public origin of SITE (http:// only for localhost)
//   BASE_ID=planet                    unstyled manifest id
//   FLAVORS="light dark white grayscale black"   one styled manifest + style per flavor
//   (the manifest ids are BASE_ID followed by FLAVORS)
//   DOWNLOAD_BASE=https://build.protomaps.com     <date>.pmtiles is fetched from here
//   BUILDS_URL=https://build-metadata.protomaps.dev/builds.json   size + base64 md5sum per build
//   RESERVE_BYTES=2147483648          free space that must remain after the new archive is in place
//   ATTRIBUTION="Protomaps © OpenStreetMap contributors"
//
// Ordering is always: archive (hard link in SITE/archives) -> styles -> manifests. Manifests and
// styles are prepared in INCOMING/stage-<date>/ and renamed into SITE (atomic per file) only after
// every publication and the style build succeeded. No step copies archive bytes.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { copyFile, link, mkdir, readFile, readdir, rename, rm, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const env = process.env;
const SITE = resolve(env.SITE || "/mnt/tstiles/site");
const INCOMING = resolve(env.INCOMING || "/mnt/tstiles/incoming");
const SNAPSHOTS = resolve(env.SNAPSHOTS || "/mnt/tstiles/snapshots");
const APP = resolve(env.APP || "/mnt/tstiles/app");
const PUBLIC_BASE = (env.PUBLIC_BASE || "https://itstiles.com").replace(/\/+$/, "");
const BASE_ID = env.BASE_ID || "planet";
const FLAVORS = (env.FLAVORS ?? "light dark white grayscale black").split(/[\s,]+/).filter(Boolean);
const IDS = [BASE_ID, ...FLAVORS];
const DOWNLOAD_BASE = (env.DOWNLOAD_BASE || "https://build.protomaps.com").replace(/\/+$/, "");
const BUILDS_URL = env.BUILDS_URL || "https://build-metadata.protomaps.dev/builds.json";
const RESERVE_BYTES = Number(env.RESERVE_BYTES ?? 2 * 1024 ** 3);
const ATTRIBUTION = env.ATTRIBUTION || "Protomaps © OpenStreetMap contributors";
// Real paths: the archive CLI only runs when argv[1] equals its own resolved module path.
const APP_REAL = existsSync(APP) ? realpathSync(APP) : APP;
const ARCHIVE_CLI = join(APP_REAL, "dist", "archive", "cli.js");
const STYLES_CLI = join(APP_REAL, "dist", "web", "styles-cli.js");
const MAPS = join(SITE, "maps");
const STYLES = join(SITE, "styles", "protomaps");
const ARCHIVES = join(SITE, "archives");
const DIGEST = /([a-f0-9]{64})\.pmtiles$/;

class OperatorError extends Error {}
const fail = (message) => { throw new OperatorError(message); };
const log = (message) => console.log(message);
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

function usage() {
  return readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 30).map((line) => line.replace(/^\/\/ ?/, "")).join("\n");
}

function parseFlags(args, allowed) {
  const flags = { positional: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) { flags.positional.push(arg); continue; }
    const name = arg.slice(2);
    if (!allowed.includes(name)) fail(`Unknown option ${arg}.\n\n${usage()}`);
    if (name === "plan") {
      const value = args[++index];
      if (!["auto", "two", "one"].includes(value)) fail("--plan takes auto, two or one.");
      flags.plan = value;
    } else {
      flags[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    }
  }
  return flags;
}

function run(command, args, { quiet = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", quiet ? "pipe" : "inherit", "inherit"] });
    let stdout = "";
    if (quiet) child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => reject(new OperatorError(`Cannot run ${command}: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolveRun(stdout) : reject(new OperatorError(`${command} ${args[0] ?? ""} exited with ${code}.`)));
  });
}

async function node(script, args) {
  const stdout = await run(process.execPath, [script, ...args], { quiet: true });
  if (!stdout.trim()) fail(`${script} printed nothing; is APP a built TSTiles checkout?`);
  return stdout;
}

function hasCommand(name) {
  return (env.PATH || "").split(":").some((dir) => dir && existsSync(join(dir, name)));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function digestOf(url) {
  const match = typeof url === "string" ? DIGEST.exec(url) : null;
  return match ? match[1] : null;
}

async function jsonFiles(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort();
}

/** What every manifest and style on disk points at. */
async function inventory() {
  const manifests = {};
  for (const name of await jsonFiles(MAPS)) {
    const manifest = await readJson(join(MAPS, name));
    manifests[name.slice(0, -5)] = { archive: manifest.archive, digest: digestOf(manifest.archive), name: manifest.name, style: manifest.style };
  }
  const styles = {};
  for (const name of await jsonFiles(STYLES)) {
    const style = await readJson(join(STYLES, name));
    const url = style?.sources?.protomaps?.url;
    styles[name.slice(0, -5)] = { url, digest: digestOf(url) };
  }
  const referenced = new Set([...Object.values(manifests), ...Object.values(styles)].map((entry) => entry.digest).filter(Boolean));
  const archives = {};
  for (const digest of referenced) {
    const path = join(ARCHIVES, `${digest}.pmtiles`);
    const info = existsSync(path) ? statSync(path) : null;
    archives[digest] = info ? { present: true, bytes: info.size, links: info.nlink } : { present: false };
  }
  return { manifests, styles, referenced, archives };
}

async function currentBuild(inv) {
  const statePath = join(SNAPSHOTS, "current.json");
  if (existsSync(statePath)) {
    const state = await readJson(statePath);
    if (state.sha256 && inv.manifests[BASE_ID]?.digest === state.sha256) return state.build;
  }
  return /(\d{8})/.exec(inv.manifests[BASE_ID]?.name ?? "")?.[1] ?? null;
}

async function freeBytes(path) {
  const info = await statfs(path);
  return Number(info.bavail) * Number(info.bsize);
}

async function fetchText(url) {
  if (url.startsWith("file://")) return readFile(new URL(url), "utf8");
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) fail(`${url} answered ${response.status}.`);
  return response.text();
}

async function buildInfo(date) {
  let builds;
  try {
    builds = JSON.parse(await fetchText(BUILDS_URL));
  } catch (error) {
    fail(`Cannot read the build list ${BUILDS_URL} (${error.message}). The size and MD5 come from there; refusing to download unverified bytes.`);
  }
  const entry = Array.isArray(builds) ? builds.find((build) => build.key === `${date}.pmtiles`) : undefined;
  if (!entry) fail(`${date}.pmtiles is not listed in ${BUILDS_URL}. Protomaps keeps daily builds for a limited time; pick a listed date.`);
  if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || typeof entry.md5sum !== "string") fail(`The build list entry for ${date} has no usable size/md5sum.`);
  return { size: entry.size, md5: entry.md5sum, version: entry.version };
}

async function md5Base64(path) {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(path, { highWaterMark: 8 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest("base64");
}

async function snapshot(label) {
  const inv = await inventory();
  let name = `${stamp()}-${(label || "manual").replace(/[^a-zA-Z0-9_.-]/g, "-")}`;
  if (existsSync(join(SNAPSHOTS, name))) name = `${name}-${process.pid}`;
  const dir = join(SNAPSHOTS, name);
  await mkdir(join(dir, "maps"), { recursive: true });
  await mkdir(join(dir, "styles", "protomaps"), { recursive: true });
  for (const file of await jsonFiles(MAPS)) await copyFile(join(MAPS, file), join(dir, "maps", file));
  for (const file of await jsonFiles(STYLES)) await copyFile(join(STYLES, file), join(dir, "styles", "protomaps", file));
  const record = {
    created: new Date().toISOString(),
    label: label || "manual",
    build: await currentBuild(inv),
    archives: Object.fromEntries([...inv.referenced].map((digest) => [digest, inv.archives[digest]])),
  };
  await writeFile(join(dir, "snapshot.json"), `${JSON.stringify(record, null, 2)}\n`);
  log(`Snapshot ${name}: ${(await jsonFiles(join(dir, "maps"))).length} manifests, ${(await jsonFiles(join(dir, "styles", "protomaps"))).length} styles -> ${dir}`);
  return name;
}

async function renameInto(sourceDir, file, targetDir) {
  await mkdir(targetDir, { recursive: true });
  await rename(join(sourceDir, file), join(targetDir, file));
}

async function replaceFrom(sourceDir, file, targetDir) {
  // Copy next to the target first so the final step is one same-directory atomic rename.
  await mkdir(targetDir, { recursive: true });
  const temp = join(targetDir, `.${file}.restore-${process.pid}`);
  await copyFile(join(sourceDir, file), temp);
  await rename(temp, join(targetDir, file));
}

async function withLock(action) {
  await mkdir(INCOMING, { recursive: true });
  const lock = join(INCOMING, ".planet-update.lock");
  try {
    await mkdir(lock);
  } catch {
    fail(`${lock} exists: another update/rollback is running, or one crashed. Check, then remove that directory.`);
  }
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function download(url, target, size) {
  if (existsSync(target) && statSync(target).size === size && !existsSync(`${target}.aria2`)) {
    log(`Download already complete: ${target}`);
    return;
  }
  log(`Downloading ${url} -> ${target} (${gib(size)})`);
  if (/^https?:/.test(url) && hasCommand("aria2c")) {
    await run("aria2c", ["--continue=true", "--max-connection-per-server=8", "--split=8", "--min-split-size=64M",
      "--file-allocation=falloc", "--auto-file-renaming=false", "--allow-overwrite=false", "--summary-interval=60",
      "--console-log-level=warn", "-d", INCOMING, "-o", basename(target), url]);
  } else {
    await run("curl", ["--fail", "--location", "--silent", "--show-error", "--retry", "5", "--continue-at", "-", "--output", target, url]);
  }
}

async function update(args) {
  const flags = parseFlags(args, ["plan", "allow-outage", "keep-old", "dry-run", "offline"]);
  const date = flags.positional[0];
  if (!/^\d{8}$/.test(date ?? "") || flags.positional.length !== 1) fail(`update needs one build date YYYYMMDD.\n\n${usage()}`);
  for (const path of [ARCHIVE_CLI, STYLES_CLI]) if (!existsSync(path)) fail(`${path} is missing. Build the tooling in APP (npm ci && npm run build).`);
  for (const path of [MAPS, ARCHIVES]) if (!existsSync(path)) fail(`${path} does not exist; SITE must be a published TSTiles tree.`);
  await mkdir(INCOMING, { recursive: true });
  if (statSync(INCOMING).dev !== statSync(ARCHIVES).dev) fail(`${INCOMING} and ${ARCHIVES} are on different filesystems; link publication cannot work. Put INCOMING on the publication volume.`);

  const before = await inventory();
  const build = await buildInfo(date);
  // builds.json lists builds that are no longer downloadable; plan one must not delete first and
  // discover that afterwards.
  const url = `${DOWNLOAD_BASE}/${date}.pmtiles`;
  const offered = url.startsWith("file://")
    ? (existsSync(new URL(url)) ? statSync(new URL(url)).size : null)
    : await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30_000) })
      .then((response) => response.ok ? Number(response.headers.get("content-length")) : null, () => null);
  if (offered !== build.size) fail(`${url} is not downloadable with the listed size (${offered ?? "unavailable"} vs ${build.size}). Protomaps removes daily builds after about a week; pick a recent date.`);
  const current = await currentBuild(before);
  if (current === date) fail(`Build ${date} is already published (${BASE_ID}.json). Nothing to do.`);
  const old = [...before.referenced];
  const oldFreed = old.reduce((sum, digest) => {
    const archive = before.archives[digest];
    return sum + (archive.present && archive.links === 1 ? archive.bytes : 0);
  }, 0);
  const free = await freeBytes(ARCHIVES);
  const partial = existsSync(join(INCOMING, `${date}.pmtiles`)) ? statSync(join(INCOMING, `${date}.pmtiles`)).size : 0;
  const need = build.size - partial + RESERVE_BYTES;
  const fitsTwo = free >= need;
  const fitsOne = free + oldFreed >= need;
  const plan = flags.plan === "one" || (flags.plan !== "two" && !fitsTwo) ? "one" : "two";

  log(`Build ${date}: ${gib(build.size)}, schema ${build.version ?? "?"}; current build ${current ?? "unknown"}.`);
  log(`Free on ${ARCHIVES}: ${gib(free)}; needed: ${gib(need)} (archive${partial ? " remainder" : ""} + RESERVE_BYTES ${gib(RESERVE_BYTES)}); deleting the current archive frees ${gib(oldFreed)}.`);
  log("Plan two (room for two archives): download alongside, publish, swap styles+manifests, then delete the old archive. No downtime.");
  log("Plan one (one planet): snapshot, DELETE the old archive, download, verify, publish, swap. The map is DOWN from the deletion until the swap: download + MD5 + one sha256 pass per manifest id.");
  if (plan === "two" && !fitsTwo) fail("Plan two was requested but there is not room for two archives.");
  if (plan === "one" && !fitsOne) fail(`Not enough space even after deleting the current archive (${gib(free + oldFreed)} < ${gib(need)}). Grow the volume.`);
  log(`Chosen: plan ${plan}.`);
  const others = Object.entries(before.manifests).filter(([id, entry]) => !IDS.includes(id) && old.includes(entry.digest)).map(([id]) => id);
  if (others.length) log(`Warning: unmanaged manifests ${others.join(", ")} also use the current archive and are not republished.`);
  if (plan === "one" && !flags.allowOutage) fail("Plan one deletes the live archive first and takes the map offline. Re-run with --allow-outage to accept that.");
  if (flags.dryRun) { log("Dry run: nothing changed."); return; }

  await withLock(async () => {
    const snap = await snapshot(`before-${date}`);
    const source = join(INCOMING, `${date}.pmtiles`);
    const stage = join(INCOMING, `stage-${date}`);
    let outage = false;
    try {
      if (plan === "one") {
        for (const digest of old) {
          if (before.archives[digest].present) {
            await unlink(join(ARCHIVES, `${digest}.pmtiles`));
            log(`Deleted ${digest}.pmtiles. OUTAGE STARTS ${new Date().toISOString()}.`);
            outage = true;
          }
        }
      }
      await download(`${DOWNLOAD_BASE}/${date}.pmtiles`, source, build.size);
      const size = statSync(source).size;
      if (size !== build.size) fail(`${source} has ${size} bytes; the build list says ${build.size}. Re-run to resume, or delete it.`);
      log("Verifying MD5 against the build list...");
      const md5 = await md5Base64(source);
      if (md5 !== build.md5) fail(`MD5 mismatch for ${source}: ${md5} != ${build.md5}. Delete the file and re-run.`);
      log(`MD5 ok (${md5}).`);

      await rm(stage, { recursive: true, force: true });
      const publish = async (id, name, style) => JSON.parse(await node(ARCHIVE_CLI, ["publish", source, "--out", stage, "--id", id,
        "--name", name, "--attribution", ATTRIBUTION, ...(style ? ["--style", style] : []), "--link"]));
      log(`Publishing ${BASE_ID} (hashes the archive in place)...`);
      const base = await publish(BASE_ID, `${env.BASE_NAME || "Planet"} (Protomaps ${date})`);
      const digest = digestOf(base.archivePath) ?? digestOf(base.manifest?.archive);
      if (!digest) fail("Could not read the new archive digest from the publication result.");
      // 1. Archive: second hard link in the served tree (same inode; no bytes copied).
      const served = join(ARCHIVES, `${digest}.pmtiles`);
      if (existsSync(served)) {
        // Same digest name already served (e.g. kept by --keep-old): its bytes were verified when it
        // was published. Keep it; the downloaded name is removed below.
        if (statSync(served).size !== size) fail(`${served} exists with a different size. Quarantine it first.`);
        log(`Archive ${digest} was already published; reusing it.`);
      } else {
        await link(join(stage, "archives", `${digest}.pmtiles`), served);
      }
      log(`Archive in place: ${served}`);
      // 2. Styles, generated from the staged base manifest at its public URL.
      await node(STYLES_CLI, ["--manifest", join(stage, "maps", `${BASE_ID}.json`), "--manifest-public-url", `${PUBLIC_BASE}/maps/${BASE_ID}.json`,
        "--assets-base", `${PUBLIC_BASE}/styles`, "--out", join(stage, "styles", "protomaps"), ...(FLAVORS.length ? ["--flavors", FLAVORS.join(",")] : [])]);
      for (const flavor of FLAVORS) {
        log(`Publishing ${flavor}...`);
        const name = before.manifests[flavor]?.name ?? `${env.BASE_NAME || "Planet"} · Protomaps ${flavor[0].toUpperCase()}${flavor.slice(1)}`;
        await publish(flavor, name, `../styles/protomaps/${flavor}.json`);
      }
      for (const file of await jsonFiles(join(stage, "styles", "protomaps"))) await renameInto(join(stage, "styles", "protomaps"), file, STYLES);
      log(`Styles swapped: ${FLAVORS.join(", ") || "none"}.`);
      // 3. Manifests last.
      for (const id of [...FLAVORS, BASE_ID]) await renameInto(join(stage, "maps"), `${id}.json`, MAPS);
      log(`Manifests swapped: ${[...FLAVORS, BASE_ID].join(", ")}.${outage ? ` OUTAGE ENDS ${new Date().toISOString()}.` : ""}`);
      outage = false;
      await writeFile(join(SNAPSHOTS, "current.json"), `${JSON.stringify({ build: date, sha256: digest, updated: new Date().toISOString() }, null, 2)}\n`);

      await rm(stage, { recursive: true, force: true });
      await unlink(source);
      if (plan === "two") {
        const after = await inventory();
        for (const previous of old) {
          if (previous === digest || after.referenced.has(previous)) continue;
          if (flags.keepOld) { log(`Kept old archive ${previous}.pmtiles (--keep-old); rollback to ${snap} stays instant.`); continue; }
          await rm(join(ARCHIVES, `${previous}.pmtiles`), { force: true });
          log(`Deleted old archive ${previous}.pmtiles. Rollback to ${snap} now needs those bytes again.`);
        }
      }
    } catch (error) {
      if (outage) {
        console.error(`\nTHE MAP IS DOWN: the old archive is deleted and the manifests still point to it.\nFix the cause and re-run \`update ${date} --plan one --allow-outage\` (the download resumes), or update to another listed build.`);
      } else {
        console.error(`\nNo manifest or style was changed (snapshot ${snap}). Staging is in ${stage}.`);
      }
      throw error;
    }
  });
  await status(flags.offline ? ["--offline"] : []);
}

async function rollback(args) {
  const flags = parseFlags(args, ["offline"]);
  const name = flags.positional[0];
  if (!name || flags.positional.length !== 1) fail(`rollback needs one snapshot name (see status).\n\n${usage()}`);
  const dir = join(SNAPSHOTS, basename(name));
  if (!existsSync(join(dir, "snapshot.json"))) fail(`${dir} is not a snapshot.`);
  const record = await readJson(join(dir, "snapshot.json"));
  const missing = Object.keys(record.archives).filter((digest) => !existsSync(join(ARCHIVES, `${digest}.pmtiles`)));
  if (missing.length) {
    fail(`Snapshot ${name} uses archive ${missing.join(", ")}, which is no longer in ${ARCHIVES}.\n`
      + "Restoring manifests/styles alone would break every map. Data rollback needs the old bytes:\n"
      + `  - re-download build ${record.build ?? "(unknown date)"} while Protomaps still lists it in ${BUILDS_URL}:\n`
      + `      node ops/planet-update.mjs update ${record.build ?? "<YYYYMMDD>"} --plan one --allow-outage   (same outage as an update)\n`
      + "  - or link it back from a second volume/backup on this filesystem, then re-run rollback.");
  }
  await withLock(async () => {
    await snapshot(`before-rollback-to-${basename(name)}`);
    for (const file of await jsonFiles(join(dir, "styles", "protomaps"))) await replaceFrom(join(dir, "styles", "protomaps"), file, STYLES);
    for (const file of await jsonFiles(join(dir, "maps"))) await replaceFrom(join(dir, "maps"), file, MAPS);
    const base = await readJson(join(MAPS, `${BASE_ID}.json`)).catch(() => null);
    if (base && record.build) await writeFile(join(SNAPSHOTS, "current.json"), `${JSON.stringify({ build: record.build, sha256: digestOf(base.archive), updated: new Date().toISOString() }, null, 2)}\n`);
    log(`Restored styles then manifests from ${name}.`);
  });
  await status(flags.offline ? ["--offline"] : []);
}

async function httpChecks(inv) {
  const problems = [];
  const query = `?verify=${Date.now()}`; // bypasses CDN copies of fixed-name files
  for (const id of IDS) {
    const response = await fetch(`${PUBLIC_BASE}/maps/${id}.json${query}`, { signal: AbortSignal.timeout(15_000) }).catch((error) => ({ ok: false, status: error.message }));
    if (!response.ok) { problems.push(`GET /maps/${id}.json: ${response.status}`); continue; }
    const digest = digestOf((await response.json()).archive);
    if (digest !== inv.manifests[id]?.digest) problems.push(`/maps/${id}.json serves ${digest}, disk has ${inv.manifests[id]?.digest}`);
  }
  for (const flavor of FLAVORS) {
    const response = await fetch(`${PUBLIC_BASE}/styles/protomaps/${flavor}.json${query}`, { signal: AbortSignal.timeout(15_000) }).catch((error) => ({ ok: false, status: error.message }));
    if (!response.ok) { problems.push(`GET /styles/protomaps/${flavor}.json: ${response.status}`); continue; }
    const digest = digestOf((await response.json())?.sources?.protomaps?.url);
    if (digest !== inv.styles[flavor]?.digest) problems.push(`/styles/protomaps/${flavor}.json serves ${digest}, disk has ${inv.styles[flavor]?.digest}`);
  }
  for (const digest of inv.referenced) {
    const path = `/archives/${digest}.pmtiles`;
    const response = await fetch(`${PUBLIC_BASE}${path}`, { headers: { Range: "bytes=0-126", "Accept-Encoding": "identity" }, signal: AbortSignal.timeout(15_000) }).catch((error) => ({ ok: false, status: error.message, headers: new Headers() }));
    const body = response.arrayBuffer ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
    if (response.status !== 206 || body.length !== 127 || response.headers.get("content-encoding") || body.subarray(0, 7).toString() !== "PMTiles") {
      problems.push(`Range 0-126 of ${path}: status ${response.status}, ${body.length} bytes, encoding ${response.headers.get("content-encoding") ?? "none"}`);
    }
  }
  return problems;
}

async function status(args) {
  const flags = parseFlags(args, ["offline", "json"]);
  const inv = await inventory();
  const problems = [];
  const digests = new Set();
  for (const id of IDS) {
    const manifest = inv.manifests[id];
    if (!manifest) { problems.push(`maps/${id}.json is missing`); continue; }
    digests.add(manifest.digest);
    if (FLAVORS.includes(id)) {
      if (manifest.style !== `../styles/protomaps/${id}.json`) problems.push(`maps/${id}.json style is ${manifest.style}`);
      const style = inv.styles[id];
      if (!style) problems.push(`styles/protomaps/${id}.json is missing`);
      else digests.add(style.digest);
    }
  }
  for (const digest of inv.referenced) if (!inv.archives[digest].present) problems.push(`archives/${digest}.pmtiles is referenced but missing`);
  if (digests.size > 1) problems.push(`manifests/styles disagree: ${[...digests].join(", ")}`);
  const http = flags.offline ? null : await httpChecks(inv);
  if (http) problems.push(...http);
  const snapshots = existsSync(SNAPSHOTS) ? readdirSync(SNAPSHOTS).filter((name) => existsSync(join(SNAPSHOTS, name, "snapshot.json"))).sort() : [];
  const free = existsSync(ARCHIVES) ? await freeBytes(ARCHIVES) : null;
  const result = { build: await currentBuild(inv), digests: [...digests], manifests: inv.manifests, styles: inv.styles, archives: inv.archives, freeBytes: free, snapshots, http: http ? (http.length ? "failed" : "ok") : "skipped", problems };
  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    log(`\nStatus of ${SITE} (${PUBLIC_BASE}) - build ${result.build ?? "unknown"}`);
    for (const id of IDS) log(`  maps/${id}.json -> ${inv.manifests[id]?.digest ?? "MISSING"}${FLAVORS.includes(id) ? `   styles/protomaps/${id}.json -> ${inv.styles[id]?.digest ?? "MISSING"}` : ""}`);
    for (const [digest, archive] of Object.entries(inv.archives)) log(`  archives/${digest}.pmtiles: ${archive.present ? `${archive.bytes} bytes, ${archive.links} link(s)` : "MISSING"}`);
    if (free !== null) log(`  free: ${gib(free)}`);
    log(`  HTTP checks against ${PUBLIC_BASE}: ${result.http}`);
    log(`  snapshots: ${snapshots.length ? snapshots.join(", ") : "none"}`);
    log(problems.length ? `PROBLEMS:\n  ${problems.join("\n  ")}` : "OK: every manifest and style names the same archive, and it is present.");
  }
  if (problems.length) process.exitCode = 1;
  return result;
}

const [command, ...rest] = process.argv.slice(2);
const commands = { status, snapshot: (args) => snapshot(args[0]), update, rollback };
if (!commands[command]) {
  console.log(usage());
  process.exitCode = command === undefined || command === "--help" || command === "-h" ? 0 : 2;
} else {
  try {
    await commands[command](rest);
  } catch (error) {
    console.error(error instanceof OperatorError ? `ERROR: ${error.message}` : error);
    process.exitCode = 1;
  }
}
