/**
 * Encryption at rest.
 *
 * This module is the condition on which the C17 decision — do not persist
 * provider keys — was reversed, so its guarantees are worth pinning: a tampered
 * ciphertext must throw rather than return anything, two seals of the same
 * input must differ, and a missing key must fail loudly rather than quietly
 * writing plaintext.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  sealSecret,
  openSecret,
  openMaybeSealed,
  isSealed,
  secretBoxReady,
  redact,
  SecretKeyMissingError,
} from "./secret-box.js";

const KEY = randomBytes(32).toString("base64");
let previous: string | undefined;

before(() => {
  previous = process.env.PARSE_SECRET_KEY;
  process.env.PARSE_SECRET_KEY = KEY;
});

after(() => {
  if (previous === undefined) delete process.env.PARSE_SECRET_KEY;
  else process.env.PARSE_SECRET_KEY = previous;
});

describe("sealSecret / openSecret", () => {
  it("round-trips ASCII", () => {
    const secret = "sk-live-abc123";
    assert.equal(openSecret(sealSecret(secret)), secret);
  });

  it("round-trips Unicode and newlines", () => {
    const secret = "clé-très-secrète\nligne deux · 日本語";
    assert.equal(openSecret(sealSecret(secret)), secret);
  });

  it("round-trips a long value", () => {
    const secret = "x".repeat(4096);
    assert.equal(openSecret(sealSecret(secret)), secret);
  });

  it("produces a different ciphertext each time", () => {
    // A deterministic seal would leak that two orgs use the same provider key.
    const a = sealSecret("same-input");
    const b = sealSecret("same-input");
    assert.notEqual(a, b);
    assert.equal(openSecret(a), openSecret(b));
  });

  it("never contains the plaintext", () => {
    const sealed = sealSecret("sk-live-do-not-leak");
    assert.ok(!sealed.includes("sk-live-do-not-leak"));
    assert.ok(!Buffer.from(sealed).toString("utf8").includes("do-not-leak"));
  });

  it("refuses to seal an empty value rather than storing something meaningless", () => {
    assert.throws(() => sealSecret(""));
  });
});

describe("tampering", () => {
  it("throws when the ciphertext is altered", () => {
    const sealed = sealSecret("sk-live-abc");
    const parts = sealed.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64");
    assert.throws(() => openSecret(parts.join(".")));
  });

  it("throws when the auth tag is altered", () => {
    const sealed = sealSecret("sk-live-abc");
    const parts = sealed.split(".");
    const tag = Buffer.from(parts[2], "base64");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64");
    assert.throws(() => openSecret(parts.join(".")));
  });

  it("throws when the IV is altered", () => {
    const sealed = sealSecret("sk-live-abc");
    const parts = sealed.split(".");
    const iv = Buffer.from(parts[1], "base64");
    iv[0] ^= 0xff;
    parts[1] = iv.toString("base64");
    assert.throws(() => openSecret(parts.join(".")));
  });

  it("refuses a value it did not seal", () => {
    assert.throws(() => openSecret("plaintext-provider-key"));
    assert.throws(() => openSecret("v2.a.b.c"));
  });
});

describe("isSealed and the migration path", () => {
  it("recognises its own output", () => {
    assert.equal(isSealed(sealSecret("x")), true);
  });

  it("does not mistake plaintext for a sealed value", () => {
    for (const value of ["sk-live-abc", "", null, undefined, "v1.only.three"]) {
      assert.equal(isSealed(value as string), false, String(value));
    }
  });

  it("openMaybeSealed passes legacy plaintext through unchanged", () => {
    // SIEMConfig.authHeader claimed to be encrypted at rest and was not, so
    // existing rows have to keep working until they are rewritten.
    assert.equal(openMaybeSealed("legacy-plaintext-token"), "legacy-plaintext-token");
  });

  it("openMaybeSealed opens a sealed value", () => {
    assert.equal(openMaybeSealed(sealSecret("new-token")), "new-token");
  });

  it("openMaybeSealed treats absent as absent, not as empty string", () => {
    assert.equal(openMaybeSealed(null), null);
    assert.equal(openMaybeSealed(undefined), null);
    assert.equal(openMaybeSealed(""), null);
  });
});

describe("failing closed", () => {
  it("throws a named error when no key is configured", () => {
    const saved = process.env.PARSE_SECRET_KEY;
    delete process.env.PARSE_SECRET_KEY;
    try {
      assert.throws(() => sealSecret("x"), SecretKeyMissingError);
      assert.equal(secretBoxReady(), false);
    } finally {
      process.env.PARSE_SECRET_KEY = saved;
    }
  });

  it("refuses a key of the wrong length instead of padding it", () => {
    const saved = process.env.PARSE_SECRET_KEY;
    process.env.PARSE_SECRET_KEY = Buffer.from("too-short").toString("base64");
    try {
      assert.throws(() => sealSecret("x"), /32 bytes/);
    } finally {
      process.env.PARSE_SECRET_KEY = saved;
    }
  });

  it("accepts a hex key as well as base64", () => {
    const saved = process.env.PARSE_SECRET_KEY;
    process.env.PARSE_SECRET_KEY = randomBytes(32).toString("hex");
    try {
      assert.equal(openSecret(sealSecret("hex-keyed")), "hex-keyed");
    } finally {
      process.env.PARSE_SECRET_KEY = saved;
    }
  });

  it("reports ready when a key is configured", () => {
    assert.equal(secretBoxReady(), true);
  });
});

describe("redact", () => {
  it("never returns any part of the secret", () => {
    assert.equal(redact("sk-live-abc123"), "[redacted]");
    assert.equal(redact(null), "");
  });
});
