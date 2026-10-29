// Shared route checks for the landing and legal pages and robots.txt, run against both Caddy
// (http.test.mjs) and nginx (nginx.test.mjs) so the two route tables stay in parity.
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const LEGAL_PAGES = ["impressum", "datenschutz", "nutzungsbedingungen"];

export async function writePages(site) {
  for (const page of LEGAL_PAGES) {
    await writeFile(join(site, `${page}.html`), `<!doctype html><title>${page} fixture</title>`);
  }
  await writeFile(join(site, "robots.txt"), "User-agent: *\nAllow: /\n");
}

function assertCors(response, label) {
  assert.equal(response.headers.get("access-control-allow-origin"), "*", `${label}: CORS`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${label}: nosniff`);
}

/** `request(path, init)` must not follow redirects. Removes robots.txt at the end. */
export async function assertPageRoutes(request, site) {
  for (const path of ["/", "/index.html", ...LEGAL_PAGES.map((page) => `/${page}`)]) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /^text\/html/, path);
    assert.equal(response.headers.get("cache-control"), "no-cache", path);
    assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin", path);
    assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'self'", path);
    assert.equal(response.headers.get("x-frame-options"), null, path);
    assertCors(response, path);
    const body = await response.text();
    if (path.length > 1 && path !== "/index.html") assert.match(body, new RegExp(`${path.slice(1)} fixture`), path);
    const revalidated = await request(path, { headers: { "If-None-Match": response.headers.get("etag") } });
    assert.equal(revalidated.status, 304, `${path} revalidation`);
    assert.equal(revalidated.headers.get("cache-control"), "no-cache", `${path} revalidation`);
    assertCors(revalidated, `304 ${path}`);
  }
  for (const page of LEGAL_PAGES) {
    const response = await request(`/${page}.html`);
    assert.equal(response.status, 301, `/${page}.html`);
    assert.equal(response.headers.get("location"), `/${page}`, `/${page}.html`);
    assert.equal(response.headers.get("cache-control"), "no-store", `/${page}.html`);
    assertCors(response, `/${page}.html`);
    await response.arrayBuffer();
  }
  for (const path of ["/impressum/", "/Impressum.htm", "/impressum.html/x", "/viewer", "/viewer.html", "/kontakt", "/kontakt.html", "/sitemap.xml"]) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.get("cache-control"), "no-store", path);
    assertCors(response, path);
    await response.arrayBuffer();
  }
  const robots = await request("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.headers.get("content-type"), /^text\/plain/);
  assert.equal(robots.headers.get("cache-control"), "public, max-age=300, must-revalidate");
  assertCors(robots, "/robots.txt");
  assert.equal(await robots.text(), "User-agent: *\nAllow: /\n");
  // A legal page that has not been deployed yet is an ordinary uncached 404, as is robots.txt.
  await rm(join(site, "robots.txt"));
  await rm(join(site, "nutzungsbedingungen.html"));
  for (const path of ["/robots.txt", "/nutzungsbedingungen"]) {
    const missing = await request(path);
    assert.equal(missing.status, 404, `${path} without its file`);
    assert.equal(missing.headers.get("cache-control"), "no-store", `${path} without its file`);
    assertCors(missing, `${path} without its file`);
    await missing.arrayBuffer();
  }
}
