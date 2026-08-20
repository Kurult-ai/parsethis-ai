/**
 * Availability arithmetic.
 *
 * The gap-detection and denominator rules are the part a customer's security
 * reviewer would actually check, and getting either wrong publishes a wrong
 * number on /status — which is worse than publishing none, since that was the
 * original finding. The pure helper is exported for exactly this reason.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summariseBeats } from "./availability.js";

const MIN = 60_000;
const at = (base: number, minute: number): Date => new Date(base + minute * MIN);

describe("summariseBeats", () => {
  const base = Date.UTC(2026, 7, 1, 0, 0, 0);

  it("reports no data rather than 0% when nothing has been recorded", () => {
    const w = summariseBeats([], new Date(base), 30);
    assert.equal(w.uptimePct, null);
    assert.equal(w.since, null);
    assert.deepEqual(w.outages, []);
  });

  it("is 100% when every minute has a beat", () => {
    const beats = Array.from({ length: 60 }, (_, i) => at(base, i));
    const w = summariseBeats(beats, at(base, 59), 30);
    assert.equal(w.observedMinutes, 60);
    assert.equal(w.possibleMinutes, 60);
    assert.equal(w.uptimePct, 100);
    assert.deepEqual(w.outages, []);
  });

  it("caps the denominator at the age of the oldest beat", () => {
    // Three minutes of history must not report 3/43200 just because the window
    // is 30 days. Publishing 0.007% for a new deploy would be a lie in the
    // other direction.
    const beats = [at(base, 0), at(base, 1), at(base, 2)];
    const w = summariseBeats(beats, at(base, 2), 30);
    assert.equal(w.possibleMinutes, 3);
    assert.equal(w.uptimePct, 100);
  });

  it("ignores a single missed minute — a restart is not an incident", () => {
    const beats = [at(base, 0), at(base, 1), /* 2 missing */ at(base, 3), at(base, 4)];
    const w = summariseBeats(beats, at(base, 4), 30);
    assert.deepEqual(w.outages, []);
    // It still costs availability; it just is not listed as an outage.
    assert.equal(w.observedMinutes, 4);
    assert.equal(w.possibleMinutes, 5);
  });

  it("records a gap of two or more minutes as an outage, with its bounds", () => {
    const beats = [at(base, 0), /* 1,2,3 missing */ at(base, 4)];
    const w = summariseBeats(beats, at(base, 4), 30);
    assert.equal(w.outages.length, 1);
    assert.equal(w.outages[0]!.minutes, 3);
    assert.equal(w.outages[0]!.from.getTime(), at(base, 1).getTime());
    assert.equal(w.outages[0]!.to.getTime(), at(base, 3).getTime());
  });

  it("lists the most recent outage first", () => {
    const beats = [
      at(base, 0), at(base, 5),   // gap of 4
      at(base, 6), at(base, 20),  // gap of 13
    ];
    const w = summariseBeats(beats, at(base, 20), 30);
    assert.equal(w.outages.length, 2);
    assert.equal(w.outages[0]!.minutes, 13, "newest first");
    assert.equal(w.outages[1]!.minutes, 4);
  });

  it("never reports more than 100%", () => {
    // Duplicate beats cannot happen through the writer (the minute is the
    // primary key), but a hand-inserted row must not produce 105%.
    const beats = [at(base, 0), at(base, 0), at(base, 1)];
    const w = summariseBeats(beats, at(base, 1), 30);
    assert.ok(w.uptimePct !== null && w.uptimePct <= 100);
  });
});
