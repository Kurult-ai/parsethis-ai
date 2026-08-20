import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ACTION_ROUTER, FEATURE_STATUS } from "./lib/product-facts.js";
import { getPricingInfo, isX402Enabled } from "./x402.js";

describe("x402 honesty", () => {
  it("the protocol exists; enablement is GET /v1/pricing.enabled", () => {
    const entry = FEATURE_STATUS.find((e) => e.name === "x402 Payment");
    assert.ok(entry);
    assert.equal(entry.status, "shipped");
  });

  it("GET /v1/pricing.enabled is false when x402 is not configured", () => {
    const info = getPricingInfo();
    if (!isX402Enabled()) {
      assert.equal(info.enabled, false);
      // payTo may be unset or a wallet hex; facilitator/enabled gate payments.
      // Do not assert payTo here — that is a separate Medium/Low Walker item.
    }
  });

  it("docs auth capsule does not list x402 as a working method while disabled", () => {
    if (isX402Enabled()) return;
    const src = readFileSync(fileURLToPath(new URL("./routes/public.ts", import.meta.url)), "utf8");
    const authIdx = src.indexOf("<h2>Authentication</h2>");
    const slice = src.slice(authIdx, authIdx + 1200);
    assert.match(slice, /not configured/);
    assert.doesNotMatch(
      slice,
      /supports two authentication methods: Bearer token \(API key\) and x402/,
    );
    assert.doesNotMatch(slice, /sign USDC on \$\{X402_PAYMENT\.networkName\}, and retry/);
  });

  it("agent Task Router does not teach a live 402→USDC→retry path while disabled", () => {
    if (isX402Enabled()) return;
    const x402Route = ACTION_ROUTER.find((item) => item.tool === "get_pricing");
    assert.ok(x402Route);
    assert.match(x402Route.action, /not configured|enabled is false/i);
    assert.doesNotMatch(x402Route.action, /accept the 402 payment requirements, sign USDC/);

    const llms = readFileSync(fileURLToPath(new URL("./routes/discovery.ts", import.meta.url)), "utf8");
    assert.match(llms, /x402 Prices \(catalog\)/);
    assert.match(llms, /not configured on this deployment/);
    assert.doesNotMatch(
      llms,
      /x402: call a billable POST endpoint without a bearer key, read the 402 accepts/,
    );
  });

  it("docs/x402 and get-started do not sell a live pay-per-call path while disabled", () => {
    if (isX402Enabled()) return;
    const x402Doc = readFileSync(fileURLToPath(new URL("../content/docs/x402.md", import.meta.url)), "utf8");
    assert.match(x402Doc, /Not configured on this deployment/i);
    assert.match(x402Doc, /Catalog prices/i);
    assert.doesNotMatch(x402Doc, /## Flow\n/);
    assert.doesNotMatch(x402Doc, /Retry the identical request with `payment-signature`/);

    const getStarted = readFileSync(fileURLToPath(new URL("./pages/get-started.ts", import.meta.url)), "utf8");
    assert.match(getStarted, /Bearer-only/);
    assert.doesNotMatch(getStarted, /pay per call with x402, no key at all/);

    const landing = readFileSync(fileURLToPath(new URL("./pages/landing.ts", import.meta.url)), "utf8");
    assert.match(landing, /x402 is not configured on this deployment/);
    assert.doesNotMatch(landing, /use the x402 402 payment flow/);
  });

  it("openapi.json and MCP auth.x402 do not teach a live 402→pay→retry path while disabled", () => {
    if (isX402Enabled()) return;
    const discovery = readFileSync(fileURLToPath(new URL("./routes/discovery.ts", import.meta.url)), "utf8");

    assert.doesNotMatch(discovery, /pay per call with x402 when no bearer key exists/);
    assert.doesNotMatch(discovery, /\*\*Payment flow \(x402\):\*\*/);
    assert.doesNotMatch(
      discovery,
      /server returns 402 with payment requirements for USDC on Base mainnet/,
    );
    assert.doesNotMatch(
      discovery,
      /wallet signs a USDC payment to the advertised `payTo`/,
    );
    assert.doesNotMatch(
      discovery,
      /Payment required — pay in USDC on Base mainnet and retry with the payment-signature header/,
    );
    assert.doesNotMatch(
      discovery,
      /Use REST endpoints directly for x402 402 -> pay -> retry flows/,
    );

    assert.match(discovery, /x402 pay-per-call is not configured on this deployment/);
    assert.match(discovery, /keyless billable POSTs return HTTP 401, not 402/);
    assert.match(
      discovery,
      /Catalog x402 payment-required shape\. Not live on this deployment/,
    );
    assert.match(
      discovery,
      /do not use a 402 -> pay -> retry flow\. Prefer Bearer auth/,
    );
  });
});

describe("matched_token honesty", () => {
  it("llms.txt Precision, /docs, and /v1/explain 402 do not claim every free flag carries matched_token", () => {
    const discovery = readFileSync(fileURLToPath(new URL("./routes/discovery.ts", import.meta.url)), "utf8");
    assert.match(discovery, /intent\.\* flags carry/);
    assert.match(discovery, /pattern\.\* flags may omit/);
    assert.doesNotMatch(discovery, /Every flag carries \\`matched_token\\`/);

    const docs = readFileSync(fileURLToPath(new URL("./routes/public.ts", import.meta.url)), "utf8");
    assert.match(docs, /intent\.\*<\/code> flags carry <code>matched_token<\/code>/);
    assert.match(docs, /pattern\.\*<\/code> flags may omit/);
    assert.doesNotMatch(docs, /Every blocking flag carries <code>matched_token<\/code>/);
    assert.doesNotMatch(docs, /the phrase is on every flag for exactly this reason/);

    const explain = readFileSync(fileURLToPath(new URL("./routes/explain.ts", import.meta.url)), "utf8");
    assert.match(explain, /intent\.\*.*carry `matched_token`|flags carry `matched_token`/);
    assert.match(explain, /pattern\.\*`.{0,3}flags may omit/);
    assert.doesNotMatch(explain, /Every blocking flag on the free tier already carries `matched_token`/);
    assert.doesNotMatch(explain, /The free tier already gets `matched_token` on every blocking flag/);
  });
});
