import "dotenv/config";
import { prisma } from "../src/db.js";
import { createApiKey } from "../src/api-key-service.js";

async function seed() {
  console.log("Seeding test API keys...\n");

  const keys = [
    { userId: "dev-user-1", name: "Development Key", tier: "pro" },
    { userId: "dev-user-1", name: "Free Tier Test", tier: "free" },
    { userId: "dev-user-2", name: "Team Test Key", tier: "team" },
  ];

  for (const k of keys) {
    const existing = await prisma.apiKey.findFirst({
      where: { userId: k.userId, name: k.name, revokedAt: null },
    });
    if (existing) {
      console.log(`  [skip] "${k.name}" already exists (prefix: ${existing.keyPrefix})`);
      continue;
    }

    const { key, record } = await createApiKey(k.userId, k.name, k.tier);
    console.log(`  [created] "${k.name}" (tier=${k.tier})`);
    console.log(`            key: ${key}`);
    console.log(`            id:  ${record.id}`);
    console.log();
  }

  console.log("Seed complete.");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
