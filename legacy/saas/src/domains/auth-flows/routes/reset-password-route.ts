import { completePasswordReset } from "../auth-flows.service";
import { renderAuthFlowsHtml } from "../components/pages";
import { generateCsrfSid, generateCsrfToken, verifyCsrfToken } from "../components/csrf";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse, AuthFlowErrorCode, AuthFlowError } from "../types";
import { getCredentialToken } from "../../identity/identity.service";

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

export async function resetPasswordRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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
  const token = path.slice("/reset-password/".length).trim();

  if (!token || token.includes("/") || token.includes("..")) {
    return {
      status: 302,
      headers: {
        "location": "/forgot-password?status=invalid",
      },
    };
  }

  if (method === "GET") {
    // Verify token validity first (without consuming)
    const checkToken = await getCredentialToken(token, "password_reset");
    const now = new Date().toISOString();
    if (!checkToken || checkToken.expiresAt < now || checkToken.consumedAt) {
      const html = renderAuthFlowsHtml("forgot-password", csrfToken, {
        tone: "danger",
        message: "Your password reset link is invalid or has expired. Please request a new one.",
      });
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }

    const html = renderAuthFlowsHtml("reset-password", csrfToken, undefined, { token });
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
      const html = renderAuthFlowsHtml(
        "reset-password",
        csrfToken,
        { tone: "danger", message: "CSRF token mismatch. Please try again." },
        { token },
      );
      return {
        status: 400,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }

    const password = String(body.password || "");
    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    try {
      const result = await completePasswordReset(token, password, clientIp, userAgent);
      // Success reset: Set session cookie and redirect to /app
      const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
      return {
        status: 302,
        headers: {
          "location": "/app",
          "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password reset failed.";
      let tone: "danger" | "warn" = "danger";
      let status = 200;

      if (error instanceof AuthFlowError) {
        if (error.code === AuthFlowErrorCode.TOKEN_INVALID) {
          tone = "danger";
          status = 400; // fail closed
        } else if (error.code === AuthFlowErrorCode.PASSWORD_WEAK) {
          tone = "danger";
          status = 400; // fail closed
        }
      }

      const html = renderAuthFlowsHtml(
        "reset-password",
        csrfToken,
        { tone, message },
        { token },
      );

      return {
        status,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }
  }

  return {
    status: 405,
    headers: { allow: "GET,POST" },
  };
}
