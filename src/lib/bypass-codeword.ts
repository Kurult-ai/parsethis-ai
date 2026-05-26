import { createHash, timingSafeEqual } from "node:crypto";

export interface BypassPolicyLike {
  bypassEnabled?: boolean;
  bypassCodewordHash?: string | null;
  bypassExpiresAt?: Date | string | null;
}

export function normalizeCodeword(codeword: string): string {
  return codeword.trim().replace(/\s+/g, " ");
}

export function hashBypassCodeword(codeword: string): string {
  const normalized = normalizeCodeword(codeword);
  return `sha256:${createHash("sha256").update(normalized, "utf8").digest("hex")}`;
}

export function verifyBypassCodeword(candidate: string | undefined, storedHash: string | null | undefined): boolean {
  if (!candidate || !storedHash?.startsWith("sha256:")) return false;
  const actual = hashBypassCodeword(candidate);
  if (actual.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(storedHash));
}

export function isBypassCodewordActive(policy: BypassPolicyLike | null | undefined, now = new Date()): boolean {
  if (!policy?.bypassEnabled || !policy.bypassCodewordHash) return false;
  if (!policy.bypassExpiresAt) return true;
  return new Date(policy.bypassExpiresAt).getTime() > now.getTime();
}

export function codewordBypassAllowed(candidate: string | undefined, policy: BypassPolicyLike | null | undefined, now = new Date()): boolean {
  return isBypassCodewordActive(policy, now) && verifyBypassCodeword(candidate, policy?.bypassCodewordHash);
}

export function formatBypassPolicy(policy: BypassPolicyLike | null | undefined) {
  const expiresAt = policy?.bypassExpiresAt ? new Date(policy.bypassExpiresAt).toISOString() : null;
  return {
    bypassEnabled: Boolean(policy?.bypassEnabled),
    bypassCodewordConfigured: Boolean(policy?.bypassCodewordHash),
    bypassExpiresAt: expiresAt,
  };
}
