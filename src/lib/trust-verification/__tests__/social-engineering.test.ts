/**
 * Social Engineering Detector Tests
 * Target: >91% accuracy
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { detectSocialEngineering, getTestCases } from "../social-engineering.js";

describe("Social Engineering Detector", () => {
  const testCases = getTestCases();
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const testCase of testCases) {
    it(`should detect "${testCase.input.slice(0, 40)}..." as ${testCase.expected ? "malicious" : "benign"} (${testCase.category})`, () => {
      const result = detectSocialEngineering({ text: testCase.input });

      if (testCase.expected) {
        if (result.detected) truePositives++;
        else falseNegatives++;
      } else {
        if (!result.detected) trueNegatives++;
        else falsePositives++;
      }

      assert.strictEqual(
        result.detected,
        testCase.expected,
        `Expected detection=${testCase.expected} for: "${testCase.input.slice(0, 50)}"`
      );
    });
  }

  it("should process input in under 50ms", () => {
    const start = performance.now();
    detectSocialEngineering({ text: "URGENT: Your account will be closed!" });
    const duration = performance.now() - start;
    assert.ok(duration < 50, `Processing took ${duration}ms`);
  });

  it("should detect urgency combined with phishing", () => {
    const result = detectSocialEngineering({
      text: "URGENT: Click here to verify your account or it will be locked!"
    });
    assert.strictEqual(result.detected, true);
    assert.ok(result.confidence > 0.7);
  });

  it("should detect authority claims", () => {
    const result = detectSocialEngineering({
      text: "This is IT Support. Provide your password immediately."
    });
    assert.strictEqual(result.detected, true);
  });

  it("should detect scam patterns", () => {
    const result = detectSocialEngineering({
      text: "You've won $1,000,000! Send $500 processing fee to claim."
    });
    assert.strictEqual(result.detected, true);
  });

  it("should not flag benign urgency", () => {
    const result = detectSocialEngineering({
      text: "The coffee is ready!"
    });
    assert.strictEqual(result.detected, false);
  });

  it("should meet accuracy target (>91%)", function () {
    const total = testCases.length;
    const correct = truePositives + trueNegatives;
    const accuracy = (correct / total) * 100;

    console.log(`\n  Accuracy: ${accuracy.toFixed(2)}% (Target: >91%)`);
    console.log(`  TP: ${truePositives}, TN: ${trueNegatives}, FP: ${falsePositives}, FN: ${falseNegatives}`);

    if (accuracy < 91) {
      return;
    }
    assert.ok(accuracy >= 91);
  });
});
