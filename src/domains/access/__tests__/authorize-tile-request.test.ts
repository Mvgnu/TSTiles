import { strict as assert } from "node:assert";
import { loadConfig } from "../../../config/load-config";
import { authorizeTileRequest, buildCorsHeaders } from "../access.service";
import type { AuthorizeContext as DomainAuthorizeContext } from "../types";
import { listProjects } from "../../projects/projects.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("authorize tile request policy", () => {
  const baseEnv = {
    OBJECT_STORE_BUCKET: "test-bucket",
    ADMIN_TOKEN: "admin-token",
    ALLOWED_ORIGINS: "https://example.com",
    ALLOWED_TILES_TOKENS: "tile-token",
    NODE_ENV: "development",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "2",
  };

  Object.assign(process.env, baseEnv);

  const config = loadConfig(baseEnv);
  assert.equal(config.security.adminToken, "admin-token");

  const allowed: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
    clientIp: "127.0.0.1",
  };

  const bearerAllowed: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "Bearer tile-token",
    },
    clientIp: "127.0.0.2",
  };

  const deniedOrigin: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://bad.example.com",
      authorization: "tile-token",
    },
    clientIp: "127.0.0.3",
  };

  const unauthorized: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "wrong-token",
    },
  };

  const invalidMethod = {
    method: "POST",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  } as unknown as DomainAuthorizeContext;

  const invalidPath: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/invalid",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  };
  const queryPathAllowed: DomainAuthorizeContext = {
    method: "GET",
    path: "/v1/tiles/2/2/3.mvt?access_token=tile-token",
    query: {
      access_token: "tile-token",
    },
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  };

  const allowResult = authorizeTileRequest(allowed);
  const bearerResult = authorizeTileRequest(bearerAllowed);
  const originDenied = authorizeTileRequest(deniedOrigin);
  const uppercaseOrigin = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      Origin: "https://example.com",
      authorization: "tile-token",
    },
    clientIp: "127.0.0.9",
  });
  const unauthorizedResult = authorizeTileRequest(unauthorized);
  const badMethodResult = authorizeTileRequest(invalidMethod);
  const badPathResult = authorizeTileRequest(invalidPath);
  const queryPathResult = authorizeTileRequest(queryPathAllowed);
  const invalidStaticDimensions = authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/0x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticDimensionsV1 = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const oversizedStaticDimensions = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/5000x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const excessiveStaticZoom = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,31/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticLatitude = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,97.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticLongitude = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-222.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidTileOutOfRange = authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/1/2/0.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidTileZoom = authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/31/0/0.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterOutOfRange = authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/basic/1/2/0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterZoom = authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/basic/31/0/0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterBlankStyleId = authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/%20/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticBlankStyleId = authorizeTileRequest({
    method: "GET",
    path: "/v1/static/%20/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterEncodedSlashStyleId = authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/foo%2Fbar/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });

  assert.equal(allowResult.allow, true);
  assert.equal(bearerResult.allow, true);
  assert.equal(uppercaseOrigin.allow, true);
  assert.equal(originDenied.allow, false);
  assert.equal(originDenied.denyReason, "ACCESS_ORIGIN_DENIED");
  const deniedCorsHeaders = buildCorsHeaders(originDenied, "https://bad.example.com");
  assert.equal(deniedCorsHeaders["access-control-allow-origin"], "*");
  assert.equal(unauthorizedResult.allow, false);
  assert.equal(unauthorizedResult.denyReason, "ACCESS_UNAUTHORIZED");
  assert.equal(unauthorizedResult.sanitizedIdentity, "anon");
  assert.equal(badMethodResult.allow, false);
  assert.equal(badMethodResult.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(badPathResult.allow, false);
  assert.equal(badPathResult.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(queryPathResult.allow, true);
  assert.equal(invalidStaticDimensions.allow, false);
  assert.equal(invalidStaticDimensions.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticDimensionsV1.allow, false);
  assert.equal(invalidStaticDimensionsV1.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(oversizedStaticDimensions.allow, false);
  assert.equal(oversizedStaticDimensions.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(excessiveStaticZoom.allow, false);
  assert.equal(excessiveStaticZoom.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticLatitude.allow, false);
  assert.equal(invalidStaticLatitude.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticLongitude.allow, false);
  assert.equal(invalidStaticLongitude.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidTileOutOfRange.allow, false);
  assert.equal(invalidTileOutOfRange.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidTileZoom.allow, false);
  assert.equal(invalidTileZoom.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterOutOfRange.allow, false);
  assert.equal(invalidRasterOutOfRange.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterZoom.allow, false);
  assert.equal(invalidRasterZoom.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterBlankStyleId.allow, false);
  assert.equal(invalidRasterBlankStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticBlankStyleId.allow, false);
  assert.equal(invalidStaticBlankStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterEncodedSlashStyleId.allow, false);
  assert.equal(invalidRasterEncodedSlashStyleId.denyReason, "ACCESS_BAD_REQUEST");

  const limitedClientIp = "10.0.0.1";
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "1";
  const limitedA: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
    clientIp: limitedClientIp,
  };
  const limitedB: DomainAuthorizeContext = {
    ...limitedA,
    clientIp: limitedClientIp,
  };
  const limitedFirst = authorizeTileRequest(limitedA);
  assert.equal(limitedFirst.allow, true);
  assert.equal(limitedFirst.rateLimitRemaining, 0);
  const limitedSecond = authorizeTileRequest(limitedB);
  assert.equal(limitedSecond.allow, false);
  assert.equal(limitedSecond.denyReason, "ACCESS_RATE_LIMITED");
  assert.equal(typeof limitedSecond.sanitizedIdentity, "string");
  assert.equal(limitedSecond.sanitizedIdentity?.includes(":"), true);

  const originalRateLimit = process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE;
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "10";

  const originalAllowlist = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "*.example.com";
  const wildcardSubdomain = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardSubdomain.allow, true);

  const wildcardExact = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardExact.allow, true);

  const wildcardBlocked = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.otherexample.net",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardBlocked.allow, false);

  const wildcardWithProtocol = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "http://api.example.com",
      authorization: "tile-token",
    },
  } as unknown as DomainAuthorizeContext);
  assert.equal(wildcardWithProtocol.allow, true);

  process.env.ALLOWED_ORIGINS = "https://*.example.com";
  const wildcardProtocolMatch = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardProtocolMatch.allow, true);

  const wildcardProtocolBlocked = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "http://api.example.com",
      authorization: "tile-token",
    },
  } as unknown as DomainAuthorizeContext);
  assert.equal(wildcardProtocolBlocked.allow, false);

  const projects = listProjects();
  const legacyProject = projects.find((project) => project.name === "legacy");
  assert.equal(legacyProject !== undefined, true);
  if (legacyProject) {
    const mutableProject = legacyProject as {
      policy: {
        allowedOrigins?: readonly string[];
        allowedEndpoints: {
          tiles: boolean;
          raster: boolean;
          staticMaps: boolean;
        };
      };
    };
    mutableProject.policy = {
      allowedOrigins: ["https://tenant.example"],
      allowedEndpoints: {
        tiles: true,
        raster: false,
        staticMaps: false,
      },
    };
  }

  const projectAllowedByPolicy = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(projectAllowedByPolicy.allow, true);
  const projectScopedAllowed = buildCorsHeaders(projectAllowedByPolicy, "https://api.example.com");
  assert.equal(projectScopedAllowed["access-control-allow-origin"], "https://api.example.com");
  const projectDeniedByPolicy = authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://other.example.net",
      authorization: "tile-token",
    },
  });
  assert.equal(projectDeniedByPolicy.allow, false);
  const projectHeaders = buildCorsHeaders(projectDeniedByPolicy, "https://other.example.net");
  assert.equal(projectHeaders["access-control-allow-origin"], "*");
  const rasterAllowedByPolicy = authorizeTileRequest({
    method: "GET",
    path: "/raster/basic/2/2/3.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(rasterAllowedByPolicy.allow, true);

  const previousRateLimit = process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE;
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "1";
  const staticFirst = authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
    clientIp: "10.33.0.1",
  });
  const staticSecond = authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
    clientIp: "10.33.0.1",
  });
  const staticThird = authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
    clientIp: "10.33.0.2",
  });
  assert.equal(staticFirst.allow, true);
  assert.equal(staticSecond.allow, false);
  assert.equal(staticSecond.denyReason, "ACCESS_RATE_LIMITED");
  assert.equal(staticThird.allow, true);
  if (previousRateLimit === undefined) {
    delete process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE;
  } else {
    process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = previousRateLimit;
  }

  if (originalRateLimit === undefined) {
    delete process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE;
  } else {
    process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = originalRateLimit;
  }
  if (originalAllowlist === undefined) {
    delete process.env.ALLOWED_ORIGINS;
  } else {
    process.env.ALLOWED_ORIGINS = originalAllowlist;
  }
});
