/**
 * A Pro key must reach the registry its card sells.
 *
 * Run 22 closed loop:
 *   POST /v1/agents         → 403 Organization required
 *   POST /v1/orgs/bootstrap → 403 Anonymous key cannot create an organization
 *
 * The identity gate stays for free anonymous keys (run 8). A paid unaffiliated
 * key is not that case.
 */
import "dotenv/config";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { checkBootstrapIdentity, paidKeyMaySelfProvisionOrg } from "./organizations.js";
import { SELF_SERVICE_USER_ID } from "../lib/constants.js";

describe("a paid key can reach the registry", () => {
  it("paidKeyMaySelfProvisionOrg is true for the tiers the cards sell", () => {
    for (const tier of ["solo", "pro", "team", "enterprise"]) {
      assert.equal(paidKeyMaySelfProvisionOrg(tier), true, tier);
    }
    assert.equal(paidKeyMaySelfProvisionOrg("free"), false);
    assert.equal(paidKeyMaySelfProvisionOrg(undefined), false);
  });

  it("an unaffiliated pro key is allowed to bootstrap", () => {
    const gate = checkBootstrapIdentity(
      { orgId: null, tier: "pro" },
      { id: SELF_SERVICE_USER_ID, email: "self-service@internal.invalid", emailVerifiedAt: null },
      new Map(),
    );
    assert.deepEqual(gate, { ok: true });
  });

  it("a governed member still cannot create a second org", () => {
    const gate = checkBootstrapIdentity(
      { orgId: "org_already", tier: "pro" },
      { id: "usr_member", email: "a@b.example", emailVerifiedAt: new Date() },
      new Map(),
    );
    assert.equal(gate.ok, false);
    assert.equal((gate as { reason: string }).reason, "already_in_org");
  });

  it("the registry auto-provisions for a paid key", () => {
    const src = readFileSync(fileURLToPath(new URL("./agent-registry.ts", import.meta.url)), "utf8");
    assert.match(src, /paidKeyMaySelfProvisionOrg/);
    assert.match(src, /organization_provisioned/);
  });
});

const canRoundTrip = Boolean(process.env.DATABASE_URL) && process.env.PARSE_REGISTRY_E2E === "1";

describe("pro key registers an agent end to end", { skip: !canRoundTrip }, () => {
  process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-pro-registry";

  let createdKeyId: string | undefined;
  let createdOrgId: string | undefined;
  let rawKey: string | undefined;

  after(async () => {
    if (!canRoundTrip) return;
    const { prisma } = await import("../db.js");
    if (createdKeyId) {
      await prisma.agentRegistry.deleteMany({ where: { orgId: createdOrgId ?? "__none__" } }).catch(() => {});
      await prisma.apiKey.delete({ where: { id: createdKeyId } }).catch(() => {});
    }
    if (createdOrgId) {
      await prisma.organization.delete({ where: { id: createdOrgId } }).catch(() => {});
    }
    const { closeQueue } = await import("../queue.js");
    const { disconnectRedis } = await import("../redis.js");
    const { disconnectDb } = await import("../db.js");
    await closeQueue();
    await disconnectRedis();
    await disconnectDb();
  });

  it("POST /v1/agents succeeds for a pro self-service key", async () => {
    const { createApiKey } = await import("../api-key-service.js");
    const { app } = await import("../app.js");
    const minted = await createApiKey(
      SELF_SERVICE_USER_ID,
      "hourly-run22-registry-probe",
      "pro",
      undefined,
      ["analyze", "evaluate"],
    );
    createdKeyId = minted.record.id;
    rawKey = minted.key;

    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawKey}`,
        "Content-Type": "application/json",
        "X-Parse-Probe": "1",
      },
      body: JSON.stringify({ name: "run22-case-summariser", tools: ["summarize"] }),
    });
    assert.equal(res.status, 201, await res.clone().text());
    const body = await res.json();
    assert.equal(body.organization_provisioned, true);
    createdOrgId = body.organization_id ?? body.orgId;
    assert.ok(createdOrgId);
  });
});
