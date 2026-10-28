import { strict as assert } from "node:assert";
import { randomBytes, scryptSync } from "node:crypto";
import { parseOptions, verifySync as verifyArgon2 } from "@node-rs/argon2";
import { prisma } from "../../../config/db";
import {
  createSession,
  createUser,
  getSession,
  revokeSession,
  verifyPasswordHash,
} from "../identity.service";
import { hashToken } from "../components/credential-token-hash";
import { hashPassword, isArgon2idHash } from "../components/password-hash";
import { decryptMfaSecret, encryptMfaSecret } from "../components/mfa-secret-encryption";

type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
const test: TestFunction = ((globalThis as { test?: TestFunction }).test ?? ((_, fn) => {
  void fn();
}));

test("password hashes are interoperable Argon2id PHC strings", async () => {
  const password = "standard-verifiable-password-7!";
  const passwordHash = hashPassword(password);

  assert.equal(isArgon2idHash(passwordHash), true);
  assert.equal(verifyArgon2(passwordHash, password), true);
  assert.match(passwordHash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

  const parsed = parseOptions(passwordHash);
  assert.equal(parsed.memoryCost, 19_456);
  assert.equal(parsed.timeCost, 2);
  assert.equal(parsed.parallelism, 1);
  assert.equal(parsed.saltLen, 16);
  assert.equal(parsed.outputLen, 32);
});

test("a valid legacy scrypt credential is replaced by real Argon2id after verification", async () => {
  const password = "legacy-password-7!";
  const salt = randomBytes(16).toString("base64");
  const digest = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 }).toString("base64");
  const legacyHash = `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${digest}`;
  const userId = `legacy-user-${randomBytes(8).toString("hex")}`;
  const now = new Date().toISOString();

  await prisma.identityUser.create({
    data: {
      id: userId,
      email: `${userId}@example.com`,
      name: "Legacy user",
      passwordHash: legacyHash,
      createdAt: now,
      updatedAt: now,
    },
  });

  assert.equal(isArgon2idHash(legacyHash), false);
  assert.equal(await verifyPasswordHash(userId, password), true);

  const migrated = await prisma.identityUser.findUniqueOrThrow({ where: { id: userId } });
  assert.notEqual(migrated.passwordHash, legacyHash);
  assert.equal(isArgon2idHash(migrated.passwordHash ?? ""), true);
  assert.equal(verifyArgon2(migrated.passwordHash ?? "", password), true);
});

test("session bearer tokens are returned at issuance but only their digest is persisted", async () => {
  const suffix = randomBytes(8).toString("hex");
  const user = await createUser({
    email: `session-${suffix}@example.com`,
    displayName: "Session user",
    passwordHash: hashPassword("session-password-7!"),
  });

  const issued = await createSession(user.id);
  assert.ok(issued.token.length >= 32);

  const stored = await prisma.identitySession.findUniqueOrThrow({ where: { id: issued.id } });
  assert.equal(stored.tokenHash, hashToken(issued.token));
  assert.equal(Object.prototype.hasOwnProperty.call(stored, "token"), false);
  assert.equal(JSON.stringify(stored).includes(issued.token), false);

  const resolved = await getSession(issued.token);
  assert.equal(resolved?.id, issued.id);
  assert.equal(Object.prototype.hasOwnProperty.call(resolved, "token"), false);
  assert.equal(await revokeSession(issued.token), true);
  assert.equal(await getSession(issued.token), null);
});

test("identity rejects plaintext and legacy-labelled password writes", async () => {
  const suffix = randomBytes(8).toString("hex");
  await assert.rejects(
    createUser({
      email: `plaintext-${suffix}@example.com`,
      passwordHash: "not-a-password-hash",
    }),
    /IDENTITY_BAD_REQUEST/,
  );
});

test("MFA secrets use the configured key and never fall back outside development", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousKey = process.env.MFA_ENCRYPTION_KEY;
  try {
    process.env.NODE_ENV = "production";
    process.env.MFA_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    const encrypted = encryptMfaSecret("JBSWY3DPEHPK3PXP");
    assert.notEqual(encrypted.includes("JBSWY3DPEHPK3PXP"), true);
    assert.equal(decryptMfaSecret(encrypted), "JBSWY3DPEHPK3PXP");

    delete process.env.MFA_ENCRYPTION_KEY;
    assert.throws(() => encryptMfaSecret("JBSWY3DPEHPK3PXP"), /MFA_ENCRYPTION_KEY/);
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
    if (previousKey === undefined) {
      delete process.env.MFA_ENCRYPTION_KEY;
    } else {
      process.env.MFA_ENCRYPTION_KEY = previousKey;
    }
  }
});
