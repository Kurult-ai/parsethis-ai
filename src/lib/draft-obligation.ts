/**
 * The draft review obligation.
 *
 * `intended_action: "draft"` lets an agent that composes replies get a finding
 * sent for human review instead of refused — but only in exchange for something
 * Parse can check: the composed draft comes back through `/v1/screen-output`
 * before a person sees it.
 *
 * ── Why an obligation and not a declaration ──
 *
 * Prospect run 12's first attempt (plan item A3) asked the caller to declare
 * that the flagged text was quoted third-party content, and it failed its own
 * control twice: a genuine injection aimed at the agent became `review` as soon
 * as the caller quoted it. The problem was not the regex. It was that the thing
 * being verified — a claim about the content — cannot distinguish a quoted
 * attack from a live one for an agent that acts on the text around it.
 *
 * An obligation is different in kind. Parse issues a token, the caller redeems
 * it by submitting the draft for output screening, and an unredeemed token is a
 * fact on the server rather than a claim by the caller. Safety comes from the
 * second screen. Nobody has to be believed.
 *
 * ── What this is not ──
 *
 * It is not a promise that a human read the draft; Parse cannot see that. It is
 * a promise that the draft was screened, which is the part that is checkable and
 * the part that catches an agent having acted on an injection.
 *
 * Tokens are HMAC-signed rather than stored: the redemption check is stateless
 * on the hot path, and single-use is enforced by a short-lived Redis key so a
 * replay cannot redeem twice.
 *
 * Plan: docs/plans/2026-08-14-claimable-evidence-and-draft-role.md item 2.
 */

import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/** SHA-256 hex of the inbound prompt the obligation is bound to. */
export function hashDraftPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/** Obligations expire quickly: a draft not screened within the hour was not screened. */
export const DRAFT_OBLIGATION_TTL_SECONDS = 60 * 60;

export interface DraftObligation {
  token: string;
  expires_at: string;
  /** What the caller must do, in the response, so nobody has to read the docs to comply. */
  redeem: { method: string; url: string; field: string };
}

function secret(): string {
  return (
    process.env.PARSE_DRAFT_OBLIGATION_SECRET ||
    process.env.PARSE_CSRF_SECRET ||
    process.env.PARSE_APPROVAL_SECRET ||
    process.env.MASTER_API_KEY ||
    "parse-draft-obligation-dev-secret"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/**
 * Mint an obligation bound to the screening it came from, the key that asked,
 * and the inbound prompt that was screened. Binding to the prompt hash is what
 * stops a dummy sentence redeeming a token issued for a different inbound.
 */
export function issueDraftObligation(
  screeningId: string,
  apiKeyId: string,
  now = Date.now(),
  promptSha256 = "",
): DraftObligation {
  const expiresAtMs = now + DRAFT_OBLIGATION_TTL_SECONDS * 1000;
  const nonce = randomUUID();
  const payload = `${screeningId}.${apiKeyId}.${expiresAtMs}.${nonce}.${promptSha256}`;
  return {
    token: `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`,
    expires_at: new Date(expiresAtMs).toISOString(),
    redeem: {
      method: "POST",
      url: "/v1/screen-output",
      field: "review_obligation",
    },
  };
}

export type ObligationVerdict =
  | { ok: true; screeningId: string; apiKeyId: string; nonce: string; promptSha256: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_key" };

/**
 * Verify a token. Returns the screening it was bound to so the redemption can be
 * recorded against the right event.
 */
export function verifyDraftObligation(
  token: string | undefined,
  apiKeyId: string,
  now = Date.now(),
): ObligationVerdict {
  if (!token || typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "malformed" };
  const idx = token.lastIndexOf(".");
  const body = token.slice(0, idx);
  const providedSig = token.slice(idx + 1);

  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "bad_signature" };

  const parts = payload.split(".");
  // Four-field tokens predate the inbound-hash bind. Fail closed — they
  // cannot prove which prompt they were issued for.
  if (parts.length !== 5) return { ok: false, reason: "malformed" };
  const [screeningId, boundKeyId, expiresAtRaw, nonce, promptSha256] = parts;
  if (!screeningId || !boundKeyId || !expiresAtRaw || !nonce) return { ok: false, reason: "malformed" };

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return { ok: false, reason: "expired" };

  // An obligation belongs to the key that accepted it. A token leaking to
  // another key must not let that key take the concession.
  if (boundKeyId !== apiKeyId) return { ok: false, reason: "wrong_key" };

  return { ok: true, screeningId, apiKeyId: boundKeyId, nonce, promptSha256 };
}

/**
 * Single-use enforcement.
 *
 * The token itself is stateless — signed, not stored — so replay is the one
 * thing the signature cannot prevent. A short-lived Redis key closes it: first
 * redemption wins, later ones are told the obligation is already spent.
 *
 * Fails **open** on a Redis outage, deliberately. This is an accounting
 * control, not an authorisation one: the draft in front of us still gets
 * screened, which is the safety-relevant half. Refusing to screen a draft
 * because a counter is unavailable would trade a real check for a bookkeeping
 * one.
 */
export async function consumeDraftObligation(nonce: string): Promise<boolean> {
  try {
    const { getRedis, isRedisAvailable, ensureRedisConnected } = await import("../redis.js");
    getRedis();
    if (!isRedisAvailable()) return true;
    const connected = await ensureRedisConnected();
    if (!connected) return true;
    const redis = getRedis();
    const key = `parse:draft-obligation:${nonce}`;
    // NX: only the first redemption sets it.
    const set = await redis.set(key, "1", "EX", DRAFT_OBLIGATION_TTL_SECONDS, "NX");
    return set === "OK";
  } catch {
    return true;
  }
}
