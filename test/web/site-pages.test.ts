import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PAGES = ["index.html", "impressum.html", "datenschutz.html", "nutzungsbedingungen.html"];
const read = (name: string) => readFile("public/" + name, "utf8");
const unescape = (html: string) => html.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&amp;/gu, "&");

describe("public site pages", () => {
  it("is exactly the landing page plus three legal pages (no viewer page)", async () => {
    expect((await readdir("public")).filter((name) => name.endsWith(".html")).sort()).toEqual([...PAGES].sort());
  });

  it.each(PAGES)("%s is German, self-contained and links the legal pages", async (name) => {
    const html = await read(name);
    expect(html).toMatch(/<html lang="de">/u);
    expect(html).toMatch(/<title>[^<]+<\/title>/u);
    expect(html).toMatch(/<meta name="description" content="[^"]{40,}">/u);
    expect(html).toContain('<link rel="icon" href="./assets/favicon.svg"');
    for (const link of ["./impressum", "./datenschutz", "./nutzungsbedingungen"]) expect(html).toContain('href="' + link + '"');
    // No third-party requests: every src/href that loads something is same-origin.
    const loaded = [
      ...[...html.matchAll(/<link\b[^>]*>/gu)].map(([tag]) => tag).filter((tag) => !tag.includes('rel="canonical"'))
        .map((tag) => /href="([^"]+)"/u.exec(tag)?.[1]),
      ...[...html.matchAll(/<(?:script|img|iframe)\b[^>]*\ssrc="([^"]+)"/gu)].map((match) => match[1]),
    ];
    expect(loaded.length).toBeGreaterThan(1);
    for (const url of loaded) expect(url, "same-origin resource").toMatch(/^\.\//u);
    expect(html).not.toMatch(/googleapis|googletagmanager|google-analytics|plausible|matomo|document\.cookie/iu);
  });

  it("states the operator verbatim and marks legal texts as an unreviewed template", async () => {
    for (const name of PAGES.slice(1)) {
      const html = await read(name);
      expect(html).toContain("VORLAGE");
      expect(html).toContain("nicht rechtlich geprüft");
    }
    const imprint = await read("impressum.html");
    for (const line of ["Magnus Ohle", "Haaggasse 10", "72070 Tübingen", "Deutschland", "info@itstiles.com"]) expect(imprint).toContain(line);
    const privacy = await read("datenschutz.html");
    for (const fact of ["14 Tagen", "Cloudflare, Inc.", "Data Privacy Framework", "Art. 6 Abs. 1 lit. f DSGVO", "Frankfurt am Main", "Art. 15", "Baden-Württemberg", "nicht protokolliert"]) {
      expect(privacy).toContain(fact);
    }
  });

  it("landing page: canonical/OG tags, live map hero, flavor switcher and tested copy snippets", async () => {
    const html = await read("index.html");
    expect(html).toContain('<link rel="canonical" href="https://itstiles.com/">');
    for (const tag of ["og:title", "og:description", "og:url", "og:type", "og:locale"]) expect(html).toContain('property="' + tag + '"');
    expect(html).toContain('id="hero-map"');
    for (const flavor of ["light", "dark", "white", "grayscale", "black"]) expect(html).toContain('value="' + flavor + '"');
    expect(html).toContain("https://github.com/Mvgnu/TSTiles/blob/main/docs/integration.md");
    const code = (id: string) => unescape(new RegExp('<code id="' + id + '">([\\s\\S]*?)</code>', "u").exec(html)?.[1] ?? "");
    expect(code("snippet-npm")).toBe((await readFile("test/web/integration-snippets/landing-npm.ts", "utf8")).trimEnd());
    const embed = code("snippet-html");
    expect(embed).toContain('import { createMapViewer } from "https://itstiles.com/assets/embed.js";');
    expect(embed).toContain('manifestUrl: "https://itstiles.com/maps/light.json"');
    expect(embed).toContain('<div id="karte"');
    expect(embed).toContain('container: "karte"');
    expect(html).not.toMatch(/embed=1|<iframe/u);
  });
});
