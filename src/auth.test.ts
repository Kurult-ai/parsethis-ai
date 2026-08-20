import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isOwnerTeamKey } from "./auth.js";

describe("isOwnerTeamKey", () => {
  it("accepts a pfa_live key when its sha256 matches OWNER_TEAM_KEY_SHA256", () => {
    const key = "pfa_live_test_owner_team_key";
    process.env.OWNER_TEAM_KEY_SHA256 = createHash("sha256").update(key).digest("hex");
    try {
      assert.equal(isOwnerTeamKey(key), true);
      assert.equal(isOwnerTeamKey("pfa_live_wrong"), false);
      assert.equal(isOwnerTeamKey("not_a_parse_key"), false);
    } finally {
      delete process.env.OWNER_TEAM_KEY_SHA256;
    }
  });
});
