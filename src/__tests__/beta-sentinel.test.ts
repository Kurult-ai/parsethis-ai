import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyKeygenFailure,
  classifyProbeResults,
  redactSecrets,
  summarizeReadiness,
  type ProbeResult,
} from "../lib/beta-sentinel.js";

describe("Parse Beta Sentinel helpers", () => {
  it("redacts generated Parse API keys from nested report text", () => {
    const input = {
      key: "pfa_live_abcdefghijklmnopqrstuvwxyz123456",
      nested: {
        body: "Bearer pfa_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ987654 should never appear",
      },
      list: ["prefix pfa_live_1234567890abcdefghijklmnop suffix"],
    };

    const redacted = redactSecrets(input) as typeof input;
    const serialized = JSON.stringify(redacted);

    assert.equal(serialized.includes("abcdefghijklmnopqrstuvwxyz123456"), false);
    assert.equal(serialized.includes("ABCDEFGHIJKLMNOPQRSTUVWXYZ987654"), false);
    assert.equal(serialized.includes("1234567890abcdefghijklmnop"), false);
    assert.match(serialized, /pfa_live_\[REDACTED\]/);
    assert.match(serialized, /pfa_test_\[REDACTED\]/);
  });

  it("classifies expected rate limits as warn but unexpected auth failures as warn evidence", () => {
    const probes: ProbeResult[] = [
      { name: "parse-0", surface: "POST /v1/parse", ok: true, status: 200, latency_ms: 100 },
      { name: "parse-1", surface: "POST /v1/parse", ok: false, status: 429, latency_ms: 120, expected: true, severity: "warn", summary: "free plan limit" },
      { name: "parse-2", surface: "POST /v1/parse", ok: false, status: 401, latency_ms: 90, severity: "warn", summary: "unexpected auth failure" },
    ];

    const classified = classifyProbeResults(probes);

    assert.equal(classified.status, "WARN");
    assert.equal(classified.counts.pass, 1);
    assert.equal(classified.counts.warn, 2);
    assert.equal(classified.counts.block, 0);
    assert.equal(classified.warnings.some((warning) => warning.includes("401")), true);
  });


  it("classifies keygen capacity exhaustion as an open-onboarding blocker", () => {
    const classified = classifyKeygenFailure(429, {
      code: "usage_cap.exceeded",
      reason: "key_cap_exceeded",
      retryable: false,
    });

    assert.equal(classified.expected, false);
    assert.equal(classified.severity, "block");
    assert.match(classified.summary, /capacity exhausted/i);
  });

  it("keeps intentional keygen per-minute throttles as warnings", () => {
    const classified = classifyKeygenFailure(429, {
      code: "rate_limit.exceeded",
      reason: "redis_rate_limit_exceeded",
      retryable: true,
    });

    assert.equal(classified.expected, true);
    assert.equal(classified.severity, "warn");
    assert.match(classified.summary, /rate limit/i);
  });

  it("summarizes controlled-beta readiness without overclaiming open launch", () => {
    const summary = summarizeReadiness({
      discovery: "PASS",
      onboarding: "PASS",
      core_api: "PASS",
      auth_rate_limits: "WARN",
      docs_friction: "PASS",
    });

    assert.equal(summary.overall, "WARN");
    assert.equal(summary.controlled_beta, "READY_WITH_WARNINGS");
    assert.equal(summary.open_launch, "NOT_PROVEN");
    assert.match(summary.recommendation, /controlled beta/i);
    assert.match(summary.recommendation, /not claim open-launch/i);
  });
});
