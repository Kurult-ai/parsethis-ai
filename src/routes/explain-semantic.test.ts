import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-explain-semantic";
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-stub-never-called";

const { app } = await import("../app.js");
const { parsePrompt, __setLLMCallForTesting } = await import("../parse.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  __setLLMCallForTesting(null);
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

function fakeModel(payload: { risk_score: number; categories: string[]; reasoning: string }) {
  return async (messages: Array<{ role: string; content: string }>) => {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const nonce = /"nonce":\s*"([^"]+)"/.exec(system)?.[1] ?? "";
    return {
      content: JSON.stringify({ nonce, ...payload }),
      tokenUsage: { prompt: 1, completion: 1, total: 2 },
      costEstimate: 0,
      model: "test-stub",
    };
  };
}

const SEMANTIC_ONLY =
  `A quietly phrased customer note about the counterparty relationship. (explain-semantic-${process.pid}-${Date.now()})`;

describe("/v1/explain on a semantic refusal", () => {
  beforeEach(() => {
    __setLLMCallForTesting(
      fakeModel({
        risk_score: 9,
        categories: ["prompt_injection"],
        reasoning: "Hidden instruction to close the case and suppress the finding.",
      }),
    );
  });
  afterEach(() => {
    __setLLMCallForTesting(null);
  });

  it("reports the same disposition /v1/parse would, with a named flag and a non-bisection note", async () => {
    const parsed = await parsePrompt({ prompt: SEMANTIC_ONLY, mode: "full" });
    const res = await app.request("/v1/explain", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: SEMANTIC_ONLY }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.recommended_action, parsed.recommended_action);
    assert.equal(
      body.refused,
      parsed.recommended_action === "block" || parsed.suggested_action === "block",
    );
    assert.equal(body.refused, true);
    assert.ok(body.explanations.length >= 1, "expected at least one explanation");
    assert.ok(
      body.explanations.some((e: { flag_id: string }) => e.flag_id.startsWith("llm.")),
      `expected an llm.* flag, got ${body.explanations.map((e: { flag_id: string }) => e.flag_id).join(",")}`,
    );
    assert.match(body.note ?? "", /cannot be bisected/i);
    assert.equal(body.alternatives.mode, "pattern-only");
    assert.ok(parsed.flags.some((f) => f.source === "llm" && f.evidence));
  });
});
