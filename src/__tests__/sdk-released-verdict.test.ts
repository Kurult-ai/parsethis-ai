import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const ts = read("../../packages/parse-sdk/ts/index.ts");
const py = read("../../packages/parse-sdk/python/parse_agents/__init__.py");

/**
 * The premise that sank the two previous attempts at the semantic acquittal
 * release was "it releases to sandbox, not allow, so it is conservative".
 *
 * That was false in the shipped clients. A released prompt comes back below the
 * risk bands — medium_risk / sandbox — and both SDKs gated on the bands, so the
 * release was `block -> allow` for every real caller. The TS SDK contained zero
 * occurrences of the word "sandbox"; the Python SDK never read
 * `recommended_action` at all.
 *
 * These are contract tests over the client source. They exist so that a future
 * change to either gate has to confront this deliberately.
 */

describe("TypeScript SDK — a released verdict is refused by default", () => {
  it("knows the field exists", () => {
    assert.match(ts, /released_from_block\?:/, "the response type must model the release");
  });

  it("defaults onReleased to block", () => {
    assert.match(
      ts,
      /onReleased: config\.onReleased \?\? "block"/,
      "upgrading the SDK must not loosen anybody's posture",
    );
  });

  it("checks the release before the risk bands", () => {
    const releaseAt = ts.indexOf("release?.released");
    const bandsAt = ts.indexOf('parseResp.verdict === "critical"');
    assert.ok(releaseAt > 0 && bandsAt > 0, "both gates must exist");
    assert.ok(
      releaseAt < bandsAt,
      "a released prompt sits below the bands, so the band gate would let it pass",
    );
  });

  it("only allows a release on an explicit opt-in", () => {
    assert.match(ts, /if \(config\.onReleased === "allow"\)/);
    assert.match(ts, /config\.onReleased === "callback" && config\.onReleasedPrompt/);
  });

  it("counts a refused release as a block", () => {
    const gate = ts.slice(ts.indexOf("release?.released"), ts.indexOf("risk bands; gating"));
    assert.match(gate, /stats\.blockedCalls\+\+/, "a refused release is a block for reporting");
  });

  it("does not fall through to the band gate once a release was allowed", () => {
    assert.match(
      ts,
      /!releasedAndAllowed &&/,
      "allowing a release then blocking on the bands would make onReleased a no-op",
    );
  });
});

describe("Python SDK — the same contract", () => {
  it("reads recommended_action, which it previously ignored entirely", () => {
    assert.match(py, /parse_resp\.get\("recommended_action"\) == "block"/);
  });

  it("gates on the frozen-agent verdict too", () => {
    assert.match(py, /"critical", "high_risk", "block"/, '"block" is the kill switch verdict');
  });

  it("defaults on_released to block", () => {
    assert.match(py, /on_released: str = "block"/);
  });

  it("refuses a release unless explicitly allowed", () => {
    assert.match(py, /if config\.on_released == "allow":\n\s+return False/);
    assert.match(py, /if not release\.get\("released"\):\n\s+return False/);
  });

  it("does not let a throwing callback open the gate", () => {
    const fn = py.slice(py.indexOf("def _release_blocked"), py.indexOf("class ParseScreeningError"));
    assert.match(fn, /except Exception:/);
    assert.match(fn, /# A throwing callback must not open the gate\.\n\s+return True/);
  });
});

describe("both SDKs agree", () => {
  it("neither treats a release as safe by default", () => {
    assert.doesNotMatch(ts, /onReleased: config\.onReleased \?\? "allow"/);
    assert.doesNotMatch(py, /on_released: str = "allow"/);
  });
});
