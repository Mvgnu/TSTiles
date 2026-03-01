import { loadConfig } from "../../../config/load-config";

export function rasterHealthRoute(): { status: number; body: unknown } {
  loadConfig();
  return {
    status: 200,
    body: {
      ok: true,
      service: "raster_api",
      mode: "in-memory-renderer",
    },
  };
}
