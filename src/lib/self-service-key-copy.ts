import { RETENTION } from "./retention-facts.js";

/** The note a newly issued self-service key carries. Number comes from RETENTION. */
export function selfServiceKeyExpiryNote(
  days: number = RETENTION.selfServiceKeyExpiryDays,
): string {
  return (
    "Store this key securely. It will not be shown again in full. "
    + `Renews automatically while in use; expires after ${days} idle days `
    + "(fails closed with 401). Self-revoke anytime with DELETE /v1/keys/self."
  );
}

export function selfServiceKeyExpiresAt(
  now: Date,
  days: number = RETENTION.selfServiceKeyExpiryDays,
): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
