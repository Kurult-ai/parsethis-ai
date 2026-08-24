import { describe, it } from "node:test";
import assert from "node:assert/strict";

const hasDatabase = !!process.env.DATABASE_URL;

describe("GET /v1/keys/self", { skip: !hasDatabase }, () => {
  it("returns expiry metadata without the secret", async () => {
    const { app } = await import("../app.js");
    const { createApiKey } = await import("../auth.js");
    const { prisma } = await import("../db.js");
    const { RETENTION } = await import("../lib/retention-facts.js");

    const key = await createApiKey("self-describe-regression", ["analyze", "evaluate", "chat"]);

    try {
      const res = await app.request("/v1/keys/self", {
        method: "GET",
        headers: { Authorization: `Bearer ${key.key}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json() as {
        id: string;
        name: string | null;
        tier: string;
        idle_expiry_days: number | null;
        self_revoke: { method: string; url: string };
        key?: string;
      };
      assert.equal(body.id, key.id);
      assert.equal(body.tier, "free");
      assert.equal(body.idle_expiry_days, RETENTION.selfServiceKeyExpiryDays);
      assert.equal(body.self_revoke.method, "DELETE");
      assert.equal(body.key, undefined);
      assert.ok(!JSON.stringify(body).includes(key.key));
    } finally {
      await prisma.apiKey.delete({ where: { id: key.id } }).catch(() => {});
    }
  });
});

describe("DELETE /v1/keys/self", { skip: !hasDatabase }, () => {
  it("lets a self-service key revoke itself and rejects later use", async () => {
    const { app } = await import("../app.js");
    const { createApiKey } = await import("../auth.js");
    const { prisma } = await import("../db.js");

    const key = await createApiKey("self-revoke-regression", ["analyze", "evaluate", "chat"]);

    try {
      const revokeRes = await app.request("/v1/keys/self", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key.key}` },
      });
      assert.equal(revokeRes.status, 200);
      assert.deepEqual(await revokeRes.json(), { revoked: true, id: key.id });

      const followupRes = await app.request("/v1/policy", {
        headers: { Authorization: `Bearer ${key.key}` },
      });
      assert.equal(followupRes.status, 401);
    } finally {
      await prisma.apiKey.delete({ where: { id: key.id } }).catch(() => {});
    }
  });
});
