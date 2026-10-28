import { strict as assert } from "node:assert";
import { loadConfig } from "../../../config/load-config";
import { authorizeTileRequest, buildCorsHeaders, resolveAllowedOrigins } from "../access.service";
import type { AuthorizeContext as DomainAuthorizeContext } from "../types";
import { createProject, listProjects, rotateApiKey } from "../../projects/projects.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("authorize tile request policy", async () => {
  const baseEnv = {
    OBJECT_STORE_BUCKET: "test-bucket",
    ADMIN_TOKEN: "admin-token",
    ALLOWED_ORIGINS: "https://example.com",
    ALLOWED_TILES_TOKENS: "tile-token",
    NODE_ENV: "development",
    ENABLE_RATE_LIMIT: "true",
    RATE_LIMIT_MAX_REQUESTS_PER_MINUTE: "10",
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

  const allowResult = await authorizeTileRequest(allowed);
  const bearerResult = await authorizeTileRequest(bearerAllowed);
  const originDenied = await authorizeTileRequest(deniedOrigin);
  const uppercaseOrigin = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      Origin: "https://example.com",
      authorization: "tile-token",
    },
    clientIp: "127.0.0.9",
  });
  const unauthorizedResult = await authorizeTileRequest(unauthorized);
  const badMethodResult = await authorizeTileRequest(invalidMethod);
  const badPathResult = await authorizeTileRequest(invalidPath);
  const nonStringPathResult = await authorizeTileRequest({
    method: "GET",
    path: 42 as unknown as string,
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const queryPathResult = await authorizeTileRequest(queryPathAllowed);
  const invalidStaticDimensions = await authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/0x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticDimensionsV1 = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/640x0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const oversizedStaticDimensions = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,12/5000x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const excessiveStaticZoom = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,37.7749,31/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticLatitude = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,97.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticMercatorLatitude = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-122.4194,85.2,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticLongitude = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/basic/-222.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidTileOutOfRange = await authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/1/2/0.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidTileZoom = await authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/31/0/0.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterOutOfRange = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/basic/1/2/0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterZoom = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/basic/31/0/0.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterBlankStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/%20/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticBlankStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/%20/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterEncodedSlashStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/foo%2Fbar/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterEncodedBackslashStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/foo%5Cbar/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterDotStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/%2E/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidRasterTraversalStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/raster/..%2Fsecret/2/2/3.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticEncodedBackslashStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/foo%5Cbar/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticDotStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/%2E/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  const invalidStaticTraversalStyleId = await authorizeTileRequest({
    method: "GET",
    path: "/v1/static/..%2Fsecret/-122.4194,37.7749,12/640x480.png",
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
  assert.equal(deniedCorsHeaders["access-control-allow-origin"], "null");
  assert.equal(deniedCorsHeaders["access-control-allow-headers"].includes("x-api-token"), true);
  assert.equal(unauthorizedResult.allow, false);
  assert.equal(unauthorizedResult.denyReason, "ACCESS_UNAUTHORIZED");
  assert.equal(unauthorizedResult.sanitizedIdentity, "anon");
  assert.equal(badMethodResult.allow, false);
  assert.equal(badMethodResult.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(badPathResult.allow, false);
  assert.equal(badPathResult.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(nonStringPathResult.allow, false);
  assert.equal(nonStringPathResult.denyReason, "ACCESS_BAD_REQUEST");
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
  assert.equal(invalidStaticMercatorLatitude.allow, false);
  assert.equal(invalidStaticMercatorLatitude.denyReason, "ACCESS_BAD_REQUEST");
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
  assert.equal(invalidRasterEncodedBackslashStyleId.allow, false);
  assert.equal(invalidRasterEncodedBackslashStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterDotStyleId.allow, false);
  assert.equal(invalidRasterDotStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidRasterTraversalStyleId.allow, false);
  assert.equal(invalidRasterTraversalStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticEncodedBackslashStyleId.allow, false);
  assert.equal(invalidStaticEncodedBackslashStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticDotStyleId.allow, false);
  assert.equal(invalidStaticDotStyleId.denyReason, "ACCESS_BAD_REQUEST");
  assert.equal(invalidStaticTraversalStyleId.allow, false);
  assert.equal(invalidStaticTraversalStyleId.denyReason, "ACCESS_BAD_REQUEST");

  const limitedClientIp = "10.0.0.1";
  const mixedCaseApiTokenProject = await createProject({
    name: "Access Mixed Case Header Project",
  });
  const mixedCaseApiTokenKey = await rotateApiKey(mixedCaseApiTokenProject.id);
  const mixedCaseApiTokenResult = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      "X-Api-Token": mixedCaseApiTokenKey.token,
    },
    clientIp: "127.0.0.8",
  });
  assert.equal(mixedCaseApiTokenResult.allow, true);

  const limitedProject = await createProject({
    name: "Access Rate Limit Project",
  });
  const limitedKey = await rotateApiKey(limitedProject.id);
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "1";
  const limitedA: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: limitedKey.token,
    },
    clientIp: limitedClientIp,
  };
  const limitedB: DomainAuthorizeContext = {
    ...limitedA,
    clientIp: limitedClientIp,
  };
  const limitedFirst = await authorizeTileRequest(limitedA);
  assert.equal(limitedFirst.allow, true);
  assert.equal(limitedFirst.rateLimitRemaining, 0);
  const limitedSecond = await authorizeTileRequest(limitedB);
  assert.equal(limitedSecond.allow, false);
  assert.equal(limitedSecond.denyReason, "ACCESS_RATE_LIMITED");
  assert.equal(typeof limitedSecond.sanitizedIdentity, "string");
  assert.equal(limitedSecond.sanitizedIdentity?.includes(":"), true);

  const originalRateLimit = process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE;
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "10";

  const originalAllowlist = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = "*.example.com";
  const wildcardSubdomain = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardSubdomain.allow, true);

  const wildcardExact = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardExact.allow, true);

  const wildcardBlocked = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.otherexample.net",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardBlocked.allow, false);

  const wildcardWithProtocol = await authorizeTileRequest({
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
  const wildcardProtocolMatch = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: "tile-token",
    },
  });
  assert.equal(wildcardProtocolMatch.allow, true);

  const wildcardProtocolBlocked = await authorizeTileRequest({
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "http://api.example.com",
      authorization: "tile-token",
    },
  } as unknown as DomainAuthorizeContext);
  assert.equal(wildcardProtocolBlocked.allow, false);

  const projects = await listProjects();
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

  const projectAllowedByPolicy = await authorizeTileRequest({
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
  assert.equal(projectScopedAllowed["access-control-allow-headers"].includes("x-api-token"), true);
  const projectDeniedByPolicy = await authorizeTileRequest({
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
  assert.equal(projectHeaders["access-control-allow-origin"], "null");
  const rasterAllowedByPolicy = await authorizeTileRequest({
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
  const staticRateLimitProject = await createProject({
    name: "Access Static Rate Limit Project",
    policy: {
      allowedOrigins: ["https://api.example.com"],
      allowedEndpoints: {
        tiles: true,
        raster: false,
        staticMaps: true,
      },
    },
  });
  const staticRateLimitKey = await rotateApiKey(staticRateLimitProject.id);
  const staticFirst = await authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: staticRateLimitKey.token,
    },
    clientIp: "10.33.0.1",
  });
  const staticSecond = await authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: staticRateLimitKey.token,
    },
    clientIp: "10.33.0.1",
  });
  const staticThird = await authorizeTileRequest({
    method: "GET",
    path: "/static/basic/-122.4194,37.7749,12/640x480.png",
    query: {},
    headers: {
      origin: "https://api.example.com",
      authorization: staticRateLimitKey.token,
    },
    clientIp: "10.33.0.2",
  });
  assert.equal(staticFirst.allow, true);
  assert.equal(staticSecond.allow, false);
  assert.equal(staticSecond.denyReason, "ACCESS_RATE_LIMITED");
  assert.equal(staticThird.allow, false);
  assert.equal(staticThird.denyReason, "ACCESS_RATE_LIMITED");
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

test("resolveAllowedOrigins uses project-scoped origins when token is provided", async (): Promise<void> => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.ALLOWED_ORIGINS = "https://example.com";
  process.env.ALLOWED_TILES_TOKENS = "tile-token";
  process.env.NODE_ENV = "development";

  const project = await createProject({
    name: "Cors Scoped Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const key = await rotateApiKey(project.id);
  const scopedOrigins = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    rawToken: key.token,
  });
  assert.equal(scopedOrigins.includes("https://tenant.example"), true);
  assert.equal(scopedOrigins.includes("https://example.com"), false);

  const scopedOriginsFromMixedCaseHeader = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
      "X-Api-Token": key.token,
    },
    rawToken: undefined,
    query: {},
  });
  assert.equal(scopedOriginsFromMixedCaseHeader.includes("https://tenant.example"), true);
  assert.equal(scopedOriginsFromMixedCaseHeader.includes("https://example.com"), false);

  const scopedOriginsFromQueryToken = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    rawToken: undefined,
    query: {
      access_token: key.token,
    },
  });
  assert.equal(scopedOriginsFromQueryToken.includes("https://tenant.example"), true);
  assert.equal(scopedOriginsFromQueryToken.includes("https://example.com"), false);

  const fallbackOrigins = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    rawToken: "invalid-token",
    query: {},
  });
  assert.equal(fallbackOrigins.includes("https://example.com"), true);
});

test("access helpers honor query access_token when rawToken is not pre-extracted", async (): Promise<void> => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.ALLOWED_ORIGINS = "https://example.com";
  process.env.ALLOWED_TILES_TOKENS = "tile-token";
  process.env.NODE_ENV = "development";
  process.env.ENABLE_RATE_LIMIT = "true";
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "10";

  const project = await createProject({
    name: "Access Query Token Project",
    policy: {
      allowedOrigins: ["https://tenant.example"],
    },
  });
  const key = await rotateApiKey(project.id);

  const queryTokenAllowed = await authorizeTileRequest({
    method: "GET",
    path: `/v1/tiles/2/2/3.mvt?access_token=${key.token}`,
    query: {
      access_token: key.token,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(queryTokenAllowed.allow, true);

  const scopedOrigins = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    query: {
      access_token: key.token,
    },
    rawToken: undefined,
  });
  assert.equal(scopedOrigins.includes("https://tenant.example"), true);
  assert.equal(scopedOrigins.includes("https://example.com"), false);

  const aliasQueryTokenAllowed = await authorizeTileRequest({
    method: "GET",
    path: `/v1/tiles/2/2/3.mvt?token=${key.token}`,
    query: {
      token: key.token,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(aliasQueryTokenAllowed.allow, true);

  const scopedOriginsFromAliasQueryToken = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    query: {
      token: key.token,
    },
    rawToken: undefined,
  });
  assert.equal(scopedOriginsFromAliasQueryToken.includes("https://tenant.example"), true);
  assert.equal(scopedOriginsFromAliasQueryToken.includes("https://example.com"), false);

  const malformedQueryTokenResult = await authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/2/2/3.mvt?access_token=ignored",
    query: {
      access_token: [42 as unknown as string, key.token],
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(malformedQueryTokenResult.allow, true);

  const scopedOriginsFromMalformedQueryToken = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    query: {
      access_token: [42 as unknown as string, key.token],
    },
    rawToken: undefined,
  });
  assert.equal(scopedOriginsFromMalformedQueryToken.includes("https://tenant.example"), true);
  assert.equal(scopedOriginsFromMalformedQueryToken.includes("https://example.com"), false);

  const malformedScalarQueryTokenResult = await authorizeTileRequest({
    method: "GET",
    path: "/v1/tiles/2/2/3.mvt",
    query: {
      access_token: { token: key.token } as unknown as string,
    },
    headers: {
      origin: "https://tenant.example",
    },
  });
  assert.equal(malformedScalarQueryTokenResult.allow, false);
  assert.equal(malformedScalarQueryTokenResult.denyReason, "ACCESS_BAD_REQUEST");

  const scopedOriginsFromMalformedScalarQueryToken = await resolveAllowedOrigins({
    headers: {
      origin: "https://tenant.example",
    },
    query: {
      access_token: { token: key.token } as unknown as string,
    },
    rawToken: undefined,
  });
  assert.equal(scopedOriginsFromMalformedScalarQueryToken.includes("https://tenant.example"), false);
  assert.equal(scopedOriginsFromMalformedScalarQueryToken.includes("https://example.com"), true);
});

test("authorizeTileRequest rate limits anonymous requests per client ip", async (): Promise<void> => {
  process.env.OBJECT_STORE_BUCKET = "test-bucket";
  process.env.ADMIN_TOKEN = "admin-token";
  process.env.ALLOWED_ORIGINS = "https://example.com";
  process.env.ALLOWED_TILES_TOKENS = "tile-token";
  process.env.NODE_ENV = "development";
  process.env.ENABLE_RATE_LIMIT = "true";
  process.env.RATE_LIMIT_MAX_REQUESTS_PER_MINUTE = "1";

  const anonymousRequest: DomainAuthorizeContext = {
    method: "GET",
    path: "/tiles/2/2/3.mvt",
    query: {},
    headers: {
      origin: "https://example.com",
      authorization: "wrong-token",
    },
    clientIp: "198.51.100.77",
  };

  const first = await authorizeTileRequest(anonymousRequest);
  const second = await authorizeTileRequest(anonymousRequest);
  const third = await authorizeTileRequest({
    ...anonymousRequest,
    clientIp: "198.51.100.78",
  });

  assert.equal(first.allow, false);
  assert.equal(first.denyReason, "ACCESS_UNAUTHORIZED");
  assert.equal(second.allow, false);
  assert.equal(second.denyReason, "ACCESS_RATE_LIMITED");
  assert.equal(third.allow, false);
  assert.equal(third.denyReason, "ACCESS_UNAUTHORIZED");
});

test("buildCorsHeaders fails closed on malformed runtime input", (): void => {
  const malformedResultHeaders = buildCorsHeaders(
    {
      allow: "yes",
    } as unknown as Parameters<typeof buildCorsHeaders>[0],
    "https://example.com",
  );
  assert.equal(malformedResultHeaders["access-control-allow-origin"], "null");
  assert.equal(malformedResultHeaders["cache-control"], "no-store");

  const malformedOriginHeaders = buildCorsHeaders(
    {
      allow: true,
      allowedOrigins: ["https://example.com"],
    },
    42 as unknown as string,
  );
  assert.equal(malformedOriginHeaders["access-control-allow-origin"], "null");
  assert.equal(malformedOriginHeaders["cache-control"], "no-store");

  const malformedAllowlistHeaders = buildCorsHeaders(
    {
      allow: true,
      allowedOrigins: ["https://example.com", 42 as unknown as string],
    } as unknown as Parameters<typeof buildCorsHeaders>[0],
    "https://example.com",
  );
  assert.equal(malformedAllowlistHeaders["access-control-allow-origin"], "null");
  assert.equal(malformedAllowlistHeaders["cache-control"], "no-store");

  const blankAllowlistHeaders = buildCorsHeaders(
    {
      allow: true,
      allowedOrigins: ["   "],
    } as unknown as Parameters<typeof buildCorsHeaders>[0],
  );
  assert.equal(blankAllowlistHeaders["access-control-allow-origin"], "null");
  assert.equal(blankAllowlistHeaders["cache-control"], "no-store");
});
