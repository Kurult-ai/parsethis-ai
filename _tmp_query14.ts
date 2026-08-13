import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Check mode distribution
    const byMode = await prisma.screeningEvent.groupBy({
      by: ["mode"],
      _count: true
    });
    console.log("BY_MODE:", JSON.stringify(byMode));
    
    // Check verdict distribution
    const byVerdict = await prisma.screeningEvent.groupBy({
      by: ["verdict"],
      _count: true
    });
    console.log("BY_VERDICT:", JSON.stringify(byVerdict));
    
    // Check the countSelfServiceKeys function
    const allKeys = await prisma.apiKey.count();
    const selfServiceNonRevoked = await prisma.apiKey.count({
      where: { userId: "self-service", revokedAt: null }
    });
    console.log("ALL_KEYS:", allKeys, "SELF_SERVICE_ACTIVE:", selfServiceNonRevoked);
    
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
