/**
 * CSRF tokens for state-changing forms posted from the SSR dashboards.
 *
 * The dashboards authenticate with the `parse_admin_key` cookie, which is
 * `SameSite=Lax`. Lax suppresses the cookie on cross-site subrequests but
 * still sends it on top-level navigations, so it is not by itself a defence
 * for a state-changing POST. Every browser-originated mutation therefore
 * carries a token bound to the authenticated key and to an expiry.
 *
 * Requests that authenticate with an `Authorization: Bearer` header are not
 * subject to this check: a cross-site page cannot attach that header, so the
 * ambient-credential problem CSRF exploits does not exist for API callers.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";
import { problem, ErrorCode } from "./problem-response.js";

const TOKEN_PREFIX = "pcsrf_";
const DEFAULT_TTL_SECONDS = 60 * 60;

export const CSRF_HEADER = "x-parse-csrf";

function csrfSecret(): string {
  return (
    process.env.PARSE_CSRF_SECRET ||
    process.env.PARSE_APPROVAL_SECRET ||
    process.env.MASTER_API_KEY ||
    "parse-csrf-dev-secret-change-me"
  );
}

/** Bind the token to the key without embedding the key id in page HTML. */
function keyDigest(apiKeyId: string): string {
  return createHash("sha256").update(apiKeyId).digest("base64url").slice(0, 22);
}

function sign(payload: string): string {
  return createHmac("sha256", csrfSecret()).update(payload).digest("base64url");
}

/** timingSafeEqual throws on length mismatch, so compare lengths first. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Issue a token for the given API key. Embed the result in a hidden form
 * field or a meta tag on the rendered dashboard.
 */
export function issueCsrfToken(
  apiKeyId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  now: number = Date.now(),
): string {
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const nonce = randomBytes(12).toString("base64url");
  const payload = `${keyDigest(apiKeyId)}.${exp}.${nonce}`;
  return `${TOKEN_PREFIX}${payload}.${sign(payload)}`;
}

export type CsrfFailure = "malformed" | "bad_signature" | "expired" | "wrong_key";

export function verifyCsrfToken(
  token: string | undefined | null,
  apiKeyId: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; reason: CsrfFailure } {
  if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const parts = token.slice(TOKEN_PREFIX.length).split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  const [digest, expRaw, nonce, sig] = parts;
  const payload = `${digest}.${expRaw}.${nonce}`;

  // Signature first: an attacker must not learn expiry or binding from a forgery.
  if (!safeEqual(sign(payload), sig)) return { ok: false, reason: "bad_signature" };

  const exp = Number.parseInt(expRaw, 10);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  if (exp * 1000 <= now) return { ok: false, reason: "expired" };

  if (!safeEqual(keyDigest(apiKeyId), digest)) return { ok: false, reason: "wrong_key" };

  return { ok: true };
}

/**
 * Middleware for state-changing dashboard endpoints. Place it AFTER
 * `authMiddleware`. Bearer-authenticated callers pass through untouched.
 */
export function requireCsrf() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (c.req.header("Authorization")) {
      await next();
      return;
    }

    const apiKey = c.get("apiKey");
    const result = verifyCsrfToken(c.req.header(CSRF_HEADER), apiKey?.id ?? "");

    if (!result.ok) {
      return problem(c, {
        status: 403,
        title: "Missing or invalid CSRF token",
        detail:
          `Browser requests authenticated by cookie must send a valid ${CSRF_HEADER} header. ` +
          `Reload the dashboard to obtain a fresh token.`,
        code: ErrorCode.AUTH_FORBIDDEN_ROLE,
        retryable: false,
        csrf_failure: result.reason,
      });
    }

    await next();
  };
}
