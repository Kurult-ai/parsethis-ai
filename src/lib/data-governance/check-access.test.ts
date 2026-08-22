/**
 * Tier-1 path-scoped data source tests (plan 2026-08-22-file-acl-plan.md).
 * checkDataAccess with path-bearing entries against path-scoped grants.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDataAccess, invalidateGrantCache } from "./check-access.js";

// Fake prisma: agent has grants to two sources —
//  src-contracts (pathPattern "contracts/**"), src-all (pathPattern null).
const fakePrisma = {
  agentDataGrant: {
    findMany: async (args: unknown) => {
      const rows = [
        { dataSourceId: "src-contracts", dataSource: { pathPattern: "contracts/**" } },
        { dataSourceId: "src-all", dataSource: { pathPattern: null } },
      ];
      void args;
      return rows;
    },
  },
};

test.before(async () => {
  const mod = await import("./check-access.js");
  mod.setPrismaAccessorForTests(async () => fakePrisma);
});

test("path in scope passes; path out of scope violates; unscoped source passes any path", async () => {
  invalidateGrantCache("agent-1");
  const ok = await checkDataAccess("agent-1", [
    { dataSourceId: "src-contracts", path: "/repo/contracts/a.md" },
  ]);
  assert.equal(ok.allowed, true);

  invalidateGrantCache("agent-1");
  const bad = await checkDataAccess("agent-1", [
    { dataSourceId: "src-contracts", path: "/repo/payroll/x.csv" },
  ]);
  assert.equal(bad.allowed, false);
  assert.equal(bad.violations[0]?.reason, "path_outside_source_scope");

  invalidateGrantCache("agent-1");
  const any = await checkDataAccess("agent-1", [
    { dataSourceId: "src-all", path: "/whatever/anywhere.txt" },
  ]);
  assert.equal(any.allowed, true);
});

test("legacy string entries behave exactly as before", async () => {
  invalidateGrantCache("agent-2");
  const legacy = await checkDataAccess("agent-2", ["src-contracts", "src-missing"]);
  assert.equal(legacy.allowed, false);
  assert.deepEqual(
    legacy.violations.map((v) => v.reason),
    ["no_active_grant"],
  );
});

test("malformed object entry reports instead of crashing", async () => {
  invalidateGrantCache("agent-3");
  const r = await checkDataAccess("agent-3", [{ path: "/etc/passwd" }]);
  assert.equal(r.allowed, false);
  assert.equal(r.violations[0]?.reason, "malformed_entry");
});
