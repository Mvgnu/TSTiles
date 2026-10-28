import { appendFileSync } from "node:fs";
import { loadConfig } from "../../../config/load-config";

export interface EmailConsoleRecord {
  readonly type: "email_dispatch";
  readonly emittedAt: string;
  readonly to: string;
  readonly templateKey: string;
  readonly params: Record<string, unknown>;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export async function writeToConsoleSink(record: EmailConsoleRecord): Promise<void> {
  let sink;
  try {
    sink = loadConfig().observability.logSink;
  } catch {
    // Fallback if loadConfig throws during testing or bootstrapping
    sink = { kind: "stdout" as const };
  }

  const line = `${JSON.stringify(record)}\n`;
  if (sink.kind === "stdout") {
    process.stdout.write(line);
  } else if (sink.kind === "file") {
    try {
      appendFileSync(sink.path, line, { encoding: "utf8" });
    } catch (error) {
      // In development/test, best effort so we don't crash
      console.error(`[email] Failed to write to file log sink: ${error}`);
      process.stdout.write(line);
    }
  } else {
    // kind is "none", so we do not write to the observability sink
  }
}
