/**
 * The trust page is where a customer's security reviewer sends their
 * questionnaire, so a claim on it that the code does not implement is not a
 * typo — it is a control assertion that fails on inspection.
 *
 * It listed four RBAC roles for months (admin, owner, member, viewer) and not
 * one of them existed. The real roles are in `src/lib/rbac.ts`, and a prospect
 * hit the mismatch within a minute of using the product, because the 403 body
 * names the real ones. It also advertised Auth0, which is not supported, and
 * omitted WorkOS, which is.
 *
 * These tests exist so the page cannot drift from the code again: rename a role
 * in rbac.ts without touching the page and this fails.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderTrustPage } from "./trust-page.js";
import { VALID_ROLES } from "../lib/rbac.js";
import { VALID_PROVIDER_TYPES } from "../lib/sso/sso-provider.js";

const html = renderTrustPage("https://example.test");

describe("trust page — RBAC claims match the code", () => {
  it("names every role the middleware actually enforces", () => {
    for (const role of VALID_ROLES) {
      assert.ok(html.includes(role), `trust page does not mention the role "${role}"`);
    }
  });

  it("no longer claims roles that never existed", () => {
    // Guarded to the RBAC contexts so ordinary prose using these words is fine.
    for (const stale of ["owner", "member", "viewer"]) {
      assert.doesNotMatch(
        html,
        new RegExp(`Roles:[^<]*\\b${stale}\\b`),
        `trust page still lists the non-existent role "${stale}"`,
      );
      assert.doesNotMatch(
        html,
        new RegExp(`defined roles \\([^)]*\\b${stale}\\b`),
        `the security questionnaire answer still lists "${stale}"`,
      );
    }
  });

  it("answers the RBAC questionnaire item with the real roles", () => {
    const answer = html.match(/defined roles \(([^)]+)\)/);
    assert.ok(answer, "the questionnaire answer no longer lists roles");
    for (const role of VALID_ROLES) {
      assert.ok(answer[1].includes(role), `questionnaire answer omits "${role}"`);
    }
  });
});

describe("trust page — SSO claims match the code", () => {
  it("does not advertise a provider the code cannot talk to", () => {
    // Auth0 was listed and is not in ProviderType. A reviewer who plans a
    // rollout around it finds out during implementation.
    assert.ok(!/Auth0/i.test(html), "trust page still advertises Auth0, which is unsupported");
  });

  it("names the providers that are supported", () => {
    const labels: Record<string, RegExp> = {
      okta: /Okta/i,
      azure: /Entra|Azure/i,
      google: /Google/i,
      workos: /WorkOS/i,
    };
    for (const type of VALID_PROVIDER_TYPES) {
      assert.match(html, labels[type], `trust page omits the supported provider "${type}"`);
    }
  });
});
