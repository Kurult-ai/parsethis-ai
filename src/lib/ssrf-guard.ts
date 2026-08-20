/**
 * SSRF protection — validates URLs before server-side fetching.
 * Blocks requests to internal/private IP ranges, cloud metadata endpoints,
 * and redirect chains that resolve to private addresses.
 *
 * Security properties:
 * - Fail-closed: DNS resolution failure returns { safe: false }
 * - Redirect-safe: callers must use redirect: "manual" and re-validate each hop
 * - IPv4 + IPv6: blocks both private address families
 * - IP literal detection: blocks direct IP URLs (e.g., http://127.0.0.1, http://[::1])
 */

import { resolve4, resolve6 } from "node:dns/promises";

const BLOCKED_IPV4 = [
  /^127\./,              // Loopback
  /^10\./,               // Class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // Class B private
  /^192\.168\./,         // Class C private
  /^169\.254\./,         // Link-local / cloud metadata
  /^0\./,                // "This" network
];

const BLOCKED_IPV6 = [
  /^::1$/,               // Loopback
  /^fe80:/i,             // Link-local
  /^fc00:/i,             // Unique local
  /^fd[0-9a-f]{2}:/i,   // Unique local
];

const BLOCKED_RANGES = [...BLOCKED_IPV4, ...BLOCKED_IPV6];

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  // GCP
  "metadata.google.internal",
  "metadata.goog",
  // AWS
  "instance-data",
  // Azure
  "metadata.azure.internal",
  // Kubernetes
  "kubernetes.default.svc",
  "kubernetes.default",
]);

/**
 * Canonicalize non-standard IP literals to dotted-quad for blocked-IP checking.
 * Catches decimal (http://2130706433) and octal (http://0177.0.0.1) encodings.
 */
function canonicalizeIp(hostname: string): string | null {
  // Decimal integer IP (e.g., 2130706433 = 127.0.0.1)
  if (/^\d{1,10}$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [(num >>> 24) & 0xFF, (num >>> 16) & 0xFF, (num >>> 8) & 0xFF, num & 0xFF].join(".");
    }
  }
  // Octal-encoded IP (e.g., 0177.0.0.1)
  if (/^0[0-7]*\.\d/.test(hostname)) {
    const parts = hostname.split(".");
    if (parts.length === 4) {
      const decimals = parts.map(p => p.startsWith("0") && p.length > 1 ? parseInt(p, 8) : parseInt(p, 10));
      if (decimals.every(d => d >= 0 && d <= 255)) {
        return decimals.join(".");
      }
    }
  }
  return null;
}

function isBlockedIp(ip: string): boolean {
  return BLOCKED_RANGES.some((r) => r.test(ip));
}

export async function validateUrl(
  url: string
): Promise<{ safe: boolean; reason?: string; resolvedIp?: string }> {
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

  // Canonicalize decimal/octal IP encodings before standard checks
  const canonicalized = canonicalizeIp(parsed.hostname);
  if (canonicalized) {
    if (isBlockedIp(canonicalized)) {
      return { safe: false, reason: `Encoded IP ${parsed.hostname} resolves to private/internal ${canonicalized}` };
    }
    return { safe: true, resolvedIp: canonicalized };
  }

  // Block IP literals directly (both [::1] bracket-style and 127.0.0.1 dot-style)
  const isBracketIp = /^\[/.test(parsed.hostname);
  const isDotIp = /^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname);
  if (isBracketIp || isDotIp) {
    const ip = parsed.hostname.replace(/[\[\]]/g, "");
    if (isBlockedIp(ip)) {
      return { safe: false, reason: `Direct IP ${ip} is private/internal` };
    }
    // Allow non-blocked IP literals (public IPs)
    return { safe: true, resolvedIp: ip };
  }

  try {
    const ipv4 = await resolve4(parsed.hostname).catch(() => [] as string[]);
    const ipv6 = await resolve6(parsed.hostname).catch(() => [] as string[]);
    const ips = [...ipv4, ...ipv6];

    if (ips.length === 0) {
      return { safe: false, reason: "DNS resolution failed (no A/AAAA records)" };
    }

    for (const ip of ips) {
      if (isBlockedIp(ip)) {
        return { safe: false, reason: `Resolved to private/internal IP: ${ip}` };
      }
    }

    return { safe: true, resolvedIp: ips[0] };
  } catch {
    // Fail-closed: DNS error = block
    return { safe: false, reason: "DNS resolution failed" };
  }
}
