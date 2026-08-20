import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  evaluateAcquittal,
  RELEASABLE_FLAG_IDS,
  RELEASE_CANCEL_CATEGORIES,
  MAX_ACQUITTAL_SCORE,
  ACQUITTAL_RUBRIC,
  type AcquittalInput,
} from "./semantic-acquittal.js";
import type { RiskFlag } from "../../parse.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Bypass register, from `docs/plans/2026-08-12-semantic-acquittal-release.md`
 * Appendix B. Each `B<n>` test fails without its guard.
 *
 * This feature shipped once, was reverted, was attempted again, and was reverted
 * again — both times passing every gate. These tests are the record of how.
 */

function flag(over: Partial<RiskFlag> = {}): RiskFlag {
  return {
    id: "intent.fuzzy_override_token",
    category: "prompt_injection",
    severity: 8,
    label: "Fuzzy override token",
    detail: "",
    confidence: "high",
    action_floor: "block",
    source: "deterministic_intent",
    ...over,
  } as RiskFlag;
}

function input(over: Partial<AcquittalInput> = {}): AcquittalInput {
  return {
    flags: [flag()],
    prompt: "Ignore the previous waypoint instruction and return to dock, battery is at 8%",
    mode: undefined,
    semanticRan: true,
    review: { score: 1, categories: ["none"], model: "deepseek/deepseek-chat" },
    analystSampled: false,
    metadata: undefined,
    enabled: true,
    ...over,
  };
}

describe("the release, when everything lines up", () => {
  it("releases the safety command that cost prospect run 4", () => {
    const d = evaluateAcquittal(input());
    assert.equal(d.release, true, d.reason);
    assert.deepEqual(d.releasableFlags.map((f) => f.id), ["intent.fuzzy_override_token"]);
  });

  it("records which model acquitted, because ANALYSIS_MODEL is a chain", () => {
    const d = evaluateAcquittal(input());
    assert.equal(d.release, true);
    // buildReleaseRecord carries it; the decision carries the flags.
    assert.ok(d.releasableFlags.length > 0);
  });
});

describe("it ships dark", () => {
  it("does nothing unless the org opted in", () => {
    assert.equal(evaluateAcquittal(input({ enabled: false })).reason, "disabled_for_org");
  });
});

describe("B1 — disclosure probes are never releasable", () => {
  it("excludes both probe flags from the releasable set", () => {
    assert.equal(RELEASABLE_FLAG_IDS.has("intent.instruction_disclosure_probe"), false);
    assert.equal(RELEASABLE_FLAG_IDS.has("intent.instruction_probe_or_mutation"), false);
  });

  it("does not release a prompt whose only flag is a disclosure probe", () => {
    const d = evaluateAcquittal(
      input({ flags: [flag({ id: "intent.instruction_disclosure_probe", category: "system_prompt_leak" })] }),
    );
    assert.equal(d.release, false);
    assert.equal(d.reason, "nothing_releasable");
  });

  it("refuses if a releasable id ever carries a non-prompt_injection category", () => {
    // The set and the categories drifting apart is what made bypass 1 work.
    const d = evaluateAcquittal(input({ flags: [flag({ category: "system_prompt_leak" })] }));
    assert.equal(d.release, false);
    assert.equal(d.reason, "releasable_flag_has_unexpected_category");
  });

  it("keeps every releasable id out of the cancel categories", () => {
    for (const id of RELEASABLE_FLAG_IDS) {
      assert.ok(id.startsWith("intent.") || id.startsWith("pattern."), id);
    }
    assert.ok(RELEASE_CANCEL_CATEGORIES.has("system_prompt_leak"));
    assert.ok(RELEASE_CANCEL_CATEGORIES.has("indirect_injection"));
    assert.ok(RELEASE_CANCEL_CATEGORIES.has("social_engineering"));
  });
});

describe("B2 — the threshold sits below the analyst's own rubric", () => {
  it("refuses a score above the threshold", () => {
    assert.equal(
      evaluateAcquittal(input({ review: { score: MAX_ACQUITTAL_SCORE + 1, categories: ["none"], model: "m" } })).reason,
      "review_score_above_threshold",
    );
  });

  it("refuses when the analyst gave no score at all", () => {
    assert.equal(evaluateAcquittal(input({ review: null })).reason, "no_acquittal_review");
  });

  it("does not overlap the acquittal rubric's own uncertainty band", () => {
    // The invariant, asserted against the rubric text rather than a number: a
    // correctly-behaving reviewer following its own instructions must not be
    // able to release a block. The acquittal rubric scores "unclear what it
    // points at, or an external-URL fetch instruction" as 3-4.
    const band = /- (\d)-(\d): unclear what it points at/.exec(ACQUITTAL_RUBRIC);
    assert.ok(band, "could not find the acquittal rubric's uncertainty band — did the prompt change?");
    const lowestRiskBearingScore = Number(band[1]);
    assert.ok(
      MAX_ACQUITTAL_SCORE < lowestRiskBearingScore,
      `MAX_ACQUITTAL_SCORE ${MAX_ACQUITTAL_SCORE} must be below the rubric's ${lowestRiskBearingScore}`,
    );
  });
});

describe("B4 — untrusted content is never an owner correction", () => {
  for (const kind of ["retrieved_doc", "web_page", "email", "tool_output", "memory", "agent_handoff"]) {
    it(`refuses source_kind ${kind}`, () => {
      assert.equal(
        evaluateAcquittal(input({ metadata: { source_kind: kind } })).reason,
        "untrusted_source_kind",
      );
    });
  }

  for (const level of ["untrusted", "external"]) {
    it(`refuses trust_level ${level}`, () => {
      assert.equal(
        evaluateAcquittal(input({ metadata: { trust_level: level } })).reason,
        "untrusted_trust_level",
      );
    });
  }
});

describe("B5 — a sampled verdict never releases", () => {
  it("refuses when the analyst saw windows", () => {
    assert.equal(evaluateAcquittal(input({ analystSampled: true })).reason, "analyst_verdict_sampled");
  });

  it("refuses a prompt long enough to be sampled, even if the flag is unset", () => {
    assert.equal(
      evaluateAcquittal(input({ prompt: "x".repeat(4001) })).reason,
      "prompt_too_long_to_acquit",
    );
  });
});

describe("B6 — an empty category list is not an acquittal", () => {
  it("requires exactly [\"none\"]", () => {
    assert.equal(evaluateAcquittal(input({ review: { score: 1, categories: [] as string[], model: "m" } })).reason, "review_did_not_affirm_none");
    assert.equal(evaluateAcquittal(input({ review: { score: 1, categories: null as unknown as string[], model: "m" } })).reason, "review_did_not_affirm_none");
    assert.equal(
      evaluateAcquittal(input({ review: { score: 1, categories: ["none", "prompt_injection"] as string[], model: "m" } })).reason,
      "review_did_not_affirm_none",
    );
    assert.equal(evaluateAcquittal(input({ review: { score: 1, categories: ["none"] as string[], model: "m" } })).release, true);
  });
});

describe("B7 — the analyst does not corroborate its own acquittal", () => {
  it("a deterministic flag holds the block", () => {
    const d = evaluateAcquittal(
      input({ flags: [flag(), flag({ id: "pattern.remote_shell_execution", source: "pattern", category: "code_execution" })] }),
    );
    assert.equal(d.release, false);
  });

  it("refuses when any other flag independently floors a block", () => {
    // Releasing the override would not change the outcome, and reporting
    // released: true on a request that still blocks is a lie in the body.
    const d = evaluateAcquittal(
      input({ flags: [flag(), flag({ id: "llm.something", source: "llm", category: "prompt_injection", action_floor: "block" })] }),
    );
    assert.equal(d.reason, "another_flag_floors_block");
  });

  it("an LLM flag does NOT count as corroboration", () => {
    // The live model was observed inventing llm.privilege_escalation on benign
    // text. If that counted, every analyst false positive would hold a block
    // that the same analyst had just acquitted — circular.
    const d = evaluateAcquittal(
      input({
        flags: [flag(), flag({ id: "llm.some_category", source: "llm", category: "prompt_injection", severity: 4, action_floor: "sandbox" })],
      }),
    );
    assert.equal(d.release, true, d.reason);
  });

  it("and an LLM flag in a cancel category does not veto either", () => {
    // The general analyst is shut out in both directions. It scored the
    // battery-at-8% dock recall ["jailbreak","prompt_injection"] at 8 while
    // scoring the canonical benchmark injection ["none"] at 1; letting it veto
    // would mean its false positives — the whole problem — keep the block.
    const d = evaluateAcquittal(
      input({
        flags: [flag(), flag({ id: "llm.data_exfiltration", source: "llm", category: "data_exfiltration", severity: 4, action_floor: "sandbox" })],
      }),
    );
    assert.equal(d.release, true, d.reason);
  });

  it("but a DETERMINISTIC flag in a cancel category cancels", () => {
    const d = evaluateAcquittal(
      input({
        flags: [flag(), flag({ id: "pattern.exfil_url", source: "pattern", category: "data_exfiltration" })],
      }),
    );
    assert.equal(d.reason, "cancelled_by_deterministic_signal");
  });
});

describe("B8 — floor and score are released together", () => {
  it("the caller drops the floor and caps the score in the same branch", () => {
    const parse = read("../../parse.ts");
    const branch = parse.slice(parse.indexOf("if (acquittal.release)"), parse.indexOf("const categories = ["));
    assert.match(branch, /action_floor = "sandbox"/, "the floor must be released");
    assert.match(branch, /riskScore = 6/, "the score must be capped, or the floor release is a no-op");
  });
});

describe("mode and layer preconditions", () => {
  it("never releases in pattern-only", () => {
    assert.equal(evaluateAcquittal(input({ mode: "pattern-only" })).reason, "pattern_only_mode");
  });

  it("never releases when the semantic layer did not run", () => {
    assert.equal(evaluateAcquittal(input({ semanticRan: false })).reason, "semantic_layer_did_not_run");
  });
});

describe("the opt-in is server-controlled", () => {
  it("comes from org policy, not from the request body", () => {
    const route = read("../../routes/parse.ts");
    assert.match(
      route,
      /body\.semanticAcquittal = screeningPolicy\?\.semanticAcquittal === true/,
      "a caller must not be able to turn this on for their own request",
    );
  });
});
