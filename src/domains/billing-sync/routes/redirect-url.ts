import { BillingSyncError, BillingSyncErrorCode } from "../types";

type HeaderMap = Readonly<Record<string, string | undefined>>;

function buildError(details: string): BillingSyncError {
  return new BillingSyncError(BillingSyncErrorCode.BAD_REQUEST, details);
}

function readHeader(headers: HeaderMap, name: string): string | undefined {
  const direct = headers[name];
  if (typeof direct === "string") {
    return direct;
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

function normalizeDelimitedHeaderValue(value: string | undefined): string | undefined {
  const normalized = value?.split(",")[0]?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function isAllowedHostedNavigationPath(pathname: string): boolean {
  return pathname === "/app"
    || pathname.startsWith("/app/")
    || pathname === "/pricing"
    || pathname.startsWith("/pricing/");
}

export function resolveRequestOrigin(headers: HeaderMap): string {
  const originHeader = normalizeDelimitedHeaderValue(readHeader(headers, "origin"));
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      return originUrl.origin;
    } catch {
      throw buildError("origin header must be an absolute http(s) URL");
    }
  }
  const host = normalizeDelimitedHeaderValue(readHeader(headers, "x-forwarded-host"))
    ?? normalizeDelimitedHeaderValue(readHeader(headers, "host"));
  if (!host) {
    throw buildError("origin or host header is required");
  }
  const protocol = normalizeDelimitedHeaderValue(readHeader(headers, "x-forwarded-proto"))?.toLowerCase() ?? "https";
  if (protocol !== "http" && protocol !== "https") {
    throw buildError("x-forwarded-proto must be http or https");
  }
  try {
    const parsed = new URL(`${protocol}://${host}`);
    if (
      parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.pathname !== "/"
      || parsed.search.length > 0
      || parsed.hash.length > 0
    ) {
      throw new Error("invalid forwarded host");
    }
    return parsed.origin;
  } catch {
    throw buildError("host header must resolve to a clean http(s) origin");
  }
}

export function normalizeHostedRedirectUrl(value: string, field: string, requestOrigin: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw buildError(`${field} is required`);
  }
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw buildError(`${field} must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw buildError(`${field} must be an absolute http(s) URL`);
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw buildError(`${field} must not include credentials`);
  }
  if (parsed.origin !== requestOrigin) {
    throw buildError(`${field} must stay on the current app origin`);
  }
  if (!isAllowedHostedNavigationPath(parsed.pathname)) {
    throw buildError(`${field} must target /app or /pricing`);
  }
  return parsed.toString();
}
