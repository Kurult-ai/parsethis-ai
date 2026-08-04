import { getPrisma, disconnectDb } from "./src/db.js";

(async () => {
  const p = getPrisma();
  try {
    const proposals = await p.adminImprovementProposal.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, idempotencyKey: true, title: true, status: true, category: true, priority: true, createdAt: true }
    });
    console.log(JSON.stringify(proposals, null, 2));
  } catch(e: any) { console.error("ERR:", e.message); }
  await disconnectDb();
})();
