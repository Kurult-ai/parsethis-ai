import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderPersonalPage } from "./personal.js";

describe("/personal", () => {
  const html = renderPersonalPage("https://www.parsethis.ai");

  it("explains screening what the agent writes", () => {
    assert.match(html, /screen-output/);
    assert.match(html, /what your agent (writes|says|sends|publishes)/i);
  });

  it("gives a copy-paste curl against the output endpoint", () => {
    assert.match(html, /curl[^<]*\/v1\/screen-output/s);
  });

  it("states the output-surface precision with its n", () => {
    assert.match(html, /16 real newsletter lines/);
    assert.match(html, /run 20/);
  });

  it("is honest about shared / colleague agents", () => {
    assert.doesNotMatch(html, /One agent, one person/);
    assert.match(html, /colleague/i);
  });
});
