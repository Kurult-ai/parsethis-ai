import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379/15";
process.env.REDIS_MAX_RETRIES = process.env.REDIS_MAX_RETRIES ?? "2";

const health = await import("../lib/semantic-health.js");
const { getRedis, ensureRedisConnected, disconnectRedis } = await import("../redis.js");

let redisAvailable = false;
function itRedis(name: string, fn: () => Promise<void>) {
  it(name, async (t) => {
    if (!redisAvailable) {
      t.skip("no Redis reachable — semantic-health test skipped");
      return;
    }
    await fn();
  });
}

async function clean() {
  const redis = getRedis();
  for (const pattern of ["screening:llm_degraded:*", "screening:llm_attempts:*", "screening:llm_alerted:*"]) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }
}

describe("semantic layer health: rate, not tripwire", () => {
  before(async () => {
    redisAvailable = await ensureRedisConnected().catch(() => false);
    if (redisAvailable) await clean();
  });

  after(async () => {
    if (redisAvailable) {
      await clean();
      await disconnectRedis();
    }
  });

  // ── the threshold rule, which is the whole point ──────────────────────────
  // Pure function, so this runs with or without Redis.

  it("does not call a single failure in a quiet hour degraded", () => {
    // The old behaviour: one fallback flipped the whole layer to degraded.
    // That is what taught everyone to ignore the page.
    assert.equal(health.isDegraded(1, 1), false, "1 of 1 is not evidence of an outage");
    assert.equal(health.isDegraded(5, 2), false);
    assert.equal(health.isDegraded(19, 4), false);
  });

  it("calls a quiet hour degraded once failures pile up in absolute terms", () => {
    assert.equal(health.isDegraded(10, 5), true);
    assert.equal(health.isDegraded(19, 9), true);
  });

  it("uses a ratio once there is enough traffic to judge", () => {
    assert.equal(health.isDegraded(1000, 10), false, "1% is normal transient noise");
    assert.equal(health.isDegraded(1000, 50), true, "5% is a real fault");
    assert.equal(health.isDegraded(200, 40), true);
  });

  it("is never degraded with zero failures", () => {
    assert.equal(health.isDegraded(0, 0), false);
    assert.equal(health.isDegraded(10_000, 0), false);
  });

  // ── counters and reporting ────────────────────────────────────────────────

  itRedis("counts attempts and failures separately and computes the ratio", async () => {
    await clean();
    const at = new Date();
    for (let i = 0; i < 10; i++) await health.recordSemanticAttempt(at);
    for (let i = 0; i < 2; i++) await health.recordSemanticDegraded(at);

    const h = await health.readSemanticHealth(at);
    assert.equal(h.attempts, 10);
    assert.equal(h.degraded, 2);
    assert.ok(h.ratio !== null && Math.abs(h.ratio - 0.2) < 1e-9);
    assert.equal(h.degradedNow, false, "2 of 10 is under the low-traffic absolute floor");
  });

  itRedis("reports magnitude in the detail string, not just a status word", async () => {
    await clean();
    const at = new Date();
    for (let i = 0; i < 4; i++) await health.recordSemanticAttempt(at);
    await health.recordSemanticDegraded(at);

    const detail = health.describeSemanticHealth(await health.readSemanticHealth(at));
    assert.match(detail, /1 of 4/, `detail should state the numbers, got: ${detail}`);
  });

  itRedis("says so plainly when nothing has used the layer", async () => {
    await clean();
    const detail = health.describeSemanticHealth(await health.readSemanticHealth(new Date()));
    assert.match(detail, /No screening calls have used the semantic layer/i);
  });

  itRedis("treats an unreadable Redis as unknown, not healthy", async () => {
    // A blank slate reads as 0/0, which is honest. The unknown case (null) is
    // covered by the describe branch; assert it does not claim health.
    const detail = health.describeSemanticHealth({ attempts: null, degraded: null, ratio: null, degradedNow: false });
    assert.match(detail, /could not be read/i);
  });

  // ── sustained-degradation alerting ────────────────────────────────────────

  itRedis("does not alert on a single degraded hour", async () => {
    await clean();
    const now = new Date();
    // Make THIS hour clearly degraded, leave the previous hour clean.
    for (let i = 0; i < 10; i++) await health.recordSemanticAttempt(now);
    for (let i = 0; i < 6; i++) await health.recordSemanticDegraded(now);

    // recordSemanticDegraded already evaluated internally; clear the marker so
    // this asserts the rule rather than the dedupe.
    await getRedis().del(`screening:llm_alerted:hour:${health.hourStamp(now)}`);
    assert.equal(await health.evaluateSustainedDegradation(now), false, "one bad hour is a blip, not a page");
  });

  itRedis("alerts once when two consecutive hours are degraded", async () => {
    await clean();
    const now = new Date();
    const prev = new Date(now.getTime() - 60 * 60 * 1000);
    const redis = getRedis();
    // Seed both hours as degraded past the absolute floor.
    for (const at of [prev, now]) {
      await redis.set(health.attemptsHourKey(health.hourStamp(at)), "10");
      await redis.set(health.degradedHourKey(health.hourStamp(at)), "6");
    }
    await redis.del(`screening:llm_alerted:hour:${health.hourStamp(now)}`);

    assert.equal(await health.evaluateSustainedDegradation(now), true, "sustained fault should alert");
    assert.equal(
      await health.evaluateSustainedDegradation(now),
      false,
      "and must not alert again for the same stretch — a busy degraded hour must not page per request",
    );
  });
});
