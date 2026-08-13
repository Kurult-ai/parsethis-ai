import { prisma, disconnectDb } from "./src/db";

async function main() {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { status: "open" },
      select: { id: true, source: true, requesterEmail: true, subject: true, category: true, priority: true, createdAt: true, apiKeyId: true },
      orderBy: { createdAt: "desc" }
    });
    console.log(JSON.stringify(tickets, null, 2));
  } catch(e: any) {
    console.log("ERROR:", e.message);
  } finally {
    await disconnectDb();
  }
}
main();
