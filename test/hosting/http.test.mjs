import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { assertPageRoutes, writePages } from "./pages.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const caddy = process.env.CADDY_BIN || "caddy";
const run = promisify(execFile);

async function unusedPort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
  return port;
}

async function acceptsConnection(host, port) {
  return new Promise((resolveConnection, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(2_000, () => {
      socket.destroy();
      reject(new Error(`Could not establish whether ${host}:${port} accepts connections`));
    });
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once("error", (error) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolveConnection(false);
      else reject(error);
    });
  });
}

test("Caddy serves the real static publication boundary", { timeout: 30_000 }, async (t) => {
  // This gate intentionally fails when its runtime is missing. A skipped server
  // test would say nothing about Range/CORS behavior on the deployed boundary.
  try {
    await run(caddy, ["version"], { timeout: 5_000 });
  } catch (error) {
    throw new Error("Hosting tests require Caddy. Install 2.11.7 or set CADDY_BIN to its executable.", { cause: error });
  }

  const root = await mkdtemp(join(tmpdir(), "tstiles-hosting-"));
  const site = join(root, "site");
  // Transport fixture, deliberately independent of the archive parser. The
  // parser's own fixture tests cover PMTiles validity; here every byte matters.
  const bytes = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => i % 251));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const archivePath = `/archives/${digest}.pmtiles`;
  let server;
  let logs = "";
  let spawnError;

  try {
    for (const directory of ["archives", "maps", "assets", "styles", "src", "ops", ".git"]) {
      await mkdir(join(site, directory), { recursive: true });
    }
    await writeFile(join(site, archivePath), bytes);
    await writeFile(join(site, "maps", "basemap.json"), JSON.stringify({ archive: `..${archivePath}` }));
    await writeFile(join(site, "index.html"), "<!doctype html><title>TSTiles transport fixture</title>");
    await writePages(site);
    await writeFile(join(site, "assets", "viewer.js"), "export const fixture = true;\n");
    await writeFile(join(site, "styles", "local.json"), "{}\n");
    for (const privatePath of [".env", ".git/config", "package.json", "src/private.ts", "ops/Caddyfile", "assets/.env"]) {
      await writeFile(join(site, privatePath), "must not be served\n");
    }

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const env = { ...process.env, TSTILES_ROOT: site, TSTILES_LISTEN: `127.0.0.1:${port}`, XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config") };
    const config = join(repo, "ops", "Caddyfile.local");
    await run(caddy, ["validate", "--config", config, "--adapter", "caddyfile"], { env, timeout: 5_000 });
    server = spawn(caddy, ["run", "--config", config, "--adapter", "caddyfile"], { cwd: repo, env, stdio: ["ignore", "ignore", "pipe"] });
    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-16_000); });
    server.on("error", (error) => { spawnError = error; });

    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5_000), redirect: "manual" });
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(`Caddy exited during startup:\n${logs}`);
      try {
        const response = await request("/", { method: "HEAD" });
        ready = response.status === 200;
        if (ready) break;
      } catch {
        // Startup is asynchronous; retry only during this bounded readiness loop.
      }
      await delay(50);
    }
    assert.ok(ready, `Caddy never became ready:\n${logs}`);

    await t.test("the local server rejects connections on other network addresses", async () => {
      // A Host matcher alone still accepts TCP connections on a wildcard
      // listener. Probe actual sockets, including a second loopback address
      // so this check also works on hosts without an external interface.
      const otherAddresses = new Set(["127.0.0.2"]);
      for (const addresses of Object.values(networkInterfaces())) {
        for (const address of addresses ?? []) {
          if (address.family === "IPv4" && !address.internal) otherAddresses.add(address.address);
        }
      }
      for (const address of otherAddresses) {
        assert.equal(await acceptsConnection(address, port), false, `local server accepted TCP on ${address}`);
      }
    });

    let etag;
    await t.test("a byte range is exact, small, unencoded, and publicly readable", async () => {
      const response = await request(archivePath, { headers: { Range: "bytes=127-253", Origin: "https://first.example", "Accept-Encoding": "gzip, br" } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes 127-253/${bytes.length}`);
      assert.equal(response.headers.get("content-length"), "127");
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
      assert.match(response.headers.get("access-control-expose-headers"), /etag/i);
      assert.match(response.headers.get("access-control-expose-headers"), /content-range/i);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(body.length, 127, "a range request must not transfer the complete archive");
      assert.deepEqual(body, bytes.subarray(127, 254));
      etag = response.headers.get("etag");
      assert.ok(etag);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    });

    await t.test("HEAD returns metadata without the archive body", async () => {
      const response = await request(archivePath, { method: "HEAD", headers: { Origin: "https://second.example" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-length"), String(bytes.length));
      assert.equal(response.headers.get("etag"), etag);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    });

    await t.test("suffix ranges and unsatisfiable ranges retain HTTP semantics", async () => {
      const suffix = await request(archivePath, { headers: { Range: "bytes=-16" } });
      assert.equal(suffix.status, 206);
      assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-16));
      const invalid = await request(archivePath, { headers: { Range: `bytes=${bytes.length}-` } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("content-range"), `bytes */${bytes.length}`);
      assert.equal(invalid.headers.get("cache-control"), "no-store");
      assert.equal(invalid.headers.get("access-control-allow-origin"), "*");
    });

    await t.test("ETag validators work for cached reads and changed representations", async () => {
      const unchanged = await request(archivePath, { headers: { "If-None-Match": etag } });
      assert.equal(unchanged.status, 304);
      assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
      const matching = await request(archivePath, { headers: { "If-Match": etag, Range: "bytes=0-7" } });
      assert.equal(matching.status, 206);
      assert.deepEqual(Buffer.from(await matching.arrayBuffer()), bytes.subarray(0, 8));
      const stale = await request(archivePath, { headers: { "If-Match": '"stale"', Range: "bytes=0-7" } });
      assert.equal(stale.status, 412);
      assert.equal(stale.headers.get("cache-control"), "no-store");
    });

    await t.test("CORS preflight permits the reader's headers without credentials", async () => {
      const response = await request(archivePath, { method: "OPTIONS", headers: { Origin: "https://third.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range,if-match" } });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("access-control-allow-methods"), "GET, HEAD, OPTIONS");
      assert.match(response.headers.get("access-control-allow-headers"), /range/i);
      assert.match(response.headers.get("access-control-allow-headers"), /if-match/i);
      assert.equal(response.headers.get("access-control-allow-credentials"), null);
      assert.equal((await response.arrayBuffer()).byteLength, 0);
      const write = await request(archivePath, { method: "PUT", body: "overwrite" });
      assert.equal(write.status, 405);
      assert.equal(write.headers.get("allow"), "GET, HEAD, OPTIONS");
      assert.deepEqual(await readFile(join(site, archivePath)), bytes);
    });

    await t.test("mutable manifests and pages revalidate; local assets have a short lifetime", async () => {
      for (const path of ["/maps/basemap.json", "/", "/index.html"]) {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "no-cache");
        await response.arrayBuffer();
      }
      for (const path of ["/assets/viewer.js", "/styles/local.json"]) {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "public, max-age=300, must-revalidate");
        await response.arrayBuffer();
      }
    });

    await t.test("service files, directory indexes, and missing archives are not exposed or cached", async () => {
      for (const path of ["/.env", "/.git/config", "/package.json", "/src/private.ts", "/ops/Caddyfile", "/assets/.env", "/archives/", "/maps/", "/styles/", `/archives/${"0".repeat(64)}.pmtiles`]) {
        const response = await request(path);
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get("cache-control"), "no-store", path);
        assert.equal(response.headers.get("access-control-allow-origin"), "*", path);
        assert.doesNotMatch(await response.text(), /must not be served/, path);
      }
    });

    await t.test("landing and legal pages, their .html redirects, and robots.txt", async () => {
      await assertPageRoutes(request, site);
    });
  } finally {
    if (server && server.exitCode === null && !spawnError) {
      const closed = once(server, "close");
      server.kill("SIGTERM");
      await Promise.race([closed, delay(3_000, undefined, { ref: false }).then(() => { server.kill("SIGKILL"); })]);
    }
    await rm(root, { recursive: true, force: true });
  }
});
