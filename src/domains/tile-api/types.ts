import type { HttpMethod } from "../../contracts/types";

export const enum TileApiErrorCode {
  BAD_COORDINATES = "TILE_BAD_COORDINATES",
  NOT_FOUND = "TILE_NOT_FOUND",
  ARTIFACT_UNAVAILABLE = "TILE_ARTIFACT_UNAVAILABLE",
  ORIGIN_READ_FAILED = "TILE_ORIGIN_READ_FAILED",
  HEAD_DISABLED = "HEAD_DISABLED",
  BAD_REQUEST = "TILE_BAD_REQUEST",
  HEALTH_NOT_FOUND = "HEALTH_NOT_FOUND",
  HEALTH_BAD_REQUEST = "HEALTH_BAD_REQUEST",
  HEALTH_UNAVAILABLE = "HEALTH_UNAVAILABLE",
}

export class TileApiError extends Error {
  public readonly code: TileApiErrorCode;

  public constructor(code: TileApiErrorCode) {
    super(code);
    this.code = code;
    this.name = "TileApiError";
  }
}

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
