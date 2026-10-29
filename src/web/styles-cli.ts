// Operator CLI: writes ready-to-serve Protomaps basemap styles (one per flavor).
import { StyleBuildError } from "./basemap.js";
import { runStylesBuild, STYLES_USAGE } from "./styles-build.js";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(STYLES_USAGE);
} else {
  try {
    const result = await runStylesBuild(argv);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof StyleBuildError ? error.message : error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
