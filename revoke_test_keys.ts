import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const ids = ['cms7y5d6r002p0pqlkigzea7i', 'cms7y5df2002q0pjldjm6lhpa'];
  for (const id of ids) {
    try {
      const updated = await prisma.apiKey.update({
        where: { id },
        data: { status: 'revoked' }
      });
      console.log(`Revoked ${id}: status=${updated.status}`);
    } catch(e: any) {
      console.log(`Failed ${id}: ${e.message}`);
    }
  }
}
main().finally(() => prisma.$disconnect());
