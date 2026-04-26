import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { parseRoutes } from "../routes/parse.js";
import type { AppEnv } from "../types.js";

function x402App() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("x402Paid", true);
    await next();
  });
  app.route("", parseRoutes);
  return app;
}

describe("POST /v1/parse x402 execution", () => {
  it("rejects execute:true because x402 callers cannot poll with stable identity", async () => {
    const response = await x402App().request("/v1/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello world", execute: true }),
    });

    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type") ?? "", /application\/problem\+json/);
    assert.equal((await response.json()).code, "x402.async_unsupported");
  });

  it("allows synchronous x402 screening when execute is omitted", async () => {
    const response = await x402App().request("/v1/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Hello world", mode: "pattern-only" }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).analysis_method, "pattern");
  });
});
