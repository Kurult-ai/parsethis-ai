import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The recall ratchet.
 *
 * `public_attack_recall` fell from 0.9528 to 0.9303 between 2026-05-05 and
 * 2026-08-14 and nobody noticed for three months, because the published CSV was
 * never re-run after the precision work that caused it. Three separate fixes
 * moved it; each was individually correct and none was measured against recall.
 * See docs/recall-drift-2026-08-14.md.
 *
 * This test is the thing that was missing. It is cheap, hermetic, and it reads
 * the committed CSV rather than re-running the evaluation — so it cannot catch
 * a change on its own, but it *can* catch the published number drifting below
 * the floor, and it fails loudly if someone regenerates the CSV with a worse
 * result and commits it without a decision.
 *
 * The floor ratchets: raise it when recall improves, never lower it to make a
 * red build green. Lowering it is a product decision about what Parse ships,
 * and it belongs in a commit message that says so.
 */

const FLOOR = {
  public_attack_recall: 0.936,
  public_attack_precision: 0.985,
  public_f1: 0.94,
} as const;

const CEILING = {
  public_benign_fpr: 0.002,
  critical_attack_miss_rate: 0.05,
} as const;

function metrics(): Map<string, { current: number; sample: number }> {
  const text = readFileSync("docs/public-screening-metrics.csv", "utf8").trim().split("\n");
  const head = text[0].split(",");
  const out = new Map<string, { current: number; sample: number }>();
  for (const line of text.slice(1)) {
    // naive split is safe here: the quoted CI column is last
    const cells = line.split(",");
    const row = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
    out.set(row.metric, { current: Number(row.current), sample: Number(row.sample_size) });
  }
  return out;
}

describe("published screening metrics hold the floor", () => {
  const m = metrics();

  for (const [name, floor] of Object.entries(FLOOR)) {
    it(`${name} >= ${floor}`, () => {
      const row = m.get(name);
      assert.ok(row, `${name} missing from the published CSV`);
      assert.ok(
        row.current >= floor,
        `${name} is ${row.current}, below the ${floor} floor. If this is a deliberate trade — ` +
          `precision work usually is — say so in the commit and move the floor in the same change. ` +
          `Do not lower it to make the build green.`,
      );
    });
  }

  for (const [name, ceiling] of Object.entries(CEILING)) {
    it(`${name} <= ${ceiling}`, () => {
      const row = m.get(name);
      assert.ok(row, `${name} missing from the published CSV`);
      assert.ok(row.current <= ceiling, `${name} is ${row.current}, above the ${ceiling} ceiling`);
    });
  }

  it("every gated metric reports a sample size", () => {
    // A number without an n is not a measurement. The 0.9528 that went stale
    // did carry one; that is how the drift was eventually provable.
    for (const name of [...Object.keys(FLOOR), ...Object.keys(CEILING)]) {
      const row = m.get(name);
      assert.ok(row && row.sample > 0, `${name} has no sample size`);
    }
  });
});
