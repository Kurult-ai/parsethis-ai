import { getPrisma } from "../src/db.js";

async function main() {
  const p = getPrisma();
  const keys = await p.apiKey.findMany({
    where: { revokedAt: null, name: { contains: "TEST" } },
    select: { id: true, name: true, tier: true, createdAt: true, expiresAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(keys, null, 1));
  await p.$disconnect();
}
main();
