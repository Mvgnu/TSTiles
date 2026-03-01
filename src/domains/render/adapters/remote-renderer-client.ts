import type { RenderFormat } from "../types";

export interface RenderInput {
  readonly styleId: string;
  readonly styleVersionKey: string;
  readonly artifactId: string;
  readonly sourcePath: string;
  readonly format: RenderFormat;
  readonly width?: number;
  readonly height?: number;
}

export interface RenderAdapterOutput {
  readonly bytes: Uint8Array;
}

export async function renderWithRemoteService(input: RenderInput): Promise<RenderAdapterOutput> {
  // Placeholder remote-renderer adapter.
  // In production this should call an external worker service.
  return renderLocalFallback(input);
}

function renderLocalFallback(input: RenderInput): RenderAdapterOutput {
  const marker = [
    "remote-renderer",
    input.format,
    `size=${input.width ?? 256}x${input.height ?? 256}`,
    input.styleId,
    input.styleVersionKey,
    input.artifactId,
    input.sourcePath,
  ].join("|");
  return {
    bytes: new TextEncoder().encode(marker),
  };
}
