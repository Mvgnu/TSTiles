import type { TileRequest } from "../types";
import type { TileResponse } from "../types";
import { handleTileRequest } from "../tile-api.service";

export async function tileRoute(request: TileRequest): Promise<TileResponse> {
  return handleTileRequest(request);
}
