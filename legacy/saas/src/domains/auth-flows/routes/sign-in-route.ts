import { signIn } from "../auth-flows.service";
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

function validateRedirect(next: string | undefined, plan: string | undefined): string {
  if (!next) {
    return plan === "pro" ? "/app/billing?intent=upgrade&plan=pro" : "/app";
  }
  const decoded = decodeURIComponent(next).trim();
  if (decoded === "/" || decoded === "/app" || decoded.startsWith("/app/") || decoded === "/pricing" || decoded.startsWith("/docs/")) {
    return decoded;
  }
  return "/app";
}

export async function signInRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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
    let alertMessage: { tone: "info" | "warn" | "danger" | "success"; message: string } | undefined;

    if (input.query?.status === "verified") {
      alertMessage = { tone: "success", message: "Email verified successfully! Please sign in." };
    }

    const html = renderAuthFlowsHtml("sign-in", csrfToken, alertMessage, {
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
        "sign-in",
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

    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    try {
      const result = await signIn({ email, password, userAgent, clientIp });

      if (result.mfaRequired) {
        // Render MFA Challenge and set short-lived pending cookie
        const html = renderAuthFlowsHtml("mfa-challenge", csrfToken, {
          tone: "info",
          message: "Multi-Factor Authentication code required.",
        });
        const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
        return {
          status: 200,
          headers: {
            "content-type": "text/html",
            "set-cookie": `app_mfa_pending=${result.user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=300${secureFlag}`,
          },
          body: html,
        };
      }

      // Success sign-in: Set cookie and redirect
      const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";
      const redirectUrl = validateRedirect(nextTarget, planTarget);

      return {
        status: 302,
        headers: {
          "location": redirectUrl,
          "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed.";
      let tone: "danger" | "warn" = "danger";
      let status = 200;

      if (error instanceof AuthFlowError) {
        if (error.code === AuthFlowErrorCode.LOCKED_OUT) {
          tone = "warn";
        }
        if (error.code === AuthFlowErrorCode.EMAIL_UNVERIFIED) {
          tone = "warn";
          status = 400; // fail closed
        }
      }

      const html = renderAuthFlowsHtml(
        "sign-in",
        csrfToken,
        { tone, message },
        { email, next: nextTarget, plan: planTarget },
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
