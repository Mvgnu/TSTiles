import { signUpRoute } from "./sign-up-route";
import { signInRoute } from "./sign-in-route";
import { signOutRoute } from "./sign-out-route";
import { verifyEmailRoute } from "./verify-email-route";
import { forgotPasswordRoute } from "./forgot-password-route";
import { resetPasswordRoute } from "./reset-password-route";
import { magicLinkRoute } from "./magic-link-route";
import { acceptInviteRoute } from "./accept-invite-route";
import { type AuthFlowsRouteInput, type AuthFlowsRouteResponse } from "../types";

export async function authFlowsRoute(input: AuthFlowsRouteInput): Promise<AuthFlowsRouteResponse> {
  const path = input.path.split("?")[0] || "/";

  if (path === "/sign-up" || path === "/sign-up/") {
    return signUpRoute(input);
  }
  if (path === "/sign-in" || path === "/sign-in/") {
    return signInRoute(input);
  }
  if (path === "/sign-out" || path === "/sign-out/") {
    return signOutRoute(input);
  }
  if (path === "/verify-email" || path === "/verify-email/" || path.startsWith("/verify-email/")) {
    return verifyEmailRoute(input);
  }
  if (path === "/forgot-password" || path === "/forgot-password/") {
    return forgotPasswordRoute(input);
  }
  if (path.startsWith("/reset-password/")) {
    return resetPasswordRoute(input);
  }
  if (path.startsWith("/magic-link/")) {
    return magicLinkRoute(input);
  }
  if (path.startsWith("/accept-invite/")) {
    return acceptInviteRoute(input);
  }

  // Fallback 404 for unhandled auth routes
  return {
    status: 404,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "AUTH_ROUTE_NOT_FOUND" }),
  };
}
