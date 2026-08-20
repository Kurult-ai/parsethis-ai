/**
 * Scheduled deletion of records past their stated retention window.
 *
 * The retention figures on /privacy and /trust were policy with nothing
 * enforcing them — a vendor questionnaire answer that no code implemented. This
 * makes them true.
 *
 * Deliberate properties:
 *   - Deletes strictly by an indexed `createdAt` cutoff derived from
 *     RETENTION in retention-facts.ts, so the code and the published copy
 *     cannot disagree about the window.
 *   - Batched, so a first run over a large backlog cannot hold a long
 *     transaction or spike the database.
 *   - A dry run reports what it would delete and removes nothing, so the first
 *     production run can be inspected before anything is destroyed.
 */
import { prisma } from "../db.js";
import { RETENTION } from "./retention-facts.js";

const BATCH_SIZE = 1_000;
/** Stop after this many batches per table per run, so one pass cannot run unbounded. */
const MAX_BATCHES_PER_TABLE = 50;

export interface PurgeTarget {
  name: string;
  retentionDays: number;
  /** Returns the number of rows deleted, capped at `limit`. */
  deleteBatch: (cutoff: Date, limit: number) => Promise<number>;
  countExpired: (cutoff: Date) => Promise<number>;
}

/**
 * Deletes by primary key from an id-selection so we never issue an unbounded
 * `deleteMany`, and so a partial run leaves a consistent state.
 */
function byCreatedAt(
  name: string,
  retentionDays: number,
  model: {
    findMany: (args: unknown) => Promise<Array<{ id: string }>>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
    count: (args: unknown) => Promise<number>;
  }
): PurgeTarget {
  return {
    name,
    retentionDays,
    countExpired: (cutoff) => model.count({ where: { createdAt: { lt: cutoff } } }),
    deleteBatch: async (cutoff, limit) => {
      const rows = await model.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      const { count } = await model.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
      return count;
    },
  };
}

export function getPurgeTargets(): PurgeTarget[] {
  const p = prisma as unknown as Record<string, never>;
  return [
    byCreatedAt("screening_events", RETENTION.screeningEventsDays, p.screeningEvent),
    byCreatedAt("audit_events", RETENTION.auditEventsDays, p.auditEvent),
    byCreatedAt("compliance_receipts", RETENTION.complianceReceiptsDays, p.complianceReceipt),
  ];
}

export interface PurgeResult {
  table: string;
  retentionDays: number;
  cutoff: string;
  expired: number;
  deleted: number;
  truncated: boolean;
  error?: string;
}

export async function runRetentionPurge(
  options: { dryRun?: boolean; now?: Date } = {}
): Promise<PurgeResult[]> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const results: PurgeResult[] = [];

  for (const target of getPurgeTargets()) {
    const cutoff = new Date(now.getTime() - target.retentionDays * 24 * 60 * 60 * 1000);
    const result: PurgeResult = {
      table: target.name,
      retentionDays: target.retentionDays,
      cutoff: cutoff.toISOString(),
      expired: 0,
      deleted: 0,
      truncated: false,
    };

    try {
      result.expired = await target.countExpired(cutoff);

      if (!dryRun) {
        for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
          const removed = await target.deleteBatch(cutoff, BATCH_SIZE);
          result.deleted += removed;
          if (removed < BATCH_SIZE) break;
          if (batch === MAX_BATCHES_PER_TABLE - 1) result.truncated = true;
        }
      }
    } catch (err) {
      // One table's failure must not stop the others; a missing table on an
      // un-migrated deploy is the common case here.
      result.error = (err as Error).message;
    }

    results.push(result);
    console.log(
      JSON.stringify({
        event: "retention_purge",
        table: result.table,
        retention_days: result.retentionDays,
        cutoff: result.cutoff,
        expired: result.expired,
        deleted: result.deleted,
        dry_run: dryRun,
        truncated: result.truncated,
        ...(result.error ? { error: result.error } : {}),
      })
    );
  }

  return results;
}
