export interface AdminRouteResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

export function adminJsonResponse(
  status: number,
  body: unknown,
  cacheControl = "no-store",
): AdminRouteResponse {
  return {
    status,
    body,
    headers: {
      "content-type": "application/json",
      "cache-control": cacheControl,
    },
  };
}
