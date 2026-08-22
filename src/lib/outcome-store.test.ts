/**
 * Outcome store + mining tests (plan v2 A8): labels recorded correctly,
 * mining semantics conservative (approved→benign_override, denied→true_positive),
 * purge behavior honest (label recorded, rawEventExists false), notes truncated.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordOutcome, mineToolExceptionOutcomes } from "./outcome-store.js";

interface UpsertArgs {
  where: { traceId_source: { traceId: string; source: string } };
  create: { data: Record<string, unknown> };
  update: { data: Record<string, unknown> };
}
interface FakeEvent { id: string; requestId: string; apiKeyId: string }
interface FakeException {
  id: string; orgId: string; tool: string; agentId: string | null;
  traceId: string | null; status: string; decidedAt: Date | null;
}
function makeFakePrisma(
  outcomes: UpsertArgs[],
  events: FakeEvent[],
  exceptions: FakeException[],
) {
  return {
    screeningOutcome: {
      upsert: async (args: UpsertArgs) => {
        outcomes.push(args);
        return {};
      },
      count: async () => outcomes.length,
    },
    screeningEvent: {
      findFirst: async ({ where }: { where: { metadata: { path: unknown[] } } }) => {
        const want = where.metadata.equals as string;
        return events.find((e) => e.requestId === want) ?? null;
      },
    },
    toolExceptionRequest: {
      findMany: async ({ where }: { where: { status: { in: string[] }; decidedAt?: { gte?: Date } } }) =>
        exceptions.filter((x) => where.status.in.includes(x.status) && (!where.decidedAt?.gte || (x.decidedAt as Date) >= where.decidedAt.gte)),
    },
  } as never;
}

test("recordOutcome links to the raw event when present", async () => {
  const outcomes: UpsertArgs[] = [];
  const events = [{ id: "evt_1", requestId: "trace_1", apiKeyId: "key_1" }];
  const p = makeFakePrisma(outcomes, events, []);
  const r = await recordOutcome(p, {
    traceId: "trace_1",
    outcome: "false_positive",
    source: "caller",
    note: "analyst describing an attack",
  });
  assert.equal(r.rawEventExists, true);
  const row = outcomes[0];
  assert.equal(row.create.traceId, "trace_1");
  assert.equal(row.create.screeningEventId, "evt_1");
  assert.equal(row.create.apiKeyId, "key_1");
});

test("recordOutcome after purge: label recorded, honest flag returned (A8d)", async () => {
  const outcomes: UpsertArgs[] = [];
  const p = makeFakePrisma(outcomes, [], []);
  const r = await recordOutcome(p, {
    traceId: "trace_old",
    outcome: "true_positive",
    source: "caller",
  });
  assert.equal(r.rawEventExists, false, "raw event gone → false, not an error");
  assert.equal(outcomes[0].create.traceId, "trace_old");
  assert.equal(outcomes[0].create.screeningEventId, null);
});

test("note is truncated to 140 chars — prompt pastes cannot travel", async () => {
  const outcomes: UpsertArgs[] = [];
  const p = makeFakePrisma(outcomes, [], []);
  await recordOutcome(p, {
    traceId: "t",
    outcome: "other",
    source: "caller",
    note: "x".repeat(500),
  });
  assert.equal((outcomes[0]!.create as Record<string, unknown>).note as string, "x".repeat(140));
});

test("mining: approved → benign_override, denied → true_positive, no-trace skipped", async () => {
  const outcomes: UpsertArgs[] = [];
  const p = makeFakePrisma(outcomes, [], [
    { id: "x1", orgId: "o1", tool: "shell", agentId: null, traceId: "t1", status: "approved", decidedAt: new Date() },
    { id: "x2", orgId: "o1", tool: "shell", agentId: null, traceId: "t2", status: "denied", decidedAt: new Date() },
    { id: "x3", orgId: "o1", tool: "shell", agentId: null, traceId: null, status: "approved", decidedAt: new Date() },
    { id: "x4", orgId: "o1", tool: "shell", agentId: null, traceId: "t4", status: "pending", decidedAt: null },
  ]);
  const r = await mineToolExceptionOutcomes(p, {});
  assert.equal(r.approved, 1);
  assert.equal(r.denied, 1);
  assert.equal(r.skipped, 1, "no-trace row skipped; pending never fetched");
  const labels = outcomes.map((o) => [o.create.traceId, o.create.outcome, o.create.source]);
  assert.deepEqual(labels, [
    ["t1", "benign_override", "mining"],
    ["t2", "true_positive", "mining"],
  ]);
});

test("mining is idempotent-shaped: upsert keyed on (traceId, mining)", async () => {
  const outcomes: UpsertArgs[] = [];
  const p = makeFakePrisma(outcomes, [], [
    { id: "x1", orgId: "o1", tool: "shell", agentId: null, traceId: "t1", status: "approved", decidedAt: new Date() },
  ]);
  await mineToolExceptionOutcomes(p, {});
  await mineToolExceptionOutcomes(p, {});
  for (const o of outcomes) {
    assert.ok(o.where && typeof o.where === "object" && "traceId_source" in o.where);
  }
});
