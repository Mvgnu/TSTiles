import { publishArchive } from "../dist/archive/index.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = await publishArchive(resolve(root, "test/fixtures/one-tile.pmtiles"), {
  outDir: resolve(root, "site"),
  id: "fixture",
  name: "One-polygon test fixture",
  attribution: "Delivery test fixture — not a geographical basemap",
});
console.log(JSON.stringify(result, null, 2));
