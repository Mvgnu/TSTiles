import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { assertPageRoutes, writePages } from "./pages.mjs";

// Real nginx against the same route/Range/CORS/cache table as ops/public.caddy. The routes and
// http-context snippets are loaded unmodified from ops/nginx/. The production site file is
// validated and exercised from a copy whose host paths/ports point into a temporary directory.

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const snippets = join(repo, "ops", "nginx");
const nginx = process.env.NGINX_BIN || "nginx";
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

async function requireNginx() {
  // This gate intentionally fails when its runtime is missing: a skipped server test would say
  // nothing about the Range/CORS behaviour of the production delivery server.
  try {
    const { stderr } = await run(nginx, ["-V"], { timeout: 5_000 });
    return stderr;
  } catch (error) {
    throw new Error("Hosting tests require nginx (production runs 1.28). Install it or set NGINX_BIN to its executable.", { cause: error });
  }
}

function startNginx(prefix, config) {
  const server = spawn(nginx, ["-p", prefix, "-e", "stderr", "-c", config], { stdio: ["ignore", "ignore", "pipe"] });
  const state = { server, logs: "", spawnError: undefined };
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => { state.logs = (state.logs + chunk).slice(-16_000); });
  server.on("error", (error) => { state.spawnError = error; });
  return state;
}

async function waitReady(state, probe) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (state.spawnError) throw state.spawnError;
    if (state.server.exitCode !== null) throw new Error(`nginx exited during startup:\n${state.logs}`);
    try {
      if (await probe()) return;
    } catch {
      // Startup is asynchronous; retry only during this bounded readiness loop.
    }
    await delay(50);
  }
  throw new Error(`nginx never became ready:\n${state.logs}`);
}

async function stopNginx(state) {
  if (!state || state.server.exitCode !== null || state.spawnError) return;
  const closed = once(state.server, "close");
  // SIGQUIT is nginx's graceful shutdown; it flushes buffered access logs.
  state.server.kill("SIGQUIT");
  await Promise.race([closed, delay(5_000, undefined, { ref: false }).then(() => { state.server.kill("SIGKILL"); })]);
}

function tempDirectives(root) {
  return ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]
    .map((name) => `  ${name}_temp_path ${join(root, "temp", name)};`).join("\n");
}

function assertPublicHeaders(response, label) {
  const h = response.headers;
  assert.equal(h.get("access-control-allow-origin"), "*", `${label}: Access-Control-Allow-Origin`);
  assert.equal(h.get("access-control-allow-methods"), "GET, HEAD, OPTIONS", `${label}: Access-Control-Allow-Methods`);
  assert.equal(h.get("access-control-allow-headers"), "Range, If-Match, If-None-Match, If-Modified-Since", `${label}: Access-Control-Allow-Headers`);
  assert.equal(h.get("access-control-expose-headers"), "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified", `${label}: Access-Control-Expose-Headers`);
  assert.equal(h.get("access-control-allow-credentials"), null, `${label}: no credentialed CORS`);
  assert.equal(h.get("x-content-type-options"), "nosniff", `${label}: nosniff`);
  assert.equal(h.get("strict-transport-security"), null, `${label}: no HSTS over plain HTTP`);
}

async function prepareSite(site) {
  // Transport fixture, deliberately independent of the archive parser: here every byte matters.
  // Mixed content so gzip would visibly change it if it were applied.
  const bytes = Buffer.from(Array.from({ length: 1024 * 1024 }, (_, i) => (i % 251) ^ ((i >> 10) & 0xff)));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const archivePath = `/archives/${digest}.pmtiles`;
  for (const directory of ["archives", "maps", "assets", "styles/fonts/Noto Sans Regular", "styles/sprites", "src", "ops", ".git"]) {
    await mkdir(join(site, directory), { recursive: true });
  }
  await writeFile(join(site, archivePath), bytes);
  await writeFile(join(site, "maps", "basemap.json"), JSON.stringify({ archive: `..${archivePath}`, padding: "x".repeat(2_000) }));
  await writeFile(join(site, "index.html"), "<!doctype html><title>TSTiles transport fixture</title>");
  await writePages(site);
  await writeFile(join(site, "assets", "viewer.js"), "export const fixture = true;\n".repeat(50));
  await writeFile(join(site, "assets", "viewer.css"), "body { margin: 0; }\n".repeat(50));
  await writeFile(join(site, "styles", "local.json"), JSON.stringify({ version: 8, padding: "y".repeat(2_000) }));
  const glyph = Buffer.alloc(4_096, 7);
  await writeFile(join(site, "styles", "fonts", "Noto Sans Regular", "0-255.pbf"), glyph);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  await writeFile(join(site, "styles", "sprites", "light.png"), png);
  for (const privatePath of [".env", ".git/config", "package.json", "src/private.ts", "ops/Caddyfile", "assets/.env", "styles/.secret.json"]) {
    await writeFile(join(site, privatePath), "must not be served\n");
  }
  return { bytes, archivePath, glyph };
}

test("nginx serves the same static publication boundary as ops/public.caddy", { timeout: 60_000 }, async (t) => {
  await requireNginx();
  const root = await mkdtemp(join(tmpdir(), "tstiles-nginx-"));
  const site = join(root, "site");
  let state;

  try {
    const { bytes, archivePath, glyph } = await prepareSite(site);
    for (const name of ["client_body", "proxy", "fastcgi", "uwsgi", "scgi"]) await mkdir(join(root, "temp", name), { recursive: true });

    const port = await unusedPort();
    const base = `http://127.0.0.1:${port}`;
    const config = join(root, "nginx.conf");
    // gzip is on for every type the routes serve, including application/octet-stream, so the
    // per-location `gzip off` is what keeps archive and glyph bytes unencoded. (The brotli module
    // is not in stock nginx builds; production turns brotli off in the site file.)
    await writeFile(config, `
daemon off;
worker_processes 1;
pid ${join(root, "nginx.pid")};
error_log stderr warn;
events { worker_connections 64; }
http {
  access_log off;
${tempDirectives(root)}
  sendfile on;
  default_type application/octet-stream;
  gzip on;
  gzip_vary on;
  gzip_proxied any;
  gzip_min_length 1;
  gzip_types application/octet-stream application/json application/x-protobuf text/javascript text/css;
  include ${join(snippets, "tstiles-http.conf")};
  server {
    listen 127.0.0.1:${port};
    server_name _;
    root ${site};
    include ${join(snippets, "tstiles-routes.conf")};
  }
}
`);
    await run(nginx, ["-t", "-q", "-p", root, "-e", "stderr", "-c", config], { timeout: 10_000 });
    state = startNginx(root, config);

    const request = (path, options = {}) => fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(5_000), redirect: "manual" });
    await waitReady(state, async () => (await request("/", { method: "HEAD" })).status === 200);

    let etag;
    await t.test("a byte range is exact, small, unencoded, and publicly readable", async () => {
      const response = await request(archivePath, { headers: { Range: "bytes=127-253", Origin: "https://first.example", "Accept-Encoding": "gzip, br" } });
      assert.equal(response.status, 206);
      assert.equal(response.headers.get("content-range"), `bytes 127-253/${bytes.length}`);
      assert.equal(response.headers.get("content-length"), "127");
      assert.equal(response.headers.get("content-type"), "application/octet-stream");
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("vary"), null);
      assertPublicHeaders(response, "206 archive");
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(body.length, 127, "a range request must not transfer the complete archive");
      assert.deepEqual(body, bytes.subarray(127, 254));
      etag = response.headers.get("etag");
      assert.ok(etag);
      assert.doesNotMatch(etag, /^W\//, "archive ETag must be strong for If-Range/If-Match");
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    });

    await t.test("a full archive read is identical bytes without HTTP compression", async () => {
      const response = await request(archivePath, { headers: { "Accept-Encoding": "gzip" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-encoding"), null);
      assert.equal(response.headers.get("content-length"), String(bytes.length));
      assert.equal(response.headers.get("accept-ranges"), "bytes");
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assertPublicHeaders(response, "200 archive");
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    });

    await t.test("HEAD returns metadata without the archive body", async () => {
      const response = await request(archivePath, { method: "HEAD", headers: { Origin: "https://second.example" } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-length"), String(bytes.length));
      assert.equal(response.headers.get("etag"), etag);
      assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assertPublicHeaders(response, "HEAD archive");
      assert.equal((await response.arrayBuffer()).byteLength, 0);
    });

    await t.test("suffix ranges and unsatisfiable ranges retain HTTP semantics", async () => {
      const suffix = await request(archivePath, { headers: { Range: "bytes=-16" } });
      assert.equal(suffix.status, 206);
      assert.equal(suffix.headers.get("content-range"), `bytes ${bytes.length - 16}-${bytes.length - 1}/${bytes.length}`);
      assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-16));
      const invalid = await request(archivePath, { headers: { Range: `bytes=${bytes.length}-` } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("content-range"), `bytes */${bytes.length}`);
      // nginx runs its header filters twice for a 416 (see ops/nginx/tstiles-http.conf): the
      // route policy from the first pass remains, and no-store is added. Every CORS header must
      // still appear exactly once, or browsers reject the response.
      assert.match(invalid.headers.get("cache-control"), /(^|,\s*)no-store(\s*,|$)/);
      assertPublicHeaders(invalid, "416 archive");
      await invalid.arrayBuffer();
    });

    await t.test("ETag validators work for cached reads, If-Match, and If-Range", async () => {
      const unchanged = await request(archivePath, { headers: { "If-None-Match": etag } });
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.get("cache-control"), "public, max-age=31536000, immutable");
      assertPublicHeaders(unchanged, "304 archive");
      assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
      const matching = await request(archivePath, { headers: { "If-Match": etag, Range: "bytes=0-7" } });
      assert.equal(matching.status, 206);
      assert.deepEqual(Buffer.from(await matching.arrayBuffer()), bytes.subarray(0, 8));
      const stale = await request(archivePath, { headers: { "If-Match": '"stale"', Range: "bytes=0-7" } });
      assert.equal(stale.status, 412);
      assert.equal(stale.headers.get("cache-control"), "no-store");
      assertPublicHeaders(stale, "412 archive");
      await stale.arrayBuffer();
      const rangeSame = await request(archivePath, { headers: { "If-Range": etag, Range: "bytes=8-15" } });
      assert.equal(rangeSame.status, 206);
      assert.deepEqual(Buffer.from(await rangeSame.arrayBuffer()), bytes.subarray(8, 16));
      const rangeChanged = await request(archivePath, { headers: { "If-Range": '"other"', Range: "bytes=8-15" } });
      assert.equal(rangeChanged.status, 200, "a changed representation ignores the range and returns the whole file");
      assert.equal((await rangeChanged.arrayBuffer()).byteLength, bytes.length);
    });

    await t.test("CORS preflight permits the reader's headers without credentials; writes are refused", async () => {
      for (const path of [archivePath, "/maps/basemap.json", "/unknown"]) {
        const response = await request(path, { method: "OPTIONS", headers: { Origin: "https://third.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "range,if-match" } });
        assert.equal(response.status, 204, path);
        assert.equal(response.headers.get("access-control-max-age"), "3600", path);
        assert.equal(response.headers.get("cache-control"), "no-store", path);
        assertPublicHeaders(response, `OPTIONS ${path}`);
        assert.equal((await response.arrayBuffer()).byteLength, 0);
      }
      for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
        const write = await request(archivePath, { method, body: "overwrite" });
        assert.equal(write.status, 405, method);
        assert.equal(write.headers.get("allow"), "GET, HEAD, OPTIONS", method);
        assert.equal(write.headers.get("cache-control"), "no-store", method);
        assert.equal(write.headers.get("access-control-max-age"), null, method);
        assertPublicHeaders(write, `${method} archive`);
        await write.arrayBuffer();
      }
      assert.deepEqual(await readFile(join(site, archivePath)), bytes);
    });

    await t.test("mutable manifests and pages revalidate; local assets have a short lifetime", async () => {
      for (const path of ["/maps/basemap.json", "/", "/index.html"]) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("cache-control"), "no-cache", path);
        assert.equal(response.headers.get("allow"), null, path);
        assertPublicHeaders(response, path);
        const validator = response.headers.get("etag");
        await response.arrayBuffer();
        const revalidated = await request(path, { headers: { "If-None-Match": validator } });
        assert.equal(revalidated.status, 304, `${path} revalidation`);
        assert.equal(revalidated.headers.get("cache-control"), "no-cache", `${path} revalidation`);
        assertPublicHeaders(revalidated, `304 ${path}`);
      }
      for (const path of ["/assets/viewer.js", "/assets/viewer.css", "/styles/local.json", "/styles/sprites/light.png", "/styles/fonts/Noto%20Sans%20Regular/0-255.pbf"]) {
        const response = await request(path);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("cache-control"), "public, max-age=300, must-revalidate", path);
        assertPublicHeaders(response, path);
        await response.arrayBuffer();
      }
    });

    await t.test("each route has its MIME type; compression is applied only where it is allowed", async () => {
      const expected = [
        ["/maps/basemap.json", "application/json", "gzip"],
        ["/", "text/html; charset=utf-8", "gzip"],
        ["/assets/viewer.js", "text/javascript; charset=utf-8", "gzip"],
        ["/assets/viewer.css", "text/css; charset=utf-8", "gzip"],
        ["/styles/local.json", "application/json", "gzip"],
        ["/styles/sprites/light.png", "image/png", null],
        ["/styles/fonts/Noto%20Sans%20Regular/0-255.pbf", "application/x-protobuf", null],
        [archivePath, "application/octet-stream", null],
      ];
      for (const [path, type, encoding] of expected) {
        const response = await request(path, { headers: { "Accept-Encoding": "gzip" } });
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get("content-type"), type, path);
        // The gzip positive controls prove this server compresses, so a missing encoding on
        // archives and glyphs is the routes' doing rather than an inactive gzip module.
        assert.equal(response.headers.get("content-encoding"), encoding, path);
        await response.arrayBuffer();
      }
      const glyphResponse = await request("/styles/fonts/Noto%20Sans%20Regular/0-255.pbf", { headers: { "Accept-Encoding": "gzip", Range: "bytes=0-99" } });
      assert.equal(glyphResponse.status, 206);
      assert.deepEqual(Buffer.from(await glyphResponse.arrayBuffer()), glyph.subarray(0, 100));
    });

    await t.test("service files, dot paths, directories, and missing archives are not exposed or cached", async () => {
      const paths = [
        "/.env", "/%2eenv", "/.git/config", "/package.json", "/src/private.ts", "/ops/Caddyfile",
        "/assets/.env", "/assets/%2Eenv", "/styles/.secret.json", "/archives/", "/maps/", "/styles/", "/assets/", "/styles", "/assets",
        "/site/index.html", "/index.htm", "/maps/basemap.json.bak", "/maps/nested/basemap.json",
        `/archives/${"0".repeat(64)}.pmtiles`, `/archives/${"A".repeat(64)}.pmtiles`, `${archivePath}.tmp`, "/archives/short.pmtiles",
        "/styles/missing.json", "/assets/missing.js",
      ];
      // nginx on macOS matches locations case-insensitively (case-insensitive filesystem), so a
      // case variant of an existing manifest is served there. Production Linux is case-sensitive.
      if (process.platform === "darwin") t.diagnostic("macOS: case-variant manifest path not checked (nginx is caseless on darwin)");
      else paths.push("/maps/Basemap.json");
      for (const path of paths) {
        for (const method of ["GET", "HEAD"]) {
          const response = await request(path, { method });
          assert.equal(response.status, 404, `${method} ${path}`);
          assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${path}`);
          assertPublicHeaders(response, `${method} ${path}`);
          assert.doesNotMatch(await response.text(), /must not be served|Index of/, `${method} ${path}`);
        }
      }
      // Dot paths are 404 before method handling, as in ops/public.caddy.
      for (const method of ["OPTIONS", "POST"]) {
        const response = await request("/.env", { method });
        assert.equal(response.status, 404, `${method} /.env`);
        await response.arrayBuffer();
      }
    });

    await t.test("landing and legal pages, their .html redirects, and robots.txt", async () => {
      await assertPageRoutes(request, site);
    });
  } finally {
    await stopNginx(state);
    await rm(root, { recursive: true, force: true });
  }
});

// node:http(s) rather than fetch: these requests need an explicit Host header and SNI name.
function rawGet({ tls, port, host, path, headers = {} }) {
  const send = tls ? httpsRequest : httpRequest;
  const options = { host: "127.0.0.1", port, path, headers: { Host: host, ...headers }, timeout: 5_000 };
  if (tls) Object.assign(options, { servername: host, rejectUnauthorized: false });
  return new Promise((resolveRequest, reject) => {
    const req = send(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`request to ${host}${path} timed out`)));
    req.on("error", reject);
    req.end();
  });
}

test("the itstiles.com site file validates and serves TLS, redirects, ACME, and the routes", { timeout: 60_000 }, async (t) => {
  const version = await requireNginx();
  const root = await mkdtemp(join(tmpdir(), "tstiles-nginx-site-"));
  const site = join(root, "site");
  let state;

  try {
    const { bytes, archivePath } = await prepareSite(site);
    const snippetDir = join(root, "snippets");
    const certDir = join(root, "letsencrypt");
    const acme = join(root, "acme");
    const logs = join(root, "logs");
    for (const directory of [snippetDir, certDir, join(acme, ".well-known", "acme-challenge"), logs, ...["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((name) => join(root, "temp", name))]) {
      await mkdir(directory, { recursive: true });
    }
    for (const name of ["tstiles-http.conf", "tstiles-routes.conf", "tstiles-cloudflare-realip.conf"]) {
      await copyFile(join(snippets, name), join(snippetDir, name));
    }
    await writeFile(join(acme, ".well-known", "acme-challenge", "token-123"), "token-123.thumbprint");
    try {
      await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=itstiles.com",
        "-addext", "subjectAltName=DNS:itstiles.com,DNS:www.itstiles.com",
        "-keyout", join(certDir, "privkey.pem"), "-out", join(certDir, "fullchain.pem")], { timeout: 30_000 });
    } catch (error) {
      throw new Error("The site-file test needs the openssl CLI to create a throwaway certificate.", { cause: error });
    }

    const httpPort = await unusedPort();
    const tlsPort = await unusedPort();
    const production = await readFile(join(snippets, "itstiles.com.conf"), "utf8");
    // Only host-specific locations change; every directive is otherwise exactly the production file.
    let siteFile = production
      .replaceAll("/etc/nginx/snippets/", `${snippetDir}/`)
      .replaceAll("/etc/letsencrypt/live/itstiles.com/", `${certDir}/`)
      .replaceAll("/var/log/nginx/", `${logs}/`)
      .replaceAll("/var/www/letsencrypt", acme)
      .replaceAll("/mnt/tstiles/site", site)
      .replaceAll(/^\s*listen \[::\]:(80|443)[^\n]*\n/gm, "")
      .replaceAll(/listen 80;/g, `listen 127.0.0.1:${httpPort};`)
      .replaceAll(/listen 443 ssl;/g, `listen 127.0.0.1:${tlsPort} ssl;`);
    for (const host of ["/etc/", "/var/", "/mnt/"]) {
      const directives = siteFile.replaceAll(root, "").split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
      assert.doesNotMatch(directives, new RegExp(`\\s${host}`), `unrewritten host path ${host}`);
    }
    if (!/brotli/.test(version)) {
      // Stock nginx has no brotli module; the production host loads it. Removing exactly these
      // two directives is the only semantic change, and it is reported.
      const before = siteFile;
      siteFile = siteFile.replace(/^\s*brotli off;\n/m, "").replace(/^\s*brotli_static off;\n/m, "");
      assert.notEqual(siteFile, before, "the site file must turn brotli off");
      t.diagnostic("local nginx has no brotli module: brotli/brotli_static off not exercised (validate with nginx -t on the host)");
    }
    const config = join(root, "nginx.conf");
    await writeFile(join(root, "itstiles.com"), siteFile);
    await writeFile(config, `
daemon off;
worker_processes 1;
pid ${join(root, "nginx.pid")};
error_log stderr warn;
events { worker_connections 64; }
http {
  access_log off;
${tempDirectives(root)}
  sendfile on;
  default_type application/octet-stream;
  gzip on;
  gzip_vary on;
  gzip_types application/octet-stream application/json application/x-protobuf text/javascript text/css;
  include ${join(root, "itstiles.com")};
}
`);
    await run(nginx, ["-t", "-q", "-p", root, "-e", "stderr", "-c", config], { timeout: 10_000 });
    state = startNginx(root, config);
    await waitReady(state, async () => (await rawGet({ tls: true, port: tlsPort, host: "itstiles.com", path: "/" })).status === 200);

    await t.test("port 80 answers ACME from the webroot and redirects everything else to the apex", async () => {
      const challenge = await rawGet({ tls: false, port: httpPort, host: "www.itstiles.com", path: "/.well-known/acme-challenge/token-123" });
      assert.equal(challenge.status, 200);
      assert.equal(challenge.body.toString("utf8"), "token-123.thumbprint");
      for (const host of ["itstiles.com", "www.itstiles.com"]) {
        const response = await rawGet({ tls: false, port: httpPort, host, path: "/maps/basemap.json?x=1" });
        assert.equal(response.status, 301, host);
        assert.equal(response.headers.location, "https://itstiles.com/maps/basemap.json?x=1", host);
        assert.equal(response.headers["strict-transport-security"], undefined, `${host}: no HSTS over plain HTTP`);
      }
    });

    await t.test("www redirects to the apex over TLS with HSTS", async () => {
      const response = await rawGet({ tls: true, port: tlsPort, host: "www.itstiles.com", path: "/index.html" });
      assert.equal(response.status, 301);
      assert.equal(response.headers.location, "https://itstiles.com/index.html");
      assert.equal(response.headers["strict-transport-security"], "max-age=31536000");
    });

    await t.test("the apex serves the routes over TLS with HSTS on success and error", async () => {
      const range = await rawGet({ tls: true, port: tlsPort, host: "itstiles.com", path: archivePath, headers: { Range: "bytes=10-19", "Accept-Encoding": "gzip, br" } });
      assert.equal(range.status, 206);
      assert.deepEqual(range.body, bytes.subarray(10, 20));
      assert.equal(range.headers["content-encoding"], undefined);
      assert.equal(range.headers["access-control-allow-origin"], "*");
      assert.equal(range.headers["cache-control"], "public, max-age=31536000, immutable");
      assert.equal(range.headers["strict-transport-security"], "max-age=31536000");
      for (const path of ["/.env", "/nope", "/maps/missing.json"]) {
        const missing = await rawGet({ tls: true, port: tlsPort, host: "itstiles.com", path });
        assert.equal(missing.status, 404, path);
        assert.equal(missing.headers["strict-transport-security"], "max-age=31536000", path);
        assert.equal(missing.headers["cache-control"], "no-store", path);
        assert.equal(missing.headers["access-control-allow-origin"], "*", path);
      }
      const invalid = await rawGet({ tls: true, port: tlsPort, host: "itstiles.com", path: archivePath, headers: { Range: `bytes=${bytes.length}-` } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers["strict-transport-security"], "max-age=31536000", "HSTS once on 416");
      assert.equal(invalid.headers["access-control-allow-origin"], "*", "CORS once on 416");
    });

    await t.test("successful archive reads are not access-logged; other requests are", async () => {
      await rawGet({ tls: true, port: tlsPort, host: "itstiles.com", path: "/index.html" });
      await stopNginx(state);
      const log = await readFile(join(logs, "itstiles.access.log"), "utf8");
      assert.match(log, /"GET \/index\.html HTTP\/1\.1" 200 /);
      assert.match(log, /"GET \/nope HTTP\/1\.1" 404 /);
      assert.match(log, new RegExp(`"GET ${archivePath.replaceAll(".", "\\.")} HTTP/1\\.1" 416 `), "archive errors stay visible");
      assert.doesNotMatch(log, new RegExp(`"GET ${archivePath.replaceAll(".", "\\.")} HTTP/1\\.1" 20[06] `));
    });
  } finally {
    await stopNginx(state);
    await rm(root, { recursive: true, force: true });
  }
});

test("the itstiles.com bootstrap site file validates and only answers ACME", { timeout: 30_000 }, async () => {
  await requireNginx();
  const root = await mkdtemp(join(tmpdir(), "tstiles-nginx-boot-"));
  let state;
  try {
    const acme = join(root, "acme");
    const logs = join(root, "logs");
    for (const directory of [join(acme, ".well-known", "acme-challenge"), logs, ...["client_body", "proxy", "fastcgi", "uwsgi", "scgi"].map((name) => join(root, "temp", name))]) {
      await mkdir(directory, { recursive: true });
    }
    await writeFile(join(acme, ".well-known", "acme-challenge", "token-456"), "token-456.thumbprint");
    const port = await unusedPort();
    const bootstrap = (await readFile(join(snippets, "itstiles.com.bootstrap.conf"), "utf8"))
      .replaceAll("/var/log/nginx/", `${logs}/`)
      .replaceAll("/var/www/letsencrypt", acme)
      .replaceAll(/^\s*listen \[::\]:80;\n/gm, "")
      .replaceAll("listen 80;", `listen 127.0.0.1:${port};`);
    const directives = bootstrap.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(directives, /listen\s+443|ssl_certificate|include /, "bootstrap must not need a certificate or snippets");
    const config = join(root, "nginx.conf");
    await writeFile(join(root, "itstiles.com"), bootstrap);
    await writeFile(config, `
daemon off;
worker_processes 1;
pid ${join(root, "nginx.pid")};
error_log stderr warn;
events { worker_connections 64; }
http {
  access_log off;
${tempDirectives(root)}
  include ${join(root, "itstiles.com")};
}
`);
    await run(nginx, ["-t", "-q", "-p", root, "-e", "stderr", "-c", config], { timeout: 10_000 });
    state = startNginx(root, config);
    await waitReady(state, async () => (await rawGet({ tls: false, port, host: "itstiles.com", path: "/.well-known/acme-challenge/token-456" })).status === 200);
    const challenge = await rawGet({ tls: false, port, host: "www.itstiles.com", path: "/.well-known/acme-challenge/token-456" });
    assert.equal(challenge.body.toString("utf8"), "token-456.thumbprint");
    for (const path of ["/", "/maps/basemap.json", "/.well-known/acme-challenge/missing"]) {
      const response = await rawGet({ tls: false, port, host: "itstiles.com", path });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await stopNginx(state);
    await rm(root, { recursive: true, force: true });
  }
});
