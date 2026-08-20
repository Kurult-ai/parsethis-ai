/**
 * Run 24 — the monthly receipt can report a hold.
 *
 * Prospect run 24's persona is unreachable for eight hours a day and asked for
 * exactly one thing: *"just '3 messages are waiting for you', so that a hold
 * stops being the same thing as a message that vanished."* The digest could
 * report `refused` and `reported` and had no field for the disposition that
 * needs a person.
 *
 * The trap these tests exist to pin: `ScreeningEvent.disposition` stores the
 * RECOMMENDED ACTION, not the four-value `Disposition` that `/v1/parse` returns
 * under the same field name. A filter on the literal "review" finds none of the
 * `sandbox` or `request_owner_approval` holds — on run 24's own corpus it would
 * have reported zero of four.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, type DigestEvent } from "./digest.js";
import { HELD_DISPOSITIONS, isHeldDisposition } from "./held-dispositions.js";

const ev = (over: Partial<DigestEvent> = {}): DigestEvent => ({
  riskScore: 0,
  verdict: "safe",
  categories: [],
  blocked: false,
  disposition: "allow",
  createdAt: new Date("2026-08-10T12:00:00Z"),
  ...over,
});

describe("run 24 — the digest reports holds", () => {
  it("counts every held disposition, not just the literal \"review\"", () => {
    const events = [
      ev({ disposition: "review", riskScore: 3, verdict: "low_risk" }),
      ev({ disposition: "sandbox", riskScore: 5, verdict: "medium_risk" }),
      ev({ disposition: "request_owner_approval", riskScore: 6, verdict: "medium_risk" }),
      ev(),
    ];
    const d = buildDigest(events, "2026-08", 31);
    assert.equal(d.held, 3, "a filter on \"review\" alone would report 1 of these 3");
    assert.equal(d.screened, 4);
    assert.equal(d.refused, 0);
  });

  it("does not count a refusal or a report as a hold", () => {
    const events = [
      ev({ blocked: true, disposition: "block", riskScore: 9.2, verdict: "critical", categories: ["prompt_injection"] }),
      ev({ disposition: "report", riskScore: 8, verdict: "high_risk" }),
      ev({ disposition: "sandbox" }),
    ];
    const d = buildDigest(events, "2026-08", 31);
    assert.equal(d.refused, 1);
    assert.equal(d.reported, 1);
    assert.equal(d.held, 1);
  });

  it("says so in the headline, because a count nobody reads is the defect", () => {
    const d = buildDigest([ev({ disposition: "request_owner_approval" }), ev()], "2026-08", 31);
    assert.match(d.headline, /waiting for you to decide/);
    assert.match(d.headline, /\b1 is waiting/);
  });

  it("pluralises, and stays silent when nothing is held", () => {
    const many = buildDigest([ev({ disposition: "sandbox" }), ev({ disposition: "review" })], "2026-08", 31);
    assert.match(many.headline, /\b2 are waiting/);

    const none = buildDigest([ev(), ev()], "2026-08", 31);
    assert.equal(none.held, 0);
    assert.doesNotMatch(none.headline, /waiting for you/);
  });

  it("the shared domain covers what the write path can persist", () => {
    // screening-event-log writes screeningDecisionAction(), a SuggestedAction.
    // These three are the ones that mean "not decided".
    assert.deepEqual([...HELD_DISPOSITIONS], ["review", "sandbox", "request_owner_approval"]);
    for (const held of HELD_DISPOSITIONS) assert.equal(isHeldDisposition(held), true, held);
    for (const decided of ["allow", "block", "report"]) {
      assert.equal(isHeldDisposition(decided), false, decided);
    }
    assert.equal(isHeldDisposition(null), false);
    assert.equal(isHeldDisposition(undefined), false);
  });
});
