import { loadConfig } from "../../../config/load-config";
import { prisma } from "../../../config/db";
import { getGlobalCss } from "../../design-system/styles";
import {
  getAdminConsolePage,
  opsSignIn,
  opsSignOut,
} from "../admin-console.service";
import {
  renderAdminConsoleHtml,
  renderOpsSignInHtml,
} from "./html";
import {
  requireOperatorSession,
  getSession,
  getUserByEmail,
  getUserById,
  grantOperatorRole,
  revokeOperatorRole,
} from "../../identity/identity.service";
import type { IdentitySession } from "../../identity/types";
import {
  promoteArtifactEndpoint,
  rollbackArtifactEndpoint,
  rotateApiKeyEndpoint,
  triggerIngest,
  listArtifactsEndpoint,
} from "../../control-plane/control-plane.service";
import { sendTransactionalEmail } from "../../email/email.service";
import { generateCsrfSid, verifyCsrfToken } from "../../auth-flows/components/csrf";
import type {
  AdminConsoleRouteRequest,
  AdminConsoleRouteResponse,
  AdminConsolePageSlug,
} from "../types";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRouteHeaders(value: unknown): Readonly<Record<string, string | undefined>> | null {
  if (!isRecord(value)) {
    return null;
  }
  const entries: Array<[string, string | undefined]> = [];
  for (const [key, val] of Object.entries(value)) {
    if (typeof key !== "string") return null;
    if (typeof val !== "string" && val !== undefined) return null;
    entries.push([key, val]);
  }
  return Object.fromEntries(entries);
}

function normalizeRouteRequest(input: unknown): AdminConsoleRouteRequest | null {
  if (!isRecord(input)) return null;
  if (typeof input.method !== "string" || typeof input.path !== "string") return null;
  const headers = normalizeRouteHeaders(input.headers);
  if (headers === null) return null;
  
  let body: Record<string, unknown> | string | undefined;
  if (typeof input.body === "string" || isRecord(input.body)) {
    body = input.body;
  }

  return {
    method: input.method as "GET" | "POST" | "HEAD" | "OPTIONS",
    path: input.path,
    headers,
    body,
  };
}

function byteLengthUtf8(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function bodyForMethod(method: string, body: string): string | undefined {
  if (method === "HEAD") return undefined;
  return body;
}

function htmlResponse(method: string, status: number, body: string, headers: Record<string, string> = {}): AdminConsoleRouteResponse {
  return {
    status,
    body: bodyForMethod(method, body),
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-length": String(byteLengthUtf8(body)),
      "cache-control": "no-store",
      ...headers,
    },
  };
}

function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): AdminConsoleRouteResponse {
  const body = JSON.stringify(data);
  return {
    status,
    body,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(byteLengthUtf8(body)),
      "cache-control": "no-store",
      ...headers,
    },
  };
}

function redirectResponse(location: string, headers: Record<string, string> = {}): AdminConsoleRouteResponse {
  return {
    status: 302,
    headers: {
      location,
      "content-length": "0",
      "cache-control": "no-store",
      ...headers,
    },
  };
}

function readCookie(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const cookieHeader = headers.cookie || headers.Cookie;
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(^|;)\\s*${name}\\s*=\\s*([^;]+)`));
  return match ? decodeURIComponent(match[2]) : undefined;
}

function errorHtml(title: string, message: string, href: string, cta: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} | Operator Console</title>
  <style>
    ${getGlobalCss()}
    main { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--surface); }
    article { max-width: 620px; padding: 32px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--rad-3); }
    h1 { margin: 0 0 12px; font-size: 2rem; }
    p { margin: 0 0 18px; color: var(--muted); line-height: 1.55; }
  </style>
</head>
<body>
  <main>
    <article class="ds-card">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      <a class="ds-button ds-button-primary" href="${escapeHtml(href)}">${escapeHtml(cta)}</a>
    </article>
  </main>
</body>
</html>`;
}

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    if (
      decoded.length === 0
      || decoded.includes("/")
      || decoded.includes("\\")
      || decoded === "."
      || decoded.includes("..")
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

async function recordOperatorAuditEvent(actor: string, operation: string, outcome: "success" | "failure", message: string): Promise<void> {
  const id = `audit-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  await prisma.adminAuditEvent.create({
    data: {
      id,
      actor,
      operation,
      outcome,
      startedAt: now,
      completedAt: now,
      message,
      recordedAt: now,
    },
  });
}

export async function adminConsoleRoute(input: unknown): Promise<AdminConsoleRouteResponse> {
  const request = normalizeRouteRequest(input);
  if (!request) {
    return htmlResponse(
      "GET",
      400,
      errorHtml("Bad request", "The administrative route request is invalid.", "/ops", "Back to console"),
    );
  }

  const method = request.method;
  const path = request.path.split("?")[0] || "/";

  if (method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        allow: "GET,HEAD,POST,OPTIONS",
        "cache-control": "public, max-age=60",
      },
    };
  }

  // 1. Double-Submit CSRF Cookie Verification
  let csrfSid = readCookie(request.headers, "csrf_sid");
  let newCsrfCookieHeader = "";
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  if (!csrfSid) {
    csrfSid = generateCsrfSid();
    newCsrfCookieHeader = `csrf_sid=${csrfSid}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`;
  }

  // 2. Unauthenticated Sign-in Endpoint Handling
  if (path === "/ops/sign-in") {
    if (method === "GET" || method === "HEAD") {
      const existingToken = readCookie(request.headers, "ops_session");
      if (existingToken) {
        const session = await getSession(existingToken);
        if (session && session.user.roleOperatorGrantedAt) {
          return redirectResponse("/ops");
        }
      }
      const responseHeaders: Record<string, string> = newCsrfCookieHeader ? { "set-cookie": newCsrfCookieHeader } : {};
      return htmlResponse(method, 200, renderOpsSignInHtml({ title: "Sign in" }), responseHeaders);
    }

    if (method === "POST") {
      try {
        const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
        const result = await opsSignIn({
          email: body?.email,
          password: body?.password,
          totp: body?.totp,
          clientIp: request.headers["x-forwarded-for"] || "127.0.0.1",
          userAgent: request.headers["user-agent"] || "unknown",
        });

        if (result.mfaRequired) {
          return jsonResponse(200, {
            mfaRequired: true,
            secret: result.secret,
            recoveryCodes: result.recoveryCodes,
          });
        }

        const sessionCookie = `ops_session=${result.session?.token}; Path=/; HttpOnly; SameSite=Lax${secureFlag}`;
        const setCookies = [sessionCookie];
        if (newCsrfCookieHeader) setCookies.push(newCsrfCookieHeader);
        
        return jsonResponse(200, { success: true }, {
          "set-cookie": setCookies.join(", "),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Authentication failed";
        return jsonResponse(400, { error: message });
      }
    }
  }

  // 3. Authenticate and Gated Operator Route
  const token = readCookie(request.headers, "ops_session");
  if (!token) {
    if (method === "GET" || method === "HEAD") {
      return redirectResponse(`/ops/sign-in?next=${encodeURIComponent(request.path)}`);
    }
    return jsonResponse(401, { error: "Authentication required" });
  }

  let session: IdentitySession;
  try {
    session = await requireOperatorSession(request.headers);
  } catch {
    if (method === "GET" || method === "HEAD") {
      return redirectResponse(`/ops/sign-in?next=${encodeURIComponent(request.path)}`);
    }
    return jsonResponse(401, { error: "Session invalid or unprivileged" });
  }

  // 4. Validate CSRF for all mutating operations
  if (method === "POST") {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const submittedCsrf = String(body._csrf || "").trim() || request.headers["x-csrf-token"];
    if (!verifyCsrfToken(submittedCsrf, csrfSid)) {
      return jsonResponse(400, { error: "CSRF verification failed" });
    }
  }

  // 5. Sign Out Endpoint
  if (path === "/ops/sign-out" && method === "POST") {
    await opsSignOut(token);
    return redirectResponse("/ops/sign-in", {
      "set-cookie": `ops_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureFlag}`,
    });
  }

  // 6. Mutating Administrative Enforcements (POST Endpoints)
  if (method === "POST") {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const reason = String(body.reason || "").trim();
    
    // Validate confirmation reason
    if (reason.length < 8) {
      return jsonResponse(400, { error: "Confirmation reason must be at least 8 characters long." });
    }
    const cleanReason = reason.replace(/[\\x00-\\x1F\\x7F]/g, "").slice(0, 280);

    const config = loadConfig();
    const adminToken = config.security.adminToken;

    // A. Promote Artifact
    const promoteMatch = /^\/ops\/artifacts\/([^/]+)\/promote\/?$/.exec(path);
    if (promoteMatch?.[1]) {
      const versionId = decodePathSegment(promoteMatch[1]);
      if (!versionId) return jsonResponse(400, { error: "Invalid versionId path segment" });

      try {
        await promoteArtifactEndpoint(versionId, adminToken);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_PROMOTED_ARTIFACT", "success", `Promoted version ${versionId} to active. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_PROMOTED_ARTIFACT", "failure", `Promote version ${versionId} failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Promote failed" });
      }
    }

    if (path === "/ops/artifacts/promote-latest") {
      try {
        const artifacts = await listArtifactsEndpoint(adminToken);
        if (artifacts.length === 0) {
          throw new Error("No artifacts found to promote");
        }
        const latest = artifacts[0];
        await promoteArtifactEndpoint(latest.id, adminToken);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_PROMOTED_ARTIFACT", "success", `Promoted latest version ${latest.id} to active. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_PROMOTED_ARTIFACT", "failure", `Promote latest failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Promote failed" });
      }
    }

    // B. Rollback Artifact
    if (path === "/ops/artifacts/rollback") {
      try {
        await rollbackArtifactEndpoint(adminToken);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ROLLEDBACK_ARTIFACT", "success", `Rolled back active artifact version. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ROLLEDBACK_ARTIFACT", "failure", `Rollback failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Rollback failed" });
      }
    }

    // C. Trigger OSM Ingest
    if (path === "/ops/ingest/start") {
      try {
        if (typeof body.snapshotId !== "string" || body.snapshotId.trim().length === 0) {
          return jsonResponse(400, { error: "snapshotId is required" });
        }
        if (typeof body.sourceUrl !== "string" || body.sourceUrl.trim().length === 0) {
          return jsonResponse(400, { error: "sourceUrl is required" });
        }
        if (typeof body.expectedChecksum !== "string" || body.expectedChecksum.trim().length === 0) {
          return jsonResponse(400, { error: "expectedChecksum is required" });
        }
        // Ingest trigger endpoint logic
        const job = await triggerIngest(adminToken);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_TRIGGERED_INGEST", "success", `Triggered ingest job ${job.jobId} for snapshot ${body.snapshotId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_TRIGGERED_INGEST", "failure", `Ingest trigger failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Trigger failed" });
      }
    }

    // D. Rotate project API key
    const rotateKeyMatch = /^\/ops\/projects\/([^/]+)\/keys\/rotate\/?$/.exec(path);
    if (rotateKeyMatch?.[1]) {
      const projectId = decodePathSegment(rotateKeyMatch[1]);
      if (!projectId) return jsonResponse(400, { error: "Invalid projectId path segment" });

      try {
        const issuedKey = await rotateApiKeyEndpoint(projectId, adminToken);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ROTATED_PROJECT_KEY", "success", `Rotated key for project ${projectId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { issuedKey });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ROTATED_PROJECT_KEY", "failure", `Key rotation failed for project ${projectId}. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Key rotation failed" });
      }
    }

    // E. Issue abuse warning email
    if (path === "/ops/abuse/warn") {
      try {
        const { workspaceId, subject, message } = body;
        if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
          return jsonResponse(400, { error: "workspaceId is required" });
        }
        if (typeof subject !== "string" || subject.trim().length === 0) {
          return jsonResponse(400, { error: "subject is required" });
        }
        if (typeof message !== "string" || message.trim().length === 0) {
          return jsonResponse(400, { error: "message is required" });
        }

        const membership = await prisma.identityMembership.findFirst({
          where: { workspaceId: workspaceId.trim(), role: { in: ["owner", "customer_owner"] } }
        });
        if (!membership) return jsonResponse(400, { error: "Workspace owner not found" });

        const ownerUser = await getUserById(membership.userId);
        if (!ownerUser) return jsonResponse(400, { error: "Workspace owner details not found" });

        await sendTransactionalEmail({
          to: ownerUser.email,
          templateKey: "abuse_warning",
          params: {
            subject: subject.trim(),
            body: message.trim(),
            appealUrl: "https://tstiles.com/support/abuse-appeal",
          },
          idempotencyKey: `warn-${workspaceId.trim()}-${Date.now()}`,
          workspaceId: workspaceId.trim(),
          userId: ownerUser.id,
        });

        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ISSUED_WARNING", "success", `Issued abuse warning email to workspace ${workspaceId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_ISSUED_WARNING", "failure", `Warning dispatch failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Warning dispatch failed" });
      }
    }

    // F. Suspend Workspace
    if (path === "/ops/abuse/suspend") {
      try {
        const { workspaceId, suspendReason } = body;
        if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
          return jsonResponse(400, { error: "workspaceId is required" });
        }
        if (typeof suspendReason !== "string" || suspendReason.trim().length === 0) {
          return jsonResponse(400, { error: "suspendReason is required" });
        }

        await prisma.identityWorkspace.update({
          where: { id: workspaceId.trim() },
          data: {
            suspendedAt: new Date().toISOString(),
            suspendedReason: suspendReason.trim(),
          },
        });

        await recordOperatorAuditEvent(session.user.email, "OPERATOR_SUSPENDED_WORKSPACE", "success", `Suspended workspace ${workspaceId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_SUSPENDED_WORKSPACE", "failure", `Suspension failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Suspension failed" });
      }
    }

    // G. Unsuspend Workspace
    if (path === "/ops/abuse/unsuspend") {
      try {
        const { workspaceId } = body;
        if (typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
          return jsonResponse(400, { error: "workspaceId is required" });
        }

        await prisma.identityWorkspace.update({
          where: { id: workspaceId.trim() },
          data: {
            suspendedAt: null,
            suspendedReason: null,
          },
        });

        await recordOperatorAuditEvent(session.user.email, "OPERATOR_UNSUSPENDED_WORKSPACE", "success", `Unsuspended workspace ${workspaceId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_UNSUSPENDED_WORKSPACE", "failure", `Unsuspension failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Unsuspension failed" });
      }
    }

    // H. Grant Operator Role
    if (path === "/ops/operators/grant") {
      try {
        const targetEmail = String(body.email || "").trim().toLowerCase();
        if (targetEmail.length === 0) return jsonResponse(400, { error: "email is required" });

        const targetUser = await getUserByEmail(targetEmail);
        if (!targetUser) return jsonResponse(400, { error: "User email not registered" });

        await grantOperatorRole(targetUser.id, session.user.id, cleanReason);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_GRANTED_ROLE", "success", `Granted operator role to user ${targetEmail}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_GRANTED_ROLE", "failure", `Grant failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Grant failed" });
      }
    }

    // I. Revoke Operator Role
    if (path === "/ops/operators/revoke") {
      try {
        const { userId } = body;
        if (typeof userId !== "string" || userId.trim().length === 0) {
          return jsonResponse(400, { error: "userId is required" });
        }

        if (userId.trim() === session.user.id) {
          return jsonResponse(400, { error: "Operators cannot revoke their own role" });
        }

        await revokeOperatorRole(userId.trim(), session.user.id, cleanReason);
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_REVOKED_ROLE", "success", `Revoked operator role from user ${userId}. Reason: ${cleanReason}`);
        return jsonResponse(200, { success: true });
      } catch (err) {
        await recordOperatorAuditEvent(session.user.email, "OPERATOR_REVOKED_ROLE", "failure", `Revocation failed. Reason: ${cleanReason}`);
        return jsonResponse(500, { error: err instanceof Error ? err.message : "Revocation failed" });
      }
    }

    return jsonResponse(404, { error: "Admin endpoint not found" });
  }

  // 7. Render Operator Console HTML (GET Endpoints)
  if (method === "GET" || method === "HEAD") {
    // Resolve slug based on paths
    let resolvedSlug: AdminConsolePageSlug;
    let projectId: string | undefined;

    if (path === "/ops" || path === "/ops/") {
      resolvedSlug = "overview";
    } else if (path === "/ops/artifacts" || path === "/ops/artifacts/") {
      resolvedSlug = "artifacts";
    } else if (path === "/ops/ingest" || path === "/ops/ingest/") {
      resolvedSlug = "ingest";
    } else if (path === "/ops/styles" || path === "/ops/styles/") {
      resolvedSlug = "styles";
    } else if (path === "/ops/projects" || path === "/ops/projects/") {
      resolvedSlug = "projects";
    } else if (path === "/ops/audit" || path === "/ops/audit/") {
      resolvedSlug = "audit";
    } else if (path === "/ops/jobs" || path === "/ops/jobs/") {
      resolvedSlug = "jobs";
    } else if (path === "/ops/abuse" || path === "/ops/abuse/") {
      resolvedSlug = "abuse";
    } else if (path === "/ops/operators" || path === "/ops/operators/") {
      resolvedSlug = "operators";
    } else {
      const projectDetailMatch = /^\/ops\/projects\/([^/]+)\/?$/.exec(path);
      if (projectDetailMatch?.[1]) {
        const decoded = decodePathSegment(projectDetailMatch[1]);
        if (!decoded) {
          return htmlResponse(method, 404, errorHtml("Page not found", "The requested administrative page does not exist.", "/ops", "Back to overview"));
        }
        resolvedSlug = "project-detail";
        projectId = decoded;
      } else {
        return htmlResponse(method, 404, errorHtml("Page not found", "The requested administrative page does not exist.", "/ops", "Back to overview"));
      }
    }

    try {
      const url = new URL(request.path, "http://admin-console.local");
      const showOwnerPii = url.searchParams.get("showOwnerPii") === "true";
      const eventType = url.searchParams.get("eventType") || undefined;
      const actor = url.searchParams.get("actor") || undefined;
      const outcome = url.searchParams.get("outcome") || undefined;
      const status = url.searchParams.get("status") || undefined;

      const page = await getAdminConsolePage(session, {
        slug: resolvedSlug,
        projectId,
        showOwnerPii,
        eventType,
        actor,
        outcome,
        status,
      });

      return htmlResponse(method, 200, renderAdminConsoleHtml(page));
    } catch (error) {
      const message = error instanceof Error ? error.message : "System console experienced a loading failure";
      return htmlResponse(method, 503, errorHtml("System console failure", message, "/ops", "Refresh overview"));
    }
  }

  return htmlResponse(
    method,
    400,
    errorHtml("Bad request", "The administrative action is invalid.", "/ops", "Back to overview"),
  );
}
