/**
 * Agent-action ledger — hash-chained events for tool calls and file paths.
 *
 * Same integrity/chain construction as compliance receipts, different payload.
 * Never stores file contents, prompt text, or env values.
 */

import { createHash, randomUUID } from "node:crypto";

export const LEDGER_KINDS = [
  "tool_call",
  "file_read",
  "file_write",
  "file_delete",
  "net_egress",
  "session_start",
  "session_stop",
] as const;

export type LedgerKind = (typeof LEDGER_KINDS)[number];

export interface LedgerEventInput {
  agentId: string;
  sessionId: string;
  kind: LedgerKind;
  tool?: string;
  pathGlob?: string;
  argsDigest?: string;
  outcome?: string;
  durationMs?: number;
  orgId?: string;
  source?: "claude-code-hooks" | "mcp-gateway" | "sdk" | "demo";
}

export interface LedgerEventRecord {
  event_id: string;
  timestamp: string;
  agent_id: string;
  session_id: string;
  kind: LedgerKind;
  tool: string;
  path_glob: string;
  args_digest: string;
  outcome: string;
  duration_ms: number;
  org_id: string;
  source: string;
  seq_num: number;
  integrity_hash: string;
  chain_hash: string;
}

const INTEGRITY_FIELDS = [
  "event_id",
  "timestamp",
  "agent_id",
  "session_id",
  "kind",
  "tool",
  "path_glob",
  "args_digest",
  "outcome",
  "duration_ms",
  "org_id",
  "source",
  "seq_num",
] as const;

const SECRET_ARG = /(?:api[_-]?key|token|password|secret|authorization|bearer|cookie|private[_-]?key|database_url)/i;

export function isLedgerKind(value: string): value is LedgerKind {
  return (LEDGER_KINDS as readonly string[]).includes(value);
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function digestArgs(args: unknown): string {
  const redacted = redactArgs(args);
  return sha256Hex(JSON.stringify(redacted));
}

export function redactArgs(args: unknown): unknown {
  if (args == null) return null;
  if (typeof args === "string") {
    if (SECRET_ARG.test(args) || args.length > 240) return `[redacted:${args.length}]`;
    return args;
  }
  if (Array.isArray(args)) return args.slice(0, 20).map(redactArgs);
  if (typeof args === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      if (SECRET_ARG.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactArgs(v);
    }
    return out;
  }
  return args;
}

export function normalizePath(raw: string | undefined, workspaceRoot?: string): string {
  if (!raw) return "";
  let p = raw.trim();
  if (workspaceRoot && p.startsWith(workspaceRoot)) {
    p = p.slice(workspaceRoot.length);
    if (!p.startsWith("/")) p = `/${p}`;
    return `.${p}`;
  }
  const home = process.env.HOME;
  if (home && p.startsWith(home)) return `~${p.slice(home.length)}`;
  return p;
}

function canonical(r: Omit<LedgerEventRecord, "integrity_hash" | "chain_hash">): string {
  const data: Record<string, unknown> = {
    event_id: r.event_id,
    timestamp: r.timestamp,
    agent_id: r.agent_id,
    session_id: r.session_id,
    kind: r.kind,
    tool: r.tool,
    path_glob: r.path_glob,
    args_digest: r.args_digest,
    outcome: r.outcome,
    duration_ms: r.duration_ms,
    org_id: r.org_id,
    source: r.source,
    seq_num: r.seq_num,
  };
  return JSON.stringify(data, INTEGRITY_FIELDS as unknown as string[]);
}

export function computeLedgerIntegrityHash(
  r: Omit<LedgerEventRecord, "integrity_hash" | "chain_hash">,
): string {
  return sha256Hex(canonical(r));
}

export function computeLedgerChainHash(previousChainHash: string, integrityHash: string): string {
  return sha256Hex(previousChainHash + integrityHash);
}

export function mintLedgerEvent(
  input: LedgerEventInput,
  previousChainHash = "GENESIS",
  seqNum = 1,
): LedgerEventRecord {
  const data: Omit<LedgerEventRecord, "integrity_hash" | "chain_hash"> = {
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    agent_id: input.agentId,
    session_id: input.sessionId,
    kind: input.kind,
    tool: input.tool ?? "",
    path_glob: normalizePath(input.pathGlob),
    args_digest: input.argsDigest ?? "",
    outcome: input.outcome ?? "",
    duration_ms: input.durationMs ?? 0,
    org_id: input.orgId ?? "",
    source: input.source ?? "sdk",
    seq_num: seqNum,
  };
  const integrity_hash = computeLedgerIntegrityHash(data);
  return {
    ...data,
    integrity_hash,
    chain_hash: computeLedgerChainHash(previousChainHash, integrity_hash),
  };
}

export function verifyLedgerEvent(
  event: LedgerEventRecord,
  previousChainHash = "GENESIS",
): { valid: boolean; integrity: boolean; chain: boolean } {
  const { integrity_hash, chain_hash, ...fields } = event;
  const integrity = computeLedgerIntegrityHash(fields) === integrity_hash;
  const chain = computeLedgerChainHash(previousChainHash, integrity_hash) === chain_hash;
  return { valid: integrity && chain, integrity, chain };
}

export function pathsFromClaudeTool(tool: string, input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const files: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.length > 0 && v.length < 512) files.push(v);
  };
  if (tool === "Read" || tool === "Write" || tool === "Edit") push(input.file_path ?? input.path);
  if (Array.isArray(input.paths)) input.paths.forEach(push);
  return files;
}
