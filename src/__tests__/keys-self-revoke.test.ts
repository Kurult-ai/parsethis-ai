import { describe, it } from "node:test";
import assert from "node:assert/strict";

const hasDatabase = !!process.env.DATABASE_URL;

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
