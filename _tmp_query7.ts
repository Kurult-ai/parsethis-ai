import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const proposals = await prisma.adminImprovementProposal.findMany({
      where: { 
        status: "proposed",
        title: { contains: "free", mode: "insensitive" }
      },
      select: { id: true, title: true, idempotencyKey: true, priority: true }
    });
    console.log("FREE-RELATED:", JSON.stringify(proposals, null, 2));
    
    // Also count all proposals by status
    const byStatus = await prisma.adminImprovementProposal.groupBy({
      by: ["status"],
      _count: true
    });
    console.log("BY_STATUS:", JSON.stringify(byStatus));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
