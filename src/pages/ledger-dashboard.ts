/**
 * Ledger dashboard — read-only. /dashboard/ledger
 * Counts from groupBy/count. Missing table → empty, not 500.
 */

import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import { resolveOrgId } from "../lib/org-scope.js";

export async function renderLedgerDashboardPage(baseUrl: string, apiKeyId: string, apiKeyName: string): Promise<string> {
  const orgId = await resolveOrgId(apiKeyId);
  let eventCount = 0;
  let sessionCount = 0;
  let recent: Array<{ sessionId: string; agentId: string; kind: string; tool: string; pathGlob: string; seqNum: number; timestamp: Date }> = [];

  try {
    const where = orgId ? { orgId } : {};
    const [count, sessions, rows] = await Promise.all([
      prisma.ledgerEvent.count({ where }),
      prisma.ledgerEvent.groupBy({ by: ["sessionId"], where, _count: true }),
      prisma.ledgerEvent.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: 25,
        select: { sessionId: true, agentId: true, kind: true, tool: true, pathGlob: true, seqNum: true, timestamp: true },
      }),
    ]);
    eventCount = count;
    sessionCount = sessions.length;
    recent = rows;
  } catch {
    // table missing or db down
  }

  const rowsHtml = recent.length
    ? recent
        .map(
          (r) => `<tr>
            <td><code>${esc(r.sessionId)}</code></td>
            <td>${esc(r.agentId)}</td>
            <td>${esc(r.kind)}</td>
            <td>${r.tool ? `<code>${esc(r.tool)}</code>` : "—"}</td>
            <td>${r.pathGlob ? `<code>${esc(r.pathGlob)}</code>` : "—"}</td>
            <td>${r.seqNum}</td>
            <td>${r.timestamp.toISOString()}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="7">no data yet</td></tr>`;

  const content = `
    <section class="wrap" style="padding:40px 0 80px;max-width:980px">
      <p class="eyebrow">Dashboard · ${esc(apiKeyName)}</p>
      <h1>Agent-action ledger</h1>
      <p>${eventCount} events · ${sessionCount} sessions. Paths and digests only.</p>
      <p><a href="/ledger">Public ledger</a> · <a href="/ledger/sample">Sample</a> · <a href="/dashboard/compliance">Compliance</a></p>
      <table>
        <thead><tr><th>Session</th><th>Agent</th><th>Kind</th><th>Tool</th><th>Path</th><th>#</th><th>When</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>`;

  return renderPage({
    title: "Ledger dashboard — Parse",
    description: "Org-scoped agent-action ledger.",
    path: "/dashboard/ledger",
    content,
    baseUrl,
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
