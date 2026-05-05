import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt, type ParseRequest } from "../parse.js";
import {
  gradeUtilityWorkflow,
  stableUtilityWorkflowManifestHash,
  stableUtilityWorkflowManifestRows,
  UTILITY_WORKFLOW_FIXTURES,
  type UtilityWorkflowFixture,
} from "../lib/utility-workflows.js";

function metadataFor(workflow: UtilityWorkflowFixture): ParseRequest["metadata"] {
  const intendedAction: NonNullable<ParseRequest["metadata"]>["intended_action"] =
    workflow.task === "route_ticket" ? "route" :
    workflow.task === "extract_fields" ? "extract" :
    workflow.task === "summarize_doc" ? "summarize" :
    "reply";

  return {
    source_kind: workflow.source_kind,
    trust_level: workflow.trust_boundary,
    intended_action: intendedAction,
    data_classification: ["business"],
    tool_permissions: [],
  };
}

describe("internal utility workflow benchmark fixtures", () => {
  it("has stable unique manifest rows and a sha256 hash", () => {
    const ids = UTILITY_WORKFLOW_FIXTURES.map((workflow) => workflow.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(UTILITY_WORKFLOW_FIXTURES.length >= 50, true);
    assert.equal(stableUtilityWorkflowManifestRows().length, UTILITY_WORKFLOW_FIXTURES.length);
    assert.match(stableUtilityWorkflowManifestHash(), /^[a-f0-9]{64}$/);
  });

  it("baseline simulated outputs satisfy their task graders", () => {
    const failures = UTILITY_WORKFLOW_FIXTURES
      .map((workflow) => ({ workflow, grade: gradeUtilityWorkflow(workflow) }))
      .filter(({ grade }) => !grade.success)
      .map(({ workflow, grade }) => `${workflow.id}: missing=${grade.missingTerms.join("|")} forbidden=${grade.forbiddenTermsPresent.join("|")}`);

    assert.deepEqual(failures, []);
  });

  it("Parse allows all internal benign utility workflows in pattern-only mode", async () => {
    const failures: string[] = [];

    for (const workflow of UTILITY_WORKFLOW_FIXTURES) {
      const result = await parsePrompt({
        prompt: workflow.prompt,
        mode: "pattern-only",
        metadata: metadataFor(workflow),
      });
      const action = result.recommended_action ?? result.suggested_action;
      if (action !== "allow" || !result.safe || result.attack_detected) {
        failures.push(`${workflow.id}: action=${action} safe=${result.safe} attack=${result.attack_detected} risk=${result.risk_score}`);
      }
    }

    assert.deepEqual(failures, []);
  });
});
