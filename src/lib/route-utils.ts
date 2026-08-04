import type { Context } from "hono";

/** Allowed hosts for base URL construction (prevents host header injection) */
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(",").map((s) => s.trim().toLowerCase())
  : null;

const FALLBACK_BASE_URL = process.env.BASE_URL || null;
const APEX_PUBLIC_HOST = "parsethis.ai";
const CANONICAL_PUBLIC_HOST = "www.parsethis.ai";

function canonicalizePublicHost(host: string): string {
  return host === APEX_PUBLIC_HOST ? CANONICAL_PUBLIC_HOST : host;
}

export function canonicalizePublicBaseUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    url.host = canonicalizePublicHost(url.host.toLowerCase());
    return url.toString().replace(/\/$/, "");
  } catch {
    return baseUrl;
  }
}

/**
 * Resolve base URL respecting reverse proxy headers (Railway terminates TLS).
 * Validates host against allowlist to prevent host header injection.
 * Production first-use surfaces canonicalize the apex host to www because the
 * apex hostname can have independent TLS/proxy behavior.
 */
export function getBaseUrl(c: Context): string {
  const url = new URL(c.req.url);
  const host = url.host.toLowerCase();
  const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");

  // If allowlist is set, validate host
  if (ALLOWED_HOSTS && !ALLOWED_HOSTS.includes(host)) {
    if (FALLBACK_BASE_URL) return canonicalizePublicBaseUrl(FALLBACK_BASE_URL);
    // Reject unknown hosts — use first allowed host as fallback
    return `${proto}://${canonicalizePublicHost(ALLOWED_HOSTS[0])}`;
  }

  return `${proto}://${canonicalizePublicHost(host)}`;
}
