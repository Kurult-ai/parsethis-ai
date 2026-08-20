import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isSyntheticRequest, PROBE_HEADER } from "./funnel.js";

/**
 * The funnel counters must be able to tell the operator's probes from customers.
 *
 * On 2026-08-17 they could not. `funnel:count:*` showed ~100 discovery hits and
 * ~30 checkout starts a day for a product that had never been marketed — all of
 * it the operator's own automation. That noise is why a completely closed
 * checkout path (429 to every visitor, four days) read as a conversion problem
 * rather than an outage.
 */

describe("synthetic request classification", () => {
  it("trusts the probe header", () => {
    assert.equal(isSyntheticRequest("1"), true);
    assert.equal(isSyntheticRequest("true"), true);
  });

  it("trusts an already-classified key", () => {
    assert.equal(isSyntheticRequest(undefined, true), true);
  });

  it("counts everything else as a customer", () => {
    // The conservative default: anything that does not positively identify
    // itself is real. Wrongly discarding a customer is the worse error.
    assert.equal(isSyntheticRequest(undefined), false);
    assert.equal(isSyntheticRequest(null), false);
    assert.equal(isSyntheticRequest(""), false);
    assert.equal(isSyntheticRequest("0"), false);
    assert.equal(isSyntheticRequest("false"), false);
    assert.equal(isSyntheticRequest(undefined, false), false);
  });

  it("does not guess from a user-agent", () => {
    // Deliberately not implemented: Parse's real customers are agents calling
    // from node-fetch/python-requests/Go-http-client, so a bot-UA heuristic
    // would delete exactly the traffic that matters most. Classification is by
    // self-identification only.
    assert.equal(isSyntheticRequest("python-requests/2.31"), false);
    assert.equal(isSyntheticRequest("curl/8.4.0"), false);
  });

  it("publishes the header name so probes can set it", () => {
    assert.equal(PROBE_HEADER, "x-parse-probe");
  });
});
