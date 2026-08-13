import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const selfService = await prisma.apiKey.count({ 
      where: { userId: "self-service" } 
    });
    
    const byTier = await prisma.apiKey.groupBy({
      by: ["tier"],
      _count: true
    });
    console.log("KEYS_BY_TIER:", JSON.stringify(byTier));
    console.log("SELF_SERVICE_COUNT:", selfService);
    
    const keyGens = await prisma.auditEvent.count({
      where: { action: "key_generated" }
    });
    console.log("KEY_GEN_EVENTS:", keyGens);
    
    // Recent screenings
    const recent = await prisma.screeningEvent.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, riskScore: true, verdict: true, mode: true }
    });
    console.log("RECENT_SCREENINGS:", JSON.stringify(recent));
    
    // Check how many screenings came from the eval swarm vs real users
    const screeningsByApiKey = await prisma.screeningEvent.groupBy({
      by: ["apiKeyId"],
      _count: true,
      orderBy: { _count: { apiKeyId: "desc" } },
      take: 10
    });
    console.log("TOP_SCREENERS:", JSON.stringify(screeningsByApiKey));
    
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
