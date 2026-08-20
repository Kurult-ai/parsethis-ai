import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_RATE_LIMIT_PER_HOUR,
  demoLimitExceeded,
  demoRateKey,
  demoRateLimitDetail,
  demoRemaining,
  demoSourceFrom,
} from "./demo-quota.js";

test("hero and lab are independent Redis keys for the same IP", () => {
  const ip = "203.0.113.9";
  const hero = demoRateKey(ip, "hero");
  const lab = demoRateKey(ip, "lab");
  assert.notEqual(hero, lab);
  assert.match(hero, /:hero:/);
  assert.match(lab, /:lab:/);
});

test("source defaults to lab unless the caller says hero", () => {
  assert.equal(demoSourceFrom("hero"), "hero");
  assert.equal(demoSourceFrom("lab"), "lab");
  assert.equal(demoSourceFrom(undefined), "lab");
  assert.equal(demoSourceFrom(""), "lab");
});

test("remaining is advertised before the first paste", () => {
  assert.equal(demoRemaining(0), DEMO_RATE_LIMIT_PER_HOUR);
  assert.equal(demoRemaining(1), DEMO_RATE_LIMIT_PER_HOUR - 1);
  assert.equal(demoRemaining(DEMO_RATE_LIMIT_PER_HOUR), 0);
  assert.equal(demoRemaining(DEMO_RATE_LIMIT_PER_HOUR + 4), 0);
});

test("the next request after the cap is exceeded", () => {
  assert.equal(demoLimitExceeded(DEMO_RATE_LIMIT_PER_HOUR), false);
  assert.equal(demoLimitExceeded(DEMO_RATE_LIMIT_PER_HOUR + 1), true);
});

test("429 copy still names /get-started", () => {
  assert.match(demoRateLimitDetail(), /\/get-started/);
});
