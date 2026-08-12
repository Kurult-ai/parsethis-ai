import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { unknownTopLevelFieldWarnings } from "./request-warnings.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("request warnings", () => {
  it("says nothing when the request is well formed", () => {
    assert.deepEqual(
      unknownTopLevelFieldWarnings({ prompt: "hello", metadata: { agent_id: "a" }, mode: "pattern-only" }),
      [],
    );
  });

  it("names the canonical home for a misplaced agent_id", () => {
    const [w] = unknownTopLevelFieldWarnings({ prompt: "x", agent_id: "a" });
    assert.equal(w.code, "misplaced_field");
    assert.equal(w.field, "agent_id");
    assert.equal(w.canonical, "metadata.agent_id");
    assert.match(w.detail, /freeze/, "the warning should say what used to break");
  });

  it("flags a field Parse does not read at all", () => {
    const [w] = unknownTopLevelFieldWarnings({ prompt: "x", agentId: "camelCased" });
    assert.equal(w.code, "unknown_field");
    assert.equal(w.field, "agentId");
    assert.match(w.detail, /ignored/);
    assert.match(w.detail, /Known fields/, "tell the caller what is accepted");
  });

  it("does not warn about tools, which is a real alias", () => {
    const ws = unknownTopLevelFieldWarnings({ prompt: "x", tools: ["playwright"] });
    assert.equal(ws.length, 1);
    assert.equal(ws[0].code, "misplaced_field");
  });

  it("ignores non-objects", () => {
    assert.deepEqual(unknownTopLevelFieldWarnings(null), []);
    assert.deepEqual(unknownTopLevelFieldWarnings("string"), []);
    assert.deepEqual(unknownTopLevelFieldWarnings([1, 2]), []);
  });
});

describe("the screening route attaches them", () => {
  it("only when there is something to say", () => {
    const route = read("../routes/parse.ts");
    assert.match(route, /const requestWarnings = unknownTopLevelFieldWarnings\(body\)/);
    assert.match(
      route,
      /if \(requestWarnings\.length > 0\)/,
      "an always-present empty array is noise on every response",
    );
  });
});

describe("the tool-policy check fails visibly", () => {
  it("marks the response rather than dropping the block silently", () => {
    const route = read("../routes/parse.ts");
    assert.match(route, /reason: "check_failed"/);
    assert.match(
      route,
      /not evidence that the tools it/,
      "the note must deny the clean-verdict reading, not just log",
    );
    assert.match(route, /recordToolPolicyCheckFailure/, "failures must be countable by the org");
  });
});
