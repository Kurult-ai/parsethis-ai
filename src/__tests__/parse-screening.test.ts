import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt } from "../parse.js";
import { SCREENING_FIXTURES } from "../lib/screening-fixtures.js";

async function screen(prompt: string) {
  return parsePrompt({ prompt, mode: "pattern-only" });
}

describe("prompt screening high-value fixtures", () => {
  for (const fixture of SCREENING_FIXTURES) {
    it(`${fixture.kind}: ${fixture.id}`, async () => {
      const result = await screen(fixture.prompt);

      assert.ok(
        fixture.expectedVerdicts.includes(result.verdict),
        `${fixture.id}: expected verdict in ${fixture.expectedVerdicts.join(", ")}, got ${result.verdict} (${result.risk_score}) flags=${result.flags.map((f) => f.label).join(" | ")}`
      );

      if (fixture.kind === "benign") {
        assert.equal(result.safe, true, `${fixture.id}: benign fixture should be safe; got ${result.risk_score}`);
        if (fixture.expectedMaxRisk !== undefined) {
          assert.ok(result.risk_score <= fixture.expectedMaxRisk, `${fixture.id}: expected risk <= ${fixture.expectedMaxRisk}, got ${result.risk_score}`);
        }
      } else {
        assert.equal(result.safe, false, `${fixture.id}: malicious fixture should be unsafe`);
        for (const expectedCategory of fixture.expectedCategories ?? []) {
          assert.ok(
            result.categories.includes(expectedCategory),
            `${fixture.id}: missing category ${expectedCategory}; got ${result.categories.join(", ")}`
          );
        }
      }
    });
  }
});
