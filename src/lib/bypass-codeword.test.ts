import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  hashBypassCodeword,
  verifyBypassCodeword,
  isBypassCodewordActive,
  formatBypassPolicy,
} from "./bypass-codeword.js";

describe("bypass codeword", () => {
  it("hashes and verifies a configured codeword without storing the raw phrase", () => {
    const hash = hashBypassCodeword("let me through once");

    assert.match(hash, /^sha256:/);
    assert.equal(hash.includes("let me through once"), false);
    assert.equal(verifyBypassCodeword("let me through once", hash), true);
    assert.equal(verifyBypassCodeword("wrong phrase", hash), false);
  });

  it("requires the bypass to be enabled and unexpired", () => {
    const hash = hashBypassCodeword("user-confirmed-override");

    assert.equal(isBypassCodewordActive({ bypassEnabled: true, bypassCodewordHash: hash }), true);
    assert.equal(isBypassCodewordActive({ bypassEnabled: false, bypassCodewordHash: hash }), false);
    assert.equal(isBypassCodewordActive({ bypassEnabled: true, bypassCodewordHash: hash, bypassExpiresAt: new Date(Date.now() - 1000) }), false);
  });

  it("formats policy responses without leaking the codeword hash", () => {
    const formatted = formatBypassPolicy({
      bypassEnabled: true,
      bypassCodewordHash: hashBypassCodeword("secret phrase"),
      bypassExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    assert.deepEqual(formatted, {
      bypassEnabled: true,
      bypassCodewordConfigured: true,
      bypassExpiresAt: "2030-01-01T00:00:00.000Z",
    });
    assert.equal(Object.prototype.hasOwnProperty.call(formatted, "bypassCodewordHash"), false);
  });
});
