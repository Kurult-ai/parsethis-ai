import { test } from "node:test";
import assert from "node:assert/strict";
import { getVariant, EXPERIMENTS } from "./ab-test.js";

test("getVariant is deterministic for the same request id", () => {
  const id = "203.0.113.7:Mozilla/5.0";
  const first = getVariant("hero-copy", id);
  for (let i = 0; i < 20; i++) {
    assert.equal(getVariant("hero-copy", id), first);
  }
});

test("getVariant returns only registered variant keys", () => {
  const keys = new Set(EXPERIMENTS["hero-copy"].variants.map((v) => v.key));
  for (let i = 0; i < 200; i++) {
    assert.ok(keys.has(getVariant("hero-copy", `198.51.100.${i % 255}:ua-${i}`)));
  }
});

test("getVariant distributes equal-weight variants roughly evenly", () => {
  // Regression: a bit-width bug in hashFraction once sent ~99.8% of traffic
  // to the last variant via the fall-through branch. The hero-copy registry
  // is now weighted (a:2, b:1, c:1 — run 32/33 P2-4 protects the control
  // while the ICP-beamed variant c gets real traffic), so the assertion
  // checks each variant against its REGISTERED weight, not a fixed 50/50.
  const counts: Record<string, number> = {};
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const v = getVariant("hero-copy", `10.${Math.floor(i / 255)}.0.${i % 255}:Mozilla/5.0 (test ${i})`);
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const totalWeight = EXPERIMENTS["hero-copy"].variants.reduce((sum, v) => sum + (v.weight ?? 1), 0);
  for (const variant of EXPERIMENTS["hero-copy"].variants) {
    const expected = (variant.weight ?? 1) / totalWeight;
    const share = (counts[variant.key] ?? 0) / n;
    assert.ok(
      share > expected - 0.06 && share < expected + 0.06,
      `variant "${variant.key}" share ${share} outside [${expected - 0.06}, ${expected + 0.06}] — counts: ${JSON.stringify(counts)}`,
    );
  }
});

test("getVariant falls back to first variant for unknown experiments", () => {
  assert.equal(getVariant("does-not-exist", "id"), "a");
});
