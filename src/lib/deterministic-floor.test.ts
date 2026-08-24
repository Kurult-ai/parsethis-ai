import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagsFiredDeterministicFloor } from "./deterministic-floor.js";

describe("flagsFiredDeterministicFloor", () => {
  it("is false on empty flags", () => {
    assert.equal(flagsFiredDeterministicFloor([]), false);
  });

  it("is false on LLM-only flags", () => {
    assert.equal(
      flagsFiredDeterministicFloor([
        { id: "llm.privilege_escalation", source: "llm" },
        { code: "llm.social_engineering" },
      ]),
      false,
    );
  });

  it("is true when a pattern flag is present even if LLM flags are too", () => {
    assert.equal(
      flagsFiredDeterministicFloor([
        { id: "intent.override_governing_instruction", source: "deterministic_intent", code: "intent.override_governing_instruction" },
        { id: "llm.privilege_escalation", source: "llm" },
      ]),
      true,
    );
  });

  it("treats stored report `code` as the id (Attack Pack shape)", () => {
    assert.equal(
      flagsFiredDeterministicFloor([{ code: "intent.spoof_instruction_hierarchy" }]),
      true,
    );
  });
});
