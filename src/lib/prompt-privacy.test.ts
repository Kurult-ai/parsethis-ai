import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { redactPrompt, redactEvaluationAfterCompletion } from "./prompt-privacy.js";

describe("redactPrompt", () => {
  it("truncates long prompts to 100 chars and appends SHA-256 hash", () => {
    const longPrompt = "A".repeat(250);
    const redacted = redactPrompt(longPrompt);

    // Should start with first 100 chars + "..."
    assert.ok(redacted.startsWith("A".repeat(100) + "..."), "Should start with 100 chars + ...");

    // Should contain the hash tag
    const expectedHash = createHash("sha256").update(longPrompt).digest("hex");
    assert.ok(
      redacted.includes(`[hash:sha256:${expectedHash}]`),
      "Should contain the SHA-256 hash tag"
    );

    // The full raw prompt should NOT appear after the truncation marker
    assert.ok(
      !redacted.slice(103).includes("A".repeat(101)),
      "No raw prompt content beyond the first 100 chars"
    );
  });

  it("handles short prompts (shorter than 100 chars) without truncation", () => {
    const shortPrompt = "Hello world";
    const redacted = redactPrompt(shortPrompt);

    // Short prompts: no "..." since slice(0,100) returns the whole thing
    assert.ok(!redacted.includes("..."), "Short prompt should not have truncation marker");

    // But should still have the hash
    const expectedHash = createHash("sha256").update(shortPrompt).digest("hex");
    assert.ok(
      redacted.includes(`[hash:sha256:${expectedHash}]`),
      "Should contain hash even for short prompts"
    );
  });

  it("handles empty string", () => {
    const redacted = redactPrompt("");
    const expectedHash = createHash("sha256").update("").digest("hex");
    assert.ok(
      redacted.includes(`[hash:sha256:${expectedHash}]`),
      "Empty string should still produce a hash"
    );
  });

  it("produces deterministic output for the same input", () => {
    const prompt = "My secret API key is sk-abc123";
    const r1 = redactPrompt(prompt);
    const r2 = redactPrompt(prompt);
    assert.equal(r1, r2, "Same input should produce identical output");
  });

  it("produces different hashes for different inputs", () => {
    const r1 = redactPrompt("prompt one");
    const r2 = redactPrompt("prompt two");
    assert.notEqual(r1, r2, "Different inputs should produce different outputs");
  });

  it("handles prompts with special characters and newlines", () => {
    const prompt = "Line 1\nLine 2\tTabbed \"quoted\" {json}";
    const redacted = redactPrompt(prompt);
    const expectedHash = createHash("sha256").update(prompt).digest("hex");
    assert.ok(
      redacted.includes(`[hash:sha256:${expectedHash}]`),
      "Should hash special-character prompts correctly"
    );
  });

  it("does not leak the full prompt when prompt is exactly 101 chars", () => {
    const prompt = "B".repeat(101);
    const redacted = redactPrompt(prompt);
    // The 101st char should not appear in the output (only first 100 + ...)
    assert.ok(redacted.startsWith("B".repeat(100) + "..."), "Boundary at 101 chars should truncate");
  });
});

describe("redactEvaluationAfterCompletion", () => {
  it("calls prisma.evaluation.update with the redacted prompt", async () => {
    // Sensitive content appears AFTER the 100-char truncation boundary
    const prefix = "A".repeat(100);
    const secret = "SECRET_API_KEY_sk_live_abc123xyz";
    const rawPrompt = prefix + secret + "X".repeat(100);
    const evaluationId = "eval_test123";

    const captured: { where: { id: string }; data: { prompt: string } }[] = [];

    const mockPrisma = {
      evaluation: {
        update: async (args: { where: { id: string }; data: { prompt: string } }) => {
          captured.push(args);
          return {};
        },
        findUnique: async () => ({ prompt: rawPrompt }),
      },
    };

    await redactEvaluationAfterCompletion(mockPrisma as any, evaluationId);

    assert.equal(captured.length, 1, "prisma.evaluation.update should have been called once");
    const updateCall = captured[0]!;
    assert.equal(updateCall.where.id, evaluationId);

    const storedPrompt = updateCall.data.prompt;
    // Content beyond the first 100 chars must be stripped
    assert.ok(
      !storedPrompt.includes(secret),
      "Redacted prompt must not contain sensitive content beyond the prefix"
    );
    // Should start with the truncated prefix
    assert.ok(storedPrompt.startsWith(prefix + "..."), "Should start with first 100 chars + ...");
    assert.ok(storedPrompt.includes("[hash:sha256:"), "Should contain the hash tag");
  });

  it("reads the current prompt before redacting (fetches from DB)", async () => {
    const dbPrompt = "The actual stored prompt that is very long " + "Y".repeat(200);
    const evaluationId = "eval_fetch_test";

    let findUniqueCalled = false;
    let updateCalled = false;

    const mockPrisma = {
      evaluation: {
        findUnique: async () => {
          findUniqueCalled = true;
          return { prompt: dbPrompt };
        },
        update: async () => {
          updateCalled = true;
          return {};
        },
      },
    };

    await redactEvaluationAfterCompletion(mockPrisma as any, evaluationId);

    assert.ok(findUniqueCalled, "Should fetch the evaluation to read the raw prompt");
    assert.ok(updateCalled, "Should update with redacted prompt");
  });

  it("throws when evaluation is not found", async () => {
    const mockPrisma = {
      evaluation: {
        findUnique: async () => null,
        update: async () => ({}),
      },
    };

    await assert.rejects(
      () => redactEvaluationAfterCompletion(mockPrisma as any, "nonexistent"),
      /not found/i,
      "Should throw when evaluation doesn't exist"
    );
  });

  it("does not double-redact an already-redacted prompt", async () => {
    const alreadyRedacted = redactPrompt("Already redacted prompt " + "Z".repeat(200));
    const evaluationId = "eval_already_redacted";

    let updateCalled = false;

    const mockPrisma = {
      evaluation: {
        findUnique: async () => ({ prompt: alreadyRedacted }),
        update: async () => {
          updateCalled = true;
          return {};
        },
      },
    };

    await redactEvaluationAfterCompletion(mockPrisma as any, evaluationId);

    assert.ok(!updateCalled, "Should skip update if prompt is already redacted");
  });
});
