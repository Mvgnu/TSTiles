import { signOut } from "../auth-flows.service";
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

export async function signOutRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
  const method = input.method;
  const headers = input.headers || {};

  if (method !== "POST") {
    return {
      status: 405,
      headers: { allow: "POST" },
    };
  }

  const sessionToken = readCookie(headers, "app_session");
  const clientIp = headers["x-forwarded-for"] || headers["x-real-ip"] || "127.0.0.1";
  const userAgent = headers["user-agent"] || "";

  if (sessionToken) {
    try {
      await signOut(sessionToken, clientIp, userAgent);
    } catch {
      // ignore failures during signout revoking
    }
  }

  // Clear cookie and redirect
  return {
    status: 302,
    headers: {
      "location": "/",
      "set-cookie": "app_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    },
  };
}
