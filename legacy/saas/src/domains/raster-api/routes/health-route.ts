import { loadConfig } from "../../../config/load-config";

export function rasterHealthRoute(): { status: number; body: unknown } {
  const config = loadConfig();
  return {
    status: 200,
    body: {
      ok: true,
      service: "raster_api",
      mode: config.storage.mode === "memory" ? "in-memory-renderer" : "object-store-renderer",
      environment: config.environment,
    },
  };
}
