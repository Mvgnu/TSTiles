import { createHash } from "node:crypto";
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

export async function renderLocally(input: RenderInput): Promise<RenderAdapterOutput> {
  const hash = createHash("sha256")
    .update(`${input.styleId}|${input.styleVersionKey}|${input.artifactId}|${input.sourcePath}`)
    .digest("hex")
    .slice(0, 16);
  const marker = [
    "local-render",
    input.format,
    `size=${input.width ?? 256}x${input.height ?? 256}`,
    `style=${input.styleId}`,
    `v=${input.styleVersionKey}`,
    `artifact=${input.artifactId}`,
    `tile=${input.sourcePath}`,
    `stamp=${hash}`,
  ].join("|");
  return {
    bytes: new TextEncoder().encode(marker),
  };
}
