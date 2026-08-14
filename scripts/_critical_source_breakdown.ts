import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const yesterday = new Date(Date.now() - 86400000);
  
  // Group criticals by apiKey
  const byKey = await prisma.screeningEvent.groupBy({
    by: ['apiKeyId'],
    _count: true,
    where: { verdict: "critical", createdAt: { gte: yesterday } }
  });
  console.log("=== CRITICAL VERDICTS BY API KEY (24h) ===");
  for (const k of byKey.sort((a,b) => b._count - a._count)) {
    // Get key name
    const key = await prisma.apiKey.findUnique({ where: { id: k.apiKeyId }, select: { name: true, tier: true } });
    console.log(`  key=${k.apiKeyId.substring(0,12)}... name="${key?.name}" tier="${key?.tier}" count=${k._count}`);
  }

  // Time distribution - are they clustered?
  const recent = await prisma.screeningEvent.findMany({
    where: { verdict: "critical", createdAt: { gte: yesterday } },
    select: { createdAt: true },
    orderBy: { createdAt: 'asc' }
  });
  if (recent.length > 0) {
    const first = recent[0].createdAt;
    const last = recent[recent.length - 1].createdAt;
    console.log(`\nTime span: ${first.toISOString()} to ${last.toISOString()}`);
    console.log(`Total: ${recent.length} criticals`);
    
    // Check if clustered in bursts
    const hourBuckets = {};
    for (const r of recent) {
      const h = r.createdAt.toISOString().substring(0, 13);
      hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    }
    console.log("\nBy hour:");
    for (const [h, c] of Object.entries(hourBuckets).sort()) {
      console.log(`  ${h}: ${c}`);
    }
  }

  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
