import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Hermetic by design: only the pure validators are exercised, so the suite
// needs neither Postgres nor Redis.
const { validateRuleInput, validateModeInput, validateTestInput } = await import("./tool-policy.js");

function rejection(result: ReturnType<typeof validateRuleInput>) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  return result;
}

describe("validateModeInput", () => {
  it("accepts blocklist and allowlist", () => {
    for (const mode of ["blocklist", "allowlist"] as const) {
      const result = validateModeInput({ mode });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value, mode);
    }
  });

  it("rejects any other mode", () => {
    for (const mode of ["monitor", "", 3, null, undefined]) {
      const result = validateModeInput({ mode });
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.status, 400);
        assert.equal(result.code, "validation.invalid_input");
      }
    }
  });
});

describe("validateRuleInput — accepted rules", () => {
  it("accepts a category rule and defaults priority to 0", () => {
    const result = validateRuleInput({ kind: "category", pattern: "browser", action: "block" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      kind: "category",
      pattern: "browser",
      action: "block",
      scopeType: null,
      scopeId: null,
      priority: 0,
      reason: null,
    });
  });

  it("accepts exact and prefix rules without touching the catalog", () => {
    const exact = validateRuleInput({ kind: "exact", pattern: "playwright", action: "require_approval" });
    assert.equal(exact.ok, true);
    if (exact.ok) assert.equal(exact.value.action, "require_approval");

    const prefix = validateRuleInput({
      kind: "prefix",
      pattern: "mcp__claude-in-chrome__",
      action: "allow",
    });
    assert.equal(prefix.ok, true);
    if (prefix.ok) assert.equal(prefix.value.pattern, "mcp__claude-in-chrome__");
  });

  it("trims the pattern and the reason, and keeps an explicit priority", () => {
    const result = validateRuleInput({
      kind: "exact",
      pattern: "  bash  ",
      action: "block",
      priority: 500,
      reason: "  no shells in prod  ",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value.pattern, "bash");
    assert.equal(result.value.reason, "no shells in prod");
    assert.equal(result.value.priority, 500);
  });

  it("accepts agent, api_key and role scopes", () => {
    const agent = validateRuleInput({
      kind: "category",
      pattern: "email",
      action: "block",
      scope_type: "agent",
      scope_id: "agt_123",
    });
    assert.equal(agent.ok, true);
    if (agent.ok) {
      assert.equal(agent.value.scopeType, "agent");
      assert.equal(agent.value.scopeId, "agt_123");
    }

    const key = validateRuleInput({
      kind: "category",
      pattern: "email",
      action: "block",
      scope_type: "api_key",
      scope_id: "key_123",
    });
    assert.equal(key.ok, true);

    const role = validateRuleInput({
      kind: "category",
      pattern: "email",
      action: "block",
      scope_type: "role",
      scope_id: "developer",
    });
    assert.equal(role.ok, true);
    if (role.ok) assert.equal(role.value.scopeId, "developer");
  });

  it("accepts the boundary priorities 0 and 1000", () => {
    for (const priority of [0, 1000]) {
      const result = validateRuleInput({ kind: "exact", pattern: "bash", action: "block", priority });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.value.priority, priority);
    }
  });
});

describe("validateRuleInput — rejections", () => {
  it("rejects a missing or unknown kind", () => {
    for (const kind of [undefined, null, "", "regex", 7]) {
      const result = rejection(validateRuleInput({ kind, pattern: "browser", action: "block" }));
      assert.equal(result.status, 400);
      assert.match(result.detail, /kind must be one of/);
    }
  });

  it("rejects a missing or unknown action", () => {
    for (const action of [undefined, "deny", "warn", 1]) {
      const result = rejection(validateRuleInput({ kind: "exact", pattern: "bash", action }));
      assert.match(result.detail, /action must be one of/);
    }
  });

  it("rejects an empty or non-string pattern", () => {
    for (const pattern of [undefined, null, "", "   ", 42]) {
      const result = rejection(validateRuleInput({ kind: "exact", pattern, action: "block" }));
      assert.equal(result.code, "validation.required");
      assert.match(result.detail, /pattern is required/);
    }
  });

  it("rejects a pattern longer than 200 characters", () => {
    const result = rejection(
      validateRuleInput({ kind: "exact", pattern: "a".repeat(201), action: "block" }),
    );
    assert.equal(result.code, "validation.too_large");
  });

  it("rejects a category rule naming an unknown slug, and lists the valid ones", () => {
    const result = rejection(
      validateRuleInput({ kind: "category", pattern: "web3", action: "block" }),
    );
    assert.match(result.detail, /known catalog category/);
    assert.match(result.detail, /browser/);
    assert.match(result.detail, /code_execution/);
  });

  it("rejects an unknown scope_type", () => {
    const result = rejection(
      validateRuleInput({
        kind: "exact",
        pattern: "bash",
        action: "block",
        scope_type: "team",
        scope_id: "t_1",
      }),
    );
    assert.match(result.detail, /scope_type must be one of/);
  });

  it("rejects scope_type without scope_id", () => {
    const result = rejection(
      validateRuleInput({ kind: "exact", pattern: "bash", action: "block", scope_type: "agent" }),
    );
    assert.equal(result.code, "validation.required");
    assert.match(result.detail, /scope_id is required/);
  });

  it("rejects scope_id without scope_type", () => {
    const result = rejection(
      validateRuleInput({ kind: "exact", pattern: "bash", action: "block", scope_id: "agt_1" }),
    );
    assert.equal(result.code, "validation.required");
    assert.match(result.detail, /scope_type is required/);
  });

  it("rejects an empty or non-string scope_id", () => {
    for (const scopeId of ["", "   ", 12]) {
      const result = rejection(
        validateRuleInput({
          kind: "exact",
          pattern: "bash",
          action: "block",
          scope_type: "agent",
          scope_id: scopeId,
        }),
      );
      assert.match(result.detail, /scope_id must be a non-empty string/);
    }
  });

  it("rejects a role scope whose scope_id is not a real role", () => {
    const result = rejection(
      validateRuleInput({
        kind: "exact",
        pattern: "bash",
        action: "block",
        scope_type: "role",
        scope_id: "intern",
      }),
    );
    assert.match(result.detail, /org_admin/);
  });

  it("rejects a non-integer or out-of-range priority", () => {
    for (const priority of ["5", 1.5, -1, 1001]) {
      const result = rejection(
        validateRuleInput({ kind: "exact", pattern: "bash", action: "block", priority }),
      );
      assert.match(result.detail, /priority must be/);
    }
  });

  it("rejects a non-string or oversized reason", () => {
    const wrongType = rejection(
      validateRuleInput({ kind: "exact", pattern: "bash", action: "block", reason: 5 }),
    );
    assert.match(wrongType.detail, /reason must be a string/);

    const tooLong = rejection(
      validateRuleInput({ kind: "exact", pattern: "bash", action: "block", reason: "x".repeat(501) }),
    );
    assert.equal(tooLong.code, "validation.too_large");
  });

  it("rejects a null or non-object body", () => {
    assert.equal(validateRuleInput(null).ok, false);
    assert.equal(validateRuleInput(undefined).ok, false);
  });
});

describe("validateTestInput", () => {
  it("accepts a tool list and an optional scope", () => {
    const result = validateTestInput({
      tools: [" playwright ", "bash"],
      agent_id: "agt_1",
      api_key_id: "key_1",
      role: "developer",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.tools, ["playwright", "bash"]);
    assert.deepEqual(result.value.scope, { agentId: "agt_1", apiKeyId: "key_1", role: "developer" });
  });

  it("accepts exactly 100 tools and rejects 101", () => {
    const hundred = validateTestInput({ tools: Array.from({ length: 100 }, (_, i) => `tool_${i}`) });
    assert.equal(hundred.ok, true);

    const overflow = validateTestInput({ tools: Array.from({ length: 101 }, (_, i) => `tool_${i}`) });
    assert.equal(overflow.ok, false);
    if (!overflow.ok) {
      assert.equal(overflow.status, 400);
      assert.equal(overflow.code, "validation.too_large");
    }
  });

  it("rejects a missing, empty, or non-array tools field", () => {
    for (const tools of [undefined, [], "browser", {}]) {
      const result = validateTestInput({ tools });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "validation.required");
    }
  });

  it("rejects non-string entries in tools", () => {
    const result = validateTestInput({ tools: ["bash", 7] });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.detail, /every entry in tools/);
  });

  it("rejects an unknown role", () => {
    const result = validateTestInput({ tools: ["bash"], role: "intern" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.detail, /role must be one of/);
  });
});
