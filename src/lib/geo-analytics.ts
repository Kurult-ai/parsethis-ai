import type { Context } from "hono";
import { createHash } from "node:crypto";
import { prisma } from "../db.js";

export const GEO_AUDIT_ACTIONS = {
  surfaceHit: "geo.surface.hit",
  x402PaymentRequired: "geo.x402.payment_required",
  x402PaymentSubmitted: "geo.x402.payment_submitted",
  x402RetrySuccess: "geo.x402.retry_success",
  x402PaymentSettled: "geo.x402.payment_settled",
  syntheticTest: "geo.synthetic.test",
  injectionSessionCreated: "playground.session_created",
  injectionSignalReceived: "playground.signal_received",
  injectionOutputChecked: "playground.output_checked",
} as const;

type GeoAuditAction = (typeof GEO_AUDIT_ACTIONS)[keyof typeof GEO_AUDIT_ACTIONS];
type GeoDetail = Record<string, unknown>;

function safeDetail(detail: GeoDetail): string {
  return JSON.stringify(detail).slice(0, 4000);
}

function requestIp(c: Context): string {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";
}

export async function recordGeoAnalyticsEvent(
  action: GeoAuditAction,
  detail: GeoDetail,
  ip = "unknown",
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.auditEvent.create({
      data: {
        action,
        detail: safeDetail(detail),
        ip,
      },
    });
  } catch (err) {
    // GEO analytics must never break model-facing discovery or paid request flow.
    if (process.env.NODE_ENV !== "test") {
      console.warn("[geo] analytics persistence failed:", (err as Error).message);
    }
  }
}

export function recordGeoSurfaceHit(c: Context, surface: string): void {
  const userAgent = c.req.header("user-agent") || "unknown";
  const accept = c.req.header("accept") || "";
  const client = createHash("sha256")
    .update(`${userAgent}:${c.req.header("x-forwarded-for") || ""}`)
    .digest("hex")
    .slice(0, 16);

  const detail = {
    event: "geo_surface_hit",
    surface,
    path: new URL(c.req.url).pathname,
    method: c.req.method,
    accept,
    client,
  };

  console.log(JSON.stringify(detail));
  void recordGeoAnalyticsEvent(GEO_AUDIT_ACTIONS.surfaceHit, detail, requestIp(c));
}
