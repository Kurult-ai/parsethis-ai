import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-content-type-tests";

const { app } = await import("../app.js");

async function postText(path: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
      "Content-Type": "text/plain",
    },
    body: "not json",
  });
}

describe("billable endpoint content type errors", () => {
  for (const path of ["/v1/parse", "/v1/screen-output"]) {
    it(`${path} returns problem+json for text/plain`, async () => {
      const res = await postText(path);

      assert.equal(res.status, 400);
      assert.ok(res.headers.get("content-type")?.includes("application/problem+json"));

      const body = await res.json();
      assert.equal(body.code, "validation.invalid_type");
      assert.equal(body.retryable, false);
      assert.equal(body.detail, "Content-Type must be application/json");
    });
  }
});
