import type { IngestRunReport } from "../types";

const lockState = new Map<string, Promise<IngestRunReport>>();

export async function withIngestLock(
  name: string,
  fn: () => Promise<IngestRunReport>,
): Promise<IngestRunReport> {
  const existing = lockState.get(name);
  if (existing) {
    return existing;
  }

  const running = (async (): Promise<IngestRunReport> => {
    try {
      return await fn();
    } finally {
      lockState.delete(name);
    }
  })();
  lockState.set(name, running);
  return running;
}
