import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Paying must never be refused where free is served.
 *
 * `src/__tests__/billable-usage.test.ts` already pins this invariant for
 * *usage*: no paid tier may be refused traffic the free tier would have served.
 * This file pins it one step earlier, at *acquisition*, because that is where
 * it actually broke.
 *
 * Measured on production 2026-08-17: `POST /v1/billing/signup-checkout` — the
 * only self-serve path to a paid plan — returned
 * `429 {"error":"Maximum number of self-service keys reached"}` for every
 * caller, while `POST /v1/keys/generate` returned 201 for the same visitor at
 * the same moment. The paid path carried a hardcoded cap of 100; the free path
 * read a configurable cap defaulting to 1,000; there were 165 live keys, of
 * which 125 were the operator's own hourly probe automation.
 *
 * So the product had been unpurchasable for roughly four days, the checkout
 * funnel showed ~30 starts a day against one completion ever, and nothing
 * alerted. Two rules fall out, and both are asserted below:
 *
 *   1. The paid path may not carry its own numeric cap. It reads the same
 *      shared cap the free path reads, or it is not allowed to refuse.
 *   2. Operator automation may not consume customer capacity. Synthetic keys
 *      are excluded from the count that gates signup.
 */

describe("the paid signup path cannot be stricter than the free one", () => {
  const billing = read("../routes/billing.ts");

  it("does not hardcode its own key cap", () => {
    // The literal that caused the outage: `if (totalKeys >= 100)`.
    assert.doesNotMatch(
      billing,
      /totalKeys\s*>=\s*\d+/,
      "signup-checkout must not compare against a numeric literal; use the shared cap",
    );
  });

  it("reads the shared, configurable cap", () => {
    assert.match(
      billing,
      /getSelfServiceKeyCap\(\)/,
      "the paid path must read the same cap helper the free keygen path reads",
    );
  });
});

describe("operator automation does not consume customer capacity", () => {
  const service = read("../api-key-service.ts");

  it("excludes synthetic keys from the self-service count that gates signup", () => {
    const fn = service.slice(service.indexOf("export async function countSelfServiceKeys"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    assert.match(
      body,
      /synthetic:\s*false/,
      "countSelfServiceKeys gates real signups; the operator's probes must not fill that quota",
    );
  });

  it("does not count keys that have already expired", () => {
    const fn = service.slice(service.indexOf("export async function countSelfServiceKeys"));
    const body = fn.slice(0, fn.indexOf("\n}\n") + 3);
    assert.match(
      body,
      /expiresAt/,
      "an expired key occupies no capacity and must not gate a new customer",
    );
  });
});

describe("the cap helper is shared rather than duplicated", () => {
  it("lives in a lib both routes can import", () => {
    const lib = read("../lib/self-service-cap.ts");
    assert.match(lib, /export function getSelfServiceKeyCap/);
    assert.match(lib, /SELF_SERVICE_KEY_CAP/, "must stay overridable by environment");
  });
});
