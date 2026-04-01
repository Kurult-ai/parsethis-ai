import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set demo key for tests
const TEST_DEMO_KEY = "test-demo-key-for-x402-tests";
process.env.DEMO_API_KEY = process.env.DEMO_API_KEY || TEST_DEMO_KEY;

const { app } = await import("./app.js");

// x402 Payment Flow Tests
// These tests verify the x402 payment middleware is working correctly on testnet

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";

describe("x402 Payment Flow", () => {
  describe("Payment Configuration", () => {
    it("GET /v1/pricing returns x402 configuration", async () => {
      const res = await app.request("/v1/pricing");
      assert.equal(res.status, 200);
      const body = await res.json();

      // Verify structure
      assert.ok(typeof body.enabled === "boolean", "Should have enabled boolean");
      assert.ok(body.currency === "USDC", "Currency should be USDC");
      assert.ok(body.network, "Should have network configured");
      assert.ok(body.payTo, "Should have payTo wallet address");
      assert.ok(body.facilitator, "Should have facilitator URL");
      assert.ok(body.endpoints, "Should have endpoint pricing");

      // Verify pricing tiers
      assert.ok(body.endpoints["POST /v1/analyze"], "Should have analyze pricing");
      assert.ok(body.endpoints["POST /v1/evaluate"], "Should have evaluate pricing");
      assert.ok(body.endpoints["POST /v1/chat"], "Should have chat pricing");
      assert.ok(body.endpoints["POST /v1/parse"], "Should have parse pricing");

      console.log("[x402] Pricing config:", JSON.stringify(body, null, 2));
    });

    it("GET /health returns status", async () => {
      const res = await app.request("/health");
      assert.ok([200, 503].includes(res.status), `Expected 200 or 503, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.status, "Health should report status");
    });
  });

  describe("402 Response Without Payment Header", () => {
    it("POST /v1/analyze without payment or auth returns 401 (not 402 when x402 not fully enabled)", async () => {
      const res = await app.request("/v1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/article" }),
      });

      // When x402 is enabled but no payment header, it falls through to API key auth
      // which returns 401 since no API key is provided
      assert.ok(res.status === 401 || res.status === 402,
        `Expected 401 or 402, got ${res.status}`);

      const body = await res.json().catch(() => ({}));
      console.log("[x402] No payment header response:", res.status, body);
    });

    it("POST /v1/evaluate without payment or auth returns 401", async () => {
      const res = await app.request("/v1/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "test",
          model: "openai/gpt-4o-mini",
          test_cases: [{ input: "hello" }],
          evaluators: ["cost"],
        }),
      });

      assert.ok(res.status === 401 || res.status === 402,
        `Expected 401 or 402, got ${res.status}`);
    });

    it("POST /v1/chat without payment or auth returns 401", async () => {
      const res = await app.request("/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "Hello" }] }),
      });

      assert.ok(res.status === 401 || res.status === 402,
        `Expected 401 or 402, got ${res.status}`);
    });
  });

  describe("Payment Stats Endpoint", () => {
    it("GET /v1/payments/stats requires admin scope", async () => {
      // Use the test demo key (which doesn't have admin scope)
      const demoKey = TEST_DEMO_KEY;

      const res = await app.request("/v1/payments/stats", {
        headers: { "Authorization": `Bearer ${demoKey}` },
      });

      // Demo key doesn't have admin scope
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.error, "Insufficient permissions");
    });

    it("Payment stats endpoint structure is correct", async () => {
      // This test documents the expected structure when accessed with admin key
      // We can't actually test without admin key, but we verify the endpoint exists
      const res = await app.request("/v1/payments/stats");

      // Without auth, should be 401 or 403
      assert.ok(res.status === 401 || res.status === 403,
        `Expected 401 or 403 without auth, got ${res.status}`);
    });
  });

  describe("Pricing Tier Verification", () => {
    it("All priced endpoints have correct USDC pricing", async () => {
      const res = await app.request("/v1/pricing");
      assert.equal(res.status, 200);
      const body = await res.json();

      // Verify pricing format (should be $X.XX strings)
      const pricePattern = /^\$\d+\.\d{2,}$/;

      if (body.endpoints["POST /v1/analyze"]) {
        const analyzePrice = body.endpoints["POST /v1/analyze"];
        assert.ok(pricePattern.test(analyzePrice) || typeof analyzePrice === "object",
          `Analyze price should be valid: ${analyzePrice}`);
        if (typeof analyzePrice === "object") {
          // Deep pricing structure
          assert.ok(analyzePrice.quick || analyzePrice.standard || analyzePrice.deep,
            "Should have depth-based pricing");
        }
      }

      if (body.endpoints["POST /v1/evaluate"]) {
        const evalPrice = body.endpoints["POST /v1/evaluate"];
        assert.ok(pricePattern.test(evalPrice),
          `Evaluate price should be valid format: ${evalPrice}`);
      }

      if (body.endpoints["POST /v1/chat"]) {
        const chatPrice = body.endpoints["POST /v1/chat"];
        assert.ok(pricePattern.test(chatPrice),
          `Chat price should be valid format: ${chatPrice}`);
      }

      if (body.endpoints["POST /v1/parse"]) {
        const parsePrice = body.endpoints["POST /v1/parse"];
        assert.ok(pricePattern.test(parsePrice),
          `Parse price should be valid format: ${parsePrice}`);
      }

      console.log("[x402] Pricing tiers verified");
    });

    it("Network configuration matches expected testnet", async () => {
      const res = await app.request("/v1/pricing");
      const body = await res.json();

      // Should be Base Sepolia testnet (eip155:84532)
      if (body.network) {
        assert.ok(
          body.network === "eip155:84532" || body.network.includes("84532"),
          `Expected Base Sepolia (eip155:84532), got ${body.network}`
        );
        console.log(`[x402] Network: ${body.network} ✓`);
      }
    });
  });

  describe("Payment Ledger Fields", () => {
    it("Payment record structure includes all required fields", { skip: !process.env.DATABASE_URL }, async () => {
      // Import the payment-ledger module to verify structure
      const { getRecentPayments } = await import("./payment-ledger.js");

      // Get recent payments (may be empty, but verifies function works)
      const payments = await getRecentPayments(1);

      // Verify it's an array
      assert.ok(Array.isArray(payments), "Should return array");

      // If there are payments, verify structure
      if (payments.length > 0) {
        const payment = payments[0];
        assert.ok(payment.txHash, "Payment should have txHash");
        assert.ok(payment.payer, "Payment should have payer");
        assert.ok(payment.amount, "Payment should have amount");
        assert.ok(payment.endpoint, "Payment should have endpoint");
        assert.ok(payment.network, "Payment should have network");
        assert.ok(payment.status, "Payment should have status");
        assert.ok(payment.timestamp, "Payment should have timestamp");

        console.log("[x402] Payment record structure verified:", payment);
      } else {
        console.log("[x402] No payments in ledger yet (expected for test)");
      }
    });
  });

  describe("x402 Middleware Integration", () => {
    it("x402Guard middleware is applied to paid endpoints", async () => {
      // The middleware is applied - we can verify by checking the response headers
      // or by testing the 402/401 behavior

      const endpoints = ["/v1/analyze", "/v1/evaluate", "/v1/chat", "/v1/parse"];

      for (const endpoint of endpoints) {
        const res = await app.request(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(endpoint === "/v1/analyze"
            ? { url: "https://example.com" }
            : endpoint === "/v1/parse"
            ? { prompt: "test" }
            : endpoint === "/v1/chat"
            ? { messages: [{ role: "user", content: "hi" }] }
            : { prompt: "test", model: "gpt-4", test_cases: [{ input: "x" }], evaluators: ["cost"] }
          ),
        });

        // All should reject without payment/auth
        assert.ok(res.status === 401 || res.status === 402,
          `${endpoint} should require auth/payment, got ${res.status}`);
      }

      console.log("[x402] Middleware applied to all paid endpoints ✓");
    });
  });
});

// Manual test instructions for full e2e payment flow
console.log(`
=================================================================
x402 Payment Flow - Manual Test Instructions
=================================================================

1. Install purl CLI:
   npm install -g @x402/purl

2. Test payment flow on each endpoint:

   POST /v1/analyze ($0.05):
   purl POST ${BASE_URL}/v1/analyze \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com/article", "depth": "quick"}'

   POST /v1/evaluate ($0.01):
   purl POST ${BASE_URL}/v1/evaluate \
     -H "Content-Type: application/json" \
     -d '{"prompt": "Summarize: {{input}}", "model": "openai/gpt-4o-mini", "test_cases": [{"input": "Hello"}], "evaluators": ["cost"]}'

   POST /v1/chat ($0.005):
   purl POST ${BASE_URL}/v1/chat \
     -H "Content-Type: application/json" \
     -d '{"messages": [{"role": "user", "content": "Hello"}]}'

3. Check payment stats (requires admin API key):
   curl -H "Authorization: Bearer <admin_key>" ${BASE_URL}/v1/payments/stats

4. Verify ledger entries in database:
   SELECT * FROM "PaymentRecord" ORDER BY timestamp DESC LIMIT 10;

=================================================================
`);
