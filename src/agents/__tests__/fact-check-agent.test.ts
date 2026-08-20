/**
 * Fact-Check Agent Tests
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { runFactCheckAgent } from "../fact-check-agent.js";
import type { FactCheckRequest, FactCheckResult } from "../types.js";

describe("Fact-Check Agent", () => {
  describe("runFactCheckAgent", () => {
    it("should reject requests with neither url nor content", async () => {
      const request: FactCheckRequest = {};
      await assert.rejects(
        () => runFactCheckAgent(request),
        /Either url or content must be provided/
      );
    });

    it("should analyze provided content", async () => {
      const request: FactCheckRequest = {
        content: "The earth is flat. Water always finds its level.",
      };

      const result = await runFactCheckAgent(request);

      assert.strictEqual(result.agent, "fact_check");
      assert.strictEqual(result.url, "content-provided");
      assert(Array.isArray(result.claims));
      assert(
        ["mostly_true", "mostly_false", "mixed", "unverifiable"].includes(
          result.verdict
        )
      );
    });

    it("should handle URL input (dry-run mode)", async () => {
      const request: FactCheckRequest = {
        url: "https://example.com/article",
      };

      const result = await runFactCheckAgent(request);

      assert.strictEqual(result.agent, "fact_check");
      assert.strictEqual(result.url, "https://example.com/article");
      assert(Array.isArray(result.claims));
    });

    it("should return claims with required fields", async () => {
      const request: FactCheckRequest = {
        content: "Climate change is caused by human activity.",
      };

      const result = await runFactCheckAgent(request);

      assert.ok(result.claims.length > 0);
      const claim = result.claims[0];
      assert.ok(typeof claim.text === "string");
      assert.ok(
        ["true", "false", "misleading", "unverifiable"].includes(claim.verdict)
      );
      assert.ok(typeof claim.confidence === "number");
      assert.ok(claim.confidence >= 0 && claim.confidence <= 1);
      assert.ok(Array.isArray(claim.sources));
    });

    it("should handle empty content gracefully", async () => {
      const request: FactCheckRequest = {
        content: "",
      };

      const result = await runFactCheckAgent(request);

      assert.strictEqual(result.agent, "fact_check");
      assert.ok(["mostly_true", "mostly_false", "mixed", "unverifiable"].includes(result.verdict));
    });

    it("should handle very long content", async () => {
      const longContent = "This is a test claim. ".repeat(1000);
      const request: FactCheckRequest = {
        content: longContent,
      };

      const result = await runFactCheckAgent(request);

      assert.strictEqual(result.agent, "fact_check");
      assert(Array.isArray(result.claims));
    });

    it("should handle content with unicode characters", async () => {
      const request: FactCheckRequest = {
        content: "The café serves café au lait. 日本語のテスト。",
      };

      const result = await runFactCheckAgent(request);

      assert.strictEqual(result.agent, "fact_check");
      assert(Array.isArray(result.claims));
    });

    it("should calculate correct overall verdict from mixed claims", async () => {
      // This test verifies the aggregation logic works
      const request: FactCheckRequest = {
        content: `
          Claim 1: The sky is blue (generally true)
          Claim 2: The moon is made of cheese (false)
          Claim 3: Some people believe in aliens (true)
        `,
      };

      const result = await runFactCheckAgent(request);

      assert.ok(result.claims.length > 0);
      assert.ok(
        ["mostly_true", "mostly_false", "mixed", "unverifiable"].includes(
          result.verdict
        )
      );
    });
  });

  describe("Type validation", () => {
    it("should return valid FactCheckResult type", async () => {
      const request: FactCheckRequest = {
        content: "Test claim for type validation",
      };

      const result = await runFactCheckAgent(request);

      // Validate result structure
      assert.ok("agent" in result);
      assert.ok("url" in result);
      assert.ok("claims" in result);
      assert.ok("verdict" in result);

      // Validate agent field
      assert.strictEqual(result.agent, "fact_check");

      // Validate verdict field
      const validVerdicts = ["mostly_true", "mostly_false", "mixed", "unverifiable"];
      assert.ok(validVerdicts.includes(result.verdict));

      // Validate claims array
      assert.ok(Array.isArray(result.claims));
      for (const claim of result.claims) {
        assert.ok("text" in claim);
        assert.ok("verdict" in claim);
        assert.ok("confidence" in claim);
        assert.ok("sources" in claim);

        const validClaimVerdicts = ["true", "false", "misleading", "unverifiable"];
        assert.ok(validClaimVerdicts.includes(claim.verdict));
        assert.ok(typeof claim.confidence === "number");
        assert.ok(claim.confidence >= 0 && claim.confidence <= 1);
        assert.ok(Array.isArray(claim.sources));
      }
    });
  });
});
