import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Self-service key count
    const selfService = await prisma.apiKey.count({ 
      where: { userId: "self-service" } 
    });
    
    // Check if any keys have an actual tier (not free)
    const byTier = await prisma.apiKey.groupBy({
      by: ["tier"],
      _count: true
    });
    console.log("KEYS_BY_TIER:", JSON.stringify(byTier));
    console.log("SELF_SERVICE_COUNT:", selfService);
    
    // Check audit events for key generation
    const keyGens = await prisma.auditEvent.count({
      where: { action: "key_generated" }
    });
    console.log("KEY_GEN_EVENTS:", keyGens);
    
    // Check screening events - are they actually being written now?
    const recentScreenings = await prisma.screeningEvent.findMany({
      take: 3,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, action: true }
    });
    console.log("RECENT_SCREENINGS:", JSON.stringify(recentScreenings));
    
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
