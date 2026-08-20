import { test } from "node:test";
import assert from "node:assert/strict";
import { OUTPUT_PRECISION, INPUT_PRECISION_OPS, INPUT_PRECISION_FINCRIME } from "./precision-facts.js";

test("output precision facts cite run 20 and carry n", () => {
  assert.equal(OUTPUT_PRECISION.harmlessRefused, 0);
  assert.equal(OUTPUT_PRECISION.harmlessTotal, 16);
  assert.match(OUTPUT_PRECISION.source, /run 20|run20/);
  assert.match(OUTPUT_PRECISION.surface, /screen-output/);
});

test("input precision facts state their provenance and carry n", () => {
  assert.equal(INPUT_PRECISION_OPS.harmlessRefusedAfter, 0);
  assert.equal(INPUT_PRECISION_OPS.harmlessRefusedBefore, 3);
  assert.equal(INPUT_PRECISION_OPS.harmlessTotal, 17);
  // The corpus informed the fix, so the figure is a delta. Saying so is the
  // difference between evidence and a memorised score.
  assert.equal(INPUT_PRECISION_OPS.corpusBurnt, true);
  assert.match(INPUT_PRECISION_OPS.surface, /v1\/parse/);
});

test("run-22 financial-crime precision facts carry n and name the surface", () => {
  assert.equal(INPUT_PRECISION_FINCRIME.harmlessRefusedPatternOnly, 0);
  assert.equal(INPUT_PRECISION_FINCRIME.harmlessRefusedFullBefore, 4);
  assert.equal(INPUT_PRECISION_FINCRIME.harmlessTotal, 19);
  assert.equal(INPUT_PRECISION_FINCRIME.corpusInformedFix, true);
  assert.match(INPUT_PRECISION_FINCRIME.surface, /v1\/parse/);
  assert.match(INPUT_PRECISION_FINCRIME.corpus, /run 22/);
});
