import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const proposals = await prisma.adminImprovementProposal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { id: true, title: true, idempotencyKey: true, status: true, category: true, source: true, createdAt: true }
  });
  console.log(JSON.stringify(proposals, null, 2));
  await prisma.$disconnect();
}
main();
