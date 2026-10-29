import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
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
console.log("Built archive CLI and static MapLibre viewer. Existing site/maps and site/archives are preserved.");
