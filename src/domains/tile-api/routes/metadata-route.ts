import type { TileRequest } from "../types";
import type { TileMetadataResponse } from "../types";
import { handleMetadataRequest } from "../tile-api.service";

export async function tileMetadataRoute(request: TileRequest): Promise<TileMetadataResponse> {
  return handleMetadataRequest(request);
}
