import { requestPasswordReset } from "../auth-flows.service";
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

export async function forgotPasswordRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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

  if (method === "GET") {
    const html = renderAuthFlowsHtml("forgot-password", csrfToken);
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

  if (method === "POST") {
    const body = (input.body || {}) as Record<string, unknown>;
    const bodyCsrf = String(body._csrf || "");
    const headerCsrf = headers["x-csrf-token"] || headers["X-CSRF-Token"];
    const submittedCsrf = bodyCsrf || headerCsrf;

    if (!verifyCsrfToken(submittedCsrf, csrfSid)) {
      const html = renderAuthFlowsHtml("forgot-password", csrfToken, {
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
      await requestPasswordReset(email, clientIp, userAgent);
    }

    // Always return non-enumerating success message
    const html = renderAuthFlowsHtml("forgot-password", csrfToken, {
      tone: "success",
      message: "If the account exists and is verified, a password reset link has been sent.",
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
