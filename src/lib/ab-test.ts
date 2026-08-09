/**
 * Lightweight server-side A/B testing framework.
 *
 * Deterministic assignment via hash — no cookies, no client-side JS.
 * Each visitor is assigned to a variant based on a hash of their request
 * ID (IP + timestamp + random). The same request ID always maps to the
 * same variant.
 */

import { createHash } from "node:crypto";

// ─── Types ───

export interface ExperimentVariant {
  /** Variant key used in data attributes and analytics (e.g. "a", "b"). */
  key: string;
  /** Relative weight. Default 1 if omitted. */
  weight?: number;
  /** Human-readable label for the admin view. */
  label: string;
}

export interface Experiment {
  /** Unique experiment identifier. */
  name: string;
  /** Human-readable description for the admin dashboard. */
  description: string;
  /** Ordered list of variants. */
  variants: ExperimentVariant[];
}

// ─── Experiment Registry ───

export const EXPERIMENTS: Record<string, Experiment> = {
  "hero-copy": {
    name: "hero-copy",
    description: "Test different hero headline and CTA copy on the landing page.",
    variants: [
      { key: "a", label: "Control — current hero copy" },
      { key: "b", label: "Variant B — shorter, action-oriented headline" },
    ],
  },
};

// ─── Assignment Engine ───

/**
 * Compute a deterministic hash for (experiment + requestId).
 * Returns a float in [0, 1) suitable for weighted bucketing.
 */
function hashFraction(experiment: string, requestId: string): number {
  const hash = createHash("sha256").update(`${experiment}:${requestId}`).digest();
  // Use the first 6 bytes as a 48-bit integer → divide by 2^48 for [0, 1)
  return hash.readUIntBE(0, 6) / 0x1000000000000;
}

/**
 * Deterministically assign a visitor to a variant for the given experiment.
 *
 * Uses a hash of `experiment + requestId` so the same visitor (same requestId)
 * always sees the same variant, with no cookies or client-side JS.
 *
 * @param experiment Experiment name (must exist in EXPERIMENTS registry)
 * @param requestId  Stable per-request identifier (IP + User-Agent + ts, or a UUID)
 * @returns Variant key string, or "a" as fallback for unknown experiments
 */
export function getVariant(experiment: string, requestId: string): string {
  const config = EXPERIMENTS[experiment];
  if (!config || config.variants.length === 0) return "a";

  const variants = config.variants;
  const totalWeight = variants.reduce((sum, v) => sum + (v.weight ?? 1), 0);

  const point = hashFraction(experiment, requestId) * totalWeight;

  let cumulative = 0;
  for (const variant of variants) {
    cumulative += variant.weight ?? 1;
    if (point < cumulative) {
      return variant.key;
    }
  }

  // Floating-point edge case — return last variant
  return variants[variants.length - 1].key;
}

/**
 * Check if a variant override value is valid for the given experiment.
 */
export function isValidVariant(experiment: string, variantKey: string): boolean {
  const config = EXPERIMENTS[experiment];
  if (!config) return false;
  return config.variants.some((v) => v.key === variantKey);
}

/**
 * Check if the current request has an admin session (via parse_admin_key cookie).
 * Used to gate the ?variant= query param override.
 */
export function isAdminRequest(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) return false;
  return cookieHeader
    .split(";")
    .map((c) => c.trim())
    .some((c) => c.startsWith("parse_admin_key=") && c.length > "parse_admin_key=".length);
}

/**
 * Build a request ID for A/B testing from request context.
 * Uses IP + User-Agent as a stable per-visitor identifier (no cookies needed).
 */
export function getRequestId(ip: string, userAgent: string): string {
  return `${ip}:${userAgent}`;
}
