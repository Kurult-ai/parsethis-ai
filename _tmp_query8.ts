import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Count P0/P1 proposals
    const p10 = await prisma.adminImprovementProposal.count({ where: { status: "proposed", priority: 10 } });
    const p9 = await prisma.adminImprovementProposal.count({ where: { status: "proposed", priority: 9 } });
    const p8 = await prisma.adminImprovementProposal.count({ where: { status: "proposed", priority: 8 } });
    
    // Check categories distribution
    const byCategory = await prisma.adminImprovementProposal.groupBy({
      by: ["category"],
      where: { status: "proposed" },
      _count: true,
      orderBy: { _count: { category: "desc" } }
    });
    
    console.log(JSON.stringify({ p10, p9, p8, byCategory }, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
