import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "dependency-ux-master-key";
delete process.env.DATABASE_URL;

const { app } = await import("../app.js");

const authHeaders = { Authorization: `Bearer ${process.env.MASTER_API_KEY}` };

async function expectDependencyUnavailable(path: string, init: RequestInit = {}) {
  const response = await app.request(path, {
    ...init,
    headers: {
      ...authHeaders,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  assert.equal(response.status, 503, `${path} should return a bounded 503 when DATABASE_URL is absent`);
  assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
  const body = await response.json();
  assert.equal(body.code, "service.unavailable");
  assert.equal(body.retryable, true);
  assert.match(body.detail, /database|storage|DATABASE_URL/i);
}

describe("dependency-unavailable UX", () => {
  it("classifies thrown database configuration errors as service unavailable instead of generic 500", async () => {
    await expectDependencyUnavailable("/v1/billing/usage");
  });

  it("returns problem+json for caught screening metrics database failures", async () => {
    await expectDependencyUnavailable("/v1/screening/metrics");
  });

  it("returns problem+json for caught policy reset database failures", async () => {
    await expectDependencyUnavailable("/v1/policy", { method: "DELETE" });
  });

  it("returns problem+json for payment stats database failures", async () => {
    await expectDependencyUnavailable("/v1/payments/stats");
  });
});
