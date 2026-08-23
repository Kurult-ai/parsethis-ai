/**
 * Agent-action ledger — core product surface.
 *
 * GET  /ledger              — ICP-facing landing (what it is, what it is not)
 * GET  /ledger/sample       — forwardable sample session (keyless)
 * POST /v1/ledger/event     — append one event (Bearer, evaluate)
 * POST /v1/ledger/events    — append a batch
 * GET  /v1/ledger/events    — list
 * POST /v1/ledger/events/:id/verify — recompute hashes
 */

import { Hono } from "hono";
import { renderPage } from "../lib/html-template.js";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import { PRODUCT } from "../lib/product-facts.js";
import type { AppEnv } from "../types.js";
import {
  digestArgs,
  isLedgerKind,
  mintLedgerEvent,
  type LedgerEventInput,
  type LedgerEventRecord,
  type LedgerKind,
  verifyLedgerEvent,
} from "../lib/compliance/agent-ledger.js";
import { loadSessionEvents, loadSharedSession, persistLedgerEvent, shareSession, ledgerCallerScope } from "../lib/compliance/ledger-store.js";
import { replayPolicy, sampleReplayPolicy } from "../lib/compliance/policy-replay.js";
import { getOrgToolPolicy } from "../lib/tool-policy-store.js";

function requestBaseUrl(c: { req: { header: (n: string) => string | undefined } }): string {
  const proto = c.req.header("x-forwarded-proto");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (proto && host) return `${proto}://${host}`;
  return PRODUCT.canonicalBaseUrl;
}

export const ledgerRoutes = new Hono<AppEnv>();

const SAMPLE_SESSION = "sess_sample_agency_delivery";

function sampleEvents(): LedgerEventRecord[] {
  const specs: LedgerEventInput[] = [
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "session_start",
      source: "demo",
    },
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "tool_call",
      tool: "Read",
      pathGlob: "~/clients/acme/invoice-playbook.md",
      outcome: "ok",
      durationMs: 18,
      source: "demo",
    },
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "file_read",
      tool: "Read",
      pathGlob: "~/clients/acme/invoice-playbook.md",
      outcome: "ok",
      durationMs: 18,
      source: "demo",
    },
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "tool_call",
      tool: "Bash",
      pathGlob: "~/clients/acme",
      outcome: "ok",
      durationMs: 42,
      source: "demo",
    },
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "file_write",
      tool: "Write",
      pathGlob: "~/clients/acme/remediation-notes.md",
      outcome: "ok",
      durationMs: 11,
      source: "demo",
    },
    {
      agentId: "claude-code:delivery-1",
      sessionId: SAMPLE_SESSION,
      kind: "session_stop",
      source: "demo",
    },
  ];
  const out: LedgerEventRecord[] = [];
  let prev = "GENESIS";
  specs.forEach((spec, i) => {
    const ev = mintLedgerEvent(spec, prev, i + 1);
    out.push(ev);
    prev = ev.chain_hash;
  });
  return out;
}

function eventTable(events: LedgerEventRecord[]): string {
  const rows = events
    .map(
      (e) => `<tr>
        <td>${e.seq_num}</td>
        <td><code>${escape(e.kind)}</code></td>
        <td>${e.tool ? `<code>${escape(e.tool)}</code>` : "—"}</td>
        <td>${e.path_glob ? `<code>${escape(e.path_glob)}</code>` : "—"}</td>
        <td>${e.outcome || "—"}</td>
        <td><code>${escape(e.integrity_hash.slice(0, 12))}…</code></td>
      </tr>`,
    )
    .join("");
  return `<table>
    <thead><tr><th>#</th><th>Kind</th><th>Tool</th><th>Path</th><th>Outcome</th><th>Integrity</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function replayAppendix(events: LedgerEventRecord[]): string {
  const policy = sampleReplayPolicy();
  const replay = replayPolicy(events, policy);
  const rows = replay.rows
    .map(
      (r) => `<tr>
        <td>${r.seq_num}</td>
        <td><code>${escape(r.tool || r.kind)}</code></td>
        <td>${escape(r.verdict)}</td>
        <td>${escape(r.reason)}</td>
      </tr>`,
    )
    .join("");
  return `<h2>Would have refused</h2>
    <p>Today’s sample allowlist (Read only) replayed against this session. Not a control. ${replay.counts.would_refuse} would refuse · ${replay.counts.unverifiable} unverifiable.</p>
    <p class="muted">${escape(replay.note)}</p>
    <table>
      <thead><tr><th>#</th><th>Tool</th><th>Replay</th><th>Why</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function escape(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

ledgerRoutes.get("/ledger", (c) => {
  const html = `
    <section class="wrap" style="padding:48px 0 80px;max-width:760px">
      <p class="eyebrow">Core product</p>
      <h1>Ledger of agent actions</h1>
      <p>Parse records the tool names and file-path globs an agent declares — then seals each row into an append-only SHA-256 chain. You forward the page. A reviewer can recompute the hashes.</p>
      <p><strong>This is not an endpoint agent.</strong> Paths and digests only. No file contents. No prompt text. No kernel monitor. Logging is not a control.</p>
      <p>Replay today’s allowlist against a session: <code>GET /v1/ledger/sessions/:id/replay</code>. Hypothetical.</p>
      <p>
        <a class="btn" href="/ledger/sample">See a sample session</a>
        <a class="btn btn-ghost" href="/attack">Screen an email first</a>
      </p>
      <h2>Who this is for</h2>
      <p>Technical directors and staff engineers whose agents sit in front of client input. The security review asks two questions: what would the agent have executed, and what did it actually touch? Attack Pack answers the first. Ledger answers the second.</p>
      <h2>POST an event</h2>
      <p>Send JSON to <code>POST /v1/ledger/event</code> with a Bearer key. Required: <code>agent_id</code>, <code>session_id</code>. <code>kind</code> is one of <code>tool_call</code>, <code>file_read</code>, <code>file_write</code>, <code>file_delete</code>, <code>net_egress</code>, <code>session_start</code>, <code>session_stop</code>. A body that names <code>tool</code> or <code>path_glob</code> and omits <code>kind</code> defaults to <code>tool_call</code>.</p>
    </section>`;
  return c.html(
    renderPage({
      title: "Ledger — Parse",
      description:
        "Tamper-evident ledger of agent tool calls and file paths. Paths and digests only.",
      path: "/ledger",
      content: html,
      baseUrl: requestBaseUrl(c),
    }),
  );
});

ledgerRoutes.get("/ledger/sample", (c) => {
  const events = sampleEvents();
  const last = events[events.length - 1];
  const checks = events.map((e, i) => verifyLedgerEvent(e, i === 0 ? "GENESIS" : events[i - 1].chain_hash));
  const allValid = checks.every((x) => x.valid);
  const html = `
    <section class="wrap" style="padding:48px 0 80px;max-width:900px">
      <p class="eyebrow">Sample evidence · not a customer session</p>
      <h1>Agency delivery session</h1>
      <p>Composite walkthrough: Claude Code reads a client playbook, runs a command in that workspace, writes notes. Chain ${allValid ? "verifies" : "BROKEN"}.</p>
      <p>Head: <code>GENESIS</code> → tail <code>${escape(last.chain_hash.slice(0, 16))}…</code> · ${events.length} events · no file contents stored.</p>
      ${eventTable(events)}
      ${replayAppendix(events)}
      <p style="margin-top:24px"><a href="/ledger">← Ledger</a> · <a href="/attack">Attack Pack</a></p>
    </section>`;
  return c.html(
    renderPage({
      title: "Sample ledger session — Parse",
      description: "Forwardable sample of a hash-chained agent-action ledger.",
      path: "/ledger/sample",
      content: html,
      baseUrl: requestBaseUrl(c),
    }),
  );
});

function parseEventBody(raw: unknown): LedgerEventInput | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "JSON object required" };
  const b = raw as Record<string, unknown>;
  const toolHint = b.tool != null ? String(b.tool) : b.tool_name != null ? String(b.tool_name) : undefined;
  const pathHint = b.path_glob != null ? String(b.path_glob) : b.path != null ? String(b.path) : undefined;
  let kind = typeof b.kind === "string" ? b.kind : "";
  if (!kind && (toolHint || pathHint)) kind = "tool_call";
  if (!isLedgerKind(kind)) return { error: `kind must be one of ${["tool_call", "file_read", "file_write", "file_delete", "net_egress", "session_start", "session_stop"].join(", ")}` };
  const agentId = String(b.agent_id ?? b.agentId ?? "").trim();
  const sessionId = String(b.session_id ?? b.sessionId ?? "").trim();
  if (!agentId || !sessionId) return { error: "agent_id and session_id required" };
  const tool = toolHint != null ? toolHint.slice(0, 80) : undefined;
  const pathGlob = b.path_glob != null ? String(b.path_glob).slice(0, 512) : b.path != null ? String(b.path).slice(0, 512) : undefined;
  const argsDigest =
    typeof b.args_digest === "string"
      ? b.args_digest.slice(0, 64)
      : b.args !== undefined
        ? digestArgs(b.args)
        : undefined;
  return {
    agentId,
    sessionId,
    kind: kind as LedgerKind,
    tool,
    pathGlob,
    argsDigest,
    outcome: b.outcome != null ? String(b.outcome).slice(0, 40) : undefined,
    durationMs: typeof b.duration_ms === "number" ? Math.max(0, Math.min(600_000, b.duration_ms)) : undefined,
    source:
      b.source === "claude-code-hooks" || b.source === "mcp-gateway" || b.source === "sdk" || b.source === "demo"
        ? b.source
        : "sdk",
  };
}

ledgerRoutes.post("/v1/ledger/event", authMiddleware("evaluate"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const parsed = parseEventBody(body);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const key = c.get("apiKey");
  try {
    const event = await persistLedgerEvent(parsed, key?.org_id ?? null, key?.id ?? null);
    return c.json({ event }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return c.json({ error: "ledger_unavailable", detail: message }, 503);
  }
});

ledgerRoutes.post("/v1/ledger/events", authMiddleware("evaluate"), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }
  const list = Array.isArray(body) ? body : (body as { events?: unknown[] })?.events;
  if (!Array.isArray(list) || list.length === 0) return c.json({ error: "events array required" }, 400);
  if (list.length > 50) return c.json({ error: "max 50 events per batch" }, 400);
  const key = c.get("apiKey");
  const minted: LedgerEventRecord[] = [];
  try {
    for (const item of list) {
      const parsed = parseEventBody(item);
      if ("error" in parsed) return c.json({ error: parsed.error, accepted: minted.length }, 400);
      minted.push(await persistLedgerEvent(parsed, key?.org_id ?? null, key?.id ?? null));
    }
    return c.json({ events: minted, count: minted.length }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "persist failed";
    return c.json({ error: "ledger_unavailable", detail: message, accepted: minted.length }, 503);
  }
});

function ledgerListWhere(
  key: { id: string; org_id?: string | null } | undefined,
  sessionId?: string,
  agentId?: string,
): Record<string, unknown> {
  const scope: Record<string, unknown> = ledgerCallerScope(key?.org_id, key?.id);
  if (sessionId) scope.sessionId = sessionId;
  if (agentId) scope.agentId = agentId;
  return scope;
}

ledgerRoutes.get("/v1/ledger/events", authMiddleware("evaluate"), async (c) => {
  const key = c.get("apiKey");
  const sessionId = c.req.query("session_id");
  const agentId = c.req.query("agent_id");
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit") ?? "50")));
  const where = ledgerListWhere(key, sessionId, agentId);
  try {
    const rows = await prisma.ledgerEvent.findMany({
      where,
      orderBy: [{ sessionId: "asc" }, { seqNum: "asc" }],
      take: limit,
    });
    return c.json({
      events: rows.map((r) => ({
        event_id: r.eventId,
        timestamp: r.timestamp.toISOString(),
        agent_id: r.agentId,
        session_id: r.sessionId,
        kind: r.kind,
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
      })),
      count: rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "query failed";
    return c.json({ error: "ledger_unavailable", detail: message }, 503);
  }
});

ledgerRoutes.post("/v1/ledger/events/:id/verify", authMiddleware("evaluate"), async (c) => {
  const id = c.req.param("id");
  try {
    const key = c.get("apiKey");
    const row = await prisma.ledgerEvent.findFirst({
      where: { AND: [ledgerListWhere(key), { OR: [{ eventId: id }, { id }] }] },
    });
    if (!row) return c.json({ error: "not_found" }, 404);
    const prev = await prisma.ledgerEvent.findFirst({
      where: { sessionId: row.sessionId, seqNum: row.seqNum - 1, ...ledgerCallerScope(key?.org_id, key?.id) },
    });
    const event: LedgerEventRecord = {
      event_id: row.eventId,
      timestamp: row.timestamp.toISOString(),
      agent_id: row.agentId,
      session_id: row.sessionId,
      kind: row.kind as LedgerKind,
      tool: row.tool,
      path_glob: row.pathGlob,
      args_digest: row.argsDigest,
      outcome: row.outcome,
      duration_ms: row.durationMs,
      org_id: row.orgId ?? "",
      source: row.source,
      seq_num: row.seqNum,
      integrity_hash: row.integrityHash,
      chain_hash: row.chainHash,
    };
    return c.json(verifyLedgerEvent(event, prev?.chainHash ?? "GENESIS"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    return c.json({ error: "ledger_unavailable", detail: message }, 503);
  }
});

function sessionPage(title: string, path: string, events: LedgerEventRecord[], baseUrl: string, note: string): string {
  const last = events[events.length - 1];
  const checks = events.map((e, i) => verifyLedgerEvent(e, i === 0 ? "GENESIS" : events[i - 1].chain_hash));
  const allValid = checks.every((x) => x.valid);
  const html = `
    <section class="wrap" style="padding:48px 0 80px;max-width:900px">
      <p class="eyebrow">${escape(note)}</p>
      <h1>${escape(title)}</h1>
      <p>Chain ${allValid ? "verifies" : "BROKEN"} · ${events.length} events · tail <code>${escape((last?.chain_hash ?? "").slice(0, 16))}…</code></p>
      <p>Paths and digests only. No file contents. No prompt text.</p>
      ${eventTable(events)}
      <p style="margin-top:24px"><a href="/ledger">← Ledger</a></p>
    </section>`;
  return renderPage({
    title: `${title} — Parse`,
    description: "Forwardable agent-action ledger session.",
    path,
    content: html,
    baseUrl,
  });
}

ledgerRoutes.get("/v1/ledger/sessions/:sessionId/replay", authMiddleware("evaluate"), async (c) => {
  const sessionId = c.req.param("sessionId") ?? "";
  const key = c.get("apiKey");
  const orgId = key?.org_id ?? null;
  try {
    const events = await loadSessionEvents(sessionId, orgId, orgId ? null : key?.id ?? null);
    if (events.length === 0) return c.json({ error: "not_found" }, 404);
    let toolMode: "blocklist" | "allowlist" = "blocklist";
    let toolRules: import("../lib/tool-policy.js").ToolRule[] = [];
    let fileRules: import("../lib/file-acl.js").FileAclRuleLike[] = [];
    if (orgId) {
      const policy = await getOrgToolPolicy(orgId);
      toolMode = policy.mode;
      toolRules = policy.rules;
      const rows = await prisma.fileAclRule.findMany({
        where: { orgId },
        select: { id: true, pathPattern: true, action: true, priority: true, comment: true },
      });
      fileRules = rows.map((r) => ({
        id: r.id,
        pathPattern: r.pathPattern,
        action: r.action as import("../lib/file-acl.js").FileAclAction,
        priority: r.priority,
        comment: r.comment,
      }));
    }
    return c.json(replayPolicy(events, { toolMode, toolRules, fileRules }));
  } catch (err) {
    const message = err instanceof Error ? err.message : "replay failed";
    return c.json({ error: "ledger_unavailable", detail: message }, 503);
  }
});

ledgerRoutes.post("/v1/ledger/sessions/:sessionId/share", authMiddleware("evaluate"), async (c) => {
  const sessionId = c.req.param("sessionId");
  const key = c.get("apiKey");
  try {
    const events = await loadSessionEvents(
      c.req.param("sessionId") ?? "",
      key?.org_id ?? null,
      key?.org_id ? null : key?.id ?? null,
    );
    if (events.length === 0) return c.json({ error: "not_found" }, 404);
    const id = await shareSession(events);
    if (!id) return c.json({ events, share_url: null, detail: "share store unavailable" }, 200);
    return c.json({ share_url: `${requestBaseUrl(c)}/ledger/s/${id}`, event_count: events.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "share failed";
    return c.json({ error: "ledger_unavailable", detail: message }, 503);
  }
});

ledgerRoutes.get("/ledger/s/:id", async (c) => {
  const packed = await loadSharedSession(c.req.param("id"));
  if (!packed) return c.text("Not found or expired", 404);
  return c.html(sessionPage("Shared ledger session", `/ledger/s/${c.req.param("id")}`, packed.events, requestBaseUrl(c), `Shared ${packed.shared_at} · 7-day TTL`));
});
