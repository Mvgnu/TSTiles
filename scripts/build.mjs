import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(resolve(root, "site/assets"), { recursive: true });
await cp(resolve(root, "public"), resolve(root, "site"), { recursive: true });
await cp(resolve(root, "node_modules/maplibre-gl/dist/maplibre-gl.css"), resolve(root, "site/assets/maplibre-gl.css"));
await build({
  absWorkingDir: root,
  entryPoints: { viewer: "src/web/main.ts", embed: "src/web/embed.ts" },
  outdir: "site/assets",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "linked",
});
await build({
  absWorkingDir: root,
  entryPoints: ["src/archive/cli.ts", "src/archive/index.ts"],
  outdir: "dist/archive",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  target: "node22",
});
// Operator CLI that writes ready-to-serve basemap styles; web-domain owned source.
await build({
  absWorkingDir: root,
  entryPoints: ["src/web/styles-cli.ts"],
  outdir: "dist/web",
  bundle: true,
  packages: "external",
  format: "esm",
  platform: "node",
  target: "node22",
});
// Fixed asset names may sit in browser/CDN caches for hours; version the
// references in our own pages so a new page never runs an old script.
const versions = new Map();
for (const name of await readdir(resolve(root, "site/assets"))) {
  const bytes = await readFile(resolve(root, "site/assets", name));
  versions.set(name, createHash("sha256").update(bytes).digest("hex").slice(0, 12));
}
for (const page of (await readdir(resolve(root, "site"))).filter(name => name.endsWith(".html"))) {
  const path = resolve(root, "site", page);
  const html = await readFile(path, "utf8");
  await writeFile(path, html.replace(/(["'])\.\/assets\/([\w.@-]+)\1/g, (match, quote, name) =>
    versions.has(name) ? `${quote}./assets/${name}?v=${versions.get(name)}${quote}` : match));
}
console.log("Built archive CLI and static MapLibre viewer. Existing site/maps and site/archives are preserved.");
