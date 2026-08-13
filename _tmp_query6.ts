import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const proposals = await prisma.adminImprovementProposal.findMany({
      where: { 
        status: "proposed",
        OR: [
          { title: { contains: "free tier", mode: "insensitive" } },
          { title: { contains: "monthly", mode: "insensitive" } },
          { title: { contains: "quota", mode: "insensitive" } },
          { title: { contains: "unlimited", mode: "insensitive" } },
          { title: { contains: "upgrade incentive", mode: "insensitive" } },
          { title: { contains: "soft cap", mode: "insensitive" } },
          { title: { contains: "revenue leak", mode: "insensitive" } },
        ]
      },
      select: { id: true, title: true, idempotencyKey: true, priority: true }
    });
    console.log("MATCHING:", JSON.stringify(proposals, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
