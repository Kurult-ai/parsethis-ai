import { prisma } from './src/db';

async function main() {
  try {
    const proposals = await prisma.adminImprovementProposal.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, idempotencyKey: true, title: true, status: true, category: true, priority: true, createdAt: true, source: true }
    });
    console.log(JSON.stringify(proposals, null, 2));
  } catch(e: any) {
    console.error('ERROR:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}
main();
