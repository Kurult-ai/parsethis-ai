import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-csp";

const { app } = await import("./app.js");

describe("marketing CSP", () => {
  it("does not include unsafe-eval", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(csp, "expected a CSP header");
    assert.doesNotMatch(csp, /unsafe-eval/);
  });

  it("trust page does not call the CSP strict default-src only", () => {
    const src = readFileSync(fileURLToPath(new URL("./pages/trust-page.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(src, /default-src 'self'<\/code> \(strict\)/);
  });
});
