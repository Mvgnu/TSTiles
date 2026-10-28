import type { HttpMethod } from "../../../contracts/types";
import { getMarketingPage } from "../marketing-site.service";
import type { MarketingPage, MarketingPageSlug } from "../types";
import { escapeHtml, getUniversalHeaderCss, renderCodeCard, renderUniversalHeader } from "../../design-system/components";
import { getGlobalCss } from "../../design-system/styles";

interface MarketingRouteRequest {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface MarketingRouteResponse {
  readonly status: number;
  readonly body?: string;
  readonly headers: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRouteRequest(input: unknown): MarketingRouteRequest | null {
  if (!isRecord(input)) {
    return null;
  }
  if (typeof input.method !== "string" || typeof input.path !== "string") {
    return null;
  }
  return {
    method: input.method as HttpMethod,
    path: input.path,
  };
}

function normalizePath(path: string): string {
  return path.split("?")[0] ?? "/";
}

function resolveSlug(path: string): MarketingPageSlug | null {
  const normalized = normalizePath(path);
  if (normalized === "/" || normalized === "") {
    return "landing";
  }
  if (normalized === "/pricing" || normalized === "/pricing/") {
    return "pricing";
  }
  if (normalized === "/legal/terms" || normalized === "/legal/terms/") {
    return "terms";
  }
  if (normalized === "/legal/privacy" || normalized === "/legal/privacy/") {
    return "privacy";
  }
  if (normalized === "/legal/dpa" || normalized === "/legal/dpa/") {
    return "dpa";
  }
  if (normalized === "/legal/acceptable-use" || normalized === "/legal/acceptable-use/") {
    return "acceptable-use";
  }
  if (normalized === "/security" || normalized === "/security/") {
    return "security";
  }
  if (normalized === "/status" || normalized === "/status/") {
    return "status";
  }
  if (normalized === "/sign-in" || normalized === "/sign-in/") {
    return "sign-in";
  }
  if (normalized === "/sign-up" || normalized === "/sign-up/") {
    return "sign-up";
  }
  return null;
}

function bodyForMethod(method: HttpMethod, body: string): string | undefined {
  if (method === "HEAD") {
    return undefined;
  }
  return body;
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isManagedAuthHeaderBridgeEnabled(): boolean {
  return (process.env.IDENTITY_MANAGED_AUTH_MODE?.trim().toLowerCase() ?? "") === "header";
}

function resolveLandingPreviewToken(): string | null {
  const landingPreviewToken = process.env.LANDING_PREVIEW_TOKEN?.trim();
  if (landingPreviewToken) {
    return landingPreviewToken;
  }
  const configuredTokens = process.env.ALLOWED_TILES_TOKENS
    ?.split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return configuredTokens?.[0] ?? null;
}

function extractLandingSnippetStyleUrl(page: MarketingPage): string | null {
  const snippetCode = page.sections
    .flatMap((section) => section.snippets ?? [])
    .map((snippet) => snippet.code)
    .find((code) => code.includes("style: "));
  if (!snippetCode) {
    return null;
  }
  const matched = /style:\s*"([^"]+)"/.exec(snippetCode);
  return matched?.[1] ?? null;
}

function resolveLandingPreviewStyleUrl(page: MarketingPage, token: string | null): string | null {
  if (page.slug !== "landing" || token === null) {
    return null;
  }
  const snippetStyleUrl = extractLandingSnippetStyleUrl(page);
  if (typeof snippetStyleUrl !== "string" || snippetStyleUrl.length === 0) {
    return null;
  }
  return snippetStyleUrl.replace("YOUR_TOKEN", encodeURIComponent(token));
}

function renderManagedAuthStatusDefault(): string {
  if (isManagedAuthHeaderBridgeEnabled()) {
    return "Enterprise identity bridge is enabled. Preserve the continuation below after account authentication completes on the authenticated app origin.";
  }
  return "Use the account form to continue. Product sessions and project delivery tokens stay separate.";
}

function resolveMarketingHeaderActiveItem(slug: MarketingPageSlug): "product" | "pricing" | "docs" | "sign-in" | "sign-up" | undefined {
  if (slug === "landing") {
    return "product";
  }
  if (slug === "pricing") {
    return "pricing";
  }
  if (slug === "sign-in") {
    return "sign-in";
  }
  if (slug === "sign-up") {
    return "sign-up";
  }
  return undefined;
}

function renderPlanCards(page: MarketingPage): string {
  if (!page.planCards || page.planCards.length === 0) {
    return "";
  }
  return `
    <section class="plans-grid">
      ${page.planCards.map((plan) => `
        <article class="plan-card" ${plan.planId === "pro" ? 'data-popular="true"' : ""}>
          <div class="plan-top">
            <div class="plan-id">${escapeHtml(plan.planId)}</div>
            <div class="plan-allowance">${plan.includedRequests.toLocaleString("en-US")} included monthly requests</div>
          </div>
          <p class="plan-meta">$${plan.unitPricePerThousandRequests.toFixed(2)} per 1,000 requests · ${escapeHtml(plan.currency)}</p>
          <a
            class="ds-button ${plan.planId === "pro" ? "ds-button-primary" : "ds-button-secondary"}"
            href="${escapeHtml(plan.ctaHref)}"
            data-marketing-plan-cta
            data-plan-id="${escapeHtml(plan.planId)}"
            data-default-label="${escapeHtml(plan.ctaLabel)}"
            data-default-href="${escapeHtml(plan.ctaHref)}"
          >${escapeHtml(plan.ctaLabel)}</a>
        </article>
      `).join("")}
    </section>
  `;
}

function renderAuthForm(page: MarketingPage): string {
  if (page.slug !== "sign-in" && page.slug !== "sign-up") {
    return "";
  }
  const managedAuthStatusDefault = renderManagedAuthStatusDefault();
  const defaultNext = page.slug === "sign-in" ? "/app" : "/app/projects/new";
  return `
    <section class="ds-card auth-panel">
      <h2>${escapeHtml(page.slug === "sign-in" ? "Sign in to your workspace" : "Create your workspace")}</h2>
      <p>Continue through the account flow before entering the authenticated app surface.</p>
      <p class="auth-provider-note">Product sessions are separate from project-token issuance. After account authentication completes, continue into the app and issue a project token for delivery requests instead of reusing account session state.</p>
      <div class="highlight auth-intent" data-auth-intent>
        ${page.slug === "sign-up"
          ? "After sign-up, continue to project creation so the first token can be issued."
          : "After sign-in, continue to the workspace overview."}
      </div>
      <div class="cta-row auth-actions">
        <a class="ds-button ds-button-primary" href="/pricing">Review pricing</a>
        <a class="ds-button ds-button-secondary" href="/docs/quickstart">Open quickstart</a>
      </div>
      <p id="auth-status" class="auth-status" aria-live="polite">${escapeHtml(managedAuthStatusDefault)}</p>
      <p class="legal-note">
        By continuing, you agree to the <a href="/legal/terms">Terms of Service</a>, acknowledge the <a href="/legal/privacy">Privacy Policy</a>, can review the <a href="/legal/dpa">Data Processing Addendum</a>, and should follow the <a href="/legal/acceptable-use">Acceptable Use Policy</a>.
      </p>
    </section>
    <script>
      const status = document.getElementById("auth-status");
      const intent = document.querySelector("[data-auth-intent]");
      if (status) {
        const params = new URLSearchParams(window.location.search);
        const requestedPlan = params.get("plan");
        const requestedNext = params.get("next");
        function resolveSafeNext(next) {
          if (typeof next !== "string") {
            return null;
          }
          var normalized = next.trim();
          if (!normalized || (normalized !== "/app" && normalized.indexOf("/app/") !== 0)) {
            return null;
          }
          return normalized;
        }
        const safePlan = requestedPlan === "pro" ? "pro" : null;
        const safeNext = resolveSafeNext(requestedNext);
        Array.prototype.forEach.call(document.querySelectorAll("[data-auth-switch-target]"), function (anchor) {
          const baseHref = anchor.getAttribute("data-auth-switch-target") || anchor.getAttribute("href") || "";
          const nextParams = new URLSearchParams();
          if (safePlan) {
            nextParams.set("plan", safePlan);
          }
          if (safeNext) {
            nextParams.set("next", safeNext);
          }
          const query = nextParams.toString();
          anchor.setAttribute("href", query ? baseHref + "?" + query : baseHref);
        });
        if (intent) {
          if (safePlan === "pro") {
            intent.textContent = "After account authentication, billing handoff continues into Stripe Checkout for the Pro plan.";
          } else if (safeNext === "/app/projects/new") {
            intent.textContent = "After account authentication, you will continue to project creation so the first token can be issued.";
          } else if (safeNext) {
            intent.textContent = "After account authentication, you will continue to the authenticated app surface you originally requested.";
          }
        }
        const next = safeNext
          || (safePlan === "pro" ? "/app/billing?intent=upgrade&plan=pro" : "${escapeHtml(defaultNext)}");
        status.textContent = "${escapeHtml(managedAuthStatusDefault)}" + " Continuation after account authentication: " + next;
      }
    </script>
  `;
}

function renderMarketingRuntimeScript(page: MarketingPage): string {
  const isPricingPage = page.slug === "pricing";
  const isStatusPage = page.slug === "status";
  const isLandingPage = page.slug === "landing";
  const landingPreviewStyleUrl = resolveLandingPreviewStyleUrl(page, resolveLandingPreviewToken());
  return `
    <script>
      (function () {
        async function parseJson(response) {
          const text = await response.text();
          if (!text) {
            return {};
          }
          try {
            return JSON.parse(text);
          } catch (_error) {
            return {};
          }
        }

        async function resolveSession() {
          try {
            const response = await fetch("/app-api/session", {
              method: "GET",
              credentials: "same-origin"
            });
            if (!response.ok) {
              return null;
            }
            return parseJson(response);
          } catch (_error) {
            return null;
          }
        }

        async function resolveBilling() {
          try {
            const response = await fetch("/app-api/billing", {
              method: "GET",
              credentials: "same-origin"
            });
            if (!response.ok) {
              return null;
            }
            return parseJson(response);
          } catch (_error) {
            return null;
          }
        }

        async function createStripeSession(endpoint, payload) {
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "content-type": "application/json"
              },
              body: JSON.stringify(payload)
            });
            const data = await parseJson(response);
            if (!response.ok || !data || typeof data.url !== "string") {
              return null;
            }
            return data.url;
          } catch (_error) {
            return null;
          }
        }

        function updateAnchor(anchor, label, href) {
          anchor.textContent = label;
          anchor.setAttribute("href", href);
          anchor.setAttribute("data-current-label", label);
          anchor.setAttribute("data-current-href", href);
        }

        function navigateTo(url) {
          if (typeof url !== "string" || url.length === 0) {
            return false;
          }
          try {
            window.location.href = url;
            return true;
          } catch (_error) {
            return false;
          }
        }

        function updateNav(session) {
          var navLinks = document.querySelector(".nav-links");
          if (!navLinks) {
            return;
          }
          var signIn = navLinks.querySelector('a[href="/sign-in"]');
          if (signIn && session) {
            signIn.textContent = "Dashboard";
            signIn.setAttribute("href", "/app");
          }
          var signUp = navLinks.querySelector('a[href="/sign-up"]');
          if (signUp && session) {
            signUp.textContent = "Billing";
            signUp.setAttribute("href", "/app/billing");
          }
        }

        function updateHeroActions(session) {
          if (!session) {
            return;
          }
          Array.prototype.forEach.call(document.querySelectorAll(".cta-row a.ds-button"), function (anchor) {
            var href = anchor.getAttribute("href") || "";
            if (href === "/sign-up" || href.startsWith("/sign-up?")) {
              updateAnchor(anchor, "Open dashboard", "/app");
              return;
            }
            if (href === "/sign-in" || href.startsWith("/sign-in?")) {
              updateAnchor(anchor, "Open billing", "/app/billing");
            }
          });
        }

        async function wirePricingActions(session, billing) {
          if (!${isPricingPage ? "true" : "false"}) {
            return;
          }
          const planLinks = Array.prototype.slice.call(document.querySelectorAll("[data-marketing-plan-cta]"));
          if (planLinks.length === 0) {
            return;
          }

          planLinks.forEach(function (anchor) {
            const planId = anchor.getAttribute("data-plan-id") || "";
            const defaultLabel = anchor.getAttribute("data-default-label") || anchor.textContent || "Open";
            const defaultHref = anchor.getAttribute("data-default-href") || anchor.getAttribute("href") || "/";

            if (!session) {
              updateAnchor(anchor, defaultLabel, defaultHref);
              return;
            }

            if (planId === "free") {
              updateAnchor(anchor, "Open dashboard", "/app");
              return;
            }

            if (billing && billing.planId === "pro" && billing.subscriptionStatus !== "free") {
              updateAnchor(anchor, "Manage in Stripe", "/app/billing");
              anchor.addEventListener("click", async function (event) {
                event.preventDefault();
                const url = await createStripeSession("/billing/portal", {
                  returnUrl: window.location.origin + "/app/billing"
                });
                if (url && navigateTo(url)) {
                  return;
                }
              });
              return;
            }

            updateAnchor(anchor, "Open Checkout", "/app/billing?intent=upgrade&plan=pro");
            anchor.addEventListener("click", async function (event) {
              event.preventDefault();
              const url = await createStripeSession("/billing/checkout", {
                planId: "pro",
                successUrl: window.location.origin + "/app/billing?checkout=success",
                cancelUrl: window.location.origin + "/pricing?checkout=cancel"
              });
              if (url && navigateTo(url)) {
                return;
              }
              navigateTo("/app/billing?intent=upgrade&plan=pro");
            });
          });
        }

        async function initMarketingRuntime() {
          const session = await resolveSession();
          updateNav(session);
          updateHeroActions(session);
          const billing = session && ${isPricingPage ? "true" : "false"} ? await resolveBilling() : null;
          await wirePricingActions(session, billing);

          if (${isLandingPage ? "true" : "false"}) {
            const mapNode = document.getElementById("marketing-live-map");
            const mapStatus = document.querySelector("[data-marketing-map-status]");
            if (mapNode && mapStatus) {
              const previewStyleUrl = ${landingPreviewStyleUrl !== null ? JSON.stringify(landingPreviewStyleUrl) : "null"};
              if (!previewStyleUrl) {
                mapStatus.textContent = "Live map preview unavailable until a browser-safe public token is configured.";
                return;
              }
              const maplibreglGlobal = globalThis.maplibregl;
              if (!maplibreglGlobal) {
                mapStatus.textContent = "Preview scripts unavailable.";
              } else {
                const ensureSizedMap = function () {
                  const rect = mapNode.getBoundingClientRect();
                  if (rect.width >= 32 && rect.height >= 32) {
                    return Promise.resolve(rect);
                  }
                  mapStatus.textContent = "Waiting for map viewport...";
                  return new Promise(function (resolve, reject) {
                    let attempts = 0;
                    const tick = function () {
                      attempts += 1;
                      const nextRect = mapNode.getBoundingClientRect();
                      if (nextRect.width >= 32 && nextRect.height >= 32) {
                        resolve(nextRect);
                        return;
                      }
                      if (attempts >= 60) {
                        reject(new Error("Map preview container has no size."));
                        return;
                      }
                      window.requestAnimationFrame(tick);
                    };
                    window.requestAnimationFrame(tick);
                  });
                };
                const startMap = async function () {
                  try {
                    await ensureSizedMap();
                    mapStatus.textContent = "Loading live browser preview...";
                    const map = new maplibreglGlobal.Map({
                      container: mapNode,
                      style: previewStyleUrl,
                      center: [10.7522, 59.9139],
                      zoom: 4.2,
                      attributionControl: false
                    });
                    const resize = function () {
                      try {
                        map.resize();
                      } catch (_error) {
                        // Ignore resize failures during teardown.
                      }
                    };
                    map.scrollZoom.disable();
                    map.dragRotate.disable();
                    map.touchZoomRotate.disableRotation();
                    map.addControl(new maplibreglGlobal.NavigationControl({ showCompass: false }), "top-right");
                    map.on("load", function () {
                      resize();
                      mapStatus.textContent = "Live map preview ready through /v1/styles and /v1/tiles.";
                    });
                    map.on("error", function (event) {
                      const message = event && event.error && event.error.message ? event.error.message : "Map preview failed.";
                      mapStatus.textContent = message;
                    });
                    window.requestAnimationFrame(resize);
                    window.addEventListener("load", resize, { once: true });
                    if (typeof ResizeObserver === "function") {
                      const observer = new ResizeObserver(function () {
                        resize();
                      });
                      observer.observe(mapNode);
                      map.on("remove", function () {
                        observer.disconnect();
                      });
                    }
                  } catch (error) {
                    mapStatus.textContent = error instanceof Error ? error.message : "Map preview failed.";
                  }
                };
                void startMap();
              }
            }
          }

          if (${isStatusPage ? "true" : "false"}) {
            const healthStatus = document.querySelector("[data-health-status]");
            const healthCheckedAt = document.querySelector("[data-health-checked-at]");
            const healthDetails = document.querySelector("[data-health-details]");
            if (healthStatus && healthCheckedAt && healthDetails) {
              healthStatus.textContent = "Checking live health";
              healthCheckedAt.textContent = "Contacting /v1/health...";
              try {
                const response = await fetch("/v1/health", {
                  method: "GET",
                  credentials: "same-origin"
                });
                const payload = await parseJson(response);
                if (response.ok) {
                  healthStatus.textContent = "Live health endpoint reachable";
                  healthCheckedAt.textContent = "Updated from /v1/health just now.";
                  healthDetails.textContent = typeof payload.status === "string"
                    ? "Reported status: " + payload.status
                    : "Health endpoint returned a successful response.";
                } else {
                  healthStatus.textContent = "Health endpoint returned an error";
                  healthCheckedAt.textContent = "Live check completed with a non-200 response.";
                  healthDetails.textContent = typeof payload.error === "string"
                    ? payload.error
                    : "Inspect /v1/health directly for the exact response body.";
                }
              } catch (_error) {
                healthStatus.textContent = "Live health check failed";
                healthCheckedAt.textContent = "The browser could not reach /v1/health.";
                healthDetails.textContent = "Check host reachability, then inspect /v1/health directly.";
              }
            }
          }
        }

        void initMarketingRuntime();
      })();
    </script>
  `;
}
function renderSections(page: MarketingPage): string {
  const isLanding = page.slug === "landing";

  return page.sections.map((section) => {
    if (isLanding) {
      if (section.id === "what-you-get") {
        return `
          <section class="landing-section feature-row-1" id="${escapeHtml(section.id)}">
            <div class="feature-copy">
              <div class="feature-badge">Capabilities</div>
              <h2>${escapeHtml(section.title)}</h2>
              <p class="feature-body">${escapeHtml(section.body)}</p>
              ${section.highlight ? `<div class="feature-highlight">${escapeHtml(section.highlight)}</div>` : ""}
            </div>
            <div class="feature-visual">
              <ul class="capability-checklist">
                <li>
                  <span class="chk-icon">✓</span>
                  <div>
                    <strong>High-Performance Vector Tiles</strong>
                    <p>Sub-millisecond range reads served straight from PMTiles archives.</p>
                  </div>
                </li>
                <li>
                  <span class="chk-icon">✓</span>
                  <div>
                    <strong>Versioned Mapbox Styles</strong>
                    <p>Fully compliant stylesheet delivery with auto-resolved local assets.</p>
                  </div>
                </li>
                <li>
                  <span class="chk-icon">✓</span>
                  <div>
                    <strong>High-Fidelity Raster & Static Maps</strong>
                    <p>On-demand server-side rendering for non-WebGL clients and previews.</p>
                  </div>
                </li>
                <li>
                  <span class="chk-icon">✓</span>
                  <div>
                    <strong>Secure Project Tokens</strong>
                    <p>Preserve isolation with distinct access tokens for each application environment.</p>
                  </div>
                </li>
              </ul>
            </div>
          </section>
        `;
      }

      if (section.id === "how-it-works") {
        const codeBlockHtml = (section.snippets ?? []).map((snippet) => renderCodeCard(snippet)).join("");
        return `
          <section class="landing-section feature-row-2" id="${escapeHtml(section.id)}">
            <div class="feature-copy">
              <div class="feature-badge">Integration</div>
              <h2>${escapeHtml(section.title)}</h2>
              <p class="feature-body">${escapeHtml(section.body)}</p>
              ${section.highlight ? `<div class="feature-highlight">${escapeHtml(section.highlight)}</div>` : ""}
            </div>
            <div class="feature-visual">
              ${codeBlockHtml}
            </div>
          </section>
        `;
      }

      if (section.id === "docs") {
        const linksHtml = section.links && section.links.length > 0 ? `
          <div class="doc-links-grid">
            ${section.links.map((link) => `
              <a class="doc-link-item" href="${escapeHtml(link.href)}">
                <span>${escapeHtml(link.label)}</span>
                <span class="doc-link-arrow">→</span>
              </a>
            `).join("")}
          </div>
        ` : "";

        return `
          <section class="landing-section feature-row-3" id="${escapeHtml(section.id)}">
            <div class="feature-copy">
              <div class="feature-badge">API Spec</div>
              <h2>${escapeHtml(section.title)}</h2>
              <p class="feature-body">${escapeHtml(section.body)}</p>
              ${section.highlight ? `<div class="feature-highlight">${escapeHtml(section.highlight)}</div>` : ""}
            </div>
            <div class="feature-visual">
              ${linksHtml}
            </div>
          </section>
        `;
      }
    }

    return `
      <section class="section-typo" id="${escapeHtml(section.id)}">
        <h2>${escapeHtml(section.title)}</h2>
        <p class="section-body">${escapeHtml(section.body)}</p>
        ${section.highlight ? `<div class="highlight">${escapeHtml(section.highlight)}</div>` : ""}
        ${section.links && section.links.length > 0 ? `
          <div class="section-links">
            ${section.links.map((link) => `
              <a class="section-link" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>
            `).join("")}
          </div>
        ` : ""}
        ${section.faqs && section.faqs.length > 0 ? `
          <div class="faq-list">
            ${section.faqs.map((faq) => `
              <article class="faq-item">
                <h3>${escapeHtml(faq.question)}</h3>
                <p>${escapeHtml(faq.answer)}</p>
              </article>
            `).join("")}
          </div>
        ` : ""}
        ${(section.snippets ?? []).map((snippet) => renderCodeCard(snippet)).join("")}
      </section>
    `;
  }).join("");
}

function renderMarketingHtml(page: MarketingPage): string {
  const legalMeta = page.legalLastUpdated ? `<p class="meta">Last updated ${escapeHtml(page.legalLastUpdated)}</p>` : "";
  const authSwitchAttribute = page.slug === "sign-in" || page.slug === "sign-up"
    ? ` data-auth-switch-target="${escapeHtml(page.secondaryCta?.href ?? "")}"`
    : "";
  const landingHeroAside = page.slug === "landing"
    ? `
      <div class="hero-split">
        <div class="hero-copy">
          <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
          <h1>${escapeHtml(page.title)}</h1>
          <p class="summary">${escapeHtml(page.summary)}</p>
          <div class="cta-row">
            <a class="ds-button ds-button-primary" href="${escapeHtml(page.primaryCta.href)}">${escapeHtml(page.primaryCta.label)}</a>
            ${page.secondaryCta ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(page.secondaryCta.href)}">${escapeHtml(page.secondaryCta.label)}</a>` : ""}
          </div>
          <div class="capability-strip">
            <span class="capability-pill">vector tiles</span>
            <span class="capability-pill">published styles</span>
            <span class="capability-pill">raster + static</span>
            <span class="capability-pill">project keys</span>
            <span class="capability-pill">usage visibility</span>
          </div>
          ${legalMeta}
        </div>
        <div class="hero-preview">
          <div class="hero-preview-top">
            <span>Live map preview</span>
            <small>MapLibre + browser token</small>
          </div>
          <div id="marketing-live-map" class="hero-map" aria-label="Live landing map preview"></div>
          <div class="hero-preview-meta">
            <strong>Map-first delivery surface</strong>
            <p>Uses the same public browser path customers use: style JSON, tiles, raster, and static endpoints with a browser-safe token.</p>
            <p class="hero-map-status" data-marketing-map-status>Waiting for live map preview.</p>
          </div>
        </div>
      </div>
    `
    : `
      <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="summary">${escapeHtml(page.summary)}</p>
      <div class="cta-row">
        <a class="ds-button ds-button-primary" href="${escapeHtml(page.primaryCta.href)}">${escapeHtml(page.primaryCta.label)}</a>
        ${page.secondaryCta ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(page.secondaryCta.href)}"${authSwitchAttribute}>${escapeHtml(page.secondaryCta.label)}</a>` : ""}
      </div>
      ${legalMeta}
    `;
  const planCards = renderPlanCards(page);
  const authForm = renderAuthForm(page);
  const runtimeScript = renderMarketingRuntimeScript(page);
  const statusPanel = page.slug === "status"
    ? `
      <section class="live-status-panel">
        <p class="eyebrow">Live status</p>
        <h2 data-health-status>Waiting for live health check</h2>
        <p class="summary compact" data-health-checked-at>The browser will request <code>/v1/health</code> after page load.</p>
        <div class="highlight" data-health-details>Use this panel for human-readable trust context, and use <code>/v1/health</code> directly for automation.</div>
      </section>
    `
    : "";

  let mainContent = "";
  if (page.slug === "landing") {
    mainContent = `
      <section class="hero">
        ${landingHeroAside}
      </section>
      ${statusPanel}
      <div class="landing-sections">
        ${renderSections(page)}
      </div>
      ${planCards}
    `;
  } else if (page.slug === "pricing") {
    mainContent = `
      <div class="pricing-header">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="summary">${escapeHtml(page.summary)}</p>
        <div class="cta-row">
          <a class="ds-button ds-button-primary" href="${escapeHtml(page.primaryCta.href)}">${escapeHtml(page.primaryCta.label)}</a>
          ${page.secondaryCta ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(page.secondaryCta.href)}"${authSwitchAttribute}>${escapeHtml(page.secondaryCta.label)}</a>` : ""}
        </div>
        ${legalMeta}
      </div>
      ${planCards}
      <div class="pricing-features-grid">
        ${renderSections(page)}
      </div>
    `;
  } else if (page.slug === "sign-in" || page.slug === "sign-up") {
    mainContent = `
      <div class="auth-layout">
        <div class="auth-info">
          <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
          <h1>${escapeHtml(page.title)}</h1>
          <p class="summary">${escapeHtml(page.summary)}</p>
          <div class="cta-row">
            <a class="ds-button ds-button-primary" href="${escapeHtml(page.primaryCta.href)}">${escapeHtml(page.primaryCta.label)}</a>
            ${page.secondaryCta ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(page.secondaryCta.href)}"${authSwitchAttribute}>${escapeHtml(page.secondaryCta.label)}</a>` : ""}
          </div>
          ${legalMeta}
          <div class="auth-info-sections">
            ${renderSections(page)}
          </div>
        </div>
        <div class="auth-form-container">
          ${authForm}
        </div>
      </div>
    `;
  } else {
    mainContent = `
      <div class="document-layout">
        <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
        <h1>${escapeHtml(page.title)}</h1>
        <p class="summary">${escapeHtml(page.summary)}</p>
        <div class="cta-row">
          <a class="ds-button ds-button-primary" href="${escapeHtml(page.primaryCta.href)}">${escapeHtml(page.primaryCta.label)}</a>
          ${page.secondaryCta ? `<a class="ds-button ds-button-secondary" href="${escapeHtml(page.secondaryCta.href)}"${authSwitchAttribute}>${escapeHtml(page.secondaryCta.label)}</a>` : ""}
        </div>
        ${legalMeta}
        ${statusPanel}
        <div class="document-content">
          ${renderSections(page)}
        </div>
      </div>
    `;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)} | Tileserver</title>
  ${page.slug === "landing" ? '<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />' : ""}
  <style>
    ${getGlobalCss()}
    ${getUniversalHeaderCss()}
    :root {
      --panel: var(--surface);
      --shadow: 0 12px 30px rgba(0, 0, 0, 0.04);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --panel: var(--surface);
        --shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
      }
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 36px 24px 56px;
    }
    .hero {
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 40px;
      box-shadow: var(--shadow);
      background: var(--surface);
    }
    .hero-split {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
      gap: 36px;
      align-items: center;
    }
    @media (max-width: 840px) {
      .hero-split {
        grid-template-columns: 1fr;
        gap: 32px;
      }
    }
    .hero-copy {
      display: grid;
      align-content: start;
    }
    .hero-preview {
      border-radius: 20px;
      border: 1px solid var(--border-strong);
      background: var(--surface-2);
      padding: 20px;
      display: grid;
      gap: 16px;
      min-height: 320px;
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
    }
    .hero-preview-top,
    .hero-preview-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }
    .hero-preview-meta {
      display: grid;
    }
    .hero-preview-top small,
    .hero-preview-meta p {
      color: var(--muted);
    }
    .hero-preview-meta p {
      margin: 4px 0 0;
      line-height: 1.6;
      font-size: 13px;
    }
    .hero-map-status {
      min-height: 1.5em;
      font-size: 12px;
    }
    .hero-map {
      width: 100%;
      min-width: 0;
      min-height: 220px;
      border-radius: 14px;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      background: var(--bg);
    }
    .hero-map .maplibregl-canvas {
      border-radius: 14px;
    }
    .hero-map :is(.maplibregl-ctrl-top-right, .maplibregl-ctrl-top-left) {
      top: 10px;
    }
    .hero-map :is(.maplibregl-ctrl-group) {
      box-shadow: 0 12px 24px rgba(20, 32, 41, 0.14);
    }
    .eyebrow {
      margin: 0 0 12px;
      color: var(--success);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      font-weight: 600;
    }
    h1 {
      margin: 0 0 16px;
      font-size: 48px;
      line-height: 1.1;
      letter-spacing: -0.03em;
      font-weight: 700;
      color: var(--ink);
    }
    .summary {
      max-width: 760px;
      margin: 0;
      color: var(--muted);
      font-size: 18px;
      line-height: 1.6;
    }
    .cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 24px;
    }
    .capability-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 28px;
    }
    .capability-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border-radius: var(--rad-2);
      border: 1px solid var(--border);
      background: var(--surface-2);
      color: var(--ink-2);
      font-size: 13px;
      font-weight: 600;
    }
    .meta {
      margin-top: 14px;
      color: var(--muted);
      font-size: 14px;
    }
    .summary.compact {
      font-size: 16px;
      max-width: none;
    }

    /* Landing Alternating Sections */
    .landing-sections {
      margin-top: 56px;
      display: flex;
      flex-direction: column;
    }
    .landing-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 56px;
      align-items: center;
      padding: 64px 0;
      border-top: 1px solid var(--border);
    }
    @media (max-width: 840px) {
      .landing-section {
        grid-template-columns: 1fr;
        gap: 32px;
        padding: 44px 0;
      }
    }
    .landing-section .feature-copy {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .landing-section .feature-badge {
      display: inline-flex;
      align-self: flex-start;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--accent);
      background: rgba(79, 70, 229, 0.06);
      padding: 4px 8px;
      border-radius: var(--rad-1);
      border: 1px solid rgba(79, 70, 229, 0.15);
      letter-spacing: 0.05em;
    }
    .landing-section h2 {
      font-size: 32px;
      font-weight: 650;
      letter-spacing: -0.02em;
      margin: 0;
      color: var(--ink);
    }
    .landing-section .feature-body {
      font-size: 16px;
      color: var(--ink-2);
      line-height: 1.6;
      margin: 0;
    }
    .landing-section .feature-highlight {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
      border-left: 2px solid var(--border-strong);
      padding-left: 12px;
      margin-top: 8px;
    }

    /* Checklist & Doc Links */
    .capability-checklist {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .capability-checklist li {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }
    .capability-checklist .chk-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: rgba(22, 163, 74, 0.1);
      color: var(--success);
      font-weight: bold;
      font-size: 13px;
      flex-shrink: 0;
    }
    .capability-checklist strong {
      display: block;
      font-size: 15px;
      font-weight: 600;
      color: var(--ink);
      margin-bottom: 2px;
    }
    .capability-checklist p {
      font-size: 13px;
      color: var(--muted);
      margin: 0;
      line-height: 1.4;
    }
    .doc-links-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 480px) {
      .doc-links-grid {
        grid-template-columns: 1fr;
      }
    }
    .doc-link-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-radius: var(--rad-2);
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--ink);
      font-weight: 600;
      font-size: 14px;
      transition: all var(--motion-fast);
    }
    .doc-link-item:hover {
      border-color: var(--border-strong);
      background: var(--surface-2);
      transform: translateY(-1px);
    }
    .doc-link-arrow {
      color: var(--muted);
      transition: transform var(--motion-fast), color var(--motion-fast);
    }
    .doc-link-item:hover .doc-link-arrow {
      transform: translateX(3px);
      color: var(--accent);
    }

    /* Pricing Section */
    .pricing-header {
      text-align: center;
      margin-bottom: 40px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .pricing-features-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 32px;
      margin-top: 48px;
    }
    .section-typo {
      border-top: 1px solid var(--border);
      padding-top: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .section-typo h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      color: var(--ink);
    }
    .section-typo .section-body {
      font-size: 15px;
      color: var(--ink-2);
      line-height: 1.6;
      margin: 0;
    }

    /* Plan Cards Grid */
    .plans-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
      margin-top: 32px;
      margin-bottom: 48px;
    }
    .plan-card {
      border: 1px solid var(--border-strong);
      border-radius: 20px;
      background: var(--surface);
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      box-shadow: var(--shadow);
      transition: border-color var(--motion-fast), box-shadow var(--motion-fast);
      position: relative;
    }
    .plan-card:hover {
      border-color: var(--accent);
      box-shadow: 0 12px 24px rgba(79, 70, 229, 0.03);
    }
    .plan-card[data-popular="true"] {
      border-color: var(--accent);
      background: var(--bg);
    }
    .plan-card[data-popular="true"]::before {
      content: "Popular";
      position: absolute;
      top: -12px;
      right: 24px;
      background: var(--accent);
      color: var(--accent-fg);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 2px 10px;
      border-radius: 999px;
      letter-spacing: 0.05em;
    }
    .plan-id {
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--success);
      font-weight: 600;
    }
    .plan-allowance {
      margin-top: 10px;
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      color: var(--ink);
    }
    .plan-meta {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }

    /* Live Status Panel */
    .live-status-panel {
      border: 1px solid var(--border);
      border-radius: 20px;
      background: var(--surface);
      padding: 32px;
      box-shadow: var(--shadow);
      display: grid;
      gap: 12px;
    }
    .live-status-panel h2 {
      margin: 0;
      font-size: 28px;
    }
    .live-status-panel code {
      font-family: "JetBrains Mono", monospace;
      font-size: 0.95em;
    }

    /* FAQ Restructuring */
    .faq-list {
      display: flex;
      flex-direction: column;
      gap: 0;
      border-top: 1px solid var(--border);
      margin-top: 16px;
    }
    .faq-item {
      border-bottom: 1px solid var(--border);
      padding: 20px 0;
      background: transparent;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .faq-item h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--ink);
      margin: 0;
    }
    .faq-item p {
      font-size: 14px;
      color: var(--muted);
      line-height: 1.6;
      margin: 0;
    }

    /* Code Snippet Styles */
    .code-card {
      margin-top: 16px;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: var(--rad-2);
      background: var(--code-bg);
      color: var(--code-ink);
    }
    .code-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    pre {
      margin: 0;
      padding: 16px;
      overflow: auto;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      line-height: 1.55;
    }

    /* Auth Layout */
    .auth-layout {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 48px;
      align-items: start;
      margin-top: 24px;
    }
    @media (max-width: 840px) {
      .auth-layout {
        grid-template-columns: 1fr;
        gap: 32px;
      }
    }
    .auth-info {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .auth-info-sections {
      display: flex;
      flex-direction: column;
      gap: 24px;
      margin-top: 16px;
    }
    .auth-form-container {
      position: sticky;
      top: 80px;
    }
    .auth-panel {
      background: var(--surface);
      border: 1px solid var(--border-strong);
      border-radius: 20px;
      padding: 32px;
      box-shadow: var(--shadow);
      display: grid;
      gap: 16px;
    }
    .auth-panel h2 {
      margin: 0;
      font-size: 24px;
    }
    .auth-panel p {
      margin: 0;
      color: var(--ink-2);
      font-size: 14px;
      line-height: 1.5;
    }
    .auth-provider-note {
      color: var(--muted) !important;
    }
    .auth-actions {
      display: flex;
      gap: 12px;
      margin: 8px 0;
    }
    .auth-intent {
      padding: 12px 16px;
      border-radius: var(--rad-2);
      border: 1px solid rgba(79, 70, 229, 0.1);
      background: rgba(79, 70, 229, 0.04);
      color: var(--accent);
      font-weight: 600;
      font-size: 13px;
    }
    .auth-status {
      min-height: 24px;
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.4;
    }
    .legal-note {
      margin: 0;
      color: var(--muted) !important;
      font-size: 12px !important;
      line-height: 1.5;
    }
    .legal-note a {
      color: var(--accent);
    }

    /* Document Layout */
    .document-layout {
      max-width: 800px;
      margin: 0 auto;
      padding: 16px 0;
    }
    .document-content {
      display: flex;
      flex-direction: column;
      gap: 40px;
      margin-top: 32px;
    }

    /* Common elements */
    .highlight {
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(150, 90, 66, 0.18);
      background: rgba(150, 90, 66, 0.08);
      color: var(--danger);
      font-weight: 600;
      font-size: 14px;
    }
    footer {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 24px 56px;
      border-top: 1px solid var(--border);
      color: var(--muted);
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      font-size: 14px;
    }
    footer a {
      color: inherit;
      transition: color var(--motion-fast);
    }
    footer a:hover {
      color: var(--ink);
    }
    @media (max-width: 840px) {
      h1 {
        font-size: 38px;
      }
    }
  </style>
</head>
<body>
  ${renderUniversalHeader(resolveMarketingHeaderActiveItem(page.slug))}
  <main>
    ${mainContent}
  </main>
  <footer>
    <a href="/legal/terms">Terms</a>
    <a href="/legal/privacy">Privacy</a>
    <a href="/legal/dpa">DPA</a>
    <a href="/legal/acceptable-use">Acceptable Use</a>
    <a href="/security">Security</a>
    <a href="/docs/quickstart">Quickstart</a>
    <a href="/status">Status</a>
    <a href="mailto:${process.env.SECURITY_CONTACT_EMAIL || "security@tstiles.com"}?subject=Security%20report">Security contact</a>
  </footer>
  ${page.slug === "landing" ? '<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>' : ""}
  ${runtimeScript}
</body>
</html>`;
}

export async function marketingSiteRoute(input: MarketingRouteRequest): Promise<MarketingRouteResponse> {
  const allowedMethods = "GET,HEAD,OPTIONS";
  const request = normalizeRouteRequest(input);
  if (!request) {
    return {
      status: 400,
      body: JSON.stringify({ error: "MARKETING_BAD_REQUEST" }),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  const slug = resolveSlug(request.path);
  if (!slug) {
    return {
      status: 404,
      body: bodyForMethod(request.method, JSON.stringify({ error: "MARKETING_NOT_FOUND" })),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  if (request.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": allowedMethods,
        "access-control-allow-headers": "authorization,content-type",
        vary: "origin",
        "cache-control": "public, max-age=300",
      },
    };
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return {
      status: 400,
      body: bodyForMethod(request.method, JSON.stringify({ error: "MARKETING_BAD_REQUEST" })),
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    };
  }
  const html = renderMarketingHtml(await getMarketingPage(slug));
  return {
    status: 200,
    body: bodyForMethod(request.method, html),
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-length": String(byteLengthUtf8(html)),
    },
  };
}
