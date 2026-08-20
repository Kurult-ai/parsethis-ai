import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isSyntheticKeyName, SYNTHETIC_NAME_CONVENTION } from "./synthetic-keys.js";

/**
 * The operator's own monitoring keys must not be counted as customers.
 *
 * Measured 2026-08-17: 574 of 708 keys and 1,247 of 1,656 screenings on
 * production belonged to hourly probe/canary automation. Every dashboard
 * number, the digest and the metrics surface were roughly three-quarters the
 * operator's own robots, which is how "134 real signups, 29% activation" was
 * nearly read as "708 signups, healthy volume".
 */

describe("operator automation is recognised by its reserved names", () => {
  const SYNTHETIC = [
    "hourly-saas-canary-do-not-use",
    "hourly-loop-smoke",
    "elon-hourly-readonly-probe-DO-NOT-USE",
    "elons-pg-test",
    "ua-probe",
    "saas-readiness-probe",
    "hourly-saas-loop-smoke",
    "elon-screen-matrix-REVOKE",
  ];
  for (const name of SYNTHETIC) {
    it(`flags: ${name}`, () => {
      assert.equal(isSyntheticKeyName(name), true);
    });
  }
});

describe("real users are never misclassified", () => {
  // The cost of a false positive here is that a real customer's traffic
  // disappears from the operator's metrics — the exact blindness this module
  // exists to remove. These are the names a genuine evaluator writes.
  const REAL = [
    "Signup Key 2026-08-12",
    "test",                      // an evaluator's first key is very often called this
    "test key",
    "my test integration",       // bare "test" must NOT be a marker
    "production",
    "staging",
    "hermes agent",
    "newsletter digest bot",
    "Canary Wharf trading desk", // "canary" as an ordinary word, not a marker
    "",
  ];
  for (const name of REAL) {
    it(`does not flag: ${JSON.stringify(name)}`, () => {
      assert.equal(isSyntheticKeyName(name), false);
    });
  }
});

describe("the convention is documented for the automation that must follow it", () => {
  it("publishes its reserved markers", () => {
    assert.ok(Array.isArray(SYNTHETIC_NAME_CONVENTION.prefixes));
    assert.ok(SYNTHETIC_NAME_CONVENTION.prefixes.includes("hourly-"));
    assert.ok(SYNTHETIC_NAME_CONVENTION.substrings.includes("probe"));
  });
});
