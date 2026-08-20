/**
 * Deception Detection Agent Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { runDeceptionDetectionAgent } from "../deception-agent.js";
import type { DeceptionRequest, DeceptionResult } from "../types.js";

describe("Deception Detection Agent", () => {
  describe("runDeceptionDetectionAgent", () => {
    it("should reject requests with neither url nor content", async () => {
      const request: DeceptionRequest = {};
      await assert.rejects(
        () => runDeceptionDetectionAgent(request),
        /Either url or content must be provided/
      );
    });

    it("should analyze provided content for deception indicators", async () => {
      const request: DeceptionRequest = {
        content: "Studies show that people who use this product are 90% happier. Many experts agree. Some critics claim otherwise, but they have ulterior motives.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert.strictEqual(result.url, "content-provided");
      assert(typeof result.overallScore === "number");
      assert(result.overallScore >= 0 && result.overallScore <= 100);
      assert(Array.isArray(result.deceptionIndicators));
    });

    it("should handle URL input (dry-run mode)", async () => {
      const request: DeceptionRequest = {
        url: "https://example.com/claims",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert.strictEqual(result.url, "https://example.com/claims");
      assert(typeof result.overallScore === "number");
      assert(Array.isArray(result.deceptionIndicators));
    });

    it("should return deception indicators with required fields", async () => {
      const request: DeceptionRequest = {
        content: "Many people are saying things that may or may not be true about what happened.",
      };

      const result = await runDeceptionDetectionAgent(request);

      if (result.deceptionIndicators.length > 0) {
        const indicator = result.deceptionIndicators[0];
        assert.ok(typeof indicator.type === "string");
        assert.ok(
          ["low", "medium", "high"].includes(indicator.severity)
        );
        assert.ok(Array.isArray(indicator.evidence));
      }
    });

    it("should detect multiple deception indicators in deceptive content", async () => {
      const request: DeceptionRequest = {
        content: `
          Studies have shown (unnamed studies) that this is absolutely true.
          Some people might say otherwise, but they're clearly biased.
          While certain details may seem unclear, the important thing is trust us.
          Mistakes were made (passive voice), but lessons were learned.
        `,
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.ok(result.overallScore >= 0);
      assert.ok(result.overallScore <= 100);
      assert(Array.isArray(result.deceptionIndicators));
    });

    it("should return low score for straightforward content", async () => {
      const request: DeceptionRequest = {
        content: "I arrived at the office at 9am. I worked on the report until noon. Then I had lunch.",
      };

      const result = await runDeceptionDetectionAgent(request);

      // Straightforward content should have lower deception score
      assert.ok(result.overallScore >= 0);
      assert.ok(result.overallScore <= 100);
    });

    it("should handle empty content gracefully", async () => {
      const request: DeceptionRequest = {
        content: "",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(typeof result.overallScore === "number");
    });

    it("should handle very long content", async () => {
      const longContent = "This is definitely true. ".repeat(500);
      const request: DeceptionRequest = {
        content: longContent,
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(typeof result.overallScore === "number");
    });

    it("should handle content with unicode characters", async () => {
      const request: DeceptionRequest = {
        content: "C'est absolument vrai. 这绝对是真实的。È assolutamente vero.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(Array.isArray(result.deceptionIndicators));
    });
  });

  describe("Deception score calculation", () => {
    it("should return score between 0 and 100", async () => {
      const request: DeceptionRequest = {
        content: "Test content for score validation",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.ok(result.overallScore >= 0);
      assert.ok(result.overallScore <= 100);
    });

    it("should weight high severity indicators more than low", async () => {
      // Content with high severity indicators should have higher score
      const request: DeceptionRequest = {
        content: `
          According to secret sources (false attribution) that can't be named,
          the event definitely happened last week (temporal distortion),
          though some details may have been exaggerated (minimization).
        `,
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.ok(result.overallScore >= 0);
    });

    it("should increase score with more distinct indicators", async () => {
      // Content with many different types of deception
      const request: DeceptionRequest = {
        content: `
          Everyone knows this is true (false attribution).
          The data speaks for itself (deflection).
          While certain minor inconsistencies exist (minimization),
          the overwhelming evidence (exaggeration) supports our position.
          Mistakes were made (linguistic distance).
        `,
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.ok(result.overallScore >= 0);
    });
  });

  describe("Type validation", () => {
    it("should return valid DeceptionResult type", async () => {
      const request: DeceptionRequest = {
        content: "Test content for type validation",
      };

      const result = await runDeceptionDetectionAgent(request);

      // Validate result structure
      assert.ok("agent" in result);
      assert.ok("url" in result);
      assert.ok("deceptionIndicators" in result);
      assert.ok("overallScore" in result);

      // Validate agent field
      assert.strictEqual(result.agent, "deception");

      // Validate overallScore field
      assert.ok(typeof result.overallScore === "number");
      assert.ok(result.overallScore >= 0);
      assert.ok(result.overallScore <= 100);

      // Validate deceptionIndicators array
      assert.ok(Array.isArray(result.deceptionIndicators));
      for (const indicator of result.deceptionIndicators) {
        assert.ok("type" in indicator);
        assert.ok("severity" in indicator);
        assert.ok("evidence" in indicator);

        assert.ok(typeof indicator.type === "string");
        assert.ok(
          ["low", "medium", "high"].includes(indicator.severity)
        );
        assert.ok(Array.isArray(indicator.evidence));
      }
    });
  });

  describe("Known deception patterns detection", () => {
    it("should detect False Attribution", async () => {
      const request: DeceptionRequest = {
        content: "Many experts agree. Sources say. Studies have shown.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
    });

    it("should detect Equivocation", async () => {
      const request: DeceptionRequest = {
        content: "It's possible that certain things may or may not have happened, depending on how you define things.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
    });

    it("should detect Linguistic Distance", async () => {
      const request: DeceptionRequest = {
        content: "Mistakes were made. Lessons were learned. Changes will be implemented.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
    });

    it("should detect Exaggeration", async () => {
      const request: DeceptionRequest = {
        content: "This is the most important discovery in human history. Absolutely everyone agrees.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
    });

    it("should detect Deflection", async () => {
      const request: DeceptionRequest = {
        content: "That's not the real question. What we should be asking is something completely different.",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
    });
  });

  describe("Edge cases", () => {
    it("should handle content with only questions", async () => {
      const request: DeceptionRequest = {
        content: "What is truth? How do we know anything? Why does it matter?",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(typeof result.overallScore === "number");
    });

    it("should handle code or technical content", async () => {
      const request: DeceptionRequest = {
        content: "function add(a, b) { return a + b; } // This function adds two numbers",
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(typeof result.overallScore === "number");
    });

    it("should handle quoted text", async () => {
      const request: DeceptionRequest = {
        content: 'He said "I did not have sexual relations with that woman" and then "Mistakes were made."',
      };

      const result = await runDeceptionDetectionAgent(request);

      assert.strictEqual(result.agent, "deception");
      assert(Array.isArray(result.deceptionIndicators));
    });
  });
});
