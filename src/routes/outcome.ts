/**
 * Outcome + long-range metrics routes (plan v2 Phase 2 item 4 + Phase 3).
 *
 * POST /v1/outcome        — label a screening trace (paid: outcomeReporting).
 * GET  /v1/screening/metrics/range — 30d + 12m rollup-backed views (own data).
 * GET  /v1/improvement/status — internal FP-rate + loop health (admin scope).
 */
import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";
import { recordOutcome, mineToolExceptionOutcomes, OUTCOME_LABELS, type OutcomeLabel } from "../lib/outcome-store.js";
import { rangeAggregateForKeys } from "../lib/rollup-range.js";
import { evaluatePromotionGate } from "../lib/shadow-rollout.js";
import { resolveOrgId } from "../lib/org-scope.js";
import type { AppEnv } from "../types.js";

export const outcomeRoutes = new Hono<AppEnv>();

const PRICE: Record<string, number> = { solo: 12, pro: 49, team: 199, compliance: 199 };

/**
 * POST /v1/outcome — the caller labels what happened after a screen.
 *
 * Body: { trace_id, outcome, note? }
 * outcome ∈ false_positive | true_positive | benign_override | confirmed_attack | other
 *
 * A8d: if the trace's raw event was purged (90d), we still record the label
 * and say so — `raw_event: "purged"` — instead of failing. Retention wins;
 * the loop's coverage metric counts the drop separately.
 */
outcomeRoutes.post("/v1/outcome", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const PAID_TIERS = ["solo", "pro", "team", "compliance", "enterprise"];
  if (!PAID_TIERS.includes(apiKey?.tier ?? "free")) {
    c.header("X-Upgrade-URL", "/pricing#pro");
    return problem(c, {
      status: 402,
      title: "Outcome reporting is not included on this plan",
      detail:
        "Labeling screening outcomes requires a paid plan. Your screening and your own compliance reads are unaffected — this gates the improvement loop, not the control.",
      code: ErrorCode.PAYMENT_REQUIRED,
      retryable: false,
      upgradeUrl: "/pricing#pro",
      upgrade: { tier: "pro", price_per_month: PRICE.pro, capability: "Outcome reporting" },
    });
  }

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const traceId = typeof body.trace_id === "string" ? body.trace_id.trim() : "";
  const outcome = typeof body.outcome === "string" ? body.outcome.trim() : "";
  const note = typeof body.note === "string" ? body.note : undefined;

  if (!traceId) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "trace_id is required (the trace_id from a /v1/parse response).",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (!(OUTCOME_LABELS as readonly string[]).includes(outcome)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: `outcome must be one of: ${OUTCOME_LABELS.join(", ")}.`,
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
      allowed_values: [...OUTCOME_LABELS],
    });
  }

  try {
    const { rawEventExists } = await recordOutcome(prisma as never, {
      traceId,
      outcome: outcome as OutcomeLabel,
      source: "caller",
      note,
      apiKeyId: apiKey?.id,
    });
    return c.json({
      recorded: true,
      trace_id: traceId,
      outcome,
      raw_event: rawEventExists ? "present" : "purged_or_unknown",
      note: rawEventExists
        ? undefined
        : "The raw screening event for this trace is past retention or unknown. The label is still recorded (numbers-only) — retention is never extended for a trace.",
    });
  } catch (err) {
    console.error("[outcome] write failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * GET /v1/screening/metrics/range?months=12 — the 12-month view (A8c).
 * Raw events answer the last 90 days; rollups answer everything older.
 * Own-data scope: the caller's key (and org siblings), no honest filter.
 */
outcomeRoutes.get("/v1/screening/metrics/range", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const monthsQ = Number(c.req.query("months") ?? "12");
  const months = Number.isFinite(monthsQ) && monthsQ >= 1 && monthsQ <= 24 ? Math.floor(monthsQ) : 12;

  try {
    const orgId = await resolveOrgId(apiKey.id);
    let keyIds = [apiKey.id];
    if (orgId) {
      const siblings = await prisma.apiKey.findMany({
        where: { orgId },
        select: { id: true },
      });
      keyIds = siblings.map((k) => k.id);
    }

    const now = new Date();
    const from = new Date(now.getTime() - months * 31 * 24 * 60 * 60 * 1000);
    const agg = await rangeAggregateForKeys(prisma as never, keyIds, from, now);

    return c.json({
      period: { from: from.toISOString(), to: now.toISOString(), months },
      source: "screening_daily_rollups",
      total_screenings: agg?.eventCount ?? 0,
      blocked_total: agg?.blockedCount ?? 0,
      would_block_total: agg?.wouldBlockCount ?? 0,
      risk_distribution: Object.entries(agg?.verdictCounts ?? {}).map(([verdict, count]) => ({ verdict, count })),
      top_categories: Object.entries(agg?.categoryCounts ?? {})
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      disposition_counts: agg?.dispositionCounts ?? {},
      days_covered: agg?.daysCovered ?? 0,
    });
  } catch (err) {
    console.error("[metrics-range] query error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * GET /v1/improvement/status — loop health for the operator (admin keys).
 * The FP-rate metric (Phase 3 item 3) with the same honesty bar as /trust:
 * every number here is synthetic-excluded, opt-out-honored, k-anonymity not
 * needed (no cohort breakdowns), and claim-gated (A6b): nothing here says
 * "improves detection for everyone" until the loop demonstrably consumes it.
 */
outcomeRoutes.get("/v1/improvement/status", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  if (apiKey?.role !== "org_admin" && apiKey?.role !== "security_analyst" && apiKey?.role !== "admin") {
    return problem(c, {
      status: 403,
      title: "Insufficient role",
      detail: "Improvement-loop status is operator-scoped (org_admin, security_analyst, or admin).",
      code: ErrorCode.AUTH_FORBIDDEN_ROLE,
      retryable: false,
    });
  }

  try {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [labelRows, shadowRules] = await Promise.all([
      prisma.screeningOutcome.groupBy({
        by: ["outcome"],
        _count: true,
        where: { createdAt: { gte: since30d } },
      }),
      prisma.shadowRule.findMany({
        where: {},
        select: { ruleId: true, mode: true, startedAt: true, promotedAt: true },
      }),
    ]);

    const labels: Record<string, number> = {};
    let labeled = 0;
    for (const r of labelRows) {
      labels[r.outcome] = r._count;
      labeled += r._count;
    }
    const fp = (labels.false_positive ?? 0) + (labels.benign_override ?? 0);
    const tp = (labels.true_positive ?? 0) + (labels.confirmed_attack ?? 0);
    const precision = labeled > 0 ? tp / labeled : null;

    // Gate reports for rules still in shadow
    const gates = [] as unknown[];
    for (const sr of shadowRules.filter((s) => s.mode === "shadow").slice(0, 20)) {
      const g = await evaluatePromotionGate(prisma as never, sr.ruleId, { windowDays: 14 });
      if (g) gates.push(g);
    }

    return c.json({
      window: "30d",
      outcome_labels: labels,
      labeled_traces: labeled,
      /** measured on labeled traces only; null until labels exist */
      observed_precision: precision,
      shadow_rules: shadowRules.map((s) => ({
        rule_id: s.ruleId,
        mode: s.mode,
        in_shadow_since: s.startedAt.toISOString(),
        promoted_at: s.promotedAt?.toISOString() ?? null,
      })),
      promotion_gates: gates,
      claim_gate: {
        published_claim: null,
        note: "No public claim that traffic improves detection for everyone is made until this loop demonstrably consumes aggregates (plan A6b).",
      },
    });
  } catch (err) {
    console.error("[improvement-status] query error:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * POST /v1/improvement/mine — run the ToolExceptionRequest mining pass now
 * (admin). The worker also runs it daily; this is the manual trigger.
 */
outcomeRoutes.post("/v1/improvement/mine", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  if (apiKey?.role !== "admin" && apiKey?.role !== "org_admin") {
    return problem(c, {
      status: 403,
      title: "Insufficient role",
      detail: "Mining is an operator action.",
      code: ErrorCode.AUTH_FORBIDDEN_ROLE,
      retryable: false,
    });
  }
  try {
    const r = await mineToolExceptionOutcomes(prisma as never, {});
    return c.json({ mined: true, ...r });
  } catch (err) {
    console.error("[improvement-mine] failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * GET /v1/benchmarks/peer?window_days=30 — cohort-level peer benchmarks
 * (plan v2 Phase 4 item 2, A9). Paid feature: the connected layer, not the
 * control plane. k≥5 with cohort suppression — small cohorts are listed as
 * suppressed with no numbers, never shown as zero.
 */
outcomeRoutes.get("/v1/benchmarks/peer", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const PAID_TIERS = ["solo", "pro", "team", "compliance", "enterprise"];
  if (!PAID_TIERS.includes(apiKey?.tier ?? "free")) {
    return problem(c, {
      status: 402,
      title: "Peer benchmarks are not included on this plan",
      detail:
        "Peer benchmarks (cohort-level, k-anonymized) require a paid plan. Your own screening and compliance reads are unaffected.",
      code: ErrorCode.PAYMENT_REQUIRED,
      retryable: false,
      upgradeUrl: "/pricing#pro",
      upgrade: { tier: "pro", price_per_month: 49, capability: "Peer benchmarks" },
    });
  }
  const daysQ = Number(c.req.query("window_days") ?? "30");
  const windowDays = Number.isFinite(daysQ) && daysQ >= 7 && daysQ <= 90 ? Math.floor(daysQ) : 30;
  try {
    const { generatePeerBenchmarks } = await import("../lib/peer-benchmarks.js");
    const report = await generatePeerBenchmarks(prisma as never, windowDays);
    return c.json(report);
  } catch (err) {
    console.error("[benchmarks-peer] failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

/**
 * GET /v1/reports/aggregate?window_days=30 — the public aggregate report
 * generator (plan v2 Phase 4 item 3). Operator-scoped UNTIL deliberately
 * published (A6b claim-gate): watching the numbers first, publishing after
 * the loop demonstrably consumes them.
 */
outcomeRoutes.get("/v1/reports/aggregate", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  if (apiKey?.role !== "org_admin" && apiKey?.role !== "security_analyst" && apiKey?.role !== "admin") {
    return problem(c, {
      status: 403,
      title: "Insufficient role",
      detail: "The aggregate report is operator-scoped until it is deliberately published (claim-gate policy).",
      code: ErrorCode.AUTH_FORBIDDEN_ROLE,
      retryable: false,
    });
  }
  const daysQ = Number(c.req.query("window_days") ?? "30");
  const windowDays = Number.isFinite(daysQ) && daysQ >= 7 && daysQ <= 365 ? Math.floor(daysQ) : 30;
  try {
    const { generatePublicAggregateReport } = await import("../lib/public-report.js");
    const report = await generatePublicAggregateReport(prisma as never, windowDays);
    return c.json(report);
  } catch (err) {
    console.error("[reports-aggregate] failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});
