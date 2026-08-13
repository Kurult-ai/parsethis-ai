import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const yesterday = new Date(Date.now() - 24*60*60*1000);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    
    const screenings24h = await prisma.screeningEvent.count({ where: { createdAt: { gte: yesterday } } });
    const screenings7d = await prisma.screeningEvent.count({ where: { createdAt: { gte: weekAgo } } });
    const totalScreenings = await prisma.screeningEvent.count();
    
    // Active API keys
    const activeKeys = await prisma.apiKey.count({ where: { revokedAt: null } });
    
    // Payment / subscription data
    const subscriptions = await prisma.subscription.count();
    const activeSubs = await prisma.subscription.count({ where: { status: "active" } });
    
    // Org count
    const orgs = await prisma.organization.count();
    
    // Agents registered
    const agents = await prisma.agentRegistry.count();
    
    console.log(JSON.stringify({ screenings24h, screenings7d, totalScreenings, activeKeys, subscriptions, activeSubs, orgs, agents }, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
