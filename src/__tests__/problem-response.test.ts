import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { parseRoutes } from "../routes/parse.js";
import { agentTrustRoutes } from "../routes/agent-trust.js";
import type { AppEnv } from "../types.js";

describe("problem+json error contract", () => {
  it("returns problem+json for missing bearer auth", async () => {
    const app = new Hono<AppEnv>();
    app.route("", parseRoutes);

    const response = await app.request("/v1/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    assert.equal(response.status, 401);
    assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.equal((await response.json()).code, "auth.required");
  });

  it("returns problem+json for trust-verify validation", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("x402Paid", true);
      await next();
    });
    app.route("", agentTrustRoutes);

    const response = await app.request("/v1/agent/trust/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });

    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.equal((await response.json()).code, "validation.invalid_input");
  });
});
