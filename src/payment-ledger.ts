import { prisma } from "./db.js";
import type { PaymentRecord } from "./types.js";

export async function recordPayment(record: PaymentRecord): Promise<void> {
  await prisma.paymentRecord.create({
    data: {
      txHash: record.txHash,
      payer: record.payer,
      amount: parseFloat(record.amount),
      endpoint: record.endpoint,
      depth: record.depth,
      network: record.network,
      status: record.status,
      timestamp: new Date(record.timestamp),
    },
  }).catch((err: Error) => {
    // Duplicate txHash = idempotent, don't throw
    if (err.message.includes("Unique constraint")) return;
    console.error("[WARN] Failed to persist payment:", err.message);
  });
}

export async function getPaymentStats() {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86_400_000);
  const oneHourAgo = new Date(now.getTime() - 3_600_000);

  const [allPayments, last24h, lastHour, byEndpoint, uniquePayers] = await Promise.all([
    prisma.paymentRecord.aggregate({
      _count: true,
      _sum: { amount: true },
    }),
    prisma.paymentRecord.aggregate({
      where: { timestamp: { gte: oneDayAgo } },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.paymentRecord.count({
      where: { timestamp: { gte: oneHourAgo } },
    }),
    prisma.paymentRecord.groupBy({
      by: ["endpoint"],
      _count: true,
    }),
    prisma.paymentRecord.findMany({
      select: { payer: true },
      distinct: ["payer"],
    }),
  ]);

  const endpointMap: Record<string, number> = {};
  for (const row of byEndpoint) {
    endpointMap[row.endpoint] = row._count;
  }

  return {
    total_payments: allPayments._count,
    total_revenue_usdc: (Number(allPayments._sum.amount) || 0).toFixed(4),
    payments_24h: last24h._count,
    revenue_24h_usdc: (Number(last24h._sum.amount) || 0).toFixed(4),
    payments_last_hour: lastHour,
    unique_payers: uniquePayers.length,
    by_endpoint: endpointMap,
  };
}

export async function getRecentPayments(limit = 20): Promise<PaymentRecord[]> {
  const rows = await prisma.paymentRecord.findMany({
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return rows.map((row) => ({
    txHash: row.txHash,
    payer: row.payer,
    amount: row.amount.toString(),
    endpoint: row.endpoint,
    depth: row.depth ?? undefined,
    network: row.network,
    status: row.status as PaymentRecord["status"],
    timestamp: row.timestamp.toISOString(),
  }));
}
