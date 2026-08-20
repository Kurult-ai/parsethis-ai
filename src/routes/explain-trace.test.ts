import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-explain-trace";

const { app } = await import("../app.js");
const { __setExplainEventLoaderForTesting } = await import("./explain.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  __setExplainEventLoaderForTesting(null);
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

describe("POST /v1/explain accepts trace_id", () => {
  it("returns 200 for a stored screening the digest can point at", async () => {
    __setExplainEventLoaderForTesting(async (traceId) => {
      if (traceId !== "trc-run22-c3") return null;
      return {
        requestId: "trc-run22-c3",
        blocked: true,
        disposition: "block",
        categories: ["prompt_injection"],
        ruleIds: ["intent.spoof_instruction_hierarchy"],
        riskScore: 9.1,
        verdict: "critical",
      };
    });

    const res = await app.request("/v1/explain", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ trace_id: "trc-run22-c3" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.refused, true);
    assert.ok(Array.isArray(body.explanations) && body.explanations.length > 0);
    assert.equal(body.trace_id, "trc-run22-c3");
  });
});
