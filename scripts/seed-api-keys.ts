import "dotenv/config";
import { createApiKey } from "../src/api-key-service.js";
import { disconnectDb } from "../src/db.js";

const SEED_KEYS = [
  { userId: "dev-user-1", name: "Development Key (Free)", tier: "free" },
  { userId: "dev-user-1", name: "Development Key (Pro)", tier: "pro" },
  { userId: "dev-user-2", name: "Team Test Key", tier: "team" },
];

async function seed() {
  console.log("Seeding API keys...\n");

  for (const cfg of SEED_KEYS) {
    const { key, record } = await createApiKey(cfg.userId, cfg.name, cfg.tier);
    console.log(`Created: ${record.name}`);
    console.log(`  Tier:   ${record.tier}`);
    console.log(`  Prefix: ${record.keyPrefix}`);
    console.log(`  Key:    ${key}`);
    console.log(`  Rate:   ${record.rateLimit} req/min`);
    console.log();
  }

  console.log("Done. Save these keys — they cannot be retrieved again.");
  await disconnectDb();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
