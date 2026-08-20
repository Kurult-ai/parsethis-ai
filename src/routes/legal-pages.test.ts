import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-legal-pages";

const { app } = await import("../app.js");
const { formatDate } = await import("../lib/html-template.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

describe("terms", () => {
  it("names every self-serve paid plan, including Solo", async () => {
    const res = await app.request("/terms");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Paid plans \(Solo, Pro, Team, Enterprise\)/);
  });
});

describe("privacy policy has one date", () => {
  it("the header and body 'Last updated' dates agree", async () => {
    const res = await app.request("/privacy");
    assert.equal(res.status, 200);
    const html = await res.text();
    const dates = [...html.matchAll(/Last updated:\s*(?:<\/strong>\s*)?([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map(
      (m) => m[1],
    );
    assert.ok(dates.length >= 2, `expected the header and body dates, found ${dates.length}`);
    assert.equal(new Set(dates).size, 1, `privacy page shows conflicting dates: ${[...new Set(dates)].join(" vs ")}`);
  });
});

describe("formatDate", () => {
  it("renders a bare ISO date in UTC, not one day earlier", () => {
    // new Date("2026-08-11") is UTC midnight; formatting it in a western local
    // timezone used to yield "August 10, 2026" under a datetime="2026-08-11".
    assert.equal(formatDate("2026-08-11"), "August 11, 2026");
  });
});

describe("the refund policy describes a path that exists", () => {
  it("names every self-serve paid plan, including Solo", async () => {
    const res = await app.request("/refund");
    assert.equal(res.status, 200);
    const html = await res.text();
    for (const tier of ["Solo", "Pro", "Team"]) {
      assert.match(html, new RegExp(tier), `refund policy does not name ${tier}`);
    }
  });

  it("does not link to /billing, which 404s", async () => {
    const res = await app.request("/refund");
    const html = await res.text();
    assert.doesNotMatch(
      html,
      /href="\/billing"/,
      'the cancel link must point at a page that exists — /billing is a 404',
    );
  });

  it("every legal page links only to billing paths that resolve", async () => {
    for (const path of ["/refund", "/terms"]) {
      const res = await app.request(path);
      const html = await res.text();
      assert.doesNotMatch(html, /href="\/billing"/, `${path} links to /billing, which 404s`);
    }
  });
});
