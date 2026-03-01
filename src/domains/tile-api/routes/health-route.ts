import type { TileRequest, TileResponse } from "../types";
import { handleHealthRequest } from "../tile-api.service";

export async function tileHealthRoute(request: TileRequest): Promise<TileResponse> {
  return handleHealthRequest(request);
}
