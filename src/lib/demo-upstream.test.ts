import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDemoUpstreamBody, resolveDemoMode } from "./demo-upstream.js";

describe("resolveDemoMode", () => {
  it("treats omitted mode as full (product default)", () => {
    assert.equal(resolveDemoMode(undefined), "full");
    assert.equal(resolveDemoMode(null), "full");
  });

  it("honours explicit full and pattern-only", () => {
    assert.equal(resolveDemoMode("full"), "full");
    assert.equal(resolveDemoMode("pattern-only"), "pattern-only");
  });

  it("does not silently under-screen on unknown mode values", () => {
    assert.equal(resolveDemoMode("patterns"), "full");
    assert.equal(resolveDemoMode(""), "full");
  });
});

describe("buildDemoUpstreamBody", () => {
  it("sends mode full explicitly on the parse path", () => {
    assert.deepEqual(buildDemoUpstreamBody({ prompt: "hi", mode: "full" }), {
      path: "/v1/parse",
      body: { prompt: "hi", mode: "full" },
    });
  });

  it("sends pattern-only when asked", () => {
    assert.deepEqual(buildDemoUpstreamBody({ prompt: "hi", mode: "pattern-only" }), {
      path: "/v1/parse",
      body: { prompt: "hi", mode: "pattern-only" },
    });
  });

  it("omitted mode runs full on parse and screen-output", () => {
    assert.deepEqual(buildDemoUpstreamBody({ prompt: "hi" }), {
      path: "/v1/parse",
      body: { prompt: "hi", mode: "full" },
    });
    assert.deepEqual(buildDemoUpstreamBody({ prompt: "out", surface: "output" }), {
      path: "/v1/screen-output",
      body: { output: "out", mode: "full" },
    });
  });
});
