import type { HttpMethod } from "../../contracts/types";

export interface RasterRequest {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query?: Readonly<Record<string, string | string[] | undefined>>;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly clientIp?: string;
}

export interface RasterResponse {
  readonly status: number;
  readonly body?: Uint8Array;
  readonly headers: Record<string, string>;
}
