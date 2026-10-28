import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ArchiveError, inspectArchive, publishArchive } from "./index.js";

const help = `TSTiles archive preparation

  inspect <file.pmtiles>
  publish <file.pmtiles> --out <directory> --id <slug> --name <text>
          [--attribution <plain-text credit>] [--style <ready-to-serve URL>]

Publication uses archive metadata attribution when --attribution is omitted.
Input must already be vector PMTiles v3. No OSM conversion is performed.
Inspection covers the header and metadata, not every directory or tile.
`;

export async function runCli(args: readonly string[], signal?: AbortSignal): Promise<string> {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return help;
  const command = args[0];
  const file = args[1];
  if ((command !== "inspect" && command !== "publish") || !file || file.startsWith("--")) {
    throw new ArchiveError("INVALID_OPTIONS", "Use inspect <file> or publish <file> --out <dir> --id <slug> --name <text>. Run --help for details.");
  }
  if (command === "inspect") {
    if (args.length !== 2) throw new ArchiveError("INVALID_OPTIONS", "inspect accepts exactly one local archive path.");
    return JSON.stringify(await inspectArchive(file, { signal }), null, 2);
  }
  const flags = new Map<string, string>();
  const allowed = new Set(["--out", "--id", "--name", "--attribution", "--style"]);
  for (let index = 2; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (key === undefined || !allowed.has(key) || value === undefined || value.startsWith("--") || flags.has(key)) {
      throw new ArchiveError("INVALID_OPTIONS", "Publish options must be unique --out, --id, --name, --attribution or --style flags, each followed by a value.");
    }
    flags.set(key, value);
  }
  const outDir = flags.get("--out");
  const id = flags.get("--id");
  const name = flags.get("--name");
  if (outDir === undefined || id === undefined || name === undefined) {
    throw new ArchiveError("INVALID_OPTIONS", "publish requires --out, --id and --name.");
  }
  return JSON.stringify(await publishArchive(file, {
    outDir, id, name,
    attribution: flags.get("--attribution"),
    style: flags.get("--style"),
    signal,
  }), null, 2);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  runCli(process.argv.slice(2), controller.signal)
    .then(result => { console.log(result); })
    .catch((error: unknown) => {
      const code = error instanceof ArchiveError ? error.code : "IO_ERROR";
      const message = error instanceof Error ? error.message : "Unknown archive operation failure.";
      console.error(`${code}: ${message}`);
      process.exitCode = code === "ABORTED" ? 130 : 1;
    })
    .finally(() => {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    });
}
