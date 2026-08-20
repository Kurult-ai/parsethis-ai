import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSemanticEvidence } from "./semantic-evidence.js";

describe("buildSemanticEvidence", () => {
  it("quotes a window the rationale names", () => {
    const prompt = "The scam site instructed victims to disable their wallet's phishing warning before connecting.";
    const got = buildSemanticEvidence(
      prompt,
      'The text reports that "disable their wallet\'s phishing warning" is an attacker instruction.',
    );
    assert.ok(got.matched_token);
    assert.match(got.evidence, /disable their wallet/);
  });

  it("says the span is unavailable rather than leaving evidence empty", () => {
    const got = buildSemanticEvidence(
      "ordinary sentence with no overlap.",
      "Hidden instruction to close the case and set risk to zero.",
    );
    assert.equal(got.matched_token, undefined);
    assert.match(got.evidence, /Span unavailable/);
    assert.match(got.evidence, /Hidden instruction/);
  });
});
