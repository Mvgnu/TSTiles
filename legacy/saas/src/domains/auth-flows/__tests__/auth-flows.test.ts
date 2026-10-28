import { strict as assert } from "node:assert";
import { prisma } from "../../../config/db";
import {
  signUp,
  signIn,
  verifyEmailToken,
  requestPasswordReset,
  completePasswordReset,
  requestMagicLink,
  consumeMagicLink,
  acceptInvitation,
  isPasswordStrong,
} from "../auth-flows.service";
import { createCredentialToken } from "../../identity/identity.service";
import { authFlowsRoute } from "../routes";
import { AuthFlowErrorCode, AuthFlowError } from "../types";
import { generateCsrfSid, generateCsrfToken } from "../components/csrf";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("Auth Flows service & route integration tests", async () => {
  // Clear any existing users/workspaces/etc.
  await prisma.emailDispatch.deleteMany();
  await prisma.identitySession.deleteMany();
  await prisma.identityCredentialToken.deleteMany();
  await prisma.identityAuthLockout.deleteMany();
  await prisma.identityAuthEvent.deleteMany();
  await prisma.identityMembership.deleteMany();
  await prisma.identityWorkspace.deleteMany();
  await prisma.identityUser.deleteMany();

  // Test 1: Password strength checks
  assert.equal(isPasswordStrong("weak"), false);
  assert.equal(isPasswordStrong("password123!"), false); // common compromised check
  assert.equal(isPasswordStrong("strongPassword123!"), true);

  // Test 2: Sign-up happy path
  const signUpResult = await signUp({
    email: "user@example.com",
    password: "strongPassword123!",
    displayName: "John Doe",
  });
  assert.equal(signUpResult.pendingVerification, true);
  assert.equal(signUpResult.user.email, "user@example.com");
  assert.equal(signUpResult.user.name, "John Doe");
  assert.equal(signUpResult.workspace.name, "John Doe's workspace");

  // Verify DB entries
  const user = await prisma.identityUser.findUnique({ where: { email: "user@example.com" } });
  assert.ok(user);
  assert.equal(user.emailVerifiedAt, null);

  const memberships = await prisma.identityMembership.findMany({ where: { userId: user.id } });
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].role, "customer_owner");

  const verifyToken = await prisma.identityCredentialToken.findFirst({
    where: { userId: user.id, purpose: "email_verification" },
  });
  assert.ok(verifyToken);

  // Verify verification mail was dispatched
  const verifyMail = await prisma.emailDispatch.findFirst({
    where: { to: "user@example.com", templateKey: "email_verification" },
  });
  assert.ok(verifyMail);

  // Test 3: Sign-up email collision does NOT enumerate
  const collisionResult = await signUp({
    email: "user@example.com",
    password: "anotherStrongPassword999!",
  });
  // Collision returns unverified state to hide registration existence
  assert.equal(collisionResult.pendingVerification, true);

  // Test 4: Sign-in unverified user fails closed
  try {
    await signIn({ email: "user@example.com", password: "strongPassword123!" });
    assert.fail("Should have failed on unverified account");
  } catch (error) {
    assert.ok(error instanceof AuthFlowError);
    assert.equal(error.code, AuthFlowErrorCode.EMAIL_UNVERIFIED);
  }

  // Test 5: Verify email token consumption
  await prisma.identityCredentialToken.findMany({
    where: { userId: user.id, purpose: "email_verification" },
  });
  // We need the raw token, which was sent in email. We can extract it or mock raw token check
  // For tests, let's locate the token URL in dispatched email!
  const mail = await prisma.emailDispatch.findFirst({
    where: { to: "user@example.com", templateKey: "email_verification" },
  });
  assert.ok(mail);
  const parsedParams = JSON.parse(mail.paramsJson) as { verificationUrl: string };
  const rawToken = parsedParams.verificationUrl.split("/verify-email/")[1];
  assert.ok(rawToken);

  const verifyResult = await verifyEmailToken(rawToken, "127.0.0.1", "test-agent");
  assert.ok(verifyResult.session.token);
  assert.equal(verifyResult.user.id, user.id);

  const userAfter = await prisma.identityUser.findUnique({ where: { id: user.id } });
  assert.ok(userAfter?.emailVerifiedAt);

  // Welcome email dispatched
  const welcomeMail = await prisma.emailDispatch.findFirst({
    where: { to: "user@example.com", templateKey: "welcome" },
  });
  assert.ok(welcomeMail);

  // Test 6: Sign-in happy path
  const signInResult = await signIn({
    email: "user@example.com",
    password: "strongPassword123!",
    userAgent: "test-agent",
    clientIp: "127.0.0.1",
  });
  assert.equal(signInResult.mfaRequired, false);
  if (signInResult.mfaRequired) {
    assert.fail("expected a session after password sign-in");
  }
  assert.ok(signInResult.session.token);

  // Test 7: Lockout counters increment on failure
  try {
    await signIn({ email: "user@example.com", password: "wrongPassword!!!" });
  } catch {
    // expected
  }
  const lockout = await prisma.identityAuthLockout.findUnique({
    where: { key_keyKind: { key: "user@example.com", keyKind: "email" } },
  });
  assert.ok(lockout);
  assert.equal(lockout.failureCount >= 1, true);

  // Test 8: request password reset
  const resetRequest = await requestPasswordReset("user@example.com");
  assert.equal(resetRequest.dispatched, true);

  const resetMail = await prisma.emailDispatch.findFirst({
    where: { to: "user@example.com", templateKey: "password_reset" },
  });
  assert.ok(resetMail);
  const resetParams = JSON.parse(resetMail.paramsJson) as { resetUrl: string };
  const rawResetToken = resetParams.resetUrl.split("/reset-password/")[1];
  assert.ok(rawResetToken);

  // Test 9: complete password reset
  const resetComplete = await completePasswordReset(rawResetToken, "newAwesomePassword123!", "127.0.0.1", "test-agent");
  assert.ok(resetComplete.session.token);

  // Old sessions should be revoked
  const revokedCount = await prisma.identitySession.count({
    where: { userId: user.id, revokedAt: { not: null } },
  });
  assert.equal(revokedCount >= 2, true);

  // Test 10: magic link sign in
  const magicRequest = await requestMagicLink("user@example.com");
  assert.equal(magicRequest.dispatched, true);

  const magicMail = await prisma.emailDispatch.findFirst({
    where: { to: "user@example.com", templateKey: "magic_link" },
  });
  assert.ok(magicMail);
  const magicParams = JSON.parse(magicMail.paramsJson) as { magicLinkUrl: string };
  const rawMagicToken = magicParams.magicLinkUrl.split("/magic-link/")[1];
  assert.ok(rawMagicToken);

  const magicConsume = await consumeMagicLink(rawMagicToken);
  assert.ok(magicConsume.session.token);

  // Test 11: Workspace invitation accept path
  const invitingWorkspace = await prisma.identityWorkspace.create({
    data: {
      id: "inv-workspace",
      name: "Inviting Workspace",
      createdAt: new Date().toISOString(),
    },
  });

  await prisma.identityCredentialToken.create({
    data: {
      id: "inv-token-id",
      tokenHash: "hashed-invite-token-secret-12345",
      purpose: "workspace_invitation",
      metaJson: JSON.stringify({
        email: "invited@example.com",
        workspaceId: invitingWorkspace.id,
        role: "customer_member",
        inviterName: "John",
        workspaceName: "Inviting Workspace",
      }),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });

  // Mock accepting invite for brand new user
  // (We need raw invite token lookup. Let's create a real token via service to get rawToken)
  const inviteTokenPayload = await createCredentialToken({
    purpose: "workspace_invitation",
    lifetimeMs: 7 * 24 * 60 * 60 * 1000,
    meta: {
      email: "invited@example.com",
      workspaceId: invitingWorkspace.id,
      role: "customer_member",
      inviterName: "John",
      workspaceName: "Inviting Workspace",
    },
  });

  const inviteResult = await acceptInvitation(inviteTokenPayload.rawToken, {
    email: "invited@example.com",
    password: "memberPassword123!",
    displayName: "Invited Member",
  });

  assert.equal(inviteResult.user.email, "invited@example.com");
  assert.equal(inviteResult.workspace.id, invitingWorkspace.id);

  // Verify membership
  const invitedUserMembership = await prisma.identityMembership.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: invitingWorkspace.id,
        userId: inviteResult.user.id,
      },
    },
  });
  assert.ok(invitedUserMembership);
  assert.equal(invitedUserMembership.role, "customer_member");
});

test("Auth Flows route integration tests", async () => {
  // OPTIONS request
  const options = await authFlowsRoute({
    method: "OPTIONS",
    path: "/sign-in",
  });
  assert.equal(options.status, 204);

  // GET sign-in renders HTML with CSRF sid
  const getSignIn = await authFlowsRoute({
    method: "GET",
    path: "/sign-in",
  });
  assert.equal(getSignIn.status, 200);
  assert.ok(getSignIn.headers["set-cookie"]);
  assert.ok(getSignIn.body?.includes("Sign in"));
  assert.ok(getSignIn.body?.includes("universal-header"));
  assert.ok(getSignIn.body?.includes("Product"));
  assert.ok(getSignIn.body?.includes("Start free"));

  // CSRF validation block
  const postSignInNoCsrf = await authFlowsRoute({
    method: "POST",
    path: "/sign-in",
    body: {
      email: "user@example.com",
      password: "strongPassword123!",
    },
  });
  assert.equal(postSignInNoCsrf.status, 400); // fails closed CSRF mismatch
  assert.ok(postSignInNoCsrf.body?.includes("CSRF"));

  // Verify successful CSRF GET -> POST happy path
  const sid = generateCsrfSid();
  const token = generateCsrfToken(sid);

  const postSignInWithCsrf = await authFlowsRoute({
    method: "POST",
    path: "/sign-in",
    headers: {
      cookie: `csrf_sid=${sid}`,
    },
    body: {
      _csrf: token,
      email: "user@example.com",
      password: "newAwesomePassword123!", // our updated password from test above
    },
  });
  assert.equal(postSignInWithCsrf.status, 302); // successful redirect
  assert.ok(postSignInWithCsrf.headers["set-cookie"].includes("app_session="));
});
