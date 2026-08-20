import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * The seal, pinned.
 *
 * `scripts/sealed-holdout-eval.mts` exists because on 2026-08-14 a corpus that
 * had been intact since May was burnt in a day: measuring is one command,
 * reading the miss list is the natural next step, and nothing sat between them.
 * Four recall fixes were written from that miss list before anyone noticed.
 *
 * These assertions guard the properties that make the tool worth having. They
 * read the script's source rather than executing it — running 16,250 prompts in
 * CI is not the point, and the properties are structural.
 */

const SCRIPT = "scripts/sealed-holdout-eval.mts";
const src = () => readFileSync(SCRIPT, "utf8");

describe("the sealed holdout harness", () => {
  it("exists", () => {
    assert.ok(existsSync(SCRIPT), `${SCRIPT} is the overfitting tripwire; do not delete it`);
  });

  it("withholds the miss list unless --reveal is passed", () => {
    const s = src();
    assert.match(s, /misses withheld/, "the sealed path must say what it is withholding");
    assert.match(s, /has\("reveal"\)/, "revealing must be explicit, never the default");
  });

  it("refuses to reveal without a stated reason", () => {
    // A burn is sometimes correct. It is never silent, and it never happens
    // because someone typed one extra flag without thinking about it.
    assert.match(src(), /--reveal requires --reason/);
  });

  it("marks the corpus burnt when the misses are read", () => {
    const s = src();
    assert.match(s, /manifest\.burnt \?\?= \{ at:/, "revealing must stamp the manifest");
    assert.match(s, /must not be\\n\s*quoted as holdout evidence|quoted as holdout evidence/);
  });

  it("refuses to run if the corpus changed under the manifest", () => {
    // A holdout that can be edited between runs measures nothing.
    assert.match(src(), /REFUSING: corpus contents changed/);
  });

  it("does not leak a per-family breakdown in the sealed path", () => {
    // "your worst miss family is X" is enough to write a rule from, which is
    // the exact thing the seal exists to prevent.
    // Comments are stripped first: the header explains *why* families are
    // withheld, and matching that explanation is not a leak.
    const code = src()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    const sealedHalf = code.split('if (has("reveal"))')[0];
    assert.doesNotMatch(sealedHalf, /worst[_ ]miss|by[_ ]family|fn_buckets/i);
  });

  it("states that it does not confer claimability", () => {
    assert.match(src(), /does not make a number claimable/i);
  });
});
