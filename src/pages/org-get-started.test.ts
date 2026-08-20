/**
 * The get-started state a key with no organization now reaches at
 * /dashboard/org, in place of the raw problem+json 403 that a paying prospect
 * read as "this feature is not for me".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderOrgGetStartedPage } from "./org-get-started.js";

const html = renderOrgGetStartedPage("https://example.test", "key_abc", "my-agent-key");

describe("org get-started page", () => {
  it("names the endpoint that creates the organization", () => {
    // The whole defect was that this route existed and nothing said so.
    assert.ok(html.includes("/v1/orgs/bootstrap"));
  });

  it("offers both tool policy modes as a decision, not a default", () => {
    assert.match(html, /value="blocklist"/);
    assert.match(html, /value="allowlist"/);
    assert.match(html, /blocked until a rule allows it/i);
  });

  it("says governance is not paywalled, because a prospect assumed it was", () => {
    assert.match(html, /every plan/i);
  });

  it("carries a CSRF token and the header name the fetch will use", () => {
    assert.match(html, /<meta name="parse-csrf" content="[^"]+"/);
    assert.match(html, /<meta name="parse-csrf-header" content="x-parse-csrf"/);
  });

  it("keeps itself out of the index", () => {
    assert.match(html, /noindex/);
  });

  it("escapes the key name rather than interpolating it raw", () => {
    const nasty = renderOrgGetStartedPage("https://example.test", "key_abc", '"><script>x()</script>');
    assert.ok(!nasty.includes("<script>x()</script>"));
    assert.ok(nasty.includes("&lt;script&gt;"));
  });

  it("leads with what the buyer came for", () => {
    // Not a generic empty state: the four things the control actually buys.
    assert.match(html, /under every name/i);
    assert.match(html, /cannot write themselves an exception/i);
    assert.match(html, /cannot raise/i);
    assert.match(html, /receipted/i);
  });
});
