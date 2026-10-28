import { execFileSync } from "node:child_process";
import { loadSpecs, root, scopeViolations, validateSpecs } from "./architecture.mjs";

const [domain, base] = process.argv.slice(2);
if (!domain || !base) {
  console.error("Usage: npm run scope:check -- <archive|web|hosting> <base-ref>");
  process.exit(1);
}
function git(...args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }); }
try {
  const sha = git("rev-parse", "--verify", `${base}^{commit}`).trim();
  const baseSpecs = loadSpecs((path) => git("show", `${sha}:${path}`));
  const currentSpecs = loadSpecs();
  const spec = baseSpecs.find((item) => item.name === domain);
  const current = currentSpecs.find((item) => item.name === domain);
  if (!spec || !current) throw new Error(`Unknown domain: ${domain}`);
  const errors = [...validateSpecs(baseSpecs), ...validateSpecs(currentSpecs)];
  if (JSON.stringify(spec.paths) !== JSON.stringify(current.paths)) errors.push("A builder cannot widen or change its own ownership; ask the PM.");
  const changed = new Set([
    ...git("diff", "--name-only", "--no-renames", "-z", sha, "--").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean));
  const escaped = scopeViolations(spec, [...changed]);
  errors.push(...escaped.map((path) => `Outside ${domain} write gate: ${path}`));
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`${domain}: ${changed.size} changed paths are inside the original write gate.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
