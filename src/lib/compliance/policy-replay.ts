/**
 * Policy replay — “would have refused.”
 *
 * Pure function over stored ledger rows (tool name + path glob) and *today’s*
 * org tool-policy / file ACL. This is an appendix, not a control. It does not
 * refuse anything. It does not become EDR.
 *
 * If a rule would need an argument value and we only have args_digest, the
 * row is `unverifiable`. Never invent a deny from a digest.
 */

import { resolveFileAcl, type FileAclRuleLike } from "../file-acl.js";
import {
  resolveToolDecision,
  type ToolPolicyMode,
  type ToolRule,
} from "../tool-policy.js";
import type { LedgerEventRecord } from "./agent-ledger.js";

export type ReplayVerdict = "would_refuse" | "would_hold" | "would_allow" | "unverifiable" | "not_applicable";

export interface ReplayRow {
  event_id: string;
  seq_num: number;
  kind: string;
  tool: string;
  path_glob: string;
  verdict: ReplayVerdict;
  reason: string;
}

export interface PolicyReplay {
  session_id: string;
  policy_as_of: string;
  tool_mode: ToolPolicyMode;
  note: string;
  counts: Record<ReplayVerdict, number>;
  rows: ReplayRow[];
}

const SKIP_KINDS = new Set(["session_start", "session_stop"]);

export function replayPolicy(
  events: LedgerEventRecord[],
  opts: {
    toolMode: ToolPolicyMode;
    toolRules: ToolRule[];
    fileRules?: FileAclRuleLike[];
    asOf?: string;
  },
): PolicyReplay {
  const rows: ReplayRow[] = [];
  for (const ev of events) {
    rows.push(replayOne(ev, opts));
  }
  const counts: Record<ReplayVerdict, number> = {
    would_refuse: 0,
    would_hold: 0,
    would_allow: 0,
    unverifiable: 0,
    not_applicable: 0,
  };
  for (const r of rows) counts[r.verdict] += 1;
  return {
    session_id: events[0]?.session_id ?? "",
    policy_as_of: opts.asOf ?? new Date().toISOString(),
    tool_mode: opts.toolMode,
    note:
      "Hypothetical. Today's dashboard policy applied to yesterday's ledger. Logging is not a control. Unverifiable means the stored digest is not enough to replay an argument-sensitive rule.",
    counts,
    rows,
  };
}

function replayOne(
  ev: LedgerEventRecord,
  opts: { toolMode: ToolPolicyMode; toolRules: ToolRule[]; fileRules?: FileAclRuleLike[] },
): ReplayRow {
  const base = {
    event_id: ev.event_id,
    seq_num: ev.seq_num,
    kind: ev.kind,
    tool: ev.tool,
    path_glob: ev.path_glob,
  };

  if (SKIP_KINDS.has(ev.kind)) {
    return { ...base, verdict: "not_applicable", reason: "session marker" };
  }

  const fileKinds = ev.kind === "file_read" || ev.kind === "file_write" || ev.kind === "file_delete";
  const digestOnly = ev.args_digest !== "" && ev.tool === "" && ev.path_glob === "";
  if (digestOnly) {
    return {
      ...base,
      verdict: "unverifiable",
      reason: "only args_digest is stored; a rule that matches on an argument value cannot be replayed",
    };
  }

  if (fileKinds && !ev.path_glob) {
    return {
      ...base,
      verdict: "unverifiable",
      reason: "file event has no path glob; cannot replay directory policy from a digest",
    };
  }

  if (!ev.tool && !ev.path_glob) {
    return {
      ...base,
      verdict: "unverifiable",
      reason: "no tool name or path glob on the row",
    };
  }

  let toolAction: "allow" | "require_approval" | "block" | null = null;
  let toolReason = "";
  if (ev.tool) {
    const d = resolveToolDecision(ev.tool, opts.toolRules, opts.toolMode, { agentId: ev.agent_id });
    toolAction = d.action;
    toolReason = d.reason;
  }

  let fileAction: "allow" | "require_approval" | "block" | null = null;
  let fileReason = "";
  if (ev.path_glob && opts.fileRules && opts.fileRules.length > 0) {
    const d = resolveFileAcl(ev.path_glob, opts.fileRules);
    fileAction = d.action;
    fileReason = d.matched
      ? `file ACL ${d.action} (${d.pattern ?? "rule"})`
      : "file ACL fail-open (no rule matched)";
  }

  const refuse = toolAction === "block" || fileAction === "block";
  const hold = !refuse && (toolAction === "require_approval" || fileAction === "require_approval");

  if (refuse) {
    return {
      ...base,
      verdict: "would_refuse",
      reason: [toolAction === "block" ? toolReason : "", fileAction === "block" ? fileReason : ""]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (hold) {
    return {
      ...base,
      verdict: "would_hold",
      reason: [toolAction === "require_approval" ? toolReason : "", fileAction === "require_approval" ? fileReason : ""]
        .filter(Boolean)
        .join(" · "),
    };
  }
  if (!ev.tool && !fileAction) {
    return { ...base, verdict: "would_allow", reason: "no tool name; no file rule applied" };
  }
  return {
    ...base,
    verdict: "would_allow",
    reason: [toolReason, fileReason].filter(Boolean).join(" · ") || "no matching deny",
  };
}

export function sampleReplayPolicy(): { toolMode: ToolPolicyMode; toolRules: ToolRule[]; fileRules: FileAclRuleLike[] } {
  return {
    toolMode: "allowlist",
    toolRules: [
      {
        id: "demo-allow-read",
        kind: "exact",
        pattern: "Read",
        action: "allow",
        scopeType: null,
        scopeId: null,
        priority: 10,
        reason: "sample allowlist — Read only",
      },
    ],
    fileRules: [
      { id: "demo-allow-acme", pathPattern: "~/clients/acme/**", action: "allow", priority: 0 },
    ],
  };
}
