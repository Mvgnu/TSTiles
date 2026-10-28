import { prisma } from "../../../config/db";
import { isLockedOut, incrementLockoutCounter, clearLockoutCounter } from "../../identity/identity.service";
import { AuthFlowError, AuthFlowErrorCode } from "../types";

/**
 * Checks if a sign-in attempt is currently locked out due to brute force protection.
 */
export async function checkSignInLockout(email: string, ip: string): Promise<void> {
  const emailLocked = await isLockedOut(email, "email");
  if (emailLocked) {
    throw new AuthFlowError(
      AuthFlowErrorCode.LOCKED_OUT,
      "Too many failed login attempts. Please try again in 15 minutes.",
      "locked_out_email",
    );
  }

  const ipLocked = await isLockedOut(ip, "ip");
  if (ipLocked) {
    throw new AuthFlowError(
      AuthFlowErrorCode.LOCKED_OUT,
      "Too many failed login attempts from this IP. Please try again in 15 minutes.",
      "locked_out_ip",
    );
  }
}

/**
 * Increments the sign-in failure count.
 */
export async function incrementSignInFailures(email: string, ip: string): Promise<void> {
  await incrementLockoutCounter(email, "email");
  await incrementLockoutCounter(ip, "ip");
}

/**
 * Clears lockout counters after a successful login.
 */
export async function clearSignInLockout(email: string, ip: string): Promise<void> {
  await clearLockoutCounter(email, "email");
  await clearLockoutCounter(ip, "ip");
}

/**
 * Increments and checks custom rate limits using the IdentityAuthLockout table.
 * Key prefix is used to differentiate between different actions (e.g. signup, reset, etc.)
 */
async function checkCustomRateLimit(
  key: string,
  kind: "email" | "ip",
  prefix: string,
  maxRequests: number,
  windowMs: number,
): Promise<void> {
  const normalizedKey = `${prefix}:${kind}:${key.trim().toLowerCase()}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs).toISOString();

  const lockout = await prisma.identityAuthLockout.findUnique({
    where: { key_keyKind: { key: normalizedKey, keyKind: kind } },
  });

  if (lockout) {
    if (lockout.windowStart < windowStart) {
      // Bounded window has passed, reset counter
      await prisma.identityAuthLockout.update({
        where: { id: lockout.id },
        data: {
          failureCount: 1,
          windowStart: now.toISOString(),
          lockedUntil: null,
        },
      });
    } else {
      const count = lockout.failureCount + 1;
      if (count > maxRequests) {
        const lockedUntil = new Date(now.getTime() + windowMs).toISOString();
        await prisma.identityAuthLockout.update({
          where: { id: lockout.id },
          data: {
            failureCount: count,
            lockedUntil,
          },
        });
        throw new AuthFlowError(
          AuthFlowErrorCode.LOCKED_OUT,
          "Rate limit exceeded. Please try again later.",
          `rate_limit_${prefix}_${kind}`,
        );
      } else {
        await prisma.identityAuthLockout.update({
          where: { id: lockout.id },
          data: {
            failureCount: count,
          },
        });
      }
    }
  } else {
    const id = `ratelimit-${Math.random().toString(36).substring(2, 15)}`;
    await prisma.identityAuthLockout.create({
      data: {
        id,
        key: normalizedKey,
        keyKind: kind,
        failureCount: 1,
        windowStart: now.toISOString(),
        lockedUntil: null,
      },
    });
  }
}

/**
 * Enforces Sign Up rate limits: 10/hour/IP and 3/hour/email.
 */
export async function checkSignUpRateLimit(email: string, ip: string): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  // Check email signup rate: max 3 per hour
  await checkCustomRateLimit(email, "email", "signup", 3, ONE_HOUR);
  // Check IP signup rate: max 10 per hour
  await checkCustomRateLimit(ip, "ip", "signup", 10, ONE_HOUR);
}

/**
 * Enforces Password Reset / Magic Link request rate limits: 5/hour/email and 20/hour/IP.
 */
export async function checkRequestTokenRateLimit(email: string, ip: string): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  // Check email reset rate: max 5 per hour
  await checkCustomRateLimit(email, "email", "reset", 5, ONE_HOUR);
  // Check IP reset rate: max 20 per hour
  await checkCustomRateLimit(ip, "ip", "reset", 20, ONE_HOUR);
}

/**
 * Enforces Email Verification resend rate limits: 3/hour/email, max one every 60 seconds.
 */
export async function checkVerificationResendRateLimit(email: string): Promise<void> {
  const ONE_HOUR = 60 * 60 * 1000;
  const key = email.trim().toLowerCase();

  // First check 60s cooldown
  const lastResendKey = `resend:last:${key}`;
  const now = new Date();

  const lastResend = await prisma.identityAuthLockout.findUnique({
    where: { key_keyKind: { key: lastResendKey, keyKind: "email" } },
  });

  if (lastResend) {
    const timeSinceLast = now.getTime() - new Date(lastResend.windowStart).getTime();
    if (timeSinceLast < 60 * 1000) {
      throw new AuthFlowError(
        AuthFlowErrorCode.LOCKED_OUT,
        "Please wait 60 seconds before requesting another verification email.",
        "resend_cooldown",
      );
    }
    // Update the last resend timestamp
    await prisma.identityAuthLockout.update({
      where: { id: lastResend.id },
      data: { windowStart: now.toISOString() },
    });
  } else {
    await prisma.identityAuthLockout.create({
      data: {
        id: `resend-last-${Math.random().toString(36).substring(2, 15)}`,
        key: lastResendKey,
        keyKind: "email",
        failureCount: 1,
        windowStart: now.toISOString(),
        lockedUntil: null,
      },
    });
  }

  // Now check hourly resend count limit: max 3 per hour
  await checkCustomRateLimit(email, "email", "resend", 3, ONE_HOUR);
}
