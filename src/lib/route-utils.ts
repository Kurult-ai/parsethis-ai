import type { Context } from "hono";

/** Allowed hosts for base URL construction (prevents host header injection) */
const ALLOWED_HOSTS = process.env.ALLOWED_HOSTS
  ? process.env.ALLOWED_HOSTS.split(",").map((s) => s.trim().toLowerCase())
  : null;

const FALLBACK_BASE_URL = process.env.BASE_URL || null;

/**
 * Resolve base URL respecting reverse proxy headers (Railway terminates TLS).
 * Validates host against allowlist to prevent host header injection.
 */
export function getBaseUrl(c: Context): string {
  const url = new URL(c.req.url);
  const host = url.host.toLowerCase();

  // If allowlist is set, validate host
  if (ALLOWED_HOSTS && !ALLOWED_HOSTS.includes(host)) {
    if (FALLBACK_BASE_URL) return FALLBACK_BASE_URL;
    // Reject unknown hosts — use first allowed host as fallback
    const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
    return `${proto}://${ALLOWED_HOSTS[0]}`;
  }

  const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
