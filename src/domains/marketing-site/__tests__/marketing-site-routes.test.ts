import { strict as assert } from "node:assert";
import { marketingSiteRoute } from "../routes/site-route";
import { getMarketingPage } from "../marketing-site.service";
import { createStyleVersion, publishStyleVersion } from "../../styles/styles.service";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("marketing site serves landing and pricing pages as html", async () => {
  const previousAllowedTilesTokens = process.env.ALLOWED_TILES_TOKENS;
  try {
    process.env.ALLOWED_TILES_TOKENS = "landing-public-token,secondary-public-token";
    const landing = await marketingSiteRoute({
      method: "GET",
      path: "/",
    });
    assert.equal(landing.status, 200);
    assert.equal(landing.headers["content-type"], "text/html; charset=utf-8");
    assert.equal((landing.body ?? "").includes("Fast, reliable map delivery for developers"), true);
    assert.equal((landing.body ?? "").includes("Hosted Map Server"), true);
    assert.equal((landing.body ?? "").includes("/security"), true);
    assert.equal((landing.body ?? "").includes("Security contact"), true);
    assert.equal((landing.body ?? "").includes("mailto:security@tstiles.com"), true);
    assert.equal((landing.body ?? "").includes('href="/demo"'), false);
    assert.equal((landing.body ?? "").includes("/docs/quickstart"), true);
    assert.equal((landing.body ?? "").includes("/docs/authentication"), true);
    assert.equal((landing.body ?? "").includes("/docs/raster"), true);
    assert.equal((landing.body ?? "").includes("/docs/static-maps"), true);
    assert.equal((landing.body ?? "").includes("/docs/styles"), true);
    assert.equal((landing.body ?? "").includes("Live map preview"), true);
    assert.equal((landing.body ?? "").includes("vector tiles"), true);
    assert.equal((landing.body ?? "").includes("published styles"), true);
    assert.equal((landing.body ?? "").includes("usage visibility"), true);
    assert.equal((landing.body ?? "").includes('id="marketing-live-map"'), true);
    assert.equal((landing.body ?? "").includes('maplibre-gl@4.7.1/dist/maplibre-gl.css'), true);
    assert.equal((landing.body ?? "").includes('maplibre-gl@4.7.1/dist/maplibre-gl.js'), true);
    assert.equal((landing.body ?? "").includes('pmtiles@3.2.1/dist/pmtiles.js'), false);
    assert.equal((landing.body ?? "").includes('/demo/data.pmtiles'), false);
    assert.equal((landing.body ?? "").includes('const previewStyleUrl = "/v1/styles/'), true);
    assert.equal((landing.body ?? "").includes('access_token=landing-public-token'), true);
    assert.equal((landing.body ?? "").includes('/v1/styles/style/style.json?access_token=landing-public-token'), true);
    assert.equal((landing.body ?? "").includes("demo-public-token"), false);
    assert.equal((landing.body ?? "").includes("Waiting for map viewport"), true);
    assert.equal((landing.body ?? "").includes("buildLandingMapStyle"), false);
    assert.equal((landing.body ?? "").includes('Uses the same public browser path customers use'), true);
    assert.equal((landing.body ?? "").includes('Live map preview ready through /v1/styles and /v1/tiles.'), true);
  } finally {
    process.env.ALLOWED_TILES_TOKENS = previousAllowedTilesTokens;
  }

  const pricing = await marketingSiteRoute({
    method: "GET",
    path: "/pricing",
  });
  assert.equal(pricing.status, 200);
  assert.equal((pricing.body ?? "").includes("Metered requests"), true);
  assert.equal((pricing.body ?? "").includes("100,000 included monthly requests"), true);
  assert.equal((pricing.body ?? "").includes("500,000 included monthly requests"), true);
  assert.equal((pricing.body ?? "").includes("Overage handling"), true);
  assert.equal((pricing.body ?? "").includes("Plan changes and usage visibility"), true);
  assert.equal((pricing.body ?? "").includes("How do plan changes happen?"), true);
  assert.equal((pricing.body ?? "").includes("Where do I manage billing details?"), true);
  assert.equal((pricing.body ?? "").includes("How do I know when usage is getting close to limits?"), true);
  assert.equal((pricing.body ?? "").includes("data-marketing-plan-cta"), true);
  assert.equal((pricing.body ?? "").includes("/app-api/session"), true);
  assert.equal((pricing.body ?? "").includes("hasAppSessionCookie"), false);
  assert.equal((pricing.body ?? "").includes("/billing/checkout"), true);
  assert.equal((pricing.body ?? "").includes("/billing/portal"), true);
  assert.equal((pricing.body ?? "").includes("function navigateTo(url)"), true);
  assert.equal((pricing.body ?? "").includes("if (url && navigateTo(url))"), true);
  assert.equal((pricing.body ?? "").includes("signUp.textContent = \"Billing\";"), true);
  assert.equal((pricing.body ?? "").includes("async function resolveSession()"), true);
  assert.equal((pricing.body ?? "").includes("async function resolveBilling()"), true);
  assert.equal((pricing.body ?? "").includes("async function createStripeSession(endpoint, payload)"), true);
  assert.equal((pricing.body ?? "").includes("catch (_error)"), true);
});

test("marketing site landing preview fails closed when no browser-safe public token is configured", async () => {
  const previousAllowedTilesTokens = process.env.ALLOWED_TILES_TOKENS;
  try {
    delete process.env.ALLOWED_TILES_TOKENS;
    const landing = await marketingSiteRoute({
      method: "GET",
      path: "/",
    });
    assert.equal(landing.status, 200);
    assert.equal((landing.body ?? "").includes("demo-public-token"), false);
    assert.equal((landing.body ?? "").includes('const previewStyleUrl = null;'), true);
    assert.equal((landing.body ?? "").includes("Live map preview unavailable until a browser-safe public token is configured."), true);
    assert.equal((landing.body ?? "").includes('const previewStyleUrl = "/v1/styles/style/style.json?access_token='), false);
  } finally {
    process.env.ALLOWED_TILES_TOKENS = previousAllowedTilesTokens;
  }
});

test("marketing site landing preview encodes browser-safe public tokens for the live style URL", async () => {
  const previousAllowedTilesTokens = process.env.ALLOWED_TILES_TOKENS;
  try {
    process.env.ALLOWED_TILES_TOKENS = "landing+token&scope=preview";
    const landing = await marketingSiteRoute({
      method: "GET",
      path: "/",
    });
    assert.equal(landing.status, 200);
    assert.equal(
      (landing.body ?? "").includes('const previewStyleUrl = "/v1/styles/'),
      true,
    );
    assert.equal((landing.body ?? "").includes('access_token=landing%2Btoken%26scope%3Dpreview'), true);
    assert.equal((landing.body ?? "").includes('/v1/styles/style/style.json?access_token=landing%2Btoken%26scope%3Dpreview'), true);
    assert.equal((landing.body ?? "").includes('access_token=landing+token&scope=preview'), false);
    assert.equal((landing.body ?? "").includes("&amp;scope"), false);
  } finally {
    process.env.ALLOWED_TILES_TOKENS = previousAllowedTilesTokens;
  }
});

test("marketing site landing preview derives its style URL from the published docs style path", async () => {
  const previousAllowedTilesTokens = process.env.ALLOWED_TILES_TOKENS;
  try {
    const style = await createStyleVersion("0 marketing style", {
      version: 8,
      sources: {
        map: {
          type: "vector",
          tiles: ["/v1/tiles/{z}/{x}/{y}.mvt?access_token={access_token}"],
      },
    },
    sprites: "/v1/styles/{styleId}/sprite",
    glyphs: "/v1/fonts/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": "#f8f6f0",
        },
      },
    ],
  });
    await publishStyleVersion("0 marketing style", style.id);
    process.env.ALLOWED_TILES_TOKENS = "landing-public-token";
    const landing = await marketingSiteRoute({
      method: "GET",
      path: "/",
    });
    assert.equal(landing.status, 200);
    const body = landing.body ?? "";
    const previewStyleUrlMatch = /const previewStyleUrl = "([^"]+)";/.exec(body);
    const snippetStyleUrlMatch = /style: &quot;([^"&]+access_token=YOUR_TOKEN)&quot;/.exec(body);
    assert.notEqual(previewStyleUrlMatch, null);
    assert.notEqual(snippetStyleUrlMatch, null);
    assert.equal(
      previewStyleUrlMatch?.[1],
      snippetStyleUrlMatch?.[1]?.replace("YOUR_TOKEN", "landing-public-token"),
    );
    assert.equal((landing.body ?? "").includes('/v1/styles/style/style.json?access_token=landing-public-token'), true);
  } finally {
    process.env.ALLOWED_TILES_TOKENS = previousAllowedTilesTokens;
  }
});

test("marketing site landing preview prefers LANDING_PREVIEW_TOKEN over general delivery tokens", async () => {
  const previousAllowedTilesTokens = process.env.ALLOWED_TILES_TOKENS;
  const previousLandingPreviewToken = process.env.LANDING_PREVIEW_TOKEN;
  try {
    process.env.ALLOWED_TILES_TOKENS = "general-token";
    process.env.LANDING_PREVIEW_TOKEN = "landing-only-token";
    const landing = await marketingSiteRoute({
      method: "GET",
      path: "/",
    });
    assert.equal(landing.status, 200);
    assert.equal((landing.body ?? "").includes("access_token=landing-only-token"), true);
    assert.equal((landing.body ?? "").includes("access_token=general-token"), false);
  } finally {
    if (previousAllowedTilesTokens === undefined) {
      Reflect.deleteProperty(process.env, "ALLOWED_TILES_TOKENS");
    } else {
      process.env.ALLOWED_TILES_TOKENS = previousAllowedTilesTokens;
    }
    if (previousLandingPreviewToken === undefined) {
      Reflect.deleteProperty(process.env, "LANDING_PREVIEW_TOKEN");
    } else {
      process.env.LANDING_PREVIEW_TOKEN = previousLandingPreviewToken;
    }
  }
});

test("marketing site serves legal and auth entry pages", async () => {
  const terms = await marketingSiteRoute({
    method: "GET",
    path: "/legal/terms",
  });
  assert.equal(terms.status, 200);
  assert.equal((terms.body ?? "").includes("Terms of Service"), true);
  assert.equal((terms.body ?? "").includes("2026-03-07"), true);

  const dpa = await marketingSiteRoute({
    method: "GET",
    path: "/legal/dpa",
  });
  assert.equal(dpa.status, 200);
  assert.equal((dpa.body ?? "").includes("Data Processing Addendum"), true);
  assert.equal((dpa.body ?? "").includes("Stripe remains the payment processor"), true);

  const privacy = await marketingSiteRoute({
    method: "GET",
    path: "/legal/privacy",
  });
  assert.equal(privacy.status, 200);
  assert.equal((privacy.body ?? "").includes("authenticated product access"), true);
  assert.equal((privacy.body ?? "").includes("additional identity/session tooling"), true);
  assert.equal((privacy.body ?? "").includes("/legal/dpa"), true);

  const acceptableUse = await marketingSiteRoute({
    method: "GET",
    path: "/legal/acceptable-use",
  });
  assert.equal(acceptableUse.status, 200);
  assert.equal((acceptableUse.body ?? "").includes("Abusive scraping"), true);
  assert.equal((acceptableUse.body ?? "").includes("Illegal content and unlawful use"), true);
  assert.equal((acceptableUse.body ?? "").includes("Credential misuse"), true);
  assert.equal((acceptableUse.body ?? "").includes("Service abuse"), true);

  const security = await marketingSiteRoute({
    method: "GET",
    path: "/security",
  });
  assert.equal(security.status, 200);
  assert.equal((security.body ?? "").includes("security@tstiles.com"), true);
  assert.equal((security.body ?? "").includes("Stripe remains the source of truth"), true);
  assert.equal((security.body ?? "").includes("/status"), true);
  assert.equal((security.body ?? "").includes('href="/demo"'), false);

  const status = await marketingSiteRoute({
    method: "GET",
    path: "/status",
  });
  assert.equal(status.status, 200);
  assert.equal((status.body ?? "").includes("Health endpoint"), true);
  assert.equal((status.body ?? "").includes("/v1/health"), true);
  assert.equal((status.body ?? "").includes("data-health-status"), true);
  assert.equal((status.body ?? "").includes("Waiting for live health check"), true);
  assert.equal((status.body ?? "").includes("fetch(\"/v1/health\""), true);

  const signIn = await marketingSiteRoute({
    method: "GET",
    path: "/sign-in",
  });
  assert.equal(signIn.status, 200);
  assert.equal((signIn.body ?? "").includes("Sign in to your workspace"), true);
  assert.equal((signIn.body ?? "").includes("demo-auth-form"), false);
  assert.equal((signIn.body ?? "").includes("/auth/demo/sign-in"), false);
  assert.equal((signIn.body ?? "").includes('params.get("plan")'), true);
  assert.equal((signIn.body ?? "").includes("/app/billing?intent=upgrade&plan=pro"), true);
  assert.equal((signIn.body ?? "").includes("/legal/terms"), true);
  assert.equal((signIn.body ?? "").includes("/legal/privacy"), true);
  assert.equal((signIn.body ?? "").includes("/legal/dpa"), true);
  assert.equal((signIn.body ?? "").includes("/legal/acceptable-use"), true);
  assert.equal((signIn.body ?? "").includes("data-auth-intent"), true);
  assert.equal((signIn.body ?? "").includes("After account authentication, billing handoff continues into Stripe Checkout for the Pro plan."), true);
  assert.equal((signIn.body ?? "").includes('data-auth-switch-target="/sign-up"'), true);
  assert.equal((signIn.body ?? "").includes("const safePlan = requestedPlan === \"pro\" ? \"pro\" : null;"), true);
  assert.equal((signIn.body ?? "").includes('if (safePlan) {'), true);
  assert.equal((signIn.body ?? "").includes('nextParams.set("plan", safePlan);'), true);
  assert.equal((signIn.body ?? "").includes('if (safeNext) {'), true);
  assert.equal((signIn.body ?? "").includes('nextParams.set("next", safeNext);'), true);
  assert.equal((signIn.body ?? "").includes('anchor.setAttribute("href", query ? baseHref + "?" + query : baseHref);'), true);
  assert.equal((signIn.body ?? "").includes("function resolveSafeNext(next)"), true);
  assert.equal((signIn.body ?? "").includes('if (!normalized || (normalized !== "/app" && normalized.indexOf("/app/") !== 0))'), true);
  assert.equal((signIn.body ?? "").includes("Use the account form to continue. Product sessions and project delivery tokens stay separate."), true);
  assert.equal((signIn.body ?? "").includes("const next = safeNext"), true);
  assert.equal((signIn.body ?? "").includes("Product sessions are separate from project-token issuance."), true);
  assert.equal((signIn.body ?? "").includes("issue a project token for delivery requests instead of reusing account session state."), true);

  const signUp = await marketingSiteRoute({
    method: "GET",
    path: "/sign-up",
  });
  assert.equal(signUp.status, 200);
  assert.equal((signUp.body ?? "").includes("Product sessions are separate from project-token issuance."), true);
  assert.equal((signUp.body ?? "").includes("issue a project token for delivery requests instead of reusing account session state."), true);
});

test("marketing site auth entry pages reflect the managed auth header bridge when enabled", async () => {
  const previousManagedMode = process.env.IDENTITY_MANAGED_AUTH_MODE;
  try {
    process.env.IDENTITY_MANAGED_AUTH_MODE = "header";
    const signIn = await marketingSiteRoute({
      method: "GET",
      path: "/sign-in?next=%2Fapp%2Fbilling&plan=pro",
    });
    assert.equal(signIn.status, 200);
    assert.equal(
      (signIn.body ?? "").includes("Enterprise identity bridge is enabled. Preserve the continuation below after account authentication completes on the authenticated app origin."),
      true,
    );
    assert.equal((signIn.body ?? "").includes("Continuation after account authentication: "), true);
    assert.equal((signIn.body ?? "").includes("Use the account form to continue. Product sessions and project delivery tokens stay separate."), false);
  } finally {
    process.env.IDENTITY_MANAGED_AUTH_MODE = previousManagedMode;
  }
});

test("marketing site supports head, options, and invalid paths", async () => {
  const get = await marketingSiteRoute({
    method: "GET",
    path: "/sign-up",
  });
  const head = await marketingSiteRoute({
    method: "HEAD",
    path: "/sign-up",
  });
  assert.equal(head.status, 200);
  assert.equal(head.body, undefined);
  assert.equal(head.headers["content-length"], get.headers["content-length"]);

  const options = await marketingSiteRoute({
    method: "OPTIONS",
    path: "/pricing",
  });
  assert.equal(options.status, 204);

  const missing = await marketingSiteRoute({
    method: "GET",
    path: "/missing",
  });
  assert.equal(missing.status, 404);

  const malformedRequest = await marketingSiteRoute(
    null as unknown as Parameters<typeof marketingSiteRoute>[0],
  );
  assert.equal(malformedRequest.status, 400);
  assert.equal(
    (malformedRequest.body ?? "").includes("MARKETING_BAD_REQUEST"),
    true,
  );

  const malformedPath = await marketingSiteRoute({
    method: "GET",
    path: 42 as unknown as string,
  });
  assert.equal(malformedPath.status, 400);

  const malformedMethod = await marketingSiteRoute({
    method: 42 as unknown as "GET",
    path: "/pricing",
  });
  assert.equal(malformedMethod.status, 400);
});

test("marketing site service rejects malformed direct page slugs", async () => {
  await assert.rejects(async () => {
    await getMarketingPage("missing" as unknown as Parameters<typeof getMarketingPage>[0]);
  }, /MARKETING_PAGE_NOT_FOUND/);

  await assert.rejects(async () => {
    await getMarketingPage(42 as unknown as Parameters<typeof getMarketingPage>[0]);
  }, /MARKETING_PAGE_NOT_FOUND/);
});
