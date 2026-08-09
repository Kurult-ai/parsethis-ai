const { PrismaClient } = require('./src/generated/prisma/client.js');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
async function main() {
  const proposals = await prisma.adminImprovementProposal.findMany({
    where: { status: { in: ['proposed', 'approved', 'in_progress'] } },
    orderBy: { createdAt: 'desc' },
    take: 25,
    select: { id: true, title: true, idempotencyKey: true, status: true, category: true, priority: true, createdAt: true }
  });
  console.log(JSON.stringify(proposals, null, 2));
  await prisma.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
