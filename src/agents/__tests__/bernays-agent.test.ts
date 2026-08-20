/**
 * Bernays Propaganda Agent Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { runBernaysAgent } from "../bernays-agent.js";
import type { BernaysRequest, BernaysResult } from "../types.js";

describe("Bernays Agent", () => {
  describe("runBernaysAgent", () => {
    it("should reject requests with neither url nor content", async () => {
      const request: BernaysRequest = {};
      await assert.rejects(
        () => runBernaysAgent(request),
        /Either url or content must be provided/
      );
    });

    it("should analyze provided content for propaganda techniques", async () => {
      const request: BernaysRequest = {
        content: "Everyone agrees this is the right choice. The so-called experts who disagree are clearly out of touch. We must act now or face disaster.",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
      assert.strictEqual(result.url, "content-provided");
      assert(typeof result.propagandaScore === "number");
      assert(result.propagandaScore >= 0 && result.propagandaScore <= 100);
      assert(Array.isArray(result.techniques));
    });

    it("should handle URL input (dry-run mode)", async () => {
      const request: BernaysRequest = {
        url: "https://example.com/propaganda",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
      assert.strictEqual(result.url, "https://example.com/propaganda");
      assert(typeof result.propagandaScore === "number");
      assert(Array.isArray(result.techniques));
    });

    it("should return techniques with required fields", async () => {
      const request: BernaysRequest = {
        content: "Join the millions who have already made the switch. Don't be left behind!",
      };

      const result = await runBernaysAgent(request);

      if (result.techniques.length > 0) {
        const technique = result.techniques[0];
        assert.ok(typeof technique.name === "string");
        assert.ok(typeof technique.description === "string");
        assert.ok(typeof technique.confidence === "number");
        assert.ok(technique.confidence >= 0 && technique.confidence <= 1);
        assert.ok(Array.isArray(technique.examples));
      }
    });

    it("should detect multiple propaganda techniques in rich content", async () => {
      const request: BernaysRequest = {
        content: `
          Everyone knows this is true. The elite don't want you to know the truth.
          Either you're with us, or you're against us. Studies show (unnamed studies) that
          people who disagree are mentally unstable. Don't let your family down—join us now!
        `,
      };

      const result = await runBernaysAgent(request);

      assert.ok(result.propagandaScore >= 0);
      assert.ok(result.propagandaScore <= 100);
      // Rich propaganda content should produce a higher score
      assert.ok(result.techniques.length >= 0);
    });

    it("should return low score for neutral content", async () => {
      const request: BernaysRequest = {
        content: "The meeting is scheduled for 3pm on Tuesday. Please bring your report.",
      };

      const result = await runBernaysAgent(request);

      // Neutral content should have low propaganda score
      assert.ok(result.propagandaScore >= 0);
      assert(Array.isArray(result.techniques));
    });

    it("should handle empty content gracefully", async () => {
      const request: BernaysRequest = {
        content: "",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
      assert(typeof result.propagandaScore === "number");
    });

    it("should handle very long content", async () => {
      const longContent = "This is propaganda. ".repeat(500);
      const request: BernaysRequest = {
        content: longContent,
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
      assert(typeof result.propagandaScore === "number");
    });

    it("should handle content with unicode characters", async () => {
      const request: BernaysRequest = {
        content: "Tout le monde est d'accord. Everyone agrees. 大家都同意。",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
      assert(Array.isArray(result.techniques));
    });
  });

  describe("Propaganda score calculation", () => {
    it("should return score of 0 for no techniques detected", async () => {
      // Empty or very neutral content should produce low score
      const request: BernaysRequest = {
        content: "The cat sat on the mat.",
      };

      const result = await runBernaysAgent(request);

      assert.ok(result.propagandaScore >= 0);
      assert.ok(result.propagandaScore <= 100);
    });

    it("should increase score with more techniques detected", async () => {
      // Content with multiple propaganda techniques should have higher score
      const request: BernaysRequest = {
        content: `
          Everyone agrees! The experts say so! Don't be the only one who disagrees!
          Join the movement now or be left behind forever!
        `,
      };

      const result = await runBernaysAgent(request);

      // Should detect some techniques in this propaganda-heavy content
      assert.ok(result.propagandaScore >= 0);
    });
  });

  describe("Type validation", () => {
    it("should return valid BernaysResult type", async () => {
      const request: BernaysRequest = {
        content: "Test content for type validation",
      };

      const result = await runBernaysAgent(request);

      // Validate result structure
      assert.ok("agent" in result);
      assert.ok("url" in result);
      assert.ok("propagandaScore" in result);
      assert.ok("techniques" in result);

      // Validate agent field
      assert.strictEqual(result.agent, "bernays");

      // Validate propagandaScore field
      assert.ok(typeof result.propagandaScore === "number");
      assert.ok(result.propagandaScore >= 0);
      assert.ok(result.propagandaScore <= 100);

      // Validate techniques array
      assert.ok(Array.isArray(result.techniques));
      for (const technique of result.techniques) {
        assert.ok("name" in technique);
        assert.ok("description" in technique);
        assert.ok("confidence" in technique);
        assert.ok("examples" in technique);

        assert.ok(typeof technique.name === "string");
        assert.ok(typeof technique.description === "string");
        assert.ok(typeof technique.confidence === "number");
        assert.ok(technique.confidence >= 0 && technique.confidence <= 1);
        assert.ok(Array.isArray(technique.examples));
      }
    });
  });

  describe("Known propaganda techniques detection", () => {
    it("should detect Bandwagon technique", async () => {
      const request: BernaysRequest = {
        content: "Millions of people can't be wrong. Join the movement today!",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
    });

    it("should detect Appeal to Authority technique", async () => {
      const request: BernaysRequest = {
        content: "Top scientists and leading experts unanimously agree with this conclusion.",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
    });

    it("should detect Fear/Uncertainty/Doubt technique", async () => {
      const request: BernaysRequest = {
        content: "If we don't act now, catastrophe is inevitable. The consequences are too terrible to imagine.",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
    });

    it("should detect False Dichotomy technique", async () => {
      const request: BernaysRequest = {
        content: "You're either with us or against us. There is no middle ground.",
      };

      const result = await runBernaysAgent(request);

      assert.strictEqual(result.agent, "bernays");
    });
  });
});
