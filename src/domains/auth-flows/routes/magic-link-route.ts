import { requestMagicLink, consumeMagicLink } from "../auth-flows.service";
import { renderAuthFlowsHtml } from "../components/pages";
import { generateCsrfSid, generateCsrfToken, verifyCsrfToken } from "../components/csrf";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse } from "../types";

function readCookie(headers: Readonly<Record<string, string | undefined>> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const cookieHeader = headers.cookie || headers.Cookie;
  if (!cookieHeader) return undefined;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawKey, ...rest] = cookie.trim().split("=");
    if (rawKey === name) {
      return rest.join("=").trim();
    }
  }
  return undefined;
}

export async function magicLinkRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
  const method = input.method;
  const headers = input.headers || {};
  let csrfSid = readCookie(headers, "csrf_sid");
  let newCsrfCookieHeader = "";

  if (!csrfSid) {
    csrfSid = generateCsrfSid();
    const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
    newCsrfCookieHeader = `csrf_sid=${csrfSid}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`;
  }

  const csrfToken = generateCsrfToken(csrfSid);
  const path = input.path.split("?")[0] || "/";

  // Case 1: GET /magic-link/:token
  if (method === "GET" && path.startsWith("/magic-link/") && path !== "/magic-link" && path !== "/magic-link/") {
    const token = path.slice("/magic-link/".length).trim();
    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    if (!token || token.includes("/") || token.includes("..")) {
      return {
        status: 302,
        headers: {
          "location": "/sign-in?status=invalid_magic",
        },
      };
    }

    try {
      const result = await consumeMagicLink(token, clientIp, userAgent);
      const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
      return {
        status: 302,
        headers: {
          "location": "/app",
          "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
        },
      };
    } catch {
      return {
        status: 302,
        headers: {
          "location": "/sign-in?status=expired_magic",
        },
      };
    }
  }

  // Case 2: GET /magic-link/request (standard form request page)
  if (method === "GET" && (path === "/magic-link/request" || path === "/magic-link/request/")) {
    const html = renderAuthFlowsHtml("magic-link-request", csrfToken);
    const responseHeaders: Record<string, string> = {
      "content-type": "text/html",
    };
    if (newCsrfCookieHeader) {
      responseHeaders["set-cookie"] = newCsrfCookieHeader;
    }

    return {
      status: 200,
      headers: responseHeaders,
      body: html,
    };
  }

  // Case 3: POST /magic-link/request
  if (method === "POST" && path === "/magic-link/request") {
    const body = (input.body || {}) as Record<string, unknown>;
    const bodyCsrf = String(body._csrf || "");
    const headerCsrf = headers["x-csrf-token"] || headers["X-CSRF-Token"];
    const submittedCsrf = bodyCsrf || headerCsrf;

    if (!verifyCsrfToken(submittedCsrf, csrfSid)) {
      const html = renderAuthFlowsHtml("magic-link-request", csrfToken, {
        tone: "danger",
        message: "CSRF token mismatch. Please try again.",
      });
      return {
        status: 400,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }

    const email = String(body.email || "");
    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    if (email) {
      await requestMagicLink(email, clientIp, userAgent);
    }

    const html = renderAuthFlowsHtml("magic-link-request", csrfToken, {
      tone: "success",
      message: "If the account exists, a magic sign-in link has been sent.",
    });

    return {
      status: 200,
      headers: { "content-type": "text/html" },
      body: html,
    };
  }

  return {
    status: 405,
    headers: { allow: "GET,POST" },
  };
}
