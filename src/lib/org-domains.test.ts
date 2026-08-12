/**
 * What may be claimed as an organization's domain, and how a challenge token is
 * bound to the organization that was issued it.
 *
 * Hermetic: pure functions only. `checkDnsChallenge` talks to a resolver and is
 * exercised end to end on staging instead.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateClaimableDomain,
  challengeHost,
  challengeValue,
  mintChallengeToken,
  tokenMatchesOrg,
  PUBLIC_MAIL_DOMAINS,
} from "./org-domains.js";

function accepted(result: ReturnType<typeof validateClaimableDomain>) {
  if (!result.ok) throw new Error(`expected accepted, got ${result.detail}`);
  return result.domain;
}

function refused(result: ReturnType<typeof validateClaimableDomain>) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  return result;
}

describe("validateClaimableDomain — what a person actually pastes", () => {
  it("accepts a plain domain", () => {
    assert.equal(accepted(validateClaimableDomain("meridian.example")), "meridian.example");
  });

  it("takes the domain out of an email address", () => {
    assert.equal(accepted(validateClaimableDomain("iris@meridian.example")), "meridian.example");
  });

  it("strips a scheme and path", () => {
    assert.equal(accepted(validateClaimableDomain("https://meridian.example/careers")), "meridian.example");
  });

  it("normalises case and surrounding whitespace", () => {
    assert.equal(accepted(validateClaimableDomain("  MERIDIAN.Example  ")), "meridian.example");
  });

  it("drops a trailing root dot", () => {
    assert.equal(accepted(validateClaimableDomain("meridian.example.")), "meridian.example");
  });

  it("accepts a subdomain", () => {
    assert.equal(accepted(validateClaimableDomain("eng.meridian.example")), "eng.meridian.example");
  });
});

describe("validateClaimableDomain — refusals", () => {
  it("refuses a shared mail provider, however well it is proved", () => {
    // Claiming gmail.com would let one org govern unrelated strangers and lock
    // every other Gmail user out of creating their own organization.
    const result = refused(validateClaimableDomain("gmail.com"));
    assert.equal(result.reason, "public_mail");
    assert.match(result.detail, /shared mail provider/i);
  });

  it("refuses every provider on the list, in any casing", () => {
    for (const domain of PUBLIC_MAIL_DOMAINS) {
      assert.equal(validateClaimableDomain(domain.toUpperCase()).ok, false, domain);
    }
  });

  it("refuses a bare hostname with no TLD", () => {
    assert.equal(refused(validateClaimableDomain("localhost")).reason, "malformed");
  });

  it("refuses an IP address", () => {
    assert.equal(refused(validateClaimableDomain("192.168.1.1")).reason, "malformed");
  });

  it("refuses empty, whitespace, and non-strings", () => {
    for (const bad of ["", "   ", null, undefined, 42, {}]) {
      assert.equal(validateClaimableDomain(bad).ok, false, String(bad));
    }
  });

  it("refuses a label with an illegal character", () => {
    assert.equal(refused(validateClaimableDomain("meri dian.example")).reason, "malformed");
    assert.equal(refused(validateClaimableDomain("meridian_corp.example")).reason, "malformed");
  });

  it("refuses a domain longer than DNS allows", () => {
    const long = `${"a".repeat(250)}.example`;
    assert.equal(refused(validateClaimableDomain(long)).reason, "malformed");
  });
});

describe("the DNS challenge", () => {
  it("asks for the record on a dedicated subdomain, not the apex", () => {
    assert.equal(challengeHost("meridian.example"), "_parse-challenge.meridian.example");
  });

  it("uses a prefixed value so an unrelated TXT record cannot satisfy it", () => {
    assert.equal(challengeValue("abc"), "parse-verify=abc");
  });

  it("binds a token to the organization it was issued for", () => {
    const token = mintChallengeToken("org_meridian");
    assert.equal(tokenMatchesOrg(token, "org_meridian"), true);
  });

  it("refuses a token issued to a different organization", () => {
    // Otherwise an attacker publishes their own org's challenge on a domain
    // they control, then replays that token to claim the domain for another.
    const token = mintChallengeToken("org_attacker");
    assert.equal(tokenMatchesOrg(token, "org_meridian"), false);
  });

  it("issues a different token every time", () => {
    const a = mintChallengeToken("org_meridian");
    const b = mintChallengeToken("org_meridian");
    assert.notEqual(a, b);
    assert.equal(tokenMatchesOrg(a, "org_meridian"), true);
    assert.equal(tokenMatchesOrg(b, "org_meridian"), true);
  });

  it("refuses a malformed or truncated token rather than throwing", () => {
    for (const bad of ["", "short", "x".repeat(64), null, undefined, 7]) {
      assert.equal(tokenMatchesOrg(bad as string, "org_meridian"), false, String(bad));
    }
  });
});
