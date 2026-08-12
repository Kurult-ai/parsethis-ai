import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Hermetic by design: only the pure validator is exercised, so the suite needs
// neither Postgres nor Redis.
const { validateOrgPolicyInput, CEILING_FIELDS } = await import("./org-policy.js");

function rejection(result: ReturnType<typeof validateOrgPolicyInput>) {
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  return result;
}

function accepted(result: ReturnType<typeof validateOrgPolicyInput>) {
  if (!result.ok) throw new Error(result.detail);
  return result.value;
}

const EMPTY_CEILING = {
  autoBlockThreshold: null,
  enforcementMode: null,
  defaultMode: null,
  screenUserInput: null,
  screenToolOutputs: null,
  screenForwardedMessages: null,
  executeInSandbox: null,
  enforceToolAllowlist: null,
  bypassEnabled: null,
  lockedFields: [],
};

describe("validateOrgPolicyInput — accepted input", () => {
  it("treats an empty body as an org with no opinion on anything", () => {
    assert.deepEqual(accepted(validateOrgPolicyInput({})), EMPTY_CEILING);
  });

  it("treats a null body as an org with no opinion on anything", () => {
    assert.deepEqual(accepted(validateOrgPolicyInput(null)), EMPTY_CEILING);
  });

  it("accepts a full ceiling with locks", () => {
    const value = accepted(
      validateOrgPolicyInput({
        autoBlockThreshold: 5,
        enforcementMode: "block",
        defaultMode: "pattern-only",
        screenUserInput: true,
        screenToolOutputs: true,
        screenForwardedMessages: false,
        executeInSandbox: true,
        enforceToolAllowlist: false,
        bypassEnabled: false,
        locked_fields: ["autoBlockThreshold", "bypassEnabled"],
      }),
    );
    assert.deepEqual(value, {
      autoBlockThreshold: 5,
      enforcementMode: "block",
      defaultMode: "pattern-only",
      screenUserInput: true,
      screenToolOutputs: true,
      screenForwardedMessages: false,
      executeInSandbox: true,
      enforceToolAllowlist: false,
      bypassEnabled: false,
      lockedFields: ["autoBlockThreshold", "bypassEnabled"],
    });
  });

  it("reads an explicit null as withdrawing the org's opinion", () => {
    const value = accepted(validateOrgPolicyInput({ autoBlockThreshold: null, enforcementMode: null, screenUserInput: null }));
    assert.equal(value.autoBlockThreshold, null);
    assert.equal(value.enforcementMode, null);
    assert.equal(value.screenUserInput, null);
  });

  it("accepts every enforcement mode", () => {
    for (const mode of ["monitor", "warn", "block"]) {
      assert.equal(accepted(validateOrgPolicyInput({ enforcementMode: mode })).enforcementMode, mode);
    }
  });

  it("accepts every screening mode", () => {
    for (const mode of ["full", "pattern-only"]) {
      assert.equal(accepted(validateOrgPolicyInput({ defaultMode: mode })).defaultMode, mode);
    }
  });

  it("accepts false as a real opinion, not as absence", () => {
    const value = accepted(validateOrgPolicyInput({ bypassEnabled: false, screenUserInput: false }));
    assert.equal(value.bypassEnabled, false);
    assert.equal(value.screenUserInput, false);
  });

  it("accepts both threshold boundaries", () => {
    assert.equal(accepted(validateOrgPolicyInput({ autoBlockThreshold: 1 })).autoBlockThreshold, 1);
    assert.equal(accepted(validateOrgPolicyInput({ autoBlockThreshold: 10 })).autoBlockThreshold, 10);
  });

  it("accepts an empty lock list", () => {
    assert.deepEqual(accepted(validateOrgPolicyInput({ locked_fields: [] })).lockedFields, []);
  });

  it("deduplicates repeated lock names", () => {
    const value = accepted(
      validateOrgPolicyInput({ autoBlockThreshold: 4, locked_fields: ["autoBlockThreshold", "autoBlockThreshold"] }),
    );
    assert.deepEqual(value.lockedFields, ["autoBlockThreshold"]);
  });

  it("accepts a lock on every ceiling field when each has a value", () => {
    const value = accepted(
      validateOrgPolicyInput({
        autoBlockThreshold: 3,
        enforcementMode: "warn",
        defaultMode: "full",
        screenUserInput: true,
        screenToolOutputs: true,
        screenForwardedMessages: true,
        executeInSandbox: true,
        enforceToolAllowlist: true,
        bypassEnabled: false,
        locked_fields: [...CEILING_FIELDS],
      }),
    );
    assert.deepEqual(value.lockedFields, [...CEILING_FIELDS]);
  });
});

describe("validateOrgPolicyInput — autoBlockThreshold", () => {
  it("rejects a threshold below 1", () => {
    const result = rejection(validateOrgPolicyInput({ autoBlockThreshold: 0 }));
    assert.equal(result.status, 400);
    assert.match(result.detail, /between 1 and 10/);
  });

  it("rejects a threshold above 10", () => {
    assert.match(rejection(validateOrgPolicyInput({ autoBlockThreshold: 11 })).detail, /between 1 and 10/);
  });

  it("rejects a non-integer threshold", () => {
    const result = rejection(validateOrgPolicyInput({ autoBlockThreshold: 5.5 }));
    assert.equal(result.code, "validation.invalid_type");
  });

  it("rejects a numeric string threshold rather than coercing it", () => {
    assert.equal(rejection(validateOrgPolicyInput({ autoBlockThreshold: "5" })).code, "validation.invalid_type");
  });
});

describe("validateOrgPolicyInput — modes", () => {
  it("rejects an unknown enforcement mode", () => {
    const result = rejection(validateOrgPolicyInput({ enforcementMode: "strict" }));
    assert.equal(result.status, 400);
    assert.match(result.detail, /monitor, warn, block/);
  });

  it("rejects a non-string enforcement mode", () => {
    assert.equal(rejection(validateOrgPolicyInput({ enforcementMode: 3 })).ok, false);
  });

  it("rejects an unknown screening mode", () => {
    assert.match(rejection(validateOrgPolicyInput({ defaultMode: "patterns" })).detail, /full, pattern-only/);
  });
});

describe("validateOrgPolicyInput — booleans", () => {
  const booleanFields = [
    "screenUserInput",
    "screenToolOutputs",
    "screenForwardedMessages",
    "executeInSandbox",
    "enforceToolAllowlist",
    "bypassEnabled",
  ];

  it("rejects a non-boolean on every boolean field", () => {
    for (const field of booleanFields) {
      const result = rejection(validateOrgPolicyInput({ [field]: "true" }));
      assert.equal(result.code, "validation.invalid_type");
      assert.match(result.detail, new RegExp(field));
    }
  });

  it("rejects 1 and 0 rather than reading them as booleans", () => {
    assert.equal(rejection(validateOrgPolicyInput({ executeInSandbox: 1 })).ok, false);
    assert.equal(rejection(validateOrgPolicyInput({ bypassEnabled: 0 })).ok, false);
  });
});

describe("validateOrgPolicyInput — locked_fields", () => {
  it("rejects an unknown field name, so a typo cannot lock nothing", () => {
    const result = rejection(validateOrgPolicyInput({ autoBlockThreshold: 5, locked_fields: ["autoBlockThresold"] }));
    assert.equal(result.status, 400);
    assert.match(result.detail, /must be one of/);
  });

  it("rejects a field name that is not a ceiling field", () => {
    assert.equal(rejection(validateOrgPolicyInput({ locked_fields: ["screenAllPrompts"] })).ok, false);
    assert.equal(rejection(validateOrgPolicyInput({ locked_fields: ["environment"] })).ok, false);
  });

  it("rejects a non-string entry", () => {
    assert.equal(rejection(validateOrgPolicyInput({ locked_fields: [7] })).ok, false);
  });

  it("rejects locked_fields that is not an array", () => {
    const result = rejection(validateOrgPolicyInput({ locked_fields: "autoBlockThreshold" }));
    assert.equal(result.code, "validation.invalid_type");
  });

  it("rejects a lock on a field the org left null, which would govern nothing", () => {
    const result = rejection(validateOrgPolicyInput({ locked_fields: ["enforcementMode"] }));
    assert.match(result.detail, /has no org value/);
  });

  it("accepts a lock on a field set to false", () => {
    const value = accepted(validateOrgPolicyInput({ bypassEnabled: false, locked_fields: ["bypassEnabled"] }));
    assert.deepEqual(value.lockedFields, ["bypassEnabled"]);
  });

  it("treats a null locked_fields as no locks", () => {
    assert.deepEqual(accepted(validateOrgPolicyInput({ locked_fields: null })).lockedFields, []);
  });
});

// The body mixes conventions: every value field is camelCase, the lock list is
// snake_case. An admin who writes the natural `lockedFields` beside
// `autoBlockThreshold` used to get 200 and an empty lock list — they believed
// the ceiling was locked and it was not. A silently dropped lock is worse than
// a rejected one, so the validator now accepts the alias and refuses anything
// it does not recognise.
describe("validateOrgPolicyInput — the casing trap", () => {
  it("accepts camelCase lockedFields as an alias, rather than dropping it", () => {
    const value = accepted(
      validateOrgPolicyInput({
        autoBlockThreshold: 5,
        enforcementMode: "block",
        lockedFields: ["autoBlockThreshold", "enforcementMode"],
      }),
    );
    assert.deepEqual(value.lockedFields, ["autoBlockThreshold", "enforcementMode"]);
  });

  it("still accepts the snake_case spelling", () => {
    const value = accepted(
      validateOrgPolicyInput({ autoBlockThreshold: 5, locked_fields: ["autoBlockThreshold"] }),
    );
    assert.deepEqual(value.lockedFields, ["autoBlockThreshold"]);
  });

  it("rejects a field name it does not recognise instead of ignoring it", () => {
    const result = rejection(validateOrgPolicyInput({ autoBlockThreshold: 5, lockedField: ["autoBlockThreshold"] }));
    assert.match(result.detail, /lockedField/);
  });

  it("names the fields it will accept, so the caller can fix the request", () => {
    const result = rejection(validateOrgPolicyInput({ autoBlockThresold: 5 }));
    assert.match(result.detail, /autoBlockThreshold/);
  });

  it("does not let the alias smuggle in a lock on a field with no org value", () => {
    const result = rejection(validateOrgPolicyInput({ lockedFields: ["enforcementMode"] }));
    assert.match(result.detail, /has no org value/);
  });
});
