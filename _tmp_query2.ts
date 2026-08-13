import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const openTickets = await prisma.supportTicket.count({ where: { status: "open" } });
    const totalTickets = await prisma.supportTicket.count();
    const activeSubs = await prisma.subscription.count({ where: { status: "active" } });
    const totalKeys = await prisma.apiKey.count();
    const activeKeys = await prisma.apiKey.count({ where: { revokedAt: null } });
    const totalProposals = await prisma.adminImprovementProposal.count({ where: { status: "proposed" } });
    
    // Recent screening events
    const recentScreening = await prisma.screeningEvent.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    });
    const blockedEvents = await prisma.screeningEvent.count({
      where: { blocked: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    });
    
    console.log(JSON.stringify({
      openTickets, totalTickets, activeSubs, totalKeys, activeKeys, totalProposals,
      recentScreening24h: recentScreening, blockedEvents24h: blockedEvents
    }, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
