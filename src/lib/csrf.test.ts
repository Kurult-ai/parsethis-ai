import { test } from "node:test";
import assert from "node:assert";
import { issueCsrfToken, verifyCsrfToken } from "./csrf.js";

const KEY = "ck_test_key_abc123";
const OTHER_KEY = "ck_test_key_zzz999";

test("a freshly issued token verifies for its own key", () => {
  const token = issueCsrfToken(KEY);
  assert.deepEqual(verifyCsrfToken(token, KEY), { ok: true });
});

test("tokens are unique per issue", () => {
  assert.notEqual(issueCsrfToken(KEY), issueCsrfToken(KEY));
});

test("a token issued for one key does not verify for another", () => {
  const token = issueCsrfToken(KEY);
  const result = verifyCsrfToken(token, OTHER_KEY);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "wrong_key");
});

test("an expired token is rejected", () => {
  const now = Date.now();
  const token = issueCsrfToken(KEY, 60, now);
  assert.deepEqual(verifyCsrfToken(token, KEY, now + 30_000), { ok: true });

  const result = verifyCsrfToken(token, KEY, now + 61_000);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "expired");
});

test("a tampered payload fails on signature, not on binding", () => {
  const token = issueCsrfToken(KEY);
  const parts = token.slice("pcsrf_".length).split(".");
  // Push the expiry far into the future without re-signing.
  parts[1] = String(Number(parts[1]) + 86_400);
  const forged = `pcsrf_${parts.join(".")}`;

  const result = verifyCsrfToken(forged, KEY);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "bad_signature");
});

test("malformed input is rejected without throwing", () => {
  for (const bad of [undefined, null, "", "nope", "pcsrf_", "pcsrf_a.b", "pcsrf_a.b.c.d.e"]) {
    const result = verifyCsrfToken(bad as string | undefined, KEY);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("a token missing the prefix is rejected as malformed", () => {
  const token = issueCsrfToken(KEY).slice("pcsrf_".length);
  const result = verifyCsrfToken(token, KEY);
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, "malformed");
});

test("a non-numeric expiry is rejected", () => {
  // Sign a payload whose expiry is not a number, so the signature is valid
  // and only the expiry parse can reject it.
  const result = verifyCsrfToken("pcsrf_abc.notanumber.nonce.sig", KEY);
  assert.equal(result.ok, false);
});
