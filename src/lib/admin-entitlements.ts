export type GrantPeriod = {
  count: number;
  unit: "day" | "week" | "month" | "year";
  label: string;
};

export function sanitizeManualId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "unknown";
}

export function normalizeGrantPeriod(period?: string | null): GrantPeriod | null {
  if (!period || !period.trim()) return null;
  const match = period.trim().toLowerCase().match(/^(\d+)\s*(day|days|week|weeks|month|months|year|years)$/);
  if (!match) {
    throw new Error(`Unsupported period: ${period}. Use e.g. '7 days', '1 month', or '1 year'.`);
  }
  const count = Number(match[1]);
  const unitRaw = match[2];
  const unit = unitRaw.startsWith("day")
    ? "day"
    : unitRaw.startsWith("week")
      ? "week"
      : unitRaw.startsWith("month")
        ? "month"
        : "year";
  return { count, unit, label: `${count}_${unit}${count === 1 ? "" : "s"}` };
}

export function addGrantPeriod(start: Date, period?: string | null): Date {
  const normalized = normalizeGrantPeriod(period);
  if (!normalized) return new Date(start.getTime() + 365 * 24 * 60 * 60 * 1000);
  const end = new Date(start);
  if (normalized.unit === "day") end.setDate(end.getDate() + normalized.count);
  else if (normalized.unit === "week") end.setDate(end.getDate() + normalized.count * 7);
  else if (normalized.unit === "month") end.setMonth(end.getMonth() + normalized.count);
  else end.setFullYear(end.getFullYear() + normalized.count);
  return end;
}

export function parsePriceUsdCents(value?: string | number | null): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid price: ${value}`);
    return Math.round(value * 100);
  }
  const cleaned = value.replace(/[^0-9.]/g, "");
  if (!cleaned) throw new Error(`Invalid price: ${value}`);
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid price: ${value}`);
  return Math.round(parsed * 100);
}

export function manualCustomerId(userId: string): string {
  return `manual_customer_${sanitizeManualId(userId)}`;
}

export function manualSubscriptionId(apiKeyId: string): string {
  return `manual_subscription_${sanitizeManualId(apiKeyId)}`;
}

export function manualPriceId(params: { priceId?: string | null; priceUsdCents?: number | null; period?: string | null }): string {
  if (params.priceId) return params.priceId;
  if (params.priceUsdCents !== undefined && params.priceUsdCents !== null) {
    if (params.priceUsdCents === 0) return "manual_usd_0";
    const dollars = Math.floor(params.priceUsdCents / 100);
    const cents = params.priceUsdCents % 100;
    return `manual_usd_${dollars}_${String(cents).padStart(2, "0")}_month`;
  }
  const period = normalizeGrantPeriod(params.period);
  if (period) return `manual_free_${period.label}`;
  return "manual_attribution";
}
