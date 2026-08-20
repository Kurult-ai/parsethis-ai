import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

import { disconnectRedis, getRedis, isRedisAvailable } from "../redis.js";

describe("Redis lazy connection state", () => {
  after(async () => {
    await disconnectRedis().catch(() => {});
  });

  it("reports available after the lazy client is created but before it connects", () => {
    getRedis();

    assert.equal(isRedisAvailable(), true);
  });
});
