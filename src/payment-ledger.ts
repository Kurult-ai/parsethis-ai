import type { PaymentRecord } from "./types.js";

// In-memory payment ledger (bounded, matching existing pattern)
const MAX_RECORDS = 1000;
const payments: PaymentRecord[] = [];

export function recordPayment(record: PaymentRecord): void {
  payments.push(record);
  if (payments.length > MAX_RECORDS) {
    payments.splice(0, payments.length - MAX_RECORDS);
  }
}

export function getPaymentStats() {
  const now = Date.now();
  const last24h = payments.filter(
    (p) => now - new Date(p.timestamp).getTime() < 86_400_000,
  );
  const lastHour = last24h.filter(
    (p) => now - new Date(p.timestamp).getTime() < 3_600_000,
  );

  const totalRevenue = payments.reduce(
    (sum, p) => sum + parseFloat(p.amount),
    0,
  );
  const revenue24h = last24h.reduce(
    (sum, p) => sum + parseFloat(p.amount),
    0,
  );

  const byEndpoint: Record<string, number> = {};
  for (const p of payments) {
    byEndpoint[p.endpoint] = (byEndpoint[p.endpoint] || 0) + 1;
  }

  const uniquePayers = new Set(payments.map((p) => p.payer)).size;

  return {
    total_payments: payments.length,
    total_revenue_usdc: totalRevenue.toFixed(4),
    payments_24h: last24h.length,
    revenue_24h_usdc: revenue24h.toFixed(4),
    payments_last_hour: lastHour.length,
    unique_payers: uniquePayers,
    by_endpoint: byEndpoint,
  };
}

export function getRecentPayments(limit = 20): PaymentRecord[] {
  return payments.slice(-limit).reverse();
}
