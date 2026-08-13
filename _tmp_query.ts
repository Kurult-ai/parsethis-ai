import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const proposals = await prisma.adminImprovementProposal.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, status: true, idempotencyKey: true, source: true, priority: true, category: true, createdAt: true }
    });
    console.log(JSON.stringify(proposals, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
