import { readFileSync, readdirSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import ts from "typescript";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const specFiles = ["src/archive/SPEC.md", "src/web/SPEC.md", "ops/SPEC.md"];
export const pmOwned = [
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.mts",
  "eslint.config.mjs", ".gitignore", ".nvmrc", "AGENTS.md", "README.md",
  "src/contract.ts", "scripts/", "test/architecture/", "test/fixtures/",
  ".agent/", ".github/", "specs/", "legacy/",
];

export function contains(scope, path) {
  return scope.endsWith("/") ? path.startsWith(scope) : path === scope;
}

export function parseSpec(text, path) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  return { ...parse(match[1]), specPath: path };
}

export function loadSpecs(read = (path) => readFileSync(resolve(root, path), "utf8")) {
  return specFiles.map((path) => parseSpec(read(path), path));
}

function nonemptyStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim());
}

export function validateSpecs(specs) {
  const errors = [];
  const allPaths = [];
  const names = new Set();
  for (const spec of specs) {
    if (typeof spec.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(spec.name)) errors.push(`${spec.specPath}: invalid name`);
    if (names.has(spec.name)) errors.push(`${spec.name}: duplicate domain`);
    names.add(spec.name);
    if (typeof spec.description !== "string" || !spec.description.trim()) errors.push(`${spec.name}: missing description`);
    for (const field of ["exports", "consumes"]) {
      if (!nonemptyStrings(spec[field])) errors.push(`${spec.name}: missing ${field}`);
    }
    for (const field of ["check", "test", "build"]) {
      const command = spec.verification?.[field];
      if (typeof command !== "string" || !command.trim() || /passWithNoTests|\|\|\s*true/.test(command)) errors.push(`${spec.name}: invalid verification.${field}`);
    }
    for (const field of ["reference", "property"]) {
      if (typeof spec.bar?.[field] !== "string" || spec.bar[field].trim().length < 20) errors.push(`${spec.name}: missing concrete bar.${field}`);
    }
    for (const field of ["owned", "tests"]) {
      const paths = spec.paths?.[field];
      if (!nonemptyStrings(paths)) { errors.push(`${spec.name}: missing paths.${field}`); continue; }
      for (const path of paths) {
        if (path.startsWith("/") || /(^|\/)\.\.?($|\/)|[\\*?{}]/.test(path) || path === "") errors.push(`${spec.name}: unsafe scope ${path}`);
        if (pmOwned.some((pm) => contains(pm, path) || contains(path, pm))) errors.push(`${spec.name}: scope covers PM-owned path ${path}`);
        if (["dist/", "site/", "node_modules/", "data/"].some((out) => contains(out, path) || contains(path, out))) errors.push(`${spec.name}: generated output in ownership ${path}`);
        allPaths.push({ path, name: spec.name });
      }
    }
    if (!spec.paths?.owned?.some((path) => contains(path, spec.specPath))) errors.push(`${spec.name}: own SPEC is outside owned paths`);
  }
  for (let i = 0; i < allPaths.length; i++) {
    for (let j = i + 1; j < allPaths.length; j++) {
      const a = allPaths[i]; const b = allPaths[j];
      if (contains(a.path, b.path) || contains(b.path, a.path)) errors.push(`overlapping scopes: ${a.name}:${a.path} and ${b.name}:${b.path}`);
    }
  }
  return errors;
}

export function scopeViolations(spec, paths) {
  const scopes = [...spec.paths.owned, ...spec.paths.tests];
  return paths.filter((path) => pmOwned.some((pm) => contains(pm, path)) || !scopes.some((scope) => contains(scope, path)));
}

export function sourceViolations(path, text) {
  const errors = [];
  const domain = path.startsWith("src/archive/") ? "archive" : path.startsWith("src/web/") ? "web" : "contract";
  const allowedPackages = domain === "archive" ? ["pmtiles"] : domain === "web" ? ["pmtiles", "maplibre-gl"] : [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  function inspectImport(value) {
    if (!ts.isStringLiteralLike(value)) { errors.push(`${path}: dynamic module name is outside the static contract`); return; }
    const name = value.text;
    if (name.startsWith(".")) {
      const target = posix.normalize(posix.join(posix.dirname(path), name)).replace(/\.(js|mjs)$/, ".ts");
      if (target !== "src/contract.ts" && !target.startsWith(`src/${domain}/`)) errors.push(`${path}: cross-domain import ${name}`);
    } else if (name.startsWith("node:")) {
      if (domain !== "archive") errors.push(`${path}: browser/contract imports Node ${name}`);
    } else if (!allowedPackages.some((allowed) => name === allowed || name.startsWith(`${allowed}/`))) {
      errors.push(`${path}: unapproved dependency ${name}`);
    }
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) inspectImport(node.moduleSpecifier);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) inspectImport(node.argument.literal);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      if (node.arguments.length === 0) errors.push(`${path}: empty module lookup`);
      else inspectImport(node.arguments[0]);
    }
    if (path !== "src/contract.ts" && (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && ["MapManifest", "VectorLayer"].includes(node.name.text)) errors.push(`${path}: duplicated frozen type ${node.name.text}`);
    if (node.kind === ts.SyntaxKind.AnyKeyword || ts.isNonNullExpression(node)) errors.push(`${path}: unbounded type assertion`);
    if (ts.isAsExpression(node) && ts.isAsExpression(node.expression)) errors.push(`${path}: double cast`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

export function walk(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix + entry.name;
    return entry.isDirectory() ? walk(resolve(directory, entry.name), path + "/") : [path];
  });
}
