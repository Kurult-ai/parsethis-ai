import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const recent = await prisma.adminImprovementProposal.findMany({
      where: { status: "proposed", priority: { gte: 9 } },
      select: { id: true, title: true, priority: true, category: true, createdAt: true, idempotencyKey: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 100
    });
    console.log("COUNT:", recent.length);
    recent.forEach((p, i) => {
      console.log(`\n${i+1}. [P${p.priority}] (${p.category}) ${p.title}`);
    });
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
