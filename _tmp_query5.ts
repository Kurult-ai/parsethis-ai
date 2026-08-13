import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Search for any proposal mentioning keygen, upgrade, conversion, funnel, pricing
    const proposals = await prisma.adminImprovementProposal.findMany({
      where: { 
        status: "proposed",
        OR: [
          { title: { contains: "keygen", mode: "insensitive" } },
          { title: { contains: "upgrade", mode: "insensitive" } },
          { title: { contains: "conversion", mode: "insensitive" } },
          { title: { contains: "funnel", mode: "insensitive" } },
          { title: { contains: "pricing", mode: "insensitive" } },
          { title: { contains: "onboard", mode: "insensitive" } },
          { title: { contains: "free tier", mode: "insensitive" } },
          { title: { contains: "aup", mode: "insensitive" } },
          { title: { contains: "acceptable", mode: "insensitive" } },
          { title: { contains: "upgrade path", mode: "insensitive" } },
          { title: { contains: "first mile", mode: "insensitive" } },
        ]
      },
      select: { id: true, title: true, idempotencyKey: true, priority: true, createdAt: true }
    });
    console.log(JSON.stringify(proposals, null, 2));
    console.log("TOTAL matching:", proposals.length);
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
