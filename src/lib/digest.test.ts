import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDigest, categoryInPlainEnglish, type DigestEvent } from "./digest.js";

const at = (day: number) => new Date(Date.UTC(2026, 7, day, 12));

function event(over: Partial<DigestEvent> = {}): DigestEvent {
  return {
    riskScore: 0,
    verdict: "safe",
    categories: [],
    blocked: false,
    disposition: "allow",
    createdAt: at(1),
    ...over,
  };
}

describe("buildDigest", () => {
  it("says the install is dead when nothing was screened", () => {
    const d = buildDigest([], "2026-08", 14);
    assert.equal(d.screened, 0);
    assert.match(d.headline, /stopped calling Parse/);
  });

  it("says so plainly when nothing tried anything", () => {
    const d = buildDigest([event(), event(), event()], "2026-08", 3);
    assert.equal(d.refused, 0);
    assert.match(d.headline, /refused none of them/);
  });

  it("counts refusals and names the commonest in plain English", () => {
    const events = [
      event(),
      event({ blocked: true, disposition: "block", categories: ["prompt_injection"], riskScore: 9.5 }),
      event({ blocked: true, disposition: "block", categories: ["prompt_injection"], riskScore: 10 }),
      event({ blocked: true, disposition: "block", categories: ["data_exfiltration"], riskScore: 10 }),
    ];
    const d = buildDigest(events, "2026-08", 5);
    assert.equal(d.screened, 4);
    assert.equal(d.refused, 3);
    assert.deepEqual(d.by_category, [
      { category: "prompt_injection", count: 2 },
      { category: "data_exfiltration", count: 1 },
    ]);
    assert.match(d.headline, /an instruction hidden in something it read/);
  });

  /** A reported finding is not a refusal. Run 11's blocked_total bug, inverted. */
  it("counts a reported finding separately from a refusal", () => {
    const d = buildDigest(
      [event({ blocked: false, disposition: "report", categories: ["prompt_injection"], riskScore: 10 })],
      "2026-08",
      2,
    );
    assert.equal(d.refused, 0);
    assert.equal(d.reported, 1);
  });

  it("counts days with no traffic at all", () => {
    const d = buildDigest([event({ createdAt: at(1) }), event({ createdAt: at(2) })], "2026-08", 10);
    assert.equal(d.quiet_days, 8);
  });

  it("never reports negative quiet days when a day carries many events", () => {
    const many = Array.from({ length: 50 }, () => event({ createdAt: at(1) }));
    assert.equal(buildDigest(many, "2026-08", 1).quiet_days, 0);
  });
});

describe("categoryInPlainEnglish", () => {
  it("translates the categories a household would meet", () => {
    assert.match(categoryInPlainEnglish("prompt_injection"), /hidden/);
    assert.match(categoryInPlainEnglish("system_prompt_leak"), /configuration/);
  });

  it("degrades readably for a category it does not know", () => {
    assert.equal(categoryInPlainEnglish("some_new_family"), "some new family");
  });
});

describe("monthlyDigestEmail", () => {
  it("warns loudly when a month saw no traffic at all", async () => {
    const { monthlyDigestEmail } = await import("./email.js");
    const digest = buildDigest([], "2026-07", 31);
    const mail = monthlyDigestEmail(digest, categoryInPlainEnglish);
    assert.match(mail.html, /Nothing reached Parse this month/);
    assert.match(mail.html, /get-started/);
  });

  it("leads with what was stopped, in words a non-technical reader uses", async () => {
    const { monthlyDigestEmail } = await import("./email.js");
    const digest = buildDigest(
      [
        event({ blocked: true, disposition: "block", categories: ["prompt_injection"], riskScore: 10 }),
        event(),
      ],
      "2026-07",
      31,
    );
    const mail = monthlyDigestEmail(digest, categoryInPlainEnglish);
    assert.match(mail.subject, /1 thing refused/);
    assert.match(mail.html, /an instruction hidden in something it read/);
    assert.doesNotMatch(mail.html, /prompt_injection/);
  });
});
