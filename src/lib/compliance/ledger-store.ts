/**
 * Persist and share hash-chained ledger events.
 * Used by /v1/ledger, MCP proxy, and SIEM. Failures stay at the caller.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../db.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../../redis.js";
import {
  mintLedgerEvent,
  type LedgerEventInput,
  type LedgerEventRecord,
  type LedgerKind,
} from "./agent-ledger.js";

const SHARE_TTL_SEC = 7 * 24 * 60 * 60;
const SHARE_PREFIX = "ledger:share:";

/** Never `{}`. Empty org selects the caller's rows, not the table. */
export function ledgerCallerScope(
  orgId: string | null | undefined,
  apiKeyId: string | null | undefined,
): { orgId: string } | { createdByApiKeyId: string } {
  if (orgId) return { orgId };
  return { createdByApiKeyId: apiKeyId || "__none__" };
}

export async function persistLedgerEvent(
  input: LedgerEventInput,
  orgId: string | null,
  createdByApiKeyId?: string | null,
): Promise<LedgerEventRecord> {
  const prev = await prisma.ledgerEvent.findFirst({
    where: { sessionId: input.sessionId, ...ledgerCallerScope(orgId, createdByApiKeyId) },
    orderBy: { seqNum: "desc" },
  });
  const seq = (prev?.seqNum ?? 0) + 1;
  const minted = mintLedgerEvent({ ...input, orgId: orgId ?? input.orgId }, prev?.chainHash ?? "GENESIS", seq);
  await prisma.ledgerEvent.create({
    data: {
      eventId: minted.event_id,
      timestamp: new Date(minted.timestamp),
      agentId: minted.agent_id,
      sessionId: minted.session_id,
      kind: minted.kind,
      tool: minted.tool,
      pathGlob: minted.path_glob,
      argsDigest: minted.args_digest,
      outcome: minted.outcome,
      durationMs: minted.duration_ms,
      orgId: minted.org_id || orgId,
      createdByApiKeyId: createdByApiKeyId || null,
      source: minted.source,
      seqNum: minted.seq_num,
      integrityHash: minted.integrity_hash,
      chainHash: minted.chain_hash,
    },
  });
  return minted;
}

export function rowToRecord(r: {
  eventId: string;
  timestamp: Date;
  agentId: string;
  sessionId: string;
  kind: string;
  tool: string;
  pathGlob: string;
  argsDigest: string;
  outcome: string;
  durationMs: number;
  orgId: string | null;
  source: string;
  seqNum: number;
  integrityHash: string;
  chainHash: string;
}): LedgerEventRecord {
  return {
    event_id: r.eventId,
    timestamp: r.timestamp.toISOString(),
    agent_id: r.agentId,
    session_id: r.sessionId,
    kind: r.kind as LedgerKind,
    tool: r.tool,
    path_glob: r.pathGlob,
    args_digest: r.argsDigest,
    outcome: r.outcome,
    duration_ms: r.durationMs,
    org_id: r.orgId ?? "",
    source: r.source,
    seq_num: r.seqNum,
    integrity_hash: r.integrityHash,
    chain_hash: r.chainHash,
  };
}

export async function loadSessionEvents(
  sessionId: string,
  orgId?: string | null,
  createdByApiKeyId?: string | null,
): Promise<LedgerEventRecord[]> {
  const where: { sessionId: string; orgId?: string; createdByApiKeyId?: string } = { sessionId };
  if (orgId) where.orgId = orgId;
  else if (createdByApiKeyId) where.createdByApiKeyId = createdByApiKeyId;
  else return [];
  const rows = await prisma.ledgerEvent.findMany({
    where,
    orderBy: { seqNum: "asc" },
    take: 500,
  });
  return rows.map(rowToRecord);
}

export async function shareSession(events: LedgerEventRecord[]): Promise<string | null> {
  await ensureRedisConnected();
  if (!isRedisAvailable()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const id = createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 24);
  await redis.set(SHARE_PREFIX + id, JSON.stringify({ events, shared_at: new Date().toISOString() }), "EX", SHARE_TTL_SEC);
  return id;
}

export async function loadSharedSession(id: string): Promise<{ events: LedgerEventRecord[]; shared_at: string } | null> {
  await ensureRedisConnected();
  if (!isRedisAvailable()) return null;
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get(SHARE_PREFIX + id);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { events: LedgerEventRecord[]; shared_at: string };
  } catch {
    return null;
  }
}

/** Fire-and-forget persist. Never throws into the agent path. */
export function persistLedgerEventSafe(
  input: LedgerEventInput,
  orgId: string | null,
  createdByApiKeyId?: string | null,
): void {
  void persistLedgerEvent(input, orgId, createdByApiKeyId).catch((err) => {
    console.error("[ledger] persist failed:", err instanceof Error ? err.message : err);
  });
}
