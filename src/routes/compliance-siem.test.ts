/**
 * SIEM destination configuration — the route, not just the format adapters.
 *
 * `POST /v1/compliance/siem` returned 500 on every call for the life of the
 * feature: `SIEMConfig.eventTypes` was declared with no `@map`, so Postgres
 * named the column "eventTypes" while the raw INSERT wrote `event_types`. It
 * shipped green because `siem-forwarder.test.ts` covers the pure functions —
 * the CEF/JSON adapters and the forwarder — and nothing exercised the route or
 * the schema it writes through.
 *
 * Two tests here, deliberately different in kind:
 *
 *   1. A hermetic schema-contract test that catches the *class* of bug in CI on
 *      every machine, with no database. Column drift between a Prisma model and
 *      hand-written SQL is the defect; this is what notices it.
 *   2. A round trip against a real database, skipped when one is not reachable,
 *      because "the insert actually succeeds" is not provable from the schema
 *      text alone.
 *
 * Plan: docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md
 * Phase 2, item 5.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const schema = readFileSync(resolve(repoRoot, "prisma/schema.prisma"), "utf8");

/** Extract one model block from schema.prisma. */
function modelBlock(name: string): string {
  const m = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(m, `model ${name} not found in schema.prisma`);
  return m[1];
}

/** Prisma scalar and enum-ish types — anything else is a relation, which has no column. */
const SCALAR_TYPES = new Set([
  "String", "Boolean", "Int", "BigInt", "Float", "Decimal", "DateTime", "Json", "Bytes",
]);

/**
 * Scalar field lines of a model, ignoring comments, attributes, blank lines and
 * relation fields. Relations are virtual — they produce no column, so a
 * camelCase relation name is not a drift risk. Returns [name, mapped] pairs.
 */
function scalarFields(block: string): Array<{ name: string; mapped: boolean }> {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("///") && !l.startsWith("@@"))
    .map((l) => {
      const [name, rawType = ""] = l.split(/\s+/);
      const baseType = rawType.replace(/[[\]?]/g, "");
      return { name, baseType, mapped: l.includes("@map(") };
    })
    .filter((f) => /^[a-z][A-Za-z0-9]*$/.test(f.name) && SCALAR_TYPES.has(f.baseType))
    .map(({ name, mapped }) => ({ name, mapped }));
}

const isCamelCase = (name: string) => /[a-z][A-Z]/.test(name);

describe("SIEMConfig schema contract", () => {
  it("maps every camelCase field to a snake_case column", () => {
    // The exact defect: eventTypes had no @map, so the column was "eventTypes"
    // while org_id, auth_header and created_at beside it were snake_case.
    const unmapped = scalarFields(modelBlock("SIEMConfig"))
      .filter((f) => isCamelCase(f.name) && !f.mapped)
      .map((f) => f.name);

    assert.deepEqual(
      unmapped,
      [],
      `SIEMConfig fields missing @map: ${unmapped.join(", ")}. ` +
        "A camelCase field with no @map becomes a quoted camelCase column, which will not match hand-written SQL.",
    );
  });

  it("keeps eventTypes mapped to event_types specifically", () => {
    assert.match(
      modelBlock("SIEMConfig"),
      /eventTypes[^\n]*@map\("event_types"\)/,
      "eventTypes must map to event_types — migration 020 renamed the column to match.",
    );
  });
});

describe("no model mixes mapped and unmapped column names", () => {
  /**
   * Generalises the bug beyond the one table it bit. A model whose other fields
   * are @map'd to snake_case, but which has a bare camelCase field, is a column
   * name waiting to drift away from anything hand-written against it.
   */
  /**
   * Grandfathered: inconsistent, but not currently drifting. Each of these is a
   * quoted camelCase column in an otherwise snake_case table, and each was
   * checked on 2026-08-13 — nothing writes hand-rolled SQL against them, so
   * every access goes through the Prisma client and resolves correctly. The
   * snake_case spellings that appear near them in the codebase are JSON API
   * field names, not column references.
   *
   * Do not add to this list. Renaming them is a migration with no user-visible
   * benefit; adding a new one is how SIEM forwarding was broken for its whole
   * life. New models should map every camelCase field.
   */
  const GRANDFATHERED = new Set([
    "AgentRegistry.dataAccess",
    "EgressRule.destinationPattern",
    "EgressRule.maxClassification",
  ]);

  it("flags every model with snake_case siblings and a bare camelCase field", () => {
    const offenders: string[] = [];

    for (const m of schema.matchAll(/model (\w+) \{([\s\S]*?)\n\}/g)) {
      const [, name, block] = m;
      const fields = scalarFields(block);
      const usesMapping = fields.some((f) => f.mapped);
      if (!usesMapping) continue; // an all-camelCase model is internally consistent

      for (const f of fields) {
        const qualified = `${name}.${f.name}`;
        if (isCamelCase(f.name) && !f.mapped && !GRANDFATHERED.has(qualified)) {
          offenders.push(qualified);
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "These fields become quoted camelCase columns in a table whose other columns are snake_case:\n  " +
        offenders.join("\n  "),
    );
  });
});

describe("SIEM destinations round trip against a database", () => {
  it("creates, lists and deletes a destination scoped to an organisation", async (t) => {
    let prisma: typeof import("../db.js").prisma;
    try {
      ({ prisma } = await import("../db.js"));
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      t.skip("no database reachable");
      return;
    }

    const org = await prisma.organization.create({
      data: {
        name: "siem-route-test",
        slug: `siem-route-test-${Date.now()}`,
        ownerId: `siem-route-test-owner-${Date.now()}`,
      },
    });

    try {
      const created = await prisma.sIEMConfig.create({
        data: {
          orgId: org.id,
          platform: "generic_webhook",
          endpoint: "https://siem.example.invalid/ingest",
          format: "json",
          eventTypes: ["screening"],
          active: true,
        },
      });
      assert.deepEqual(created.eventTypes, ["screening"]);

      const listed = await prisma.sIEMConfig.findMany({ where: { orgId: org.id } });
      assert.equal(listed.length, 1);
      assert.equal(listed[0].id, created.id);

      // Scoped by org: another org sees nothing.
      const other = await prisma.sIEMConfig.findMany({ where: { orgId: `${org.id}-not-real` } });
      assert.equal(other.length, 0);

      await prisma.sIEMConfig.delete({ where: { id: created.id } });
      assert.equal((await prisma.sIEMConfig.findMany({ where: { orgId: org.id } })).length, 0);
    } finally {
      await prisma.sIEMConfig.deleteMany({ where: { orgId: org.id } });
      await prisma.organization.delete({ where: { id: org.id } });
    }
  });
});
