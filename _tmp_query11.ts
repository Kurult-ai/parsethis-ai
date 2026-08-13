import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Group by date
    const proposals = await prisma.adminImprovementProposal.findMany({
      where: { status: "proposed" },
      select: { createdAt: true, priority: true },
      orderBy: { createdAt: "asc" }
    });
    
    const byDate: Record<string, number> = {};
    proposals.forEach(p => {
      const d = p.createdAt.toISOString().slice(0, 10);
      byDate[d] = (byDate[d] || 0) + 1;
    });
    
    console.log("BY_DATE:", JSON.stringify(byDate, null, 2));
    console.log("TOTAL:", proposals.length);
    
    // Count how many are from before Aug 12 (likely stale)
    const beforeAug12 = proposals.filter(p => p.createdAt < new Date("2026-08-12")).length;
    const afterAug12 = proposals.filter(p => p.createdAt >= new Date("2026-08-12")).length;
    console.log("BEFORE_AUG_12:", beforeAug12, "AFTER_AUG_12:", afterAug12);
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
