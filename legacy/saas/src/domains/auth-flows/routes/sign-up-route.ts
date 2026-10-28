import { signUp } from "../auth-flows.service";
import { renderAuthFlowsHtml } from "../components/pages";
import { generateCsrfSid, generateCsrfToken, verifyCsrfToken } from "../components/csrf";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse, AuthFlowErrorCode, AuthFlowError } from "../types";

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

export async function signUpRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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
  const nextTarget = typeof input.query?.next === "string" ? input.query.next : "";
  const planTarget = input.query?.plan === "pro" ? "pro" : undefined;

  const allowedMethods = "GET,POST,OPTIONS";
  const corsHeaders: Record<string, string> = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": allowedMethods,
    "access-control-allow-headers": "content-type,x-csrf-token,cookie",
    vary: "origin",
  };

  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        ...corsHeaders,
        "cache-control": "public, max-age=60",
      },
    };
  }

  if (method === "GET") {
    const defaultEmail = typeof input.query?.email === "string" ? input.query.email : "";
    const html = renderAuthFlowsHtml("sign-up", csrfToken, undefined, {
      email: defaultEmail,
      next: nextTarget,
      plan: planTarget,
    });

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
        "sign-up",
        csrfToken,
        { tone: "danger", message: "CSRF token mismatch. Please try again." },
        { email: String(body.email || ""), next: nextTarget, plan: planTarget },
      );
      return {
        status: 400,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }

    const email = String(body.email || "");
    const password = String(body.password || "");
    const displayName = String(body.displayName || "");

    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    try {
      await signUp({ email, password, displayName }, clientIp, userAgent);
      // After success, render the verify-email page
      const html = renderAuthFlowsHtml("verify-email", csrfToken, {
        tone: "info",
        message: "Account created successfully. Please verify your email.",
      });
      return {
        status: 201,
        headers: { "content-type": "text/html" },
        body: html,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Registration failed.";
      const tone = error instanceof AuthFlowError && error.code === AuthFlowErrorCode.LOCKED_OUT ? "warn" : "danger";
      const html = renderAuthFlowsHtml(
        "sign-up",
        csrfToken,
        { tone, message },
        { email, next: nextTarget, plan: planTarget },
      );
      return {
        status: error instanceof AuthFlowError && error.code === AuthFlowErrorCode.BAD_REQUEST ? 400 : 200,
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
