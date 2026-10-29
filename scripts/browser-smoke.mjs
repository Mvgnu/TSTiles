import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { publishArchive } from "../dist/archive/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = await mkdtemp(join(tmpdir(), "tstiles-browser-"));
const output = resolve(root, "test-results/browser");
const evidence = { pages: [], crossOrigin: false, independentInstances: false, missingManifest: false, suppliedStyleFailures: false };
let caddy;
let browser;
let consumer;
let logs = "";
let spawnError;

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}
async function close(server) {
  if (!server?.listening) return;
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}

try {
  await mkdir(output, { recursive: true });
  const site = join(work, "site");
  await mkdir(site);
  await cp(resolve(root, "site/assets"), join(site, "assets"), { recursive: true });
  for (const page of ["index.html", "impressum.html", "datenschutz.html", "nutzungsbedingungen.html"]) {
    await cp(resolve(root, "site", page), join(site, page));
  }
  const { manifest } = await publishArchive(resolve(root, "test/fixtures/one-tile.pmtiles"), {
    outDir: site, id: "fixture", name: "Browser test fixture",
    attribution: "Delivery test fixture — not a geographical basemap",
  });
  // The landing page's hero loads ./maps/light.json; here it is the fixture (data preview style).
  await publishArchive(resolve(root, "test/fixtures/one-tile.pmtiles"), {
    outDir: site, id: "light", name: "Browser test fixture",
    attribution: "Delivery test fixture — not a geographical basemap",
  });
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  const base = `http://127.0.0.1:${port}`;
  caddy = spawn(process.env.CADDY_BIN || "caddy", ["run", "--config", resolve(root, "ops/Caddyfile.local"), "--adapter", "caddyfile"], {
    cwd: root,
    env: { ...process.env, TSTILES_ROOT: site, TSTILES_LISTEN: `127.0.0.1:${port}`, XDG_DATA_HOME: join(work, "data"), XDG_CONFIG_HOME: join(work, "config") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  caddy.stderr.setEncoding("utf8");
  caddy.stderr.on("data", (chunk) => { logs = (logs + chunk).slice(-12000); });
  caddy.on("error", (error) => { spawnError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw new Error("Browser check requires Caddy. Install it or set CADDY_BIN.", { cause: spawnError });
    if (caddy.exitCode !== null) throw new Error(`Caddy exited: ${logs}`);
    try { ready = (await fetch(base, { method: "HEAD", signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded startup retry */ }
    if (ready) break;
    await delay(50);
  }
  assert.ok(ready, `Caddy did not become ready: ${logs}`);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_BIN || undefined,
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const external = [];
    const failures = [];
    const ranges = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== base) external.push(request.url());
    });
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => {
      if (response.url().endsWith(".pmtiles")) ranges.push({ status: response.status(), headers: response.headers() });
    });
    await page.goto(base);
    // The hero centres Tübingen; the one-polygon fixture lies at 0°/0°, so "empty" is the honest settled state here.
    await page.locator('#hero-map:is([data-state="ready"], [data-state="empty"])').waitFor({ timeout: 20000 });
    assert.match(await page.locator("#hero-map .maplibregl-ctrl-attrib").innerText(), /Delivery test fixture/);
    assert.equal(await page.locator("#hero-map .maplibregl-compact").count(), 0, "Attribution must not collapse");
    assert.deepEqual(external, [], "Default map must not fetch hidden provider assets");
    assert.deepEqual(failures, []);
    assert.ok(ranges.some((response) => response.status === 206 && response.headers["content-range"]));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Page overflows its viewport");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.locator('#hero-map:is([data-state="ready"], [data-state="empty"])').waitFor();
    await page.screenshot({ path: join(output, `landing-${viewport.width}.png`), fullPage: true });
    for (const legal of ["impressum", "datenschutz", "nutzungsbedingungen"]) {
      const response = await page.goto(`${base}/${legal}.html`);
      assert.equal(response?.status(), 200, legal);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${legal} overflows`);
    }
    evidence.pages.push({ viewport, archiveResponses: ranges.length });
    await page.close();
  }

  consumer = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://consumer.invalid");
    response.setHeader("Access-Control-Allow-Origin", "*");
    if (["/empty.json", "/wrong.json"].includes(url.pathname)) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...manifest, style: `.${url.pathname.replace(".json", "-style.json")}`, archive: new URL(manifest.archive, `${base}/maps/fixture.json`).href }));
      return;
    }
    if (["/empty-style.json", "/wrong-style.json"].includes(url.pathname)) {
      const empty = url.pathname === "/empty-style.json";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ version: 8,
        sources: empty ? {} : { archive: { type: "vector", url: "pmtiles://" + new URL(manifest.archive, `${base}/maps/fixture.json`).href } },
        layers: empty ? [] : [{ id: "incompatible-layer", type: "fill", source: "archive", "source-layer": "does-not-exist", paint: { "fill-color": "#336699" } }],
      }));
      return;
    }
    if (url.pathname === "/a.json" || url.pathname === "/b.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ...manifest, id: url.pathname === "/a.json" ? "a" : "b", name: `Independent ${url.pathname}`, archive: new URL(manifest.archive, `${base}/maps/fixture.json`).href }));
      return;
    }
    if (url.pathname === "/case") {
      // One createMapViewer per failure case, exactly as an integrating site calls it.
      response.setHeader("Content-Type", "text/html");
      response.end(`<!doctype html><title>Failure case</title>
        <link rel="stylesheet" href="${base}/assets/maplibre-gl.css">
        <div id="map" style="height:400px"></div><p id="map-status"></p>
        <script type="module">
          import { createMapViewer } from '${base}/assets/embed.js';
          const line = document.getElementById("map-status");
          createMapViewer({ container: "map", manifestUrl: new URLSearchParams(location.search).get("manifest"),
            onStatus: (status) => { line.textContent = status.message; document.getElementById("map").dataset.state = status.state; } })
            .catch(() => undefined);
        </script>`);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(`<!doctype html><title>Independent consuming site</title>
      <link rel="stylesheet" href="${base}/assets/maplibre-gl.css">
      <div id="a" style="height:300px"></div><div id="b" style="height:300px"></div>
      <script type="module">
        import { createMapViewer } from '${base}/assets/embed.js';
        window.checks = { states: {}, viewers: [] };
        for (const id of ['a', 'b']) {
          window.checks.viewers.push(await createMapViewer({ container: id, manifestUrl: './' + id + '.json',
            onStatus: (status) => { window.checks.states[id] = status.state; } }));
        }
      </script>`);
  });
  const consumerPort = await listen(consumer);
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${consumerPort}/`);
  await page.waitForFunction(() => window.checks?.states.a === "ready" && window.checks?.states.b === "ready", undefined, { timeout: 20000 });
  assert.deepEqual(pageErrors, []);
  const before = await page.evaluate(() => window.checks.viewers.map((viewer) => ({ id: viewer.manifest.id, zoom: viewer.map.getZoom(), features: viewer.map.queryRenderedFeatures().length })));
  assert.deepEqual(before.map((view) => view.id), ["a", "b"]);
  assert.ok(before.every((view) => view.features > 0));
  await page.locator("#a").getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForFunction((initial) => window.checks.viewers[0].map.getZoom() > initial, before[0].zoom);
  const after = await page.evaluate(() => window.checks.viewers.map((viewer) => viewer.map.getZoom()));
  assert.equal(after[1], before[1].zoom, "Zooming one map must not change another instance");
  await page.screenshot({ path: join(output, "second-site.png"), fullPage: true });
  evidence.crossOrigin = true;
  evidence.independentInstances = true;
  await page.goto(`http://127.0.0.1:${consumerPort}/case?manifest=${encodeURIComponent(`${base}/maps/does-not-exist.json`)}`);
  await page.locator('#map[data-state="error"]').waitFor({ timeout: 10000 });
  assert.match(await page.locator("#map-status").innerText(), /HTTP 404/);
  assert.match(await page.locator("#map .tstiles-error").innerText(), /HTTP 404/);
  await page.screenshot({ path: join(output, "missing-manifest.png"), fullPage: true });
  evidence.missingManifest = true;
  for (const kind of ["empty", "wrong"]) {
    await page.goto(`http://127.0.0.1:${consumerPort}/case?manifest=${encodeURIComponent(`./${kind}.json`)}`);
    await page.waitForFunction(() => {
      const state = document.querySelector("#map")?.getAttribute("data-state");
      return state && state !== "loading";
    }, undefined, { timeout: 20000 });
    const state = await page.locator("#map").getAttribute("data-state");
    assert.ok(["error", "empty", "unverified"].includes(state), `${kind} supplied style must not report a loaded map`);
    assert.match(await page.locator("#map-status").innerText(), /style|layer|feature/i);
    await page.screenshot({ path: join(output, `${kind}-style.png`), fullPage: true });
  }
  evidence.suppliedStyleFailures = true;
  console.log(JSON.stringify({ result: "pass", browser: browser.version(), ...evidence }, null, 2));
  await writeFile(join(output, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
} finally {
  await browser?.close();
  await close(consumer);
  if (caddy && caddy.exitCode === null && !spawnError) {
    const stopped = once(caddy, "close");
    caddy.kill("SIGTERM");
    await Promise.race([stopped, delay(3000, undefined, { ref: false }).then(() => caddy.kill("SIGKILL"))]);
  }
  await rm(work, { recursive: true, force: true });
}
