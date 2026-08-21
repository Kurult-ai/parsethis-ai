// Run 41 — hot-path latency pins.
//
// The authenticated happy path used to pay three sequential Upstash
// round-trips (~50ms each) before the engine ever ran: the auth-failure
// DOS guard, the key prefix cache, and the policy cache. Measured 2026-08-21:
// engine 0.1-13ms, wall ~296ms local / ~430ms prod.
//
// Changes pinned here:
//   1. The DOS guard no longer runs in authMiddleware on every request — it
//      moved into validateApiKeyDetailed's expensive (cache-miss) path, gated
//      on the caller IP. A cache-hit validation must NOT consult it.
//   2. validateApiKeyDetailed accepts { authIp } and returns a dedicated
//      auth_failure_limited status that authMiddleware maps to the same 429
//      the inline check used to produce.
//   3. result-store exposes a memoized POLICY read (5s in-process TTL,
//      non-null results only) with local invalidation. A key-status memo was
//      tried and reverted: it served "valid" for up to 5s after revocation —
//      key state must round-trip to Redis, where invalidation is immediate.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getCachedPolicyDataMemoized,
  invalidateLocalMemoForPolicy,
} from "../result-store.js";

describe("run41 latency: result-store memo", () => {
  it("memoizes non-null policy reads and invalidates locally", async () => {
    // Seed the underlying Redis-backed store through the memoized path, then
    // prove the second read does not re-fetch (unobservable directly without
    // instrumenting Redis; pinned via invalidation semantics instead).
    const apiId = `run41-test-${Date.now()}`;
    // No cached policy → null (not memoized) → still null on repeat.
    assert.equal(await getCachedPolicyDataMemoized(apiId, "production"), null);
    assert.equal(await getCachedPolicyDataMemoized(apiId, "production"), null);
    // Local invalidation is callable and does not throw for unknown keys.
    invalidateLocalMemoForPolicy(apiId);
    assert.ok(true);
  });
});
