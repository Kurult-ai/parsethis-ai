import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyActivity } from "./activity.js";

const NOW = new Date("2026-08-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe("classifyActivity", () => {
  it("reports 'never' when nothing has ever been screened", () => {
    assert.equal(classifyActivity(0, null, NOW).status, "never");
  });

  it("reports 'never' when a count exists but no timestamp does", () => {
    // Defensive: a count without a row is a degraded read, not a live install.
    assert.equal(classifyActivity(5, null, NOW).status, "never");
  });

  it("reports 'screening' for traffic in the last day", () => {
    assert.equal(classifyActivity(120, hoursAgo(2), NOW).status, "screening");
  });

  it("still reports 'screening' inside the grace window", () => {
    // An agent that runs nightly must not be told it has stopped.
    assert.equal(classifyActivity(120, hoursAgo(36), NOW).status, "screening");
  });

  it("reports 'stopped' once an install that worked has gone quiet", () => {
    const { status, hoursSinceLast } = classifyActivity(120, hoursAgo(24 * 9), NOW);
    assert.equal(status, "stopped");
    assert.equal(Math.round(hoursSinceLast ?? 0), 216);
  });

  /**
   * The distinction the whole endpoint exists for. Prospect run 14 could not
   * tell a dead install from a quiet one, because both render as nothing.
   */
  it("distinguishes a dead install from a quiet one", () => {
    assert.notEqual(
      classifyActivity(0, null, NOW).status,
      classifyActivity(500, hoursAgo(24 * 30), NOW).status,
    );
  });
});
