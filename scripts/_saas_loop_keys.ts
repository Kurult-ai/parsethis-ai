import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const props = await prisma.adminImprovementProposal.findMany({
  select: { id: true, status: true, title: true, idempotencyKey: true, createdAt: true },
  orderBy: { createdAt: "desc" },
  take: 80,
});
const open = await prisma.adminImprovementProposal.count({ where: { status: "proposed" } });
const withTask = await prisma.adminImprovementProposal.count({ where: { taskId: { not: null } } });
const approved = await prisma.adminImprovementProposal.count({ where: { status: "approved" } });
// search keywords already covered
const keywords = [
  "pk_test", "publishable", "stripe.*test", "Default Organization", "orphan org",
  "draft.?role", "farah", "signup-checkout", "rolledExpiry", "determinism",
  "proposal.*stale", "triage truth", "re-verification", "origin/main", "ahead",
  "ALLOWED_ORIGINS", "CORS", "activity", "coverage", "semantic_layer", "llm_failed",
  "master.?key", "admin key", "collector", "business_state", "parse_business"
];
const allTitles = await prisma.adminImprovementProposal.findMany({ select: { title: true, idempotencyKey: true, status: true } });
function hit(re: RegExp) {
  return allTitles.filter(p => re.test(p.title) || re.test(p.idempotencyKey)).slice(0,8).map(p => `${p.status}|${p.idempotencyKey}|${p.title.slice(0,100)}`);
}
const coverage: Record<string, string[]> = {};
for (const k of keywords) coverage[k] = hit(new RegExp(k, "i"));
console.log(JSON.stringify({ open, withTask, approved, recent: props.map(p=>({id:p.id,key:p.idempotencyKey,title:p.title.slice(0,120),createdAt:p.createdAt})), coverage }, null, 2));
await prisma.$disconnect();
