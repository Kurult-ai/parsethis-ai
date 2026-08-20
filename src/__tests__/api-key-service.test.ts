import { describe, it } from "node:test";
import assert from "node:assert/strict";

const hasDatabase = !!process.env.DATABASE_URL;

describe("API key creation", { skip: !hasDatabase }, () => {
  it("persists caller-provided scopes on the database row", async () => {
    const { createApiKey } = await import("../auth.js");
    const { prisma } = await import("../db.js");
    const scopes = ["analyze", "evaluate", "chat"];
    const key = await createApiKey("scope-regression-test", scopes);

    try {
      const row = await prisma.apiKey.findUniqueOrThrow({
        where: { id: key.id },
        select: { scopes: true },
      });

      assert.deepEqual(row.scopes, scopes);
    } finally {
      await prisma.apiKey.delete({ where: { id: key.id } }).catch(() => {});
    }
  });
});
