import type { HttpMethod } from "../../contracts/types";

export interface TileRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface TileResponse {
  readonly status: number;
  readonly body?: Uint8Array;
  readonly headers: Record<string, string>;
}

export interface TileMetadataResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}
