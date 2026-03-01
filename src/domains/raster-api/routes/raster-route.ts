import type { RasterRequest, RasterResponse } from "../types";
import { handleRasterTileRequest } from "../raster-api.service";

export async function rasterTileRoute(request: RasterRequest): Promise<RasterResponse> {
  return handleRasterTileRequest(request);
}
