import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildDigest } from "./digest.js";

/**
 * The digest must report what Parse did, not assert what someone intended.
 *
 * `/personal` calls the digest "the thing you can show the other people in the
 * channel". Prospect run 21's said: "Parse screened 132 things your agent read
 * this month and refused 35. The commonest was an attempt to get private data
 * out." — 17 under data_exfiltration, most of them third-party release notes
 * containing the word "password".
 *
 * Two different claims are being conflated. "Parse refused this" is a fact
 * about Parse. "Someone attempted to get your private data out" is a claim
 * about a stranger's intent, and Parse cannot know it. A monthly report that
 * overstates attacks teaches its reader to stop opening it, which costs more
 * than sending nothing — and this reader is the person the product asks to
 * show it to their household.
 *
 * The detector fixes in run 21 remove most of these refusals at source. This
 * pins the language so the next over-trigger does not get narrated as an
 * attack.
 */

function evt(categories: string[], blocked = true) {
  return { categories, blocked, disposition: blocked ? "block" : "allow", createdAt: new Date() } as never;
}

describe("the digest describes refusals, not intentions", () => {
  it("does not claim an attempt was made", () => {
    const d = buildDigest([evt(["data_exfiltration"]), evt(["data_exfiltration"])] as never[], "2026-08", 31);
    assert.doesNotMatch(
      d.headline,
      /\battempt\b/i,
      "the digest asserts a stranger's intent, which Parse cannot observe",
    );
  });

  it("still names what was refused, so the reader can act", () => {
    const d = buildDigest([evt(["data_exfiltration"])] as never[], "2026-08", 31);
    assert.match(d.headline, /refused/i);
    assert.ok(d.headline.length > 0);
  });

  it("says nothing alarming when nothing was refused", () => {
    const d = buildDigest([evt(["data_exfiltration"], false)] as never[], "2026-08", 31);
    assert.doesNotMatch(d.headline, /\battempt\b/i);
  });

  it("points at a /v1/explain call that accepts trace_id", () => {
    const d = buildDigest([evt(["prompt_injection"])] as never[], "2026-08", 31);
    assert.match(d.headline, /\/v1\/explain/);
    assert.match(d.headline, /trace_id/);
  });
});
