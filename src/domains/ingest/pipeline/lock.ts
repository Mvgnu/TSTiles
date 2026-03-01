const lockState = new Map<string, Promise<unknown>>();

export async function withIngestLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const existing = lockState.get(name);
  if (existing) {
    return existing as Promise<T>;
  }

  const running = (async (): Promise<T> => {
    try {
      return await fn();
    } finally {
      lockState.delete(name);
    }
  })();
  lockState.set(name, running);
  return running;
}
