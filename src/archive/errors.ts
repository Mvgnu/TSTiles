export type ArchiveErrorCode =
  | "INVALID_ARCHIVE"
  | "UNSUPPORTED_ARCHIVE"
  | "LIMIT_EXCEEDED"
  | "INPUT_CHANGED"
  | "INVALID_OPTIONS"
  | "DESTINATION_CORRUPT"
  | "ABORTED"
  | "IO_ERROR";

export class ArchiveError extends Error {
  public constructor(
    public readonly code: ArchiveErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ArchiveError";
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function archiveError(error: unknown, context: string): ArchiveError {
  if (error instanceof ArchiveError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ArchiveError("ABORTED", "Archive operation was interrupted.", error);
  }
  return new ArchiveError(
    "IO_ERROR",
    `${context}: ${error instanceof Error ? error.message : "unknown failure"}`,
    error,
  );
}

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ArchiveError("ABORTED", "Archive operation was interrupted.");
}
