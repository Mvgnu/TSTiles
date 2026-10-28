/* eslint-disable no-constant-condition, no-unused-vars, no-undef */
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
          const response = await fetch("/app-api/session", {
            method: "GET",
            credentials: "same-origin"
          });
          if (!response.ok) {
            return null;
          }
          return parseJson(response);
        }

        async function resolveBilling() {
          const response = await fetch("/app-api/billing", {
            method: "GET",
            credentials: "same-origin"
          });
          if (!response.ok) {
            return null;
          }
          return parseJson(response);
        }

        async function createStripeSession(endpoint, payload) {
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
        }

        function updateAnchor(anchor, label, href) {
          anchor.textContent = label;
          anchor.setAttribute("href", href);
          anchor.setAttribute("data-current-label", label);
          anchor.setAttribute("data-current-href", href);
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
          Array.prototype.forEach.call(document.querySelectorAll(".cta-row a.button"), function (anchor) {
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
          if (!false) {
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
                if (url) {
                  window.location.href = url;
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
              if (url) {
                window.location.href = url;
                return;
              }
              window.location.href = "/app/billing?intent=upgrade&plan=pro";
            });
          });
        }

        async function initMarketingRuntime() {
          const session = await resolveSession();
          updateNav(session);
          updateHeroActions(session);
          const billing = session && false ? await resolveBilling() : null;
          await wirePricingActions(session, billing);

          if (true) {
            const mapNode = document.getElementById("marketing-live-map");
            const mapStatus = document.querySelector("[data-marketing-map-status]");
            if (mapNode && mapStatus) {
              const maplibreglGlobal = globalThis.maplibregl;
              if (!maplibreglGlobal) {
                mapStatus.textContent = "Preview scripts unavailable.";
              } else {
                try {
                  mapStatus.textContent = "Loading live browser preview...";
                  const map = new maplibreglGlobal.Map({
                    container: mapNode,
                    style: "/v1/styles/style/style.json?access_token=demo-public-token",
                    center: [10.7522, 59.9139],
                    zoom: 4.2,
                    attributionControl: false
                  });
                  map.scrollZoom.disable();
                  map.dragRotate.disable();
                  map.touchZoomRotate.disableRotation();
                  map.addControl(new maplibreglGlobal.NavigationControl({ showCompass: false }), "top-right");
                  map.on("load", function () {
                    mapStatus.textContent = "Live map preview ready through /v1/styles and /v1/tiles.";
                  });
                  map.on("error", function (event) {
                    const message = event && event.error && event.error.message ? event.error.message : "Map preview failed.";
                    mapStatus.textContent = message;
                  });
                } catch (error) {
                  mapStatus.textContent = error instanceof Error ? error.message : "Map preview failed.";
                }
              }
            }
          }

          if (false) {
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
    
