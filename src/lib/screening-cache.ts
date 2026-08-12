/**
 * A short-lived memory of what the semantic layer said about a prompt.
 *
 * The problem this solves is not cost and it is not latency. It is that a
 * customer has to be able to reproduce a block in order to argue with it.
 *
 * Prospect run 8 sent one benign sentence — "Open the payer portal and read the
 * claim status for member 88213", the literal job of the agent — nine times in
 * a row on one key. The scores were 0.3, 3, 3, 3, 3, 3, 5, 5 and 8.8, and the
 * last one blocked. Three different attack families were cited for one
 * sentence. The engineer on the receiving end spent twenty minutes looking for
 * the bug in his own code, because an intermittent refusal is indistinguishable
 * from one.
 *
 * Greedy sampling narrows that spread. It cannot close it: the default model is
 * a mixture-of-experts, and expert routing varies with batching regardless of
 * temperature. So the guarantee is made here instead, where it can be absolute
 * — within the TTL, the same prompt under the same policy returns the same
 * verdict, every time, and says so on the response.
 *
 * What is deliberately *not* cached: the org tool policy, the freeze check,
 * data governance, volume budgets. Those are decisions about the caller and the
 * moment, not about the text, and they are re-evaluated on every request. Only
 * the semantic layer's reading of the prompt is remembered.
 */

import { createHash } from "node:crypto";
import { getRedis, isRedisAvailable, ensureRedisConnected, isRedisConfigured } from "../redis.js";

/**
 * How long a verdict stays reproducible.
 *
 * 15 minutes covered a retry and an argument. It does not cover an audit: an
 * enterprise asking "why was this prompt blocked on Tuesday" needs the same
 * answer on Wednesday, and a model that is non-deterministic under batching
 * will not give it to them. 24 hours is the default, overridable per
 * deployment.
 *
 * A long TTL is safe here because the key already carries everything that
 * decides the answer — prompt, model, mode, policy mode — plus a VERSION that
 * must be bumped whenever the rubric changes. Changing the model changes the
 * key; changing the prompt changes the key. Nothing goes stale silently.
 */
const TTL_SECONDS = Number(process.env.SCREENING_CACHE_TTL_SECONDS || 24 * 60 * 60);

const VERSION = "v1";

export interface CacheDimensions {
  prompt: string;
  model: string;
  mode: string;
  policyMode: string;
}

/**
 * A stable integer seed for a prompt, for providers that honour `seed`.
 * Derived from the same hash as the cache key so the two never disagree about
 * what "the same request" means.
 */
export function seedFor(prompt: string): number {
  const hex = createHash("sha256").update(prompt).digest("hex").slice(0, 8);
  return parseInt(hex, 16) % 2_147_483_647;
}

export function cacheKey(d: CacheDimensions): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([VERSION, d.prompt, d.model, d.mode, d.policyMode]),
    )
    .digest("hex")
    .slice(0, 32);
  return `screening:verdict:${digest}`;
}

/**
 * The remembered semantic reading for this prompt, or null.
 *
 * Never throws. A cache that can fail a request is worse than no cache.
 */
export async function getCachedVerdict<T>(d: CacheDimensions): Promise<T | null> {
  if (!isRedisConfigured()) return null;
  try {
    // The guard above asks whether Redis is *configured*, not whether a client
    // exists yet: it reports false until the
    // client singleton exists, and ensureRedisConnected() is what creates it.
    // Gating on it made this cache silently inert on every cold process — which
    // is exactly when a verdict most needs to be stable.
    if (!(await ensureRedisConnected())) return null;
    const raw = await getRedis().get(cacheKey(d));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error("[screening-cache] read failed:", (err as Error).message);
    return null;
  }
}

/** Remember a semantic reading. Fire and forget; never throws. */
export async function setCachedVerdict(d: CacheDimensions, value: unknown): Promise<void> {
  if (!isRedisConfigured()) return;
  try {
    if (!(await ensureRedisConnected())) return;
    const redis = getRedis();
    // These writes are fire-and-forget, so one can still be in flight when the
    // process (or a test) closes the connection underneath it. ioredis rejects
    // pending commands with "Connection is closed.", which surfaces as a failed
    // teardown rather than as anything this function can catch. Do not start a
    // command on a client that is not ready.
    if (redis.status !== "ready") return;
    await redis.set(cacheKey(d), JSON.stringify(value), "EX", TTL_SECONDS);
  } catch (err) {
    console.error("[screening-cache] write failed:", (err as Error).message);
  }
}

export const SCREENING_CACHE_TTL_SECONDS = TTL_SECONDS;
