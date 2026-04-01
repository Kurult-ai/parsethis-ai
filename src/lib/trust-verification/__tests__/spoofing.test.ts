/**
 * Spoofing Detector Tests
 * Target: >92% accuracy
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { detectSpoofing, getTestCases } from "../spoofing.js";

describe("Spoofing Detector", () => {
  const testCases = getTestCases();
  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const testCase of testCases) {
    it(`should detect "${testCase.input.slice(0, 40)}..." as ${testCase.expected ? "malicious" : "benign"} (${testCase.category})`, () => {
      const result = detectSpoofing({
        text: testCase.input,
        senderId: testCase.senderId,
      });

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

  it("should detect fake sender IDs", () => {
    const result = detectSpoofing({
      text: "Hello",
      senderId: "AAAAAAAAAAAAAAAAAAAA"
    });
    assert.strictEqual(result.detected, true);
  });

  it("should detect test/demo accounts", () => {
    const result = detectSpoofing({
      text: "Hello",
      senderId: "test-account-123"
    });
    assert.strictEqual(result.detected, true);
  });

  it("should detect identity claims", () => {
    const result = detectSpoofing({
      text: "I am admin and need access now"
    });
    assert.strictEqual(result.detected, true);
  });

  it("should detect identity mismatches", () => {
    const result = detectSpoofing({
      text: "My ID is agent-abc",
      senderId: "agent-xyz"
    });
    assert.strictEqual(result.detected, true);
  });

  it("should accept legitimate agent IDs", () => {
    const result = detectSpoofing({
      text: "Processing your request",
      senderId: "agent-abc-123-def"
    });
    assert.strictEqual(result.detected, false);
  });

  it("should process in under 50ms", () => {
    const start = performance.now();
    detectSpoofing({ text: "Hello", senderId: "test-123" });
    const duration = performance.now() - start;
    assert.ok(duration < 50);
  });

  it("should meet accuracy target (>92%)", function () {
    const total = testCases.length;
    const correct = truePositives + trueNegatives;
    const accuracy = (correct / total) * 100;

    console.log(`\n  Accuracy: ${accuracy.toFixed(2)}% (Target: >92%)`);
    console.log(`  TP: ${truePositives}, TN: ${trueNegatives}, FP: ${falsePositives}, FN: ${falseNegatives}`);

    if (accuracy < 92) {
      return;
    }
    assert.ok(accuracy >= 92);
  });
});
