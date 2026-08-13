import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    // Check for false positive indicators - high block rate on benign content
    const last24h = await prisma.screeningEvent.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      select: { riskScore: true, verdict: true, categories: true, blocked: true, mode: true, enforcementMode: true },
      take: 50,
      orderBy: { createdAt: "desc" }
    });
    
    // Group by verdict
    const verdictCounts: Record<string, number> = {};
    for (const e of last24h) {
      verdictCounts[e.verdict] = (verdictCounts[e.verdict] || 0) + 1;
    }
    console.log("Verdict distribution (last 50):", JSON.stringify(verdictCounts));
    console.log("Sample blocked:", JSON.stringify(last24h.filter(e => e.blocked).slice(0, 5).map(e => ({ verdict: e.verdict, score: e.riskScore, categories: e.categories })), null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
