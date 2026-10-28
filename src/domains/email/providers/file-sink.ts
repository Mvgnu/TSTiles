import { appendFileSync } from "node:fs";

export interface EmailFileRecord {
  readonly emittedAt: string;
  readonly to: string;
  readonly templateKey: string;
  readonly params: Record<string, unknown>;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export async function writeToFileSink(filePath: string, record: EmailFileRecord): Promise<void> {
  const line = `${JSON.stringify(record)}\n`;
  appendFileSync(filePath, line, { encoding: "utf8" });
}
