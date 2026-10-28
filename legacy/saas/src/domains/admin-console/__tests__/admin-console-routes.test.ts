import { strict as assert } from "node:assert";
import { createHmac } from "node:crypto";
import { prisma } from "../../../config/db";
import { adminConsoleRoute } from "../routes/ops-route";
import { hashPassword } from "../../identity/components/password-hash";
import { hashToken } from "../../identity/components/credential-token-hash";
import { generateCsrfSid, generateCsrfToken } from "../../auth-flows/components/csrf";

// Configure required environment variables for config loading and MFA cryptography
process.env.NODE_ENV = "development";
process.env.OBJECT_STORE_BUCKET = "test-bucket";
process.env.ADMIN_TOKEN = "test-token";
process.env.MFA_KEY = "mfa-default-key-32-bytes-long!!!";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

let sequence = 0;
function uniqueId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

// Helper to decode base32
function decodeBase32(b32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = b32.toUpperCase().replace(/=+$/, "");
  let bits = "";
  for (let i = 0; i < cleaned.length; i++) {
    const val = alphabet.indexOf(cleaned[i]);
    if (val === -1) throw new Error("Invalid base32 character");
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Helper to generate a valid TOTP code for testing
function generateTotp(secretBase32: string): string {
  const key = decodeBase32(secretBase32);
  const epoch = Math.floor(Date.now() / 1000);
  const counter = Math.floor(epoch / 30);
  const counterBuffer = Buffer.alloc(8);
  let temp = counter;
  for (let i = 7; i >= 0; i--) {
    counterBuffer[i] = temp & 0xff;
    temp >>= 8;
  }
  const hmac = createHmac("sha1", key);
  hmac.update(counterBuffer);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0xf;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (binary % 1000000).toString().padStart(6, "0");
}

async function createTestOperator(email: string, passwordPlain: string, mfaEnabled = true): Promise<any> {
  void mfaEnabled;
  const passHash = hashPassword(passwordPlain);
  const now = new Date().toISOString();
  
  // Encrypted secret mock format format
  // ops-route decrypts using MASTER_MFA_KEY, so we can just let it generate or store one.
  // Actually, we can decrypt/encrypt or just let the first-login flow generate it.
  // Let's create the user with roleOperatorGrantedAt
  const user = await prisma.identityUser.create({
    data: {
      id: uniqueId("usr"),
      email: email.toLowerCase(),
      name: "Test Operator",
      passwordHash: passHash,
      roleOperatorGrantedAt: now,
      roleOperatorGrantedByUserId: "system",
      createdAt: now,
      updatedAt: now,
    },
  });

  return user;
}

test("admin console redirects unauthenticated users to sign-in with next path", async () => {
  const response = await adminConsoleRoute({
    method: "GET",
    path: "/ops",
    headers: {},
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, "/ops/sign-in?next=%2Fops");
});

test("admin console route rejects malformed direct request input", async () => {
  const nullRequest = await adminConsoleRoute(null);
  assert.equal(nullRequest.status, 400);

  const badPath = await adminConsoleRoute({
    method: "GET",
    path: 42 as any,
    headers: {},
  });
  assert.equal(badPath.status, 400);
});

test("admin console sign in enforces MFA setup and then allows log in", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "SuperSecretPassword123!!";
  await createTestOperator(email, password, false);

  // 1. Initial sign-in attempt (without TOTP) should prompt for MFA enrollment
  const firstTry = await adminConsoleRoute({
    method: "POST",
    path: "/ops/sign-in",
    headers: {},
    body: JSON.stringify({ email, password }),
  });
  assert.equal(firstTry.status, 200);
  const mfaResult = JSON.parse(firstTry.body || "{}");
  assert.equal(mfaResult.mfaRequired, true);
  assert.equal(typeof mfaResult.secret, "string");
  assert.equal(Array.isArray(mfaResult.recoveryCodes), true);

  // Calculate the correct TOTP code
  const totpCode = generateTotp(mfaResult.secret);

  // 2. Submit the TOTP code to complete sign-in
  const secondTry = await adminConsoleRoute({
    method: "POST",
    path: "/ops/sign-in",
    headers: {},
    body: JSON.stringify({ email, password, totp: totpCode }),
  });
  assert.equal(secondTry.status, 200);
  const loginResult = JSON.parse(secondTry.body || "{}");
  assert.equal(loginResult.success, true);
  assert.equal(secondTry.headers["set-cookie"].includes("ops_session="), true);
});

test("admin console enforces lockout on repeated login failures", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "CorrectPassword123";
  await createTestOperator(email, password, false);

  // 3 failed logins should trigger a lockout
  for (let i = 0; i < 3; i++) {
    const res = await adminConsoleRoute({
      method: "POST",
      path: "/ops/sign-in",
      headers: {},
      body: JSON.stringify({ email, password: "WrongPassword" }),
    });
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(res.body || "{}").error, "ADMIN_NOT_OPERATOR:Invalid email or password");
  }

  // The 4th attempt should result in a LOCKED_OUT status code / message
  const lockedOutRes = await adminConsoleRoute({
    method: "POST",
    path: "/ops/sign-in",
    headers: {},
    body: JSON.stringify({ email, password: "CorrectPassword123" }),
  });
  assert.equal(lockedOutRes.status, 400);
  assert.equal(JSON.parse(lockedOutRes.body || "{}").error.includes("lockout active"), true);
});

test("admin console GET routes load successfully for authenticated operators", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "SecurePassword123!!";
  const user = await createTestOperator(email, password);

  // Set up an active operator session in the database
  const sessionToken = uniqueId("sess");
  const now = new Date().toISOString();
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: user.id,
      workspaceId: "",
      membershipUserId: user.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  const headers = { cookie: `ops_session=${sessionToken}` };

  // Overview Page
  const overview = await adminConsoleRoute({ method: "GET", path: "/ops", headers });
  assert.equal(overview.status, 200);
  assert.equal(overview.body?.includes("System Overview"), true);
  assert.equal(overview.body?.includes("Operator"), true);

  // Artifacts Page
  const artifacts = await adminConsoleRoute({ method: "GET", path: "/ops/artifacts", headers });
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body?.includes("PMTiles Artifacts Catalog"), true);

  // Ingest Page
  const ingest = await adminConsoleRoute({ method: "GET", path: "/ops/ingest", headers });
  assert.equal(ingest.status, 200);
  assert.equal(ingest.body?.includes("Osm Ingest runs"), true);

  // Styles Page
  const styles = await adminConsoleRoute({ method: "GET", path: "/ops/styles", headers });
  assert.equal(styles.status, 200);
  assert.equal(styles.body?.includes("Published style sheets"), true);

  // Projects Page
  const projects = await adminConsoleRoute({ method: "GET", path: "/ops/projects", headers });
  assert.equal(projects.status, 200);
  assert.equal(projects.body?.includes("Customer projects registry"), true);

  // Audit log Page
  const audit = await adminConsoleRoute({ method: "GET", path: "/ops/audit", headers });
  assert.equal(audit.status, 200);
  assert.equal(audit.body?.includes("Admin audit log"), true);

  // Jobs Page
  const jobs = await adminConsoleRoute({ method: "GET", path: "/ops/jobs", headers });
  assert.equal(jobs.status, 200);
  assert.equal(jobs.body?.includes("Osm Ingest job pipeline log"), true);

  // Abuse page
  const abuse = await adminConsoleRoute({ method: "GET", path: "/ops/abuse", headers });
  assert.equal(abuse.status, 200);
  assert.equal(abuse.body?.includes("Abuse"), true);
  assert.equal(abuse.body?.includes("Compliance"), true);

  // Operators page
  const operators = await adminConsoleRoute({ method: "GET", path: "/ops/operators", headers });
  assert.equal(operators.status, 200);
  assert.equal(operators.body?.includes("System Operators"), true);
});

test("admin console detail page protects owner PII contact with operator audit logging", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "SecurePassword123!!";
  const operatorUser = await createTestOperator(email, password);

  // Create a customer user & workspace & project to details audit
  const custUserId = uniqueId("cust");
  const wsId = uniqueId("ws");
  const projId = uniqueId("proj");
  const now = new Date().toISOString();
  const custEmail = `${uniqueId("cust")}@example.com`;

  await prisma.identityUser.create({
    data: {
      id: custUserId,
      email: custEmail,
      name: "John Customer Owner",
      createdAt: now,
    },
  });

  await prisma.identityWorkspace.create({
    data: {
      id: wsId,
      name: "Customer Workspace",
      createdAt: now,
    },
  });

  await prisma.identityMembership.create({
    data: {
      workspaceId: wsId,
      userId: custUserId,
      role: "owner",
      createdAt: now,
    },
  });

  await prisma.project.create({
    data: {
      id: projId,
      workspaceId: wsId,
      name: "Super customer project",
      policy: "{}",
      planId: "free",
      createdAt: now,
    },
  });

  // Active Operator session
  const sessionToken = uniqueId("sess");
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: operatorUser.id,
      workspaceId: "",
      membershipUserId: operatorUser.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  const headers = { cookie: `ops_session=${sessionToken}` };

  // 1. Load project details WITHOUT showing PII contact
  const regularDetails = await adminConsoleRoute({
    method: "GET",
    path: `/ops/projects/${projId}`,
    headers,
  });
  assert.equal(regularDetails.status, 200);
  assert.equal(regularDetails.body?.includes("John Customer Owner"), false);
  assert.equal(regularDetails.body?.includes("Show owner contact"), true);

  // 2. Load project details WITH showing PII contact
  const piiDetails = await adminConsoleRoute({
    method: "GET",
    path: `/ops/projects/${projId}?showOwnerPii=true`,
    headers,
  });
  assert.equal(piiDetails.status, 200);
  assert.equal(piiDetails.body?.includes("John Customer Owner"), true);
  assert.equal(piiDetails.body?.includes(custEmail), true);

  // Verify that an audit event was recorded for operator PII access
  const auditLogs = await prisma.adminAuditEvent.findFirst({
    where: {
      operation: "OPERATOR_VIEWED_PII",
      actor: email.toLowerCase(),
    },
  });
  assert.ok(auditLogs);
  assert.equal(auditLogs.message?.includes(projId), true);
});

test("admin console mutating POST routes require CSRF and confirmation reason", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "SecurePassword123!!";
  const operatorUser = await createTestOperator(email, password);

  // Active session
  const sessionToken = uniqueId("sess");
  const now = new Date().toISOString();
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: operatorUser.id,
      workspaceId: "",
      membershipUserId: operatorUser.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  // CSRF Setup
  const csrfSid = generateCsrfSid();
  const csrfToken = generateCsrfToken(csrfSid);
  const cookieHeader = `ops_session=${sessionToken}; csrf_sid=${csrfSid}`;

  // 1. Post request without CSRF should fail
  const noCsrf = await adminConsoleRoute({
    method: "POST",
    path: "/ops/abuse/suspend",
    headers: { cookie: cookieHeader },
    body: JSON.stringify({ workspaceId: "ws123", suspendReason: "Spam behavior" }),
  });
  assert.equal(noCsrf.status, 400);
  assert.equal(JSON.parse(noCsrf.body || "{}").error, "CSRF verification failed");

  // 2. Post request with CSRF but without confirmation reason should fail
  const noReason = await adminConsoleRoute({
    method: "POST",
    path: "/ops/abuse/suspend",
    headers: { cookie: cookieHeader, "x-csrf-token": csrfToken },
    body: JSON.stringify({ workspaceId: "ws123", suspendReason: "Spam behavior" }),
  });
  assert.equal(noReason.status, 400);
  assert.equal(JSON.parse(noReason.body || "{}").error.includes("reason must be at least 8 characters"), true);

  // 3. Post request with CSRF and confirmation reason less than 8 characters should fail
  const shortReason = await adminConsoleRoute({
    method: "POST",
    path: "/ops/abuse/suspend",
    headers: { cookie: cookieHeader, "x-csrf-token": csrfToken },
    body: JSON.stringify({ workspaceId: "ws123", suspendReason: "Spam behavior", reason: "short" }),
  });
  assert.equal(shortReason.status, 400);
  assert.equal(JSON.parse(shortReason.body || "{}").error.includes("reason must be at least 8 characters"), true);
});

test("admin console mutating POST routes execute successfully when valid CSRF & confirmation reason are provided", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const password = "SecurePassword123!!";
  const operatorUser = await createTestOperator(email, password);

  // Create a customer workspace to suspend
  const wsId = uniqueId("ws");
  const now = new Date().toISOString();
  await prisma.identityWorkspace.create({
    data: {
      id: wsId,
      name: "Abusive Workspace",
      createdAt: now,
    },
  });

  // Active session
  const sessionToken = uniqueId("sess");
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: operatorUser.id,
      workspaceId: "",
      membershipUserId: operatorUser.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  const csrfSid = generateCsrfSid();
  const csrfToken = generateCsrfToken(csrfSid);
  const headers = {
    cookie: `ops_session=${sessionToken}; csrf_sid=${csrfSid}`,
    "x-csrf-token": csrfToken,
  };

  // Suspend Workspace
  const suspendRes = await adminConsoleRoute({
    method: "POST",
    path: "/ops/abuse/suspend",
    headers,
    body: JSON.stringify({
      workspaceId: wsId,
      suspendReason: "Excessive usage and policy violations",
      reason: "Confirmed visual trace of crawler scraping tilesets without authorization",
    }),
  });

  assert.equal(suspendRes.status, 200);
  const suspendStatus = JSON.parse(suspendRes.body || "{}");
  assert.equal(suspendStatus.success, true);

  // Check if database updated workspace suspension
  const updatedWs = await prisma.identityWorkspace.findUnique({ where: { id: wsId } });
  assert.ok(updatedWs?.suspendedAt);
  assert.equal(updatedWs?.suspendedReason, "Excessive usage and policy violations");

  // Unsuspend Workspace
  const unsuspendRes = await adminConsoleRoute({
    method: "POST",
    path: "/ops/abuse/unsuspend",
    headers,
    body: JSON.stringify({
      workspaceId: wsId,
      reason: "Appeal accepted: client implemented standard cache headers",
    }),
  });

  assert.equal(unsuspendRes.status, 200);
  const unsuspendStatus = JSON.parse(unsuspendRes.body || "{}");
  assert.equal(unsuspendStatus.success, true);

  // Check if database updated workspace suspension to cleared
  const clearedWs = await prisma.identityWorkspace.findUnique({ where: { id: wsId } });
  assert.equal(clearedWs?.suspendedAt, null);
  assert.equal(clearedWs?.suspendedReason, null);
});

test("admin console operator role management prevents self-revocation", async () => {
  const email1 = `${uniqueId("op")}@example.com`;
  const email2 = `${uniqueId("op")}@example.com`;
  const op1 = await createTestOperator(email1, "Password123!");
  const op2 = await createTestOperator(email2, "Password123!");

  // Active session for op1
  const sessionToken = uniqueId("sess");
  const now = new Date().toISOString();
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: op1.id,
      workspaceId: "",
      membershipUserId: op1.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  const csrfSid = generateCsrfSid();
  const csrfToken = generateCsrfToken(csrfSid);
  const headers = {
    cookie: `ops_session=${sessionToken}; csrf_sid=${csrfSid}`,
    "x-csrf-token": csrfToken,
  };

  // Attempting to revoke self role should fail
  const revokeSelf = await adminConsoleRoute({
    method: "POST",
    path: "/ops/operators/revoke",
    headers,
    body: JSON.stringify({
      userId: op1.id,
      reason: "Demoting myself as requested by operators lead",
    }),
  });
  assert.equal(revokeSelf.status, 400);
  assert.equal(JSON.parse(revokeSelf.body || "{}").error, "Operators cannot revoke their own role");

  // Revoking op2's role by op1 should succeed
  const revokeOther = await adminConsoleRoute({
    method: "POST",
    path: "/ops/operators/revoke",
    headers,
    body: JSON.stringify({
      userId: op2.id,
      reason: "Revoking access due to operators team role shift",
    }),
  });
  assert.equal(revokeOther.status, 200);

  // Database should reflect revoke
  const revokedUser = await prisma.identityUser.findUnique({ where: { id: op2.id } });
  assert.equal(revokedUser?.roleOperatorGrantedAt, null);
  assert.ok(revokedUser?.roleOperatorRevokedAt);
});

test("admin console GET routes reject invalid paths and traversal attempts", async () => {
  const email = `${uniqueId("op")}@example.com`;
  const operatorUser = await createTestOperator(email, "Password123!");

  // Active session
  const sessionToken = uniqueId("sess");
  const now = new Date().toISOString();
  await prisma.identitySession.create({
    data: {
      id: uniqueId("session-row"),
      tokenHash: hashToken(sessionToken),
      userId: operatorUser.id,
      workspaceId: "",
      membershipUserId: operatorUser.id,
      membershipWorkspaceId: "",
      membershipRole: "operator",
      sessionKind: "ops",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    },
  });

  const headers = { cookie: `ops_session=${sessionToken}` };

  const traversal = await adminConsoleRoute({
    method: "GET",
    path: "/ops/projects/..%2F..",
    headers,
  });
  assert.equal(traversal.status, 404);

  const blankProject = await adminConsoleRoute({
    method: "GET",
    path: "/ops/projects/%20",
    headers,
  });
  assert.equal(blankProject.status, 404);
});
