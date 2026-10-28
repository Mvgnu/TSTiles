import { acceptInvitation } from "../auth-flows.service";
import { renderAuthFlowsHtml } from "../components/pages";
import { generateCsrfSid, generateCsrfToken, verifyCsrfToken } from "../components/csrf";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse, AuthFlowErrorCode, AuthFlowError } from "../types";
import { getCredentialToken, getUserByEmail, resolveSession } from "../../identity/identity.service";

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

export async function acceptInviteRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
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
  const token = path.slice("/accept-invite/".length).trim();

  if (!token || token.includes("/") || token.includes("..")) {
    return {
      status: 302,
      headers: {
        "location": "/sign-in?status=invalid_invite",
      },
    };
  }

  // Get token metadata first (without consuming)
  const checkToken = await getCredentialToken(token, "workspace_invitation");
  const now = new Date().toISOString();

  if (!checkToken || checkToken.expiresAt < now || checkToken.consumedAt) {
    const html = renderAuthFlowsHtml("sign-in", csrfToken, {
      tone: "danger",
      message: "This invitation link is invalid or has expired. Please ask the administrator for a new one.",
    });
    return {
      status: 200,
      headers: { "content-type": "text/html" },
      body: html,
    };
  }

  const meta = checkToken.metaJson ? (JSON.parse(checkToken.metaJson) as Record<string, unknown>) : {};
  const inviteEmail = String(meta.email || "");
  const workspaceName = String(meta.workspaceName || "Workspace");
  const inviterName = String(meta.inviterName || "Team Member");

  const existingUser = await getUserByEmail(inviteEmail);

  if (method === "GET") {
    if (existingUser) {
      // Invite is for an existing user, check if they are signed in
      const session = await resolveSession(headers);
      if (!session || session.user.email.toLowerCase() !== inviteEmail.toLowerCase()) {
        // Not signed in or signed in as someone else: redirect to sign-in
        const nextUrl = `/accept-invite/${token}`;
        return {
          status: 302,
          headers: {
            "location": `/sign-in?next=${encodeURIComponent(nextUrl)}&email=${encodeURIComponent(inviteEmail)}`,
          },
        };
      }

      // Signed in correctly: render accept invitation page for existing user
      const html = renderAuthFlowsHtml(
        "accept-invite",
        csrfToken,
        undefined,
        {
          token,
          email: inviteEmail,
          workspaceName,
          inviterName,
          existingUser: true,
        },
      );
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

    // New user signup accept invitation UI
    const html = renderAuthFlowsHtml(
      "accept-invite",
      csrfToken,
      undefined,
      {
        token,
        email: inviteEmail,
        workspaceName,
        inviterName,
        existingUser: false,
      },
    );
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
        "accept-invite",
        csrfToken,
        { tone: "danger", message: "CSRF token mismatch. Please try again." },
        { token, email: inviteEmail, workspaceName, inviterName, existingUser: !!existingUser },
      );
      return {
        status: 400,
        headers: { "content-type": "text/html" },
        body: html,
      };
    }

    const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
    const userAgent = headers["user-agent"] || "";

    try {
      if (existingUser) {
        // Invite is for an existing signed-in user
        const session = await resolveSession(headers);
        if (!session || session.user.email.toLowerCase() !== inviteEmail.toLowerCase()) {
          throw new AuthFlowError(AuthFlowErrorCode.BAD_REQUEST, "Invitee session not matches target email.");
        }

        const result = await acceptInvitation(token, undefined, clientIp, userAgent);
        const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";

        return {
          status: 302,
          headers: {
            "location": "/app",
            "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
          },
        };
      } else {
        // Brand new user sign-up
        const password = String(body.password || "");
        const displayName = String(body.displayName || "");

        const signUpInput = {
          email: inviteEmail,
          password,
          displayName,
        };

        const result = await acceptInvitation(token, signUpInput, clientIp, userAgent);
        const secureFlag = process.env.NODE_ENV === "development" ? "" : "; Secure";

        return {
          status: 302,
          headers: {
            "location": "/app",
            "set-cookie": `app_session=${result.session.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`,
          },
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to accept invitation.";
      let tone: "danger" | "warn" = "danger";
      let status = 200;

      if (error instanceof AuthFlowError) {
        if (error.code === AuthFlowErrorCode.PASSWORD_WEAK) {
          tone = "danger";
          status = 400; // fail closed
        }
      }

      const html = renderAuthFlowsHtml(
        "accept-invite",
        csrfToken,
        { tone, message },
        { token, email: inviteEmail, workspaceName, inviterName, existingUser: !!existingUser },
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
