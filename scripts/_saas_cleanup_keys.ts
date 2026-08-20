import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const ids = ["cmt0gwhei00is2i1ew6it9pqq", "cmt0grgjg00i92i1emejlluw2"];
  const found = await prisma.apiKey.findMany({
    where: {
      OR: [
        { id: { in: ids } },
        { name: { in: ["saas-loop-probe", "hourly-saas-loop-probe", "Signup Key"] } },
        { name: { contains: "Signup" } },
      ],
      revokedAt: null,
    },
    select: { id: true, name: true, createdAt: true, tier: true, synthetic: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  console.log("FOUND", JSON.stringify(found, null, 2));
  // revoke only exact probe orphans we created today by id if still active
  const toRevoke = found.filter((k) => ids.includes(k.id) || k.name === "saas-loop-probe");
  for (const k of toRevoke) {
    await prisma.apiKey.update({ where: { id: k.id }, data: { revokedAt: new Date() } });
    console.log("REVOKED", k.id, k.name);
  }
  const signupActive = await prisma.apiKey.count({ where: { revokedAt: null, name: { contains: "Signup" } } });
  const probeActive = await prisma.apiKey.count({
    where: {
      revokedAt: null,
      OR: [
        { name: { contains: "probe" } },
        { name: { contains: "canary" } },
        { name: { contains: "hourly" } },
        { name: { contains: "smoke" } },
      ],
    },
  });
  console.log(JSON.stringify({ signupActive, probeActive }, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
