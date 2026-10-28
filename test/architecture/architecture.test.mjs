import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { contains, loadSpecs, pmOwned, root, scopeViolations, sourceViolations, validateSpecs, walk } from "../../scripts/architecture.mjs";

test("active domain specs have disjoint scopes, real gates, and external bars", () => {
  assert.deepEqual(validateSpecs(loadSpecs()), []);
});

test("ownership cannot cover contracts, another domain, or generated files", () => {
  const specs = loadSpecs();
  const archive = specs.find((spec) => spec.name === "archive");
  assert.deepEqual(scopeViolations(archive, ["src/archive/new.ts", "test/archive/new.test.ts", "src/contract.ts", "src/web/main.ts", "package.json"]), ["src/contract.ts", "src/web/main.ts", "package.json"]);
  const overlap = structuredClone(specs);
  overlap[0].paths.owned.push("src/web/");
  assert.ok(validateSpecs(overlap).some((error) => error.includes("overlapping")));
  const escaped = structuredClone(specs);
  escaped[0].paths.owned.push("src/", "site/");
  assert.ok(validateSpecs(escaped).some((error) => error.includes("PM-owned")));
  assert.ok(validateSpecs(escaped).some((error) => error.includes("generated")));
});

test("source dependency graph stays inside domains and frozen types", () => {
  const errors = walk(resolve(root, "src"), "src/")
    .filter((path) => path.endsWith(".ts"))
    .flatMap((path) => sourceViolations(path, readFileSync(resolve(root, path), "utf8")));
  assert.deepEqual(errors, []);
});

test("dependency gate catches actual architecture escapes", () => {
  const bad = [
    'import x from "../../legacy/saas/src/config/db.js";',
    'export { x } from "../web/main.js";',
    'const x = import("../web/main.js");',
    'const x = import(variable);',
    'type X = import("../web/main.js").Thing;',
    'interface MapManifest { invented: string }',
    'const x = value as unknown as string;',
  ];
  for (const code of bad) assert.notDeepEqual(sourceViolations("src/archive/example.ts", code), [], code);
  assert.notDeepEqual(sourceViolations("src/web/example.ts", 'import fs from "node:fs";'), []);
  assert.deepEqual(sourceViolations("src/archive/example.ts", 'import type { MapManifest } from "../contract.js"; import { PMTiles } from "pmtiles";'), []);
});

test("each active implementation path has exactly one declared owner", () => {
  const specs = loadSpecs();
  for (const directory of ["src", "public", "ops", "test"]) {
    for (const path of walk(resolve(root, directory), `${directory}/`)) {
      const domainOwners = specs.filter((spec) => [...spec.paths.owned, ...spec.paths.tests].some((scope) => contains(scope, path)));
      const pm = pmOwned.some((scope) => contains(scope, path));
      assert.equal(domainOwners.length + Number(pm), 1, path);
    }
  }
});

test("default toolchain cannot install or run the archived SaaS", () => {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["maplibre-gl", "pmtiles"]);
  assert.equal(pkg.workspaces, undefined);
  for (const command of Object.values(pkg.scripts)) assert.doesNotMatch(command, /legacy|prisma|db:push|accept-data-loss|passWithNoTests/);
  const tsconfig = JSON.parse(readFileSync(resolve(root, "tsconfig.json"), "utf8"));
  assert.deepEqual(tsconfig.include, ["src/**/*.ts", "test/**/*.ts"]);
});
