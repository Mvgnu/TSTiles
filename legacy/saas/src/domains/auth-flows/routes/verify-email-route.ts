import { requestEmailVerification, verifyEmailToken } from "../auth-flows.service";
import { renderAuthFlowsHtml } from "../components/pages";
import { generateCsrfSid, generateCsrfToken, verifyCsrfToken } from "../components/csrf";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse } from "../types";
import { getUserByEmail } from "../../identity/identity.service";

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

export async function verifyEmailRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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

  // Case 1: GET /verify-email/:token
  if (method === "GET" && path.startsWith("/verify-email/") && path !== "/verify-email" && path !== "/verify-email/") {
    const token = path.slice("/verify-email/".length).trim();
    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    try {
      const result = await verifyEmailToken(token, clientIp, userAgent);
      // Success: Set app_session cookie and redirect to /app
      const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
      return {
        status: 302,
        headers: {
          "location": "/app",
          "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
        },
      };
    } catch {
      // Failed verification: redirect to verify-email page with status=expired
      return {
        status: 302,
        headers: {
          "location": "/verify-email?status=expired",
        },
      };
    }
  }

  // Case 2: GET /verify-email
  if (method === "GET" && (path === "/verify-email" || path === "/verify-email/")) {
    let alertMessage: { tone: "info" | "warn" | "danger" | "success"; message: string } | undefined;
    if (input.query?.status === "expired") {
      alertMessage = {
        tone: "danger",
        message: "Your verification link has expired or is invalid. Please request a new one below.",
      };
    }

    const html = renderAuthFlowsHtml("verify-email", csrfToken, alertMessage);
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

  // Case 3: POST /verify-email/resend
  if (method === "POST" && path === "/verify-email/resend") {
    const body = (input.body || {}) as Record<string, unknown>;
    const bodyCsrf = String(body._csrf || "");
    const headerCsrf = headers["x-csrf-token"] || headers["X-CSRF-Token"];
    const submittedCsrf = bodyCsrf || headerCsrf;

    if (!verifyCsrfToken(submittedCsrf, csrfSid)) {
      const html = renderAuthFlowsHtml("verify-email", csrfToken, {
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
      try {
        const user = await getUserByEmail(email.trim().toLowerCase());
        if (user) {
          await requestEmailVerification(user.id, clientIp, userAgent);
        }
      } catch {
        // fail silent to prevent email enumeration
      }
    }

    const html = renderAuthFlowsHtml("verify-email", csrfToken, {
      tone: "success",
      message: "If the account exists, a new verification link has been sent.",
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
