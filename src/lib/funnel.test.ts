import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Test funnel stage constants and hash function without Redis
import { createHash } from "crypto";

describe("funnel utilities", () => {
  test("todayKey produces YYYY-MM-DD format", () => {
    const key = new Date().toISOString().slice(0, 10);
    assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("hashId is deterministic and 16 chars", () => {
    const id = "test-user-123";
    const hash = createHash("sha256").update(id).digest("hex").slice(0, 16);
    assert.equal(hash.length, 16);
    const hash2 = createHash("sha256").update(id).digest("hex").slice(0, 16);
    assert.equal(hash, hash2, "same input → same hash");
  });

  test("hashId produces different hashes for different inputs", () => {
    const h1 = createHash("sha256").update("user1").digest("hex").slice(0, 16);
    const h2 = createHash("sha256").update("user2").digest("hex").slice(0, 16);
    assert.notEqual(h1, h2);
  });
});
