import { createHash, randomUUID } from "node:crypto";
import type { SanitizedExposurePayload } from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function digestJson(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value));
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function createExposureReceiptId(): string {
  return `exp_${randomUUID().replace(/-/g, "").slice(0, 26)}`;
}

export function exposureFindingsDigest(payload: SanitizedExposurePayload): string {
  return digestJson(payload.findings);
}

export function exposurePolicyDigest(payload: SanitizedExposurePayload): string {
  return digestJson(payload.policy);
}
