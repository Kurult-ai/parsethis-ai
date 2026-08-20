import { PrismaClient } from "../dist/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const proposals = await prisma.adminImprovementProposal.findMany({
  where: { status: { in: ['proposed', 'approved', 'in_progress'] } },
  orderBy: { createdAt: 'desc' },
  take: 25,
  select: { id: true, title: true, idempotencyKey: true, status: true, category: true, priority: true, createdAt: true }
});
console.log(JSON.stringify(proposals, null, 2));
await prisma.$disconnect();
