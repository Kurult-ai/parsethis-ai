import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cacheKey, seedFor, SCREENING_CACHE_TTL_SECONDS } from "./screening-cache.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const base = {
  prompt: "Open the payer portal and read the claim status for member 88213.",
  model: "deepseek/deepseek-chat",
  mode: "full",
  policyMode: "balanced",
};

describe("screening cache key", () => {
  it("is stable for the same request", () => {
    assert.equal(cacheKey(base), cacheKey({ ...base }));
  });

  it("separates prompts", () => {
    assert.notEqual(cacheKey(base), cacheKey({ ...base, prompt: base.prompt + " " }));
  });

  it("separates models, because a different judge is a different verdict", () => {
    assert.notEqual(cacheKey(base), cacheKey({ ...base, model: "other/model" }));
  });

  it("separates modes and policy modes", () => {
    assert.notEqual(cacheKey(base), cacheKey({ ...base, mode: "pattern-only" }));
    assert.notEqual(cacheKey(base), cacheKey({ ...base, policyMode: "strict" }));
  });

  it("is namespaced so it cannot collide with other redis users", () => {
    assert.match(cacheKey(base), /^screening:verdict:[0-9a-f]{32}$/);
  });
});

describe("seed", () => {
  it("is stable per prompt", () => {
    assert.equal(seedFor(base.prompt), seedFor(base.prompt));
  });

  it("differs across prompts", () => {
    assert.notEqual(seedFor("a"), seedFor("b"));
  });

  it("is a non-negative 32-bit-safe integer", () => {
    const s = seedFor(base.prompt);
    assert.ok(Number.isInteger(s) && s >= 0 && s < 2_147_483_647, `got ${s}`);
  });
});

describe("the TTL is long enough to argue with a block", () => {
  it("covers a retry and a redeploy", () => {
    assert.ok(SCREENING_CACHE_TTL_SECONDS >= 10 * 60);
  });
});

/**
 * Run 8's nine identical requests scored 0.3 to 8.8 and blocked once. These pin
 * the three things that together stop that: greedy sampling, a seed, and a
 * corroboration requirement before one model reading can hard-floor a block.
 */
describe("verdict stability", () => {
  it("samples greedily on the screening path", () => {
    const client = read("../model-client.ts");
    // callLLMFull is the screening call. streamLLM is the chat path and keeps
    // its own sampling — variety in a conversation is a feature, variety in a
    // verdict about someone's traffic is not.
    const screeningCall = client.slice(
      client.indexOf("export async function callLLMFull"),
      client.indexOf("export async function callModel"),
    );
    assert.ok(screeningCall.length > 0, "could not isolate callLLMFull");
    assert.match(screeningCall, /temperature: 0,/, "screening must not sample at temperature 0.3");
    assert.match(screeningCall, /top_p: 1,/);
    assert.doesNotMatch(screeningCall, /temperature: 0\.3/);
    assert.match(screeningCall, /determinism\?\.seed/);
  });

  it("passes a per-prompt seed", () => {
    const parse = read("../parse.ts");
    assert.match(parse, /llmCall\(messages, configured, \{ seed: seedFor\(prompt\) \}\)/);
  });

  it("consults and fills the cache around the semantic call", () => {
    const parse = read("../parse.ts");
    assert.match(parse, /getCachedVerdict<LlmRiskResult>\(dims\)/);
    assert.match(parse, /setCachedVerdict\(dims, llmResult\)/);
  });

  it("will not let one model reading hard-floor a block uncorroborated", () => {
    const parse = read("../parse.ts");
    assert.match(
      parse,
      /llmMayFloorBlock = maxPatternSeverity > 0/,
      "corroboration means the deterministic layer also saw something",
    );
    assert.match(
      parse,
      /effectiveLlmSeverity >= 7 && llmMayFloorBlock && !trustedConversation/,
      "the block floor must require corroboration",
    );
  });

  it("still lets the combined score block on its own", () => {
    // The point is not that the LLM cannot cause a block — it is that one
    // sample cannot *floor* one. riskScore >= 7 remains a blocking condition.
    const parse = read("../parse.ts");
    assert.match(parse, /riskScore >= 7 \|\| flags\.some\(\(flag\) => flag\.action_floor === "block"\)/);
  });

  it("tells the caller the verdict is reproducible", () => {
    const parse = read("../parse.ts");
    assert.match(parse, /semantic_verdict: llmVerdictCached \? "cached" : "computed"/);
    assert.match(parse, /reproducible_until/);
  });
});
