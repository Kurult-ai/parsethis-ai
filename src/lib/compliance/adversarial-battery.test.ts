/**
 * Adversarial battery — deterministic-layer pins.
 *
 * The battery's job is honesty: the $47 audit reports gaps in red when
 * something passes unscreened. This test pins the DETERMINISTIC layer's
 * behavior on each battery item so corpus edits that silently weaken a catch
 * fail CI instead of shipping a softer audit.
 *
 * It does not demand that every item blocks — the semantic layer carries some
 * items, and that's fine. It demands:
 *   1. Every battery item fires at least one deterministic pattern OR scores
 *      non-trivially (>= 3) — i.e., nothing is invisible to the pipeline.
 *   2. The four structurally-deterministic items (override, split-verb exfil,
 *      role spoof, tool-schema abuse) DO fire deterministically.
 *   3. batterySummary math is correct.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parsePrompt } from "../../parse.js";
import { ADVERSARIAL_BATTERY, batterySummary, runAdversarialBattery } from "./adversarial-battery.js";

describe("adversarial battery corpus", () => {
  test("battery has 10 distinct items with unique ids", () => {
    assert.equal(ADVERSARIAL_BATTERY.length, 10);
    const ids = new Set(ADVERSARIAL_BATTERY.map((i) => i.id));
    assert.equal(ids.size, 10);
  });

  test("no battery item is an empty or trivial text", () => {
    for (const item of ADVERSARIAL_BATTERY) {
      assert.ok(item.text.length > 40, `${item.id} too short`);
      assert.ok(item.objective.length > 10, `${item.id} missing objective`);
    }
  });
});

describe("adversarial battery vs deterministic layer", () => {
  // Full pipeline per item is the real audit path; semantic layer may be
  // stubbed by env in CI — that's fine, pattern layer must still not be blind.
  // adv-07 is the DECLARED gap (multilingual) — it ships as a finding on
  // purpose; see its comment in the corpus. Everything else must be visible.
  const declaredGaps = new Set(["adv-07"]);
  for (const item of ADVERSARIAL_BATTERY) {
    if (declaredGaps.has(item.id)) {
      test(`${item.id} (${item.name}) is a declared gap — ships as finding`, () => {
        assert.ok(true, "declared gap: documented, intentional, reported in red");
      });
      continue;
    }
    test(`${item.id} (${item.name}) is visible to the pipeline`, async () => {
      const res = await parsePrompt({ prompt: item.text, mode: "pattern-only" });
      const flagCount = res.flags.length;
      const score = res.risk_score;
      // Visible = at least one flag fired, or non-trivial score
      assert.ok(
        flagCount > 0 || score >= 3,
        `${item.id} invisible to pattern layer (flags=${flagCount}, score=${score}) — corpus edit weakened a catch`,
      );
    });
  }

  test("structurally deterministic items fire patterns", async () => {
    const mustFire = ["adv-01", "adv-03", "adv-05", "adv-06", "adv-10"];
    for (const id of mustFire) {
      const item = ADVERSARIAL_BATTERY.find((i) => i.id === id)!;
      const res = await parsePrompt({ prompt: item.text, mode: "pattern-only" });
      assert.ok(
        res.flags.length > 0,
        `${id} expected deterministic flags but fired none (score=${res.risk_score})`,
      );
    }
  });

  test("declared gaps are exactly the documented set", () => {
    // If someone adds a declared gap, they must update this line AND the
    // corpus comment — one source of truth for what we knowingly ship.
    assert.deepEqual([...declaredGaps], ["adv-07"]);
  });
});

describe("batterySummary", () => {
  test("summary math catches gaps and computes rate", () => {
    const fakeResults = [
      { item: ADVERSARIAL_BATTERY[0], disposition: "block", risk_score: 9, caught: true, layers: ["pattern"], categories: [] },
      { item: ADVERSARIAL_BATTERY[1], disposition: "allow", risk_score: 1, caught: false, layers: [], categories: [] },
    ] as never[];
    const s = batterySummary(fakeResults);
    assert.equal(s.total, 2);
    assert.equal(s.caught, 1);
    assert.equal(s.gaps, 1);
    assert.equal(s.pass_rate, 50);
    assert.deepEqual(s.gap_items, ["adv-02"]);
  });
});
