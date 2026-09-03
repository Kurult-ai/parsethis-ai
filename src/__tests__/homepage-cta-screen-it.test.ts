/**
 * t_172f32d3 — the homepage CTA fork.
 *
 * The hero box's #hero-screen "Screen it" button screens on the homepage,
 * but the nav, hero and closer "Screen one" CTAs forked off to /attack.
 * This file pins the fix: with a demo key configured (the box renders),
 * all three CTAs anchor to the same homepage screen box (#screen) instead
 * of /attack. Labeled Attack Pack links are not CTAs and stay.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// The hero shop window is only rendered when a demo key is configured.
process.env.DEMO_API_KEY = process.env.DEMO_API_KEY || "test-demo-key-cta-fork";

const { renderLandingPage } = await import("../pages/landing.js");

describe("homepage Screen one CTAs match the Screen it path", () => {
  const html = renderLandingPage("https://www.parsethis.ai");

  it("no Screen one CTA points at /attack", () => {
    assert.doesNotMatch(html, /href="\/attack"[^>]*>Screen one</);
  });

  it("nav, hero and closer all anchor to the homepage screen box", () => {
    const ctas = html.match(/href="#screen"[^>]*>Screen one</g) ?? [];
    assert.equal(ctas.length, 3, "expected the nav, hero and closer CTAs");
  });

  it("the anchor lands on the box that holds the Screen it button", () => {
    const box = html.indexOf('id="screen"');
    const button = html.indexOf('id="hero-screen"');
    assert.ok(box >= 0, "hero box must carry the #screen anchor");
    assert.ok(button > box, "#hero-screen must sit inside the anchored box");
    // The sticky 64px header must not cover the anchored box.
    assert.match(html, /id="screen"[^>]*scroll-margin-top/);
  });

  it("labeled Attack Pack links survive — the pack page stays reachable", () => {
    assert.match(html, /href="\/attack">Attack Pack</);
    assert.match(html, /href="\/attack">See the Attack Pack</);
  });
});
