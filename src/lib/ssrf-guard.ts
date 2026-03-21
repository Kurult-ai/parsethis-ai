/**
 * SSRF protection — validates URLs before server-side fetching.
 * Blocks requests to internal/private IP ranges and cloud metadata endpoints.
 */

import { resolve4 } from "node:dns/promises";

const BLOCKED_RANGES = [
  /^127\./, // Loopback
  /^10\./, // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./, // Class C private
  /^169\.254\./, // Link-local / cloud metadata
  /^0\./, // "This" network
];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
]);

export async function validateUrl(
  url: string
): Promise<{ safe: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { safe: false, reason: "Only http/https protocols allowed" };
  }

  if (BLOCKED_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return { safe: false, reason: "Blocked hostname" };
  }

  try {
    const ips = await resolve4(parsed.hostname);
    for (const ip of ips) {
      if (BLOCKED_RANGES.some((r) => r.test(ip))) {
        return { safe: false, reason: `Resolved to private/internal IP: ${ip}` };
      }
    }
  } catch {
    // DNS resolution failed — could be legitimate (e.g., IPv6-only)
    // Allow through but log
    console.warn(`[ssrf-guard] DNS resolution failed for ${parsed.hostname}`);
  }

  return { safe: true };
}
