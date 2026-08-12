import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { extractAgentId, usedTopLevelAgentId } from "./agent-id.js";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Prospect run 8 froze an agent and then sent the same request twice, changing
 * only where `agent_id` sat. One was blocked with `agent_frozen`; the other came
 * back `safe / allow`. These pin both halves of the fix: the reader accepts both
 * placements, and every control in the screening route uses the reader.
 */
describe("agent id extraction", () => {
  it("reads the documented metadata placement", () => {
    assert.equal(extractAgentId({ metadata: { agent_id: "claims-intake" } }), "claims-intake");
  });

  it("reads the top-level alias, which is where callers actually put it", () => {
    assert.equal(extractAgentId({ agent_id: "claims-intake" }), "claims-intake");
  });

  it("prefers metadata when a caller sends both", () => {
    assert.equal(
      extractAgentId({ agent_id: "top", metadata: { agent_id: "canonical" } }),
      "canonical",
    );
  });

  it("trims, and treats blank as absent", () => {
    assert.equal(extractAgentId({ agent_id: "  spaced  " }), "spaced");
    assert.equal(extractAgentId({ agent_id: "   " }), null);
    assert.equal(extractAgentId({ metadata: { agent_id: "" } }), null);
  });

  it("survives the shapes a real body arrives in", () => {
    assert.equal(extractAgentId(null), null);
    assert.equal(extractAgentId(undefined), null);
    assert.equal(extractAgentId({}), null);
    assert.equal(extractAgentId({ metadata: null }), null);
    assert.equal(extractAgentId({ agent_id: 42 as unknown as string }), null);
  });

  it("reports when the alias was the one used", () => {
    assert.equal(usedTopLevelAgentId({ agent_id: "a" }), true);
    assert.equal(usedTopLevelAgentId({ metadata: { agent_id: "a" } }), false);
    assert.equal(usedTopLevelAgentId({ agent_id: "a", metadata: { agent_id: "b" } }), false);
    assert.equal(usedTopLevelAgentId({}), false);
  });
});

describe("every agent-keyed control uses the shared reader", () => {
  it("leaves no direct metadata.agent_id read in the screening route", () => {
    const route = read("../routes/parse.ts");
    assert.doesNotMatch(
      route,
      /metadata\?\.agent_id/,
      "a direct read here is a control that a misplaced field can switch off",
    );
  });

  it("covers the freeze, the tool scope and coverage by name", () => {
    const route = read("../routes/parse.ts");
    for (const site of ["freezeAgentId", "toolAgentId", "coverageAgentId", "dgAgentId", "volAgentId", "sigAgentId"]) {
      assert.match(
        route,
        new RegExp(`const ${site} = extractAgentId\\(body\\)`),
        `${site} must resolve through the shared reader`,
      );
    }
    // The org tool-policy scope resolves the id into a local first, so the
    // same value can be reused for the exception-request help block below it.
    assert.match(
      route,
      /const orgScopeAgentId = extractAgentId\(body\)/,
      "agent-scoped tool rules must match on the resolved id",
    );
    assert.match(
      route,
      /agentId: orgScopeAgentId \?\? undefined/,
      "and that resolved id must be what the resolver is given",
    );
  });

  it("auto-registration shares the reader rather than carrying its own", () => {
    const auto = read("./agent-auto-register.ts");
    assert.match(auto, /import \{ extractAgentId \} from "\.\/agent-id\.js"/);
    assert.doesNotMatch(auto, /function extractAgentId/, "one reader, not two");
  });
});
