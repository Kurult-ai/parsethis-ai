import type { Context } from "hono";

/**
 * Resolve base URL respecting reverse proxy headers (Railway terminates TLS).
 */
export function getBaseUrl(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
  return `${proto}://${url.host}`;
}
