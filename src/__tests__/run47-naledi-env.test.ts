/**
 * Run 47 (Naledi Moyo) named-environment pins.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { isEnvironmentName } from "../auth.js";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-run47";

const { app } = await import("../app.js");
const hasDatabase = Boolean(process.env.DATABASE_URL);

function authHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "X-Parse-Probe": "1",
  };
}

describe("run 47 Naledi — environment names", () => {
  it("accepts disaster-recovery and rejects spaces", () => {
    assert.equal(isEnvironmentName("disaster-recovery"), true);
    assert.equal(isEnvironmentName("production"), true);
    assert.equal(isEnvironmentName("disaster recovery"), false);
    assert.equal(isEnvironmentName(""), false);
  });
});

describe("run 47 Naledi — policy persists named environments", { skip: !hasDatabase }, () => {
  const stamp = Date.now();
  let key: { id: string; key: string } | undefined;

  after(async () => {
    if (!key?.id) return;
    const { prisma } = await import("../db.js");
    await prisma.screeningPolicy.deleteMany({ where: { apiKeyId: key.id } }).catch(() => {});
    await prisma.apiKey.delete({ where: { id: key.id } }).catch(() => {});
  });

  it("PUT disaster-recovery writes that name, not production", async () => {
    const { createApiKey } = await import("../auth.js");
    key = await createApiKey(`Naledi run47 env ${stamp}`, ["analyze", "evaluate"]);
    const put = await app.request("/v1/policy", {
      method: "PUT",
      headers: { ...authHeaders(key.key), "X-Parse-Environment": "disaster-recovery" },
      body: JSON.stringify({ enforcement_mode: "monitor" }),
    });
    assert.equal(put.status, 200, await put.clone().text());
    const written = await put.json();
    assert.equal(written.environment_written, "disaster-recovery");
    assert.equal(written.environment, "disaster-recovery");

    const get = await app.request("/v1/policy", {
      headers: { ...authHeaders(key.key), "X-Parse-Environment": "disaster-recovery" },
    });
    assert.equal(get.status, 200, await get.clone().text());
    const body = await get.json();
    assert.ok(
      Array.isArray(body.environments) && body.environments.includes("disaster-recovery"),
      JSON.stringify(body.environments),
    );

    const bad = await app.request("/v1/policy", {
      method: "PUT",
      headers: { ...authHeaders(key.key), "X-Parse-Environment": "disaster recovery" },
      body: JSON.stringify({ enforcement_mode: "block" }),
    });
    assert.equal(bad.status, 400, await bad.clone().text());
    const err = await bad.json();
    assert.match(String(err.error), /Invalid environment/);
  });
});
