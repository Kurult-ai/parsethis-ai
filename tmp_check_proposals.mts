import { PrismaClient } from './src/generated/prisma/client.js';
async function main() {
  const p = new PrismaClient();
  const rows = await p.adminImprovementProposal.findMany({
    where: { status: 'proposed' },
    select: { id: true, idempotencyKey: true, title: true, category: true, priority: true, source: true, createdAt: true }
  });
  console.log(JSON.stringify(rows, null, 2));
  await p.$disconnect();
}
main();
