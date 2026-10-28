export {
  AuthFlowError,
  AuthFlowErrorCode,
  type SignUpInput,
  type SignInInput,
  type PasswordResetRequestInput,
  type PasswordResetCompleteInput,
  type MagicLinkRequestInput,
  type InvitationAcceptInput,
  type AuthFlowsRouteInput,
  type AuthFlowsRouteResponse,
  type AuthFlowsPage,
} from "./types";

export {
  signUp,
  signIn,
  signOut,
  requestEmailVerification,
  verifyEmailToken,
  requestPasswordReset,
  completePasswordReset,
  requestMagicLink,
  consumeMagicLink,
  acceptInvitation,
  isPasswordStrong,
} from "./auth-flows.service";

export { authFlowsRoute } from "./routes";
export { renderAuthFlowsHtml } from "./components/pages";
export { renderAuthShell } from "./components/auth-shell";
