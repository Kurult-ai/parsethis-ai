import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rolledExpiryFor } from "../api-key-service.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("Rolling key expiry", () => {
  it("non-expiring keys (null) never roll", () => {
    assert.equal(rolledExpiryFor(null), null);
  });

  it("a fresh key with ~30 days remaining does not roll (self-throttle)", () => {
    const fresh = new Date(Date.now() + 30 * DAY_MS);
    assert.equal(rolledExpiryFor(fresh), null);
  });

  it("a key inside its final 29 days rolls to now + 30 days", () => {
    const aging = new Date(Date.now() + 10 * DAY_MS);
    const rolled = rolledExpiryFor(aging);
    assert.ok(rolled, "expected a rolled expiry");
    const remaining = rolled.getTime() - Date.now();
    assert.ok(
      remaining > 29.9 * DAY_MS && remaining <= 30 * DAY_MS,
      `expected ~30 days remaining, got ${(remaining / DAY_MS).toFixed(2)}`,
    );
  });

  it("a key one day from expiry rolls (the walkthrough scenario)", () => {
    const dying = new Date(Date.now() + 1 * DAY_MS);
    assert.ok(rolledExpiryFor(dying));
  });

  it("an already-expired key does not roll — expiry still means expiry", () => {
    const dead = new Date(Date.now() - 1000);
    assert.equal(rolledExpiryFor(dead), null);
  });
});
