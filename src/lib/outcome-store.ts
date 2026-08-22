/**
 * Screening outcome store + mining (plan v2 A8): ground-truth labels for the
 * detection-improvement loop.
 *
 * Sources, in the order the plan ships them:
 *  1. MINING (free, already in prod): ToolExceptionRequest approvals/denials
 *     and the trace-linked approval-request decisions. An owner APPROVING a
 *     blocked/flagged action says the flag was a false positive for their
 *     workflow; DENYING says true positive. source = "mining".
 *  2. POST /v1/outcome (paid-gated): the caller labels a trace directly.
 *     source = "caller".
 *
 * A8d — late feedback after purge: if the trace's raw ScreeningEvent is gone
 * (90d retention ate it), we still record the label (it's numbers-only and
 * cheap) and increment outcome_dropped_after_purge so the loop's coverage
 * metric stays honest. Never resurrect or extend retention for a trace.
 */
import type { Prisma } from "../generated/prisma/client.js";

export const OUTCOME_LABELS = [
  "false_positive",
  "true_positive",
  "benign_override",
  "confirmed_attack",
  "other",
] as const;
export type OutcomeLabel = (typeof OUTCOME_LABELS)[number];

export type OutcomeSource = "caller" | "owner" | "mining";

export interface OutcomePrismaClient {
  screeningOutcome: {
    upsert: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  };
  screeningEvent: {
    findFirst: (args: unknown) => Promise<{ id: string; apiKeyId: string } | null>;
  };
  $queryRaw: Prisma.PrismaPromise<unknown> extends never ? never : (sql: unknown, ...values: unknown[]) => Promise<unknown>;
  toolExceptionRequest?: {
    findMany: (args: unknown) => Promise<MineRow[]>;
  };
}

export interface MineRow {
  id: string;
  orgId: string;
  tool: string;
  agentId: string | null;
  traceId: string | null;
  status: string;
  decidedAt: Date | null;
}

export interface RecordOutcomeInput {
  traceId: string;
  outcome: OutcomeLabel;
  source: OutcomeSource;
  note?: string;
  apiKeyId?: string;
}

/** Drop-after-purge counter lives in Redis via the caller; this fn returns
 * whether the raw event still exists so the route can count it. */
export async function recordOutcome(
  p: OutcomePrismaClient,
  input: RecordOutcomeInput,
): Promise<{ rawEventExists: boolean }> {
  // Numbers/labels only. `note` is the reporter's own short label — truncate
  // hard so an accidental paste of prompt text cannot travel far.
  const note = input.note ? input.note.slice(0, 140) : undefined;

  const raw = await p.screeningEvent.findFirst({
    where: { metadata: { path: ["request_id"], equals: input.traceId } },
    select: { id: true, apiKeyId: true },
  });

  await p.screeningOutcome.upsert({
    where: { traceId_source: { traceId: input.traceId, source: input.source } },
    create: {
      traceId: input.traceId,
      outcome: input.outcome,
      source: input.source,
      note,
      apiKeyId: input.apiKeyId ?? raw?.apiKeyId ?? null,
      screeningEventId: raw?.id ?? null,
    },
    update: {
      outcome: input.outcome,
      note,
      apiKeyId: input.apiKeyId ?? raw?.apiKeyId ?? undefined,
      screeningEventId: raw?.id ?? undefined,
    },
  });

  return { rawEventExists: raw !== null };
}

/**
 * Mining pass (A8 step a): turn decided ToolExceptionRequests into labels.
 *
 * Semantics, deliberately conservative:
 *  - status "approved"  → the owner overrode the flag: benign_override.
 *    (Not "false_positive" — the owner may simply have wanted the action;
 *    conflating override with FP would poison precision metrics.)
 *  - status "denied"    → the owner confirmed the flag was right:
 *    true_positive.
 *  - pending/withdrawn/expired → no label.
 *
 * Only rows with a traceId are usable (that is the join to the screening
 * event). Idempotent: upsert keyed on (traceId, source="mining").
 */
export async function mineToolExceptionOutcomes(
  p: OutcomePrismaClient,
  opts: { since?: Date } = {},
): Promise<{ approved: number; denied: number; skipped: number }> {
  const rows = (await p.toolExceptionRequest?.findMany({
    where: {
      status: { in: ["approved", "denied"] },
      decidedAt: opts.since ? { gte: opts.since } : undefined,
    },
    select: {
      id: true,
      orgId: true,
      tool: true,
      agentId: true,
      traceId: true,
      status: true,
      decidedAt: true,
    },
  })) ?? [];

  let approved = 0;
  let denied = 0;
  let skipped = 0;

  for (const r of rows) {
    if (!r.traceId) {
      skipped++;
      continue;
    }
    const outcome: OutcomeLabel = r.status === "approved" ? "benign_override" : "true_positive";
    await recordOutcome(p, {
      traceId: r.traceId,
      outcome,
      source: "mining",
      note: `tool_exception:${r.tool}:${r.status}`,
    });
    if (outcome === "benign_override") approved++;
    else denied++;
  }

  return { approved, denied, skipped };
}

/**
 * Loop health snapshot: label counts by outcome, for the internal FP-rate
 * metric (plan Phase 3 item 3). Honest filter is the CALLER's responsibility
 * at query time (join to key for synthetic/opt-out) — labels themselves are
 * per-trace facts.
 */
export async function outcomeLabelCounts(
  p: OutcomePrismaClient,
  from: Date,
): Promise<Record<OutcomeLabel | "total", number>> {
  const rows = (await p.$queryRaw(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await import("../generated/prisma/client.js")).Prisma.sql`SELECT outcome, count(*)::int as count FROM screening_outcomes WHERE created_at >= ${from} GROUP BY outcome`,
  )) as Array<{ outcome: string; count: number }>;

  const out: Record<string, number> = { total: 0 };
  for (const r of rows) {
    out[r.outcome] = r.count;
    out.total += r.count;
  }
  return out as Record<OutcomeLabel | "total", number>;
}
