import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ArchiveError, inspectArchive, publishArchive } from "./index.js";

const help = `TSTiles archive preparation

  inspect <file.pmtiles>
  publish <file.pmtiles> --out <directory> --id <slug> --name <text>
          [--attribution <plain-text credit>] [--style <ready-to-serve URL>]
          [--link]

Publication uses archive metadata attribution when --attribution is omitted.
Input must already be vector PMTiles v3. No OSM conversion is performed.
Inspection covers the header and metadata, not every directory or tile.

By default publish copies the archive (needs free space for a second copy).
--link copies no bytes: it hashes the source in place and hard-links it to
<out>/archives/<sha256>.pmtiles, then writes the manifest last. The source
must be an ordinary file (not a symlink) on the same filesystem as --out;
otherwise publication fails (it never falls back to copying). Afterwards
both names share one inode: remove the original name or never modify it,
because writing to either name changes the published, immutable archive.
`;

const valueFlags = ["--out", "--id", "--name", "--attribution", "--style"] as const;
const booleanFlags = ["--link"] as const;
type PublishFlag = typeof valueFlags[number] | typeof booleanFlags[number];
const flagError = "Publish options must be unique --out, --id, --name, --attribution or --style flags each followed by a value, or a valueless --link.";

function isValueFlag(key: string): key is typeof valueFlags[number] {
  return (valueFlags as readonly string[]).includes(key);
}

function isBooleanFlag(key: string): key is typeof booleanFlags[number] {
  return (booleanFlags as readonly string[]).includes(key);
}

function parsePublishFlags(args: readonly string[]): Map<PublishFlag, string | true> {
  const flags = new Map<PublishFlag, string | true>();
  let index = 0;
  while (index < args.length) {
    const key = args[index];
    if (key === undefined) throw new ArchiveError("INVALID_OPTIONS", flagError);
    if (isBooleanFlag(key)) {
      // A following non-flag token is not a value for --link; it is rejected as an unknown flag next.
      if (flags.has(key)) throw new ArchiveError("INVALID_OPTIONS", flagError);
      flags.set(key, true);
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!isValueFlag(key) || flags.has(key) || value === undefined || value.startsWith("--")) {
      throw new ArchiveError("INVALID_OPTIONS", flagError);
    }
    flags.set(key, value);
    index += 2;
  }
  return flags;
}

function stringFlag(flags: Map<PublishFlag, string | true>, key: PublishFlag): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

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
  const flags = parsePublishFlags(args.slice(2));
  const outDir = stringFlag(flags, "--out");
  const id = stringFlag(flags, "--id");
  const name = stringFlag(flags, "--name");
  if (outDir === undefined || id === undefined || name === undefined) {
    throw new ArchiveError("INVALID_OPTIONS", "publish requires --out, --id and --name.");
  }
  return JSON.stringify(await publishArchive(file, {
    outDir, id, name,
    attribution: stringFlag(flags, "--attribution"),
    style: stringFlag(flags, "--style"),
    mode: flags.has("--link") ? "link" : "copy",
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
