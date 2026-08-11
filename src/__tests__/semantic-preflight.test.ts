import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";

const {
  runSemanticPreflight,
  getSemanticPreflight,
  __setSemanticPreflightProbeForTesting,
  __resetSemanticPreflightForTesting,
} = await import("../lib/semantic-preflight.js");

/**
 * The semantic layer has twice been silently dead in production while every
 * response still looked complete. These pin the contract that makes that
 * loud at boot instead of discovered by a customer.
 */
describe("semantic layer boot preflight", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.OPENROUTER_API_KEY;
    __resetSemanticPreflightForTesting();
  });

  afterEach(() => {
    __setSemanticPreflightProbeForTesting(null);
    __resetSemanticPreflightForTesting();
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("reports not_configured when no key is set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await runSemanticPreflight();
    assert.equal(result.status, "not_configured");
    assert.equal(getSemanticPreflight().status, "not_configured");
  });

  it("reports ok when the provider accepts the key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    __setSemanticPreflightProbeForTesting(async () => ({ ok: true, status: 200 }));
    const result = await runSemanticPreflight();
    assert.equal(result.status, "ok");
    assert.ok(result.checkedAt, "should record when it checked");
  });

  it("reports rejected — not merely unreachable — on a 401", async () => {
    // This is the placeholder-key case that hid twice. It must be
    // distinguishable from a provider hiccup, because the response differs:
    // one needs a new key, the other needs patience.
    process.env.OPENROUTER_API_KEY = "sk-or-.....";
    __setSemanticPreflightProbeForTesting(async () => ({ ok: false, status: 401 }));
    const result = await runSemanticPreflight();
    assert.equal(result.status, "rejected");
    assert.match(result.detail, /rejected/i);
  });

  it("treats a 403 as a credential problem too", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    __setSemanticPreflightProbeForTesting(async () => ({ ok: false, status: 403 }));
    assert.equal((await runSemanticPreflight()).status, "rejected");
  });

  it("reports unreachable — not rejected — on a provider 5xx", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    __setSemanticPreflightProbeForTesting(async () => ({ ok: false, status: 503 }));
    const result = await runSemanticPreflight();
    assert.equal(result.status, "unreachable");
  });

  it("never throws when the probe itself blows up", async () => {
    // The whole point is that a bad model provider costs us the semantic
    // layer, never the process. index.ts calls this with a bare `void`.
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    __setSemanticPreflightProbeForTesting(async () => {
      throw new Error("connect ECONNREFUSED");
    });
    const result = await runSemanticPreflight();
    assert.equal(result.status, "unreachable");
    assert.match(result.detail, /ECONNREFUSED/);
  });

  it("never leaks the key into the public detail string", async () => {
    const secret = "sk-or-v1-super-secret-value-do-not-log";
    process.env.OPENROUTER_API_KEY = secret;
    __setSemanticPreflightProbeForTesting(async () => ({ ok: false, status: 401 }));
    const result = await runSemanticPreflight();
    assert.ok(!result.detail.includes(secret), "detail is surfaced on /health and must never contain the key");
  });
});
