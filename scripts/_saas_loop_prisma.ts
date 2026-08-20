import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

function scrub(v: any, depth = 0): any {
  if (depth > 8) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|authorization|password|hash/i.test(k) && typeof val === "string") {
        const s = val as string;
        o[k] = s.length > 8 ? s.slice(0, 4) + "…" + `len=${s.length}` : "[redacted]";
      } else o[k] = scrub(val, depth + 1);
    }
    return o;
  }
  return v;
}

async function main() {
  const out: any = {};

  try {
    const proposals = await prisma.adminImprovementProposal.findMany({
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 50,
    });
    out.proposals = proposals.map((p: any) => ({
      id: p.id,
      status: p.status,
      priority: p.priority,
      category: p.category,
      title: p.title,
      idempotencyKey: p.idempotencyKey,
      source: p.source,
      createdAt: p.createdAt,
      taskId: p.taskId,
      riskLevel: p.riskLevel,
    }));
    out.proposal_status_counts = await prisma.adminImprovementProposal.groupBy({
      by: ["status"],
      _count: true,
    });
  } catch (e: any) {
    out.proposals_error = String(e.message || e).slice(0, 500);
  }

  try {
    out.api_keys = {
      total: await prisma.apiKey.count(),
      active: await prisma.apiKey.count({ where: { revokedAt: null } }),
      revoked: await prisma.apiKey.count({ where: { revokedAt: { not: null } } }),
      synthetic: await prisma.apiKey.count({ where: { synthetic: true } }),
      real_active: await prisma.apiKey.count({ where: { synthetic: false, revokedAt: null } }),
      by_tier: await prisma.apiKey.groupBy({ by: ["tier"], _count: true }),
    };
  } catch (e: any) {
    out.api_keys_error = String(e.message || e).slice(0, 500);
  }

  try {
    out.subscriptions = await prisma.subscription.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        tier: true,
        createdAt: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: true,
        apiKeyId: true,
      },
    });
    out.subscription_counts = await prisma.subscription.groupBy({ by: ["status", "tier"], _count: true });
  } catch (e: any) {
    out.subscriptions_error = String(e.message || e).slice(0, 500);
  }

  try {
    out.payments = await prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, status: true, amount: true, currency: true, createdAt: true, stripePaymentIntentId: true },
    });
  } catch (e: any) {
    out.payments_error = String(e.message || e).slice(0, 400);
  }

  try {
    out.tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { id: true, status: true, subject: true, category: true, priority: true, createdAt: true, updatedAt: true },
    });
    out.ticket_counts = await prisma.supportTicket.groupBy({ by: ["status"], _count: true });
  } catch (e: any) {
    out.tickets_error = String(e.message || e).slice(0, 400);
  }

  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    out.screening_24h = {
      total: await prisma.screeningEvent.count({ where: { createdAt: { gte: since } } }),
      real: await prisma.screeningEvent.count({ where: { createdAt: { gte: since }, apiKey: { synthetic: false } } }),
      synthetic: await prisma.screeningEvent.count({ where: { createdAt: { gte: since }, apiKey: { synthetic: true } } }),
    };
    out.screening_recent_real = await prisma.screeningEvent.findMany({
      where: { apiKey: { synthetic: false } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        createdAt: true,
        suggestedAction: true,
        riskScore: true,
        environment: true,
        enforcementMode: true,
      },
    });
  } catch (e: any) {
    out.screening_error = String(e.message || e).slice(0, 500);
  }

  try {
    out.entitlements = await prisma.entitlement.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, tier: true, status: true, startsAt: true, endsAt: true, createdAt: true, reason: true },
    });
  } catch (e: any) {
    out.entitlements_error = String(e.message || e).slice(0, 400);
  }

  try {
    out.admin_receipts_recent = await prisma.adminActionReceipt.findMany({
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { id: true, action: true, createdAt: true, riskLevel: true, dryRun: true },
    });
  } catch (e: any) {
    out.receipts_error = String(e.message || e).slice(0, 400);
  }

  try {
    out.orgs = {
      count: await prisma.organization.count(),
      recent: await prisma.organization.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, name: true, createdAt: true },
      }),
    };
  } catch (e: any) {
    out.orgs_error = String(e.message || e).slice(0, 400);
  }

  // open pending proposals content for dedupe judgment
  try {
    const open = await prisma.adminImprovementProposal.findMany({
      where: { status: { in: ["proposed", "approved", "open", "pending"] } },
      orderBy: { priority: "desc" },
      take: 20,
    });
    out.open_proposals_detail = open.map((p: any) => ({
      id: p.id,
      status: p.status,
      priority: p.priority,
      category: p.category,
      title: p.title,
      idempotencyKey: p.idempotencyKey,
      source: p.source,
      impact: (p.impact || "").slice(0, 240),
      acceptance: Array.isArray(p.acceptanceCriteria) ? p.acceptanceCriteria.slice(0, 6) : p.acceptanceCriteria,
    }));
  } catch (e: any) {
    out.open_proposals_error = String(e.message || e).slice(0, 400);
  }

  console.log(JSON.stringify(scrub(out), null, 2));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("FATAL", String(e).slice(0, 800));
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
