import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt } from "../parse.js";
import {
  CONVERSATIONAL_BENIGN_CORPUS,
  CONVERSATIONAL_ATTACK_CORPUS,
  TRUSTED_CONVERSATION_METADATA_CANONICAL,
} from "../lib/conversational-corrections-corpus.js";

// Tests run without OPENROUTER_API_KEY, so parsePrompt exercises the
// deterministic layers only — which is where the false positive lives
// (source: "deterministic_intent", action_floor: "block").
delete process.env.OPENROUTER_API_KEY;

describe("Trusted-conversation softening — owner corrections must not block", () => {
  for (const fixture of CONVERSATIONAL_BENIGN_CORPUS) {
    it(`benign+trusted: ${fixture.id} must not block`, async () => {
      const result = await parsePrompt({
        prompt: fixture.prompt,
        metadata: { ...TRUSTED_CONVERSATION_METADATA_CANONICAL },
      });
      assert.notEqual(
        result.recommended_action,
        "block",
        `${fixture.id} blocked with trusted-conversation metadata.\n` +
          `score=${result.risk_score} flags=${result.flags.map((f) => f.id).join(", ")}`,
      );
      // Softened fixtures land at 3-4.5: sev-3 flags plus a correlation bonus
      // when the correction trips both prompt_injection and system_prompt_leak
      // shaped rules. The action assertion above is the contract; the score
      // bound just catches wholesale regression.
      assert.ok(
        result.risk_score <= 5,
        `${fixture.id} expected softened score <= 5, got ${result.risk_score}`,
      );
    });

    it(`benign, NO metadata: ${fixture.id} keeps today's default behavior`, async () => {
      const result = await parsePrompt({ prompt: fixture.prompt });
      if (fixture.blocksWithoutMetadata) {
        assert.equal(
          result.recommended_action,
          "block",
          `${fixture.id} without metadata expected block (fail-closed default unchanged), got ` +
            `${result.recommended_action} at score ${result.risk_score}`,
        );
      } else {
        assert.notEqual(
          result.recommended_action,
          "block",
          `${fixture.id} passed clean before this change and must stay clean`,
        );
      }
    });
  }

  for (const fixture of CONVERSATIONAL_ATTACK_CORPUS) {
    it(`attack+trusted: ${fixture.id} must still block`, async () => {
      const result = await parsePrompt({
        prompt: fixture.prompt,
        metadata: { ...TRUSTED_CONVERSATION_METADATA_CANONICAL },
      });
      assert.equal(
        result.recommended_action,
        "block",
        `${fixture.id} expected block despite trusted metadata, got ` +
          `${result.recommended_action} at score ${result.risk_score}`,
      );
    });
  }

  it("untrusted source_kind gets no softening even with owner requester_trust", async () => {
    const result = await parsePrompt({
      // conv-002 by id: it names "the previous instructions" — a governing-
      // instruction override — so it still blocks, which is what makes it the
      // right probe for "requester_trust cannot soften untrusted content".
      //
      // This used to point at conv-001 ("ignore what I said before about the
      // grocery list"), a BARE-MODIFIER correction. The 2026-08-19 directive
      // (prospect run 26) leans toward allowing that family, so conv-001 as a
      // retrieved_doc no longer blocks — a precision change, not a softening of
      // untrusted content. The security property this test guards (owner trust
      // does not relax untrusted governing-instruction overrides) is unchanged
      // and is what conv-002 asserts.
      prompt: CONVERSATIONAL_BENIGN_CORPUS.find((f) => f.id === "conv-002")!.prompt,
      metadata: { source_kind: "retrieved_doc", requester_trust: "owner" },
    });
    assert.equal(
      result.recommended_action,
      "block",
      "retrieved_doc content must keep the full floor regardless of requester_trust",
    );
  });
});
