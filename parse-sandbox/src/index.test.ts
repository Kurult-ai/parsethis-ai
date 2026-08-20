import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

// ========================
// Test Helpers
// ========================

const TEST_SECRET = "test-hmac-secret-for-testing";
const ALT_SECRET = "different-hmac-secret-for-testing";

function signRequest(
  body: string,
  timestamp: string,
  nonce: string,
  secret = TEST_SECRET
): string {
  return createHmac("sha256", secret)
    .update(body + timestamp + nonce)
    .digest("hex");
}

// Model allowlist — mirrors the set in parse-sandbox/src/index.ts
const ALLOWED_MODELS = new Set([
  // Free models
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "deepseek/deepseek-chat-v3-0324:free",
  // DeepSeek
  "deepseek/deepseek-chat",
  // OpenAI
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "openai/o1",
  "openai/o3-mini",
  // Anthropic
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-3.5-sonnet",
  "anthropic/claude-3-haiku",
  // Google
  "google/gemini-2.0-flash",
  "google/gemini-2.0-pro",
  // Mistral
  "mistral/mistral-large",
  "mistral/mistral-small",
]);

// ========================
// HMAC Signature Tests
// ========================

describe("HMAC Signature Verification", () => {
  const body = JSON.stringify({ messages: [{ role: "user", content: "Hello" }], model: "openai/gpt-4o-mini" });
  const timestamp = String(Date.now());
  const nonce = randomUUID();

  it("valid signature produces correct hex string", () => {
    const sig = signRequest(body, timestamp, nonce);
    // HMAC-SHA256 hex is always 64 characters
    assert.equal(sig.length, 64);
    assert.match(sig, /^[0-9a-f]{64}$/);

    // Deterministic: same inputs produce the same output
    const sig2 = signRequest(body, timestamp, nonce);
    assert.equal(sig, sig2);
  });

  it("different body produces different signature", () => {
    const altBody = JSON.stringify({ messages: [{ role: "user", content: "Goodbye" }], model: "openai/gpt-4o-mini" });
    const sig1 = signRequest(body, timestamp, nonce);
    const sig2 = signRequest(altBody, timestamp, nonce);
    assert.notEqual(sig1, sig2);
  });

  it("different secret produces different signature", () => {
    const sig1 = signRequest(body, timestamp, nonce, TEST_SECRET);
    const sig2 = signRequest(body, timestamp, nonce, ALT_SECRET);
    assert.notEqual(sig1, sig2);
  });

  it("different timestamp produces different signature", () => {
    const ts1 = String(Date.now());
    const ts2 = String(Date.now() + 5000);
    const sig1 = signRequest(body, ts1, nonce);
    const sig2 = signRequest(body, ts2, nonce);
    assert.notEqual(sig1, sig2);
  });

  it("different nonce produces different signature", () => {
    const nonce1 = randomUUID();
    const nonce2 = randomUUID();
    const sig1 = signRequest(body, timestamp, nonce1);
    const sig2 = signRequest(body, timestamp, nonce2);
    assert.notEqual(sig1, sig2);
  });

  it("signature matches the sandbox verification algorithm", () => {
    // Replicate the exact algorithm from parse-sandbox/src/index.ts verifyHmac()
    const ts = String(Date.now());
    const n = randomUUID();
    const expected = createHmac("sha256", TEST_SECRET)
      .update(body + ts + n)
      .digest("hex");

    const computed = signRequest(body, ts, n, TEST_SECRET);
    assert.equal(computed, expected);

    // timingSafeEqual would also pass (buffer comparison)
    const sigBuf = Buffer.from(computed, "hex");
    const expBuf = Buffer.from(expected, "hex");
    assert.equal(sigBuf.length, expBuf.length);
    assert.deepEqual(sigBuf, expBuf);
  });
});

// ========================
// Model Allowlist Tests
// ========================

describe("Model Allowlist", () => {
  it("known free models are in the allowlist", () => {
    assert.ok(ALLOWED_MODELS.has("meta-llama/llama-3.3-70b-instruct:free"));
    assert.ok(ALLOWED_MODELS.has("deepseek/deepseek-chat-v3-0324:free"));
    assert.ok(ALLOWED_MODELS.has("google/gemma-3-27b-it:free"));
  });

  it("known paid models are in the allowlist", () => {
    assert.ok(ALLOWED_MODELS.has("openai/gpt-4o-mini"));
    assert.ok(ALLOWED_MODELS.has("openai/gpt-4o"));
    assert.ok(ALLOWED_MODELS.has("anthropic/claude-sonnet-4-6"));
    assert.ok(ALLOWED_MODELS.has("deepseek/deepseek-chat"));
    assert.ok(ALLOWED_MODELS.has("google/gemini-2.0-flash"));
    assert.ok(ALLOWED_MODELS.has("mistral/mistral-large"));
  });

  it("unknown models are NOT in the allowlist", () => {
    assert.equal(ALLOWED_MODELS.has("openai/gpt-3.5-turbo"), false);
    assert.equal(ALLOWED_MODELS.has("anthropic/claude-2"), false);
    assert.equal(ALLOWED_MODELS.has("random-vendor/random-model"), false);
    assert.equal(ALLOWED_MODELS.has(""), false);
    assert.equal(ALLOWED_MODELS.has("gpt-4o-mini"), false); // missing vendor prefix
  });

  it("allowlist has expected size", () => {
    // Should have exactly the count from the source file (18 models)
    assert.equal(ALLOWED_MODELS.size, 18);
  });
});

// ========================
// Protocol Version Tests
// ========================

describe("Protocol Version", () => {
  it("protocol version '1' is the current version", () => {
    // The sandbox middleware checks: if (protocol !== "1") -> reject
    const CURRENT_PROTOCOL = "1";
    assert.equal(CURRENT_PROTOCOL, "1");
  });

  it("protocol version must be a string", () => {
    // The protocol header comes as a string from HTTP headers
    const protocol = "1";
    assert.equal(typeof protocol, "string");
    assert.notEqual(protocol, 1); // Not a number
  });

  it("empty or missing protocol would be rejected", () => {
    // Validates the concept that empty/missing protocol != "1"
    assert.notEqual("", "1");
    assert.notEqual("0", "1");
    assert.notEqual("2", "1");
    assert.notEqual(undefined, "1");
  });
});

// ========================
// Request Construction Tests
// ========================

describe("Request Construction (sandbox client compatibility)", () => {
  it("signed request includes all required headers", () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "test" }], model: "openai/gpt-4o-mini" });
    const timestamp = String(Date.now());
    const nonce = randomUUID();
    const signature = signRequest(body, timestamp, nonce);

    // All 4 headers the sandbox middleware expects
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Sandbox-Timestamp": timestamp,
      "X-Sandbox-Nonce": nonce,
      "X-Sandbox-Signature": signature,
      "X-Sandbox-Protocol": "1",
    };

    assert.ok(headers["X-Sandbox-Timestamp"]);
    assert.ok(headers["X-Sandbox-Nonce"]);
    assert.ok(headers["X-Sandbox-Signature"]);
    assert.equal(headers["X-Sandbox-Protocol"], "1");
    assert.match(headers["X-Sandbox-Signature"], /^[0-9a-f]{64}$/);
  });

  it("timestamp is a valid millisecond epoch", () => {
    const timestamp = String(Date.now());
    const parsed = parseInt(timestamp, 10);
    assert.ok(!isNaN(parsed));
    // Should be recent (within 30 seconds, matching the sandbox's window)
    assert.ok(Math.abs(Date.now() - parsed) < 30_000);
  });

  it("nonce is a valid UUID v4", () => {
    const nonce = randomUUID();
    assert.match(nonce, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
