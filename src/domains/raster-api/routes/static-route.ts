import type { RasterRequest, RasterResponse } from "../types";
import { handleStaticMapRequest } from "../raster-api.service";

export async function staticMapRoute(request: RasterRequest): Promise<RasterResponse> {
  return handleStaticMapRequest(request);
}
