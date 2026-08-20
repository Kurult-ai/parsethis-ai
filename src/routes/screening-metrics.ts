import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { serviceDependencyProblem } from "../lib/problem-response.js";
import type { AppEnv } from "../types.js";

export const screeningMetricsRoutes = new Hono<AppEnv>();

// GET /v1/screening/metrics — aggregated screening analytics
screeningMetricsRoutes.get("/v1/screening/metrics", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const [total, last24h, blocked, riskDist, topCategories] = await Promise.all([
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id } }),
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id, blocked: true } }),
      prisma.screeningEvent.groupBy({
        by: ["verdict"],
        _count: true,
        where: { apiKeyId: apiKey.id },
      }),
      // Flatten categories array and count — Prisma doesn't natively aggregate arrays,
      // so we'll do a raw query for this
      prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
        SELECT unnest(categories) as category, count(*) as count
        FROM screening_events
        WHERE api_key_id = ${apiKey.id}
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `,
    ]);

    return c.json({
      total_screenings: total,
      screenings_24h: last24h,
      blocked_total: blocked,
      risk_distribution: riskDist.map((r) => ({
        verdict: r.verdict,
        count: r._count,
      })),
      top_categories: topCategories.map((r) => ({
        category: r.category,
        count: Number(r.count),
      })),
    });
  } catch (err) {
    console.error("[screening-metrics] query error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
