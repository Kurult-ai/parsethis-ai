import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectIntentPromptRisks } from "../lib/patterns/intent.js";
import {
  COMPLIANCE_BENIGN_CORPUS,
  COMPLIANCE_INJECTION_CORPUS,
} from "../lib/compliance-corpus.js";

describe("Compliance-analyst corpus — must not false-positive", () => {
  for (const fixture of COMPLIANCE_BENIGN_CORPUS) {
    it(`benign: ${fixture.id} (${fixture.domain}) must not trigger override_governing_instruction`, () => {
      const flags = detectIntentPromptRisks(fixture.prompt);
      const overrideFlag = flags.find(
        (f) => f.id === "intent.override_governing_instruction"
      );
      assert.equal(
        overrideFlag,
        undefined,
        `Expected no override flag but got: ${JSON.stringify(overrideFlag)}\n` +
          `All flags: ${flags.map((f) => f.id).join(", ")}`
      );
    });

    it(`benign: ${fixture.id} (${fixture.domain}) must not trigger spoof_instruction_hierarchy`, () => {
      const flags = detectIntentPromptRisks(fixture.prompt);
      const spoofFlag = flags.find(
        (f) => f.id === "intent.spoof_instruction_hierarchy"
      );
      assert.equal(
        spoofFlag,
        undefined,
        `Expected no role-spoof flag but got: ${JSON.stringify(spoofFlag)}\n` +
          `All flags: ${flags.map((f) => f.id).join(", ")}`
      );
    });
  }

  // Real injection payloads must still be caught
  for (const fixture of COMPLIANCE_INJECTION_CORPUS) {
    it(`injection: ${fixture.id} (${fixture.domain}) must still be caught`, () => {
      const flags = detectIntentPromptRisks(fixture.prompt);
      assert.ok(
        flags.length > 0,
        `Expected at least one flag for injection payload ${fixture.id}, got none`
      );
    });
  }
});
