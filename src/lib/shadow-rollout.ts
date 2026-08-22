/**
 * Shadow-rollout engine (plan v2 A8b): new/changed detection rules ship
 * observe-only. A shadow rule counts would-have-hits via `wouldBlock` without
 * enforcing; promotion to enforce requires the gate:
 *
 *   1. frozen-fixture precision/recall (existing test corpus)
 *   2. shadow-window precision ≥ target against labeled outcomes
 *   3. FP-rate non-regression on the shadow window's unlabeled traffic
 *
 * recordShadowObservation is called from the screening path for every rule
 * registered in ShadowRule with mode='shadow'. evaluatePromotionGate is
 * called by the admin/worker to produce the gate report; promote() freezes
 * it. Nothing in here enforces a rule — shadow means observe, full stop.
 */
import type { Prisma } from "../generated/prisma/client.js";

export interface ShadowPrismaClient {
  shadowRule: {
    findMany: (args: unknown) => Promise<Array<{ ruleId: string; mode: string; startedAt: Date }>>;
    findUnique: (args: unknown) => Promise<{ ruleId: string; mode: string } | null>;
    update: (args: unknown) => Promise<unknown>;
  };
  shadowRuleObservation: {
    create: (args: unknown) => Promise<unknown>;
    findMany: (args: unknown) => Promise<ShadowObsRow[]>;
  };
  screeningOutcome?: {
    findMany: (args: unknown) => Promise<Array<{ traceId: string; outcome: string }>>;
  };
}

export interface ShadowObsRow {
  ruleId: string;
  day: Date;
  wouldBlock: boolean;
  outcomeLabel: string | null;
  traceId: string | null;
  synthetic: boolean;
  excludedFromAggregates: boolean;
}

/** Observe a screening result against the shadow registry. Fire-and-forget
 * safe: errors must never take the screening path down (caller catches). */
export async function recordShadowObservations(
  p: ShadowPrismaClient,
  input: {
    traceId: string;
    apiKeyId: string;
    synthetic: boolean;
    excludedFromAggregates: boolean;
    /** rule ids that fired on this screen */
    firedRuleIds: string[];
    /** rules that WOULD have blocked (counterfactual), among fired */
    wouldBlockRuleIds: string[];
  },
): Promise<number> {
  const shadowRules = (await p.shadowRule.findMany({
    where: { mode: "shadow" },
    select: { ruleId: true },
  })) as Array<{ ruleId: string }>;
  if (shadowRules.length === 0) return 0;

  const inShadow = new Set(shadowRules.map((r) => r.ruleId));
  const fired = new Set(input.firedRuleIds);
  const wouldBlock = new Set(input.wouldBlockRuleIds);

  const day = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ));

  let written = 0;
  for (const ruleId of inShadow) {
    if (!fired.has(ruleId)) continue;
    await p.shadowRuleObservation.create({
      data: {
        ruleId,
        day,
        wouldBlock: wouldBlock.has(ruleId),
        traceId: input.traceId,
        apiKeyId: input.apiKeyId,
        synthetic: input.synthetic,
        excludedFromAggregates: input.excludedFromAggregates,
      },
    });
    written++;
  }
  return written;
}

export interface GateReport {
  ruleId: string;
  windowDays: number;
  observations: number;
  labeled: number;
  /** precision on labeled outcomes: TP / (TP + FP) */
  precision: number | null;
  /** would-have-blocks that were labeled false_positive */
  falsePositives: number;
  truePositives: number;
  /** unlabeled would-have-blocks — the non-regression eyeball number */
  wouldBlockUnlabeled: number;
  /** synthetic/excluded excluded from all of the above */
  filteredOut: number;
  fixturePrecision: number | null;
  fixtureRecall: number | null;
  /** required to promote */
  precisionTarget: number;
  meetsPrecisionTarget: boolean;
  recommendation: "promote" | "extend-shadow" | "retire";
}

/**
 * Compute the promotion gate for one shadow rule. Honest filter applied
 * (synthetic + opted-out observations are counted separately, never in the
 * gate math). Outcome labels join on traceId.
 */
export async function evaluatePromotionGate(
  p: ShadowPrismaClient,
  ruleId: string,
  opts: { windowDays?: number; precisionTarget?: number; fixturePrecision?: number | null; fixtureRecall?: number | null } = {},
): Promise<GateReport | null> {
  const windowDays = opts.windowDays ?? 14;
  const precisionTarget = opts.precisionTarget ?? 0.8;

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await p.shadowRuleObservation.findMany({
    where: { ruleId, day: { gte: since } },
  });

  const usable = rows.filter((r) => !r.synthetic && !r.excludedFromAggregates);
  const filteredOut = rows.length - usable.length;

  const labels = new Map<string, string>();
  if (p.screeningOutcome) {
    const outs = await p.screeningOutcome.findMany({
      where: { createdAt: { gte: since } },
      select: { traceId: true, outcome: true },
    });
    for (const o of outs) labels.set(o.traceId, o.outcome);
  }

  let labeled = 0;
  let truePositives = 0;
  let falsePositives = 0;
  let wouldBlockUnlabeled = 0;

  for (const r of usable) {
    if (!r.wouldBlock) continue; // gate cares about would-have-blocks
    const label = r.traceId ? labels.get(r.traceId) : undefined;
    if (!label) {
      wouldBlockUnlabeled++;
      continue;
    }
    labeled++;
    if (label === "false_positive" || label === "benign_override") falsePositives++;
    else if (label === "true_positive" || label === "confirmed_attack") truePositives++;
  }

  const precision = labeled > 0 ? truePositives / labeled : null;
  const meetsPrecisionTarget = precision !== null && precision >= precisionTarget;

  // Recommendation logic — deliberately boring:
  //  - enough labeled evidence and precision target met → promote
  //  - labeled evidence but precision below target → extend shadow
  //  - no would-have-blocks at all in the window → retire (rule fires on nothing)
  let recommendation: GateReport["recommendation"] = "extend-shadow";
  if (usable.length === 0 || (truePositives + falsePositives + wouldBlockUnlabeled) === 0) {
    recommendation = "retire";
  } else if (meetsPrecisionTarget && labeled >= 5) {
    recommendation = "promote";
  }

  return {
    ruleId,
    windowDays,
    observations: usable.length,
    labeled,
    precision,
    falsePositives,
    truePositives,
    wouldBlockUnlabeled,
    filteredOut,
    fixturePrecision: opts.fixturePrecision ?? null,
    fixtureRecall: opts.fixtureRecall ?? null,
    precisionTarget,
    meetsPrecisionTarget,
    recommendation,
  };
}

/** Freeze a gate report into the registry and flip the mode. Admin action. */
export async function promoteShadowRule(
  p: ShadowPrismaClient,
  ruleId: string,
  report: GateReport,
): Promise<{ ok: boolean; reason?: string }> {
  if (report.recommendation !== "promote") {
    return { ok: false, reason: `gate says ${report.recommendation}; promotion requires precision ≥ ${report.precisionTarget} with ≥5 labeled would-blocks` };
  }
  await p.shadowRule.update({
    where: { ruleId },
    data: {
      mode: "promoted",
      promotedAt: new Date(),
      gateReport: report as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: true };
}

/** Retire a shadow rule (fires on nothing / superseded). Admin action. */
export async function retireShadowRule(
  p: ShadowPrismaClient,
  ruleId: string,
  report: GateReport | null,
): Promise<void> {
  await p.shadowRule.update({
    where: { ruleId },
    data: {
      mode: "retired",
      retiredAt: new Date(),
      ...(report ? { gateReport: report as unknown as Prisma.InputJsonValue } : {}),
    },
  });
}
