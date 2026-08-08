/**
 * Agent Dashboard — SSR page at /dashboard/agents
 *
 * Layout follows Miller's law: content is chunked into a small number of
 * scannable zones, each holding at most ~5-7 items:
 *   1. Dashboard switcher (4 destinations) — replaces the marketing-only nav gap
 *   2. Posture strip — one segmented card with 5 fleet-level facts
 *   3. Agent registry — the core object; filter chips + search, 6 columns
 *   4. Recent screening activity — 4 columns, agent ids resolved to names
 *   5. Controls band — enforcement / data governance / SIEM as 3 compact cards
 *
 * Rendering is read-only: this page must never write to the database
 * (org provisioning belongs to the API routes, not a GET).
 */

import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import { isRedisAvailable } from "../redis.js";

// ─── Helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined) return "—";
  return escapeHtml(String(val));
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimestamp(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface StatusBadge {
  class: string;
  label: string;
}

function statusBadge(status: string, frozen: boolean): StatusBadge {
  if (frozen) return { class: "st-frozen", label: "Frozen" };
  switch (status) {
    case "active":
      return { class: "st-active", label: "Active" };
    case "suspended":
      return { class: "st-suspended", label: "Suspended" };
    case "decommissioned":
      return { class: "st-retired", label: "Retired" };
    case "discovered":
      return { class: "st-discovered", label: "Discovered" };
    default:
      return { class: "st-other", label: escapeHtml(status) };
  }
}

function riskBadge(risk: string): StatusBadge {
  switch (risk) {
    case "low":
      return { class: "risk-low", label: "Low" };
    case "medium":
      return { class: "risk-medium", label: "Medium" };
    case "high":
      return { class: "risk-high", label: "High" };
    case "critical":
      return { class: "risk-critical", label: "Critical" };
    default:
      return { class: "risk-unscored", label: "Unscored" };
  }
}

function enforcementModeClass(mode: string): string {
  switch (mode) {
    case "block":
      return "mode-block";
    case "warn":
      return "mode-warn";
    case "monitor":
      return "mode-monitor";
    default:
      return "mode-other";
  }
}

function verdictBadge(verdict: string): StatusBadge {
  const label = escapeHtml(verdict.replace(/_/g, " "));
  switch (verdict) {
    case "safe":
    case "low_risk":
      return { class: "st-active", label };
    case "medium_risk":
      return { class: "st-suspended", label };
    case "high_risk":
    case "critical":
      return { class: "st-danger", label };
    default:
      return { class: "st-other", label };
  }
}

// "Needs attention" = anything an operator should look at first.
function needsAttention(a: { status: string; frozen: boolean; riskLevel: string }): boolean {
  return (
    a.frozen ||
    a.status === "suspended" ||
    a.riskLevel === "high" ||
    a.riskLevel === "critical"
  );
}

// ─── Org resolution (read-only; API routes own org provisioning) ──────

async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    if (apiKey?.orgId) return apiKey.orgId;
  } catch {
    // fall through
  }
  try {
    const existingOrg = await prisma.organization.findFirst({
      where: { ownerId: apiKeyId },
    });
    return existingOrg?.id ?? null;
  } catch {
    return null;
  }
}

// ─── Main render ──────────────────────────────────────────────────────

export async function renderAgentDashboardPage(
  baseUrl: string,
  apiKeyId: string,
): Promise<string> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Default values (used when DB tables not available)
  let totalAgents = 0;
  let activeAgents = 0;
  let frozenAgents = 0;
  let agentRows: Array<{
    id: string;
    agentName: string;
    status: string;
    frozen: boolean;
    riskLevel: string;
    lastSeenAt: Date | null;
    framework: string | null;
    ownerEmail: string | null;
  }> = [];
  let screenings24h = 0;
  let coveragePct: number | null = null;
  let enforcementModes: Array<{ environment: string; mode: string }> = [];
  let recentEvents: Array<Record<string, unknown>> = [];
  let activeGrantsCount = 0;
  let egressRulesCount = 0;
  let volumeBudgetsCount = 0;
  let siemConnected = false;
  let siemLastForwarded: string | null = null;
  let siemDestinations = 0;
  let siemEventsQueued = 0;
  let siemFailedCount = 0;

  const orgId = await resolveOrgId(apiKeyId);

  // ─── Fetch agent registry ──────────────────────────────────────────
  if (orgId) {
    try {
      const [agents, counts] = await Promise.all([
        prisma.agentRegistry.findMany({
          where: { orgId },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true,
            agentName: true,
            status: true,
            frozen: true,
            riskLevel: true,
            lastSeenAt: true,
            framework: true,
            ownerEmail: true,
            createdAt: true,
          },
        }),
        prisma.agentRegistry.groupBy({
          by: ["status"],
          where: { orgId },
          _count: true,
        }),
      ]);

      agentRows = agents.map((a) => ({
        id: a.id,
        agentName: a.agentName,
        status: a.status,
        frozen: a.frozen,
        riskLevel: a.riskLevel,
        lastSeenAt: a.lastSeenAt,
        framework: a.framework,
        ownerEmail: a.ownerEmail,
      }));

      // True total from groupBy — findMany is capped at 100 rows.
      totalAgents = counts.reduce((sum, c) => sum + (c._count ?? 0), 0);
      if (totalAgents < agents.length) totalAgents = agents.length;

      for (const c of counts) {
        if (c.status === "active") activeAgents = c._count;
      }

      // Frozen count is separate from status
      frozenAgents = await prisma.agentRegistry.count({
        where: { orgId, frozen: true },
      });
    } catch {
      // table might not exist
    }
  }

  // ─── Fetch screening counts & recent events ────────────────────────
  try {
    screenings24h = await prisma.screeningEvent.count({
      where: { apiKeyId, createdAt: { gte: since24h } },
    });
  } catch {
    // non-fatal
  }

  try {
    recentEvents = (await prisma.screeningEvent.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        riskScore: true,
        verdict: true,
        categories: true,
        blocked: true,
        createdAt: true,
        metadata: true,
      },
    })) as unknown as Array<Record<string, unknown>>;
  } catch {
    // non-fatal
  }

  // ─── Coverage attestation (best-effort; null = no data, not 0%) ────
  if (orgId) {
    try {
      const { getCoverageReport } = await import(
        "../lib/compliance/coverage-attestation.js"
      );
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const to = new Date();
      const report = await getCoverageReport(orgId, { from, to });
      const pct = (report as { coverage_pct?: number }).coverage_pct;
      coveragePct = typeof pct === "number" ? Math.round(pct) : null;
    } catch {
      // coverage may be unavailable
    }
  }

  // ─── Enforcement modes per environment ─────────────────────────────
  try {
    const policies = await prisma.screeningPolicy.findMany({
      where: { apiKeyId },
      select: { environment: true, enforcementMode: true },
    });
    enforcementModes = policies.map((p) => ({
      environment: p.environment,
      mode: p.enforcementMode,
    }));
    if (enforcementModes.length === 0) {
      enforcementModes = [{ environment: "production", mode: "block" }];
    }
  } catch {
    enforcementModes = [{ environment: "production", mode: "block" }];
  }

  // ─── Data governance summary (scoped to this org's agents) ─────────
  if (orgId) {
    const orgAgentIds = agentRows.map((a) => a.id);

    if (orgAgentIds.length > 0) {
      try {
        activeGrantsCount = await prisma.agentDataGrant.count({
          where: {
            agentId: { in: orgAgentIds },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
      } catch {
        // non-fatal
      }

      try {
        volumeBudgetsCount = await prisma.volumeBudget.count({
          where: { agentId: { in: orgAgentIds } },
        });
      } catch {
        // non-fatal
      }
    }

    try {
      egressRulesCount = await prisma.egressRule.count({
        where: { orgId },
      });
    } catch {
      // non-fatal
    }
  }

  // ─── SIEM forwarding status ────────────────────────────────────────
  try {
    if (isRedisAvailable()) {
      const { getSIEMStatus } = await import("../lib/compliance/siem-worker.js");
      const status = await getSIEMStatus();
      siemLastForwarded = status.last_forwarded;
      siemDestinations = status.destinations.length;
      siemEventsQueued = status.events_queued;
      siemFailedCount = status.failed_forward_count;
      siemConnected = status.destinations.length > 0 && status.destinations.some((d) => d.reachable);
    }
  } catch {
    // non-fatal
  }

  // ─── Build HTML ────────────────────────────────────────────────────

  const attentionCount = agentRows.filter(needsAttention).length;
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.agentName]));
  const prodMode =
    enforcementModes.find((e) => e.environment === "production")?.mode ??
    enforcementModes[0]?.mode ??
    "block";

  // Posture strip — one segmented card, five facts.
  const coverageCell =
    coveragePct === null
      ? `<div class="ad-cell-value ad-num ad-value-dim">—</div>
         <div class="ad-cell-foot">no data yet</div>`
      : `<div class="ad-cell-value ad-num" style="color:${
          coveragePct >= 85 ? "var(--green)" : coveragePct >= 50 ? "var(--yellow)" : "var(--destructive)"
        };">${coveragePct}%</div>
         <div class="ad-cell-foot">last 7 days</div>`;

  const postureStrip = `
    <div class="ad-strip" role="group" aria-label="Fleet posture">
      <a class="ad-cell" href="#registry">
        <div class="ad-cell-label">Agents</div>
        <div class="ad-cell-value ad-num">${totalAgents}</div>
        <div class="ad-cell-foot"><span class="ad-dot ad-dot-green"></span>${activeAgents} active${frozenAgents > 0 ? ` · <span class="ad-dot ad-dot-blue"></span>${frozenAgents} frozen` : ""}</div>
      </a>
      <a class="ad-cell" href="#registry">
        <div class="ad-cell-label">Needs attention</div>
        <div class="ad-cell-value ad-num" style="color:${attentionCount > 0 ? "var(--yellow)" : "var(--text)"};">${attentionCount}</div>
        <div class="ad-cell-foot">${attentionCount === 0 ? "all clear" : "frozen · suspended · high risk"}</div>
      </a>
      <a class="ad-cell" href="#activity">
        <div class="ad-cell-label">Screenings 24h</div>
        <div class="ad-cell-value ad-num">${screenings24h}</div>
        <div class="ad-cell-foot">across this key</div>
      </a>
      <div class="ad-cell">
        <div class="ad-cell-label">Coverage</div>
        ${coverageCell}
      </div>
      <a class="ad-cell" href="#controls">
        <div class="ad-cell-label">Production dial</div>
        <div class="ad-cell-value"><span class="ad-mode ${enforcementModeClass(prodMode)}">${escapeHtml(prodMode)}</span></div>
        <div class="ad-cell-foot">SIEM ${siemConnected ? '<span class="ad-dot ad-dot-green"></span>connected' : '<span class="ad-dot ad-dot-dim"></span>off'}</div>
      </a>
    </div>`;

  // Agent table rows
  const registerSnippet = `curl -X POST ${escapeHtml(baseUrl)}/v1/agents \\
  -H "Authorization: Bearer $PARSE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_name": "my-first-agent", "framework": "langgraph"}'`;

  const emptyRegistry = `
    <div class="ad-empty">
      <div class="ad-empty-title">No agents registered yet</div>
      <p>Register your first agent and it will show up here with live status, risk level, and screening history.</p>
      <pre class="ad-snippet"><code>${registerSnippet}</code></pre>
      <a href="/docs" class="btn btn-outline" style="margin-top:12px;">Read the docs</a>
    </div>`;

  const agentTableRows = agentRows
    .map((a) => {
      const sb = statusBadge(a.status, a.frozen);
      const rb = riskBadge(a.riskLevel);
      const attention = needsAttention(a);
      const searchable = escapeHtml(
        `${a.agentName} ${a.id} ${a.ownerEmail ?? ""} ${a.framework ?? ""}`.toLowerCase(),
      );
      return `
        <tr data-status="${escapeHtml(a.status)}" data-frozen="${a.frozen}" data-attention="${attention}" data-search="${searchable}">
          <td>
            <div class="ad-agent-name">${escapeHtml(a.agentName)}</div>
            <div class="ad-agent-meta"><code class="ad-agent-id">${escapeHtml(a.id.slice(0, 12))}…</code>${a.framework ? ` · ${escapeHtml(a.framework)}` : ""}</div>
          </td>
          <td><span class="ad-badge ${sb.class}">${sb.label}</span></td>
          <td><span class="ad-badge ${rb.class}">${rb.label}</span></td>
          <td class="ad-num-cell" title="${a.lastSeenAt ? escapeHtml(formatTimestamp(a.lastSeenAt)) : "never"}">${timeAgo(a.lastSeenAt)}</td>
          <td class="ad-dim-cell">${safeStr(a.ownerEmail)}</td>
          <td style="text-align:right;"><a href="/v1/agents/${encodeURIComponent(a.id)}" class="ad-detail-link" title="Raw agent record (JSON)">Details →</a></td>
        </tr>`;
    })
    .join("\n");

  const registrySection =
    agentRows.length === 0
      ? emptyRegistry
      : `
    <div class="ad-toolbar">
      <div class="ad-chips" role="tablist" aria-label="Filter agents">
        <button class="ad-chip ad-chip-on" data-filter="all">All <span class="ad-chip-n">${totalAgents}</span></button>
        <button class="ad-chip" data-filter="active">Active <span class="ad-chip-n">${activeAgents}</span></button>
        <button class="ad-chip" data-filter="frozen">Frozen <span class="ad-chip-n">${frozenAgents}</span></button>
        <button class="ad-chip" data-filter="attention">Needs attention <span class="ad-chip-n">${attentionCount}</span></button>
      </div>
      <input type="search" id="ad-search" class="ad-search" placeholder="Search name, id, owner…" aria-label="Search agents">
    </div>
    <div class="table-wrapper">
      <table id="ad-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Status</th>
            <th>Risk</th>
            <th>Last seen</th>
            <th>Owner</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${agentTableRows}
        </tbody>
      </table>
    </div>
    <div class="ad-table-foot" id="ad-table-foot">${agentRows.length < totalAgents ? `Showing newest ${agentRows.length} of ${totalAgents} agents.` : ""}</div>`;

  // Recent screening events — 4 columns, agent ids resolved to names.
  const eventRows =
    recentEvents.length === 0
      ? `<tr><td colspan="4" class="ad-empty-row">No screening events yet. Calls to <code>POST /v1/parse</code> and <code>POST /v1/screen-output</code> will appear here.</td></tr>`
      : recentEvents
          .map((e) => {
            const verdict = String(e.verdict ?? "unknown");
            const vb = verdictBadge(verdict);
            const riskScore = e.riskScore as number | undefined;
            const blocked = e.blocked as boolean;
            const metadata = e.metadata as Record<string, unknown> | null;
            const agentId = metadata?.agent_id ? String(metadata.agent_id) : null;
            const agentLabel = agentId
              ? agentNameById.get(agentId) ?? `${agentId.slice(0, 12)}…`
              : "—";
            const riskColor =
              riskScore === undefined
                ? "var(--text-dim)"
                : riskScore >= 7
                  ? "var(--destructive)"
                  : riskScore >= 4
                    ? "var(--yellow)"
                    : "var(--green)";
            return `
        <tr>
          <td><span class="ad-badge ${vb.class}">${vb.label}</span>${blocked ? ' <span class="ad-badge st-danger">blocked</span>' : ""}</td>
          <td class="ad-num-cell"><strong style="color:${riskColor};">${riskScore !== undefined ? riskScore.toFixed(1) : "—"}</strong></td>
          <td class="ad-dim-cell">${escapeHtml(agentLabel)}</td>
          <td class="ad-num-cell" title="${escapeHtml(formatTimestamp(e.createdAt as Date))}">${timeAgo(e.createdAt as Date)}</td>
        </tr>`;
          })
          .join("\n");

  // Controls band — enforcement / governance / SIEM as three compact cards.
  const enforcementItems = enforcementModes
    .map(
      (e) => `
      <div class="ad-ctl-row">
        <span class="ad-env">${escapeHtml(e.environment)}</span>
        <span class="ad-mode ${enforcementModeClass(e.mode)}">${escapeHtml(e.mode)}</span>
      </div>`,
    )
    .join("");

  const controlsBand = `
    <div class="ad-controls" id="controls">
      <div class="ad-ctl-card">
        <div class="ad-ctl-title">Enforcement dial</div>
        <div class="ad-ctl-sub">block stops it · warn annotates · monitor logs only</div>
        ${enforcementItems}
      </div>
      <div class="ad-ctl-card">
        <div class="ad-ctl-title">Data governance</div>
        <div class="ad-ctl-sub">what your agents may touch and move</div>
        <div class="ad-ctl-row"><span class="ad-env">active data grants</span><span class="ad-num ad-ctl-n">${activeGrantsCount}</span></div>
        <div class="ad-ctl-row"><span class="ad-env">egress rules</span><span class="ad-num ad-ctl-n">${egressRulesCount}</span></div>
        <div class="ad-ctl-row"><span class="ad-env">volume budgets</span><span class="ad-num ad-ctl-n">${volumeBudgetsCount}</span></div>
      </div>
      <div class="ad-ctl-card">
        <div class="ad-ctl-title">SIEM forwarding</div>
        <div class="ad-ctl-sub">${siemConnected ? '<span class="ad-dot ad-dot-green"></span>connected' : '<span class="ad-dot ad-dot-dim"></span>not connected'} · last forwarded ${siemLastForwarded ? escapeHtml(formatTimestamp(siemLastForwarded)) : "never"}</div>
        <div class="ad-ctl-row"><span class="ad-env">destinations</span><span class="ad-num ad-ctl-n">${siemDestinations}</span></div>
        <div class="ad-ctl-row"><span class="ad-env">queued</span><span class="ad-num ad-ctl-n">${siemEventsQueued}</span></div>
        <div class="ad-ctl-row"><span class="ad-env">failed</span><span class="ad-num ad-ctl-n" style="color:${siemFailedCount > 0 ? "var(--destructive)" : "inherit"};">${siemFailedCount}</span></div>
      </div>
    </div>`;

  const content = `
<style>
  /* ── layout & type ─────────────────────────────────────────────── */
  .ad-num, .ad-num-cell { font-variant-numeric: tabular-nums; }
  .ad-kicker {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent2);
    margin-bottom: 4px;
  }
  .ad-section { margin-bottom: 48px; }
  .ad-section h2 { margin: 0 0 2px; }
  .ad-section-sub { color: var(--text-dim); font-size: 14px; margin: 0 0 16px; }

  /* ── dashboard switcher ────────────────────────────────────────── */
  .ad-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    align-items: center;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0;
    margin-bottom: 28px;
  }
  .ad-tab {
    padding: 9px 14px 11px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-dim);
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .ad-tab:hover { color: var(--text); text-decoration: none; }
  .ad-tab-on {
    color: var(--accent2);
    border-bottom-color: var(--accent);
  }
  .ad-tabs-right { margin-left: auto; font-size: 13px; color: var(--text-soft); padding-bottom: 8px; }

  /* ── posture strip ─────────────────────────────────────────────── */
  .ad-strip {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    margin-bottom: 8px;
    box-shadow: 0 1px 0 rgba(24,36,50,0.02);
  }
  .ad-cell {
    padding: 18px 20px 14px;
    border-left: 1px solid var(--border);
    color: inherit;
    display: block;
  }
  .ad-cell:first-child { border-left: none; }
  a.ad-cell:hover { background: var(--surface2); text-decoration: none; color: inherit; }
  .ad-cell-label {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 6px;
  }
  .ad-cell-value { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .ad-value-dim { color: var(--text-soft); }
  .ad-cell-foot { font-size: 12px; color: var(--text-dim); margin-top: 6px; }
  @media (max-width: 900px) {
    .ad-strip { grid-template-columns: 1fr 1fr; }
    .ad-cell { border-top: 1px solid var(--border); }
    .ad-cell:nth-child(-n+2) { border-top: none; }
    .ad-cell:nth-child(odd) { border-left: none; }
  }

  /* ── dots & badges ─────────────────────────────────────────────── */
  .ad-dot {
    display: inline-block;
    width: 7px; height: 7px;
    border-radius: 50%;
    margin-right: 4px;
    vertical-align: 1px;
  }
  .ad-dot-green { background: var(--green); }
  .ad-dot-blue { background: var(--accent); }
  .ad-dot-dim { background: var(--text-soft); }
  .ad-badge {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .st-active { background: var(--green-dim); color: var(--green); }
  .st-frozen { background: var(--accent-dim); color: var(--accent2); }
  .st-suspended { background: var(--yellow-dim); color: var(--yellow); }
  .st-retired, .st-other { background: var(--surface2); color: var(--text-soft); }
  .st-discovered { background: var(--accent-dim); color: var(--accent2); }
  .st-danger { background: var(--destructive-dim); color: var(--destructive); }
  .risk-low { background: var(--green-dim); color: var(--green); }
  .risk-medium { background: var(--yellow-dim); color: var(--yellow); }
  .risk-high, .risk-critical { background: var(--destructive-dim); color: var(--destructive); }
  .risk-critical { font-weight: 700; }
  .risk-unscored { background: var(--surface2); color: var(--text-soft); }
  .ad-mode {
    display: inline-block;
    font-size: 12px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 3px 10px;
    border-radius: 6px;
  }
  .mode-block { background: var(--destructive-dim); color: var(--destructive); }
  .mode-warn { background: var(--yellow-dim); color: var(--yellow); }
  .mode-monitor { background: var(--accent-dim); color: var(--accent2); }
  .mode-other { background: var(--surface2); color: var(--text-soft); }

  /* ── registry toolbar & table ──────────────────────────────────── */
  .ad-toolbar {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .ad-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .ad-chip {
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-dim);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .ad-chip:hover { color: var(--text); background: var(--surface2); }
  .ad-chip-on {
    color: var(--accent2);
    background: var(--accent-dim);
    border-color: transparent;
  }
  .ad-chip-n { opacity: 0.65; font-weight: 700; margin-left: 2px; }
  .ad-search {
    font: inherit;
    font-size: 13px;
    margin-left: auto;
    min-width: 220px;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--text);
  }
  .ad-search:focus { outline: none; border-color: var(--accent); }
  .ad-agent-name { font-weight: 600; }
  .ad-agent-meta { font-size: 12px; color: var(--text-dim); margin-top: 2px; }
  .ad-agent-id { font-size: 11px; }
  .ad-num-cell { font-size: 13px; color: var(--text-dim); white-space: nowrap; }
  .ad-dim-cell { font-size: 13px; color: var(--text-dim); }
  .ad-detail-link { font-size: 13px; font-weight: 600; white-space: nowrap; }
  .ad-table-foot { font-size: 12px; color: var(--text-soft); margin-top: 8px; min-height: 15px; }
  #ad-table tbody tr:hover { background: var(--surface2); }
  .ad-empty-row { text-align: center; color: var(--text-dim); padding: 32px !important; }

  /* ── empty state ───────────────────────────────────────────────── */
  .ad-empty {
    background: var(--surface);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 32px;
    max-width: 720px;
  }
  .ad-empty-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; }
  .ad-empty p { color: var(--text-dim); font-size: 14px; margin: 0 0 14px; }
  .ad-snippet {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    font-size: 12.5px;
    overflow-x: auto;
    margin: 0;
  }

  /* ── controls band ─────────────────────────────────────────────── */
  .ad-controls {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 16px;
  }
  .ad-ctl-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 20px;
  }
  .ad-ctl-title { font-size: 14px; font-weight: 700; }
  .ad-ctl-sub { font-size: 12px; color: var(--text-dim); margin: 3px 0 12px; }
  .ad-ctl-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 0;
    border-top: 1px solid var(--border);
    font-size: 13px;
  }
  .ad-env { color: var(--text-dim); }
  .ad-ctl-n { font-weight: 700; font-size: 15px; }
</style>

<!-- Dashboard switcher -->
<nav class="ad-tabs" aria-label="Dashboards">
  <a class="ad-tab ad-tab-on" href="/dashboard/agents" aria-current="page">Agents</a>
  <a class="ad-tab" href="/dashboard/screening">Screening</a>
  <a class="ad-tab" href="/dashboard/compliance">Compliance</a>
  <a class="ad-tab" href="/dashboard/billing">Billing</a>
  <span class="ad-tabs-right"><a href="/docs">API docs</a></span>
</nav>

<!-- Header + posture strip -->
<div class="ad-section">
  <div class="ad-kicker">Fleet</div>
  <h1 style="margin:0 0 2px;">Agents</h1>
  <p class="ad-section-sub">Registry, enforcement posture, and data governance for your organization.</p>
  ${postureStrip}
</div>

<!-- Agent registry -->
<div class="ad-section" id="registry">
  <h2>Registry</h2>
  <p class="ad-section-sub">Every agent Parse knows about, newest first.</p>
  ${registrySection}
</div>

<!-- Recent screening activity -->
<div class="ad-section" id="activity">
  <h2>Recent screening activity</h2>
  <p class="ad-section-sub">Last 10 screening verdicts for this key.</p>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Verdict</th>
          <th>Risk score</th>
          <th>Agent</th>
          <th>When</th>
        </tr>
      </thead>
      <tbody>
        ${eventRows}
      </tbody>
    </table>
  </div>
</div>

<!-- Controls band -->
<div class="ad-section">
  <h2>Controls</h2>
  <p class="ad-section-sub">Enforcement, governance, and forwarding at a glance.</p>
  ${controlsBand}
</div>

<script>
(function () {
  var table = document.getElementById('ad-table');
  if (!table) return;
  var rows = Array.prototype.slice.call(table.querySelectorAll('tbody tr'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.ad-chip'));
  var search = document.getElementById('ad-search');
  var foot = document.getElementById('ad-table-foot');
  var footBase = foot ? foot.textContent : '';
  var filter = 'all';

  function rowMatches(row) {
    if (filter === 'active' && row.getAttribute('data-status') !== 'active') return false;
    if (filter === 'frozen' && row.getAttribute('data-frozen') !== 'true') return false;
    if (filter === 'attention' && row.getAttribute('data-attention') !== 'true') return false;
    var q = (search && search.value || '').trim().toLowerCase();
    if (q && (row.getAttribute('data-search') || '').indexOf(q) === -1) return false;
    return true;
  }

  function apply() {
    var shown = 0;
    rows.forEach(function (row) {
      var ok = rowMatches(row);
      row.style.display = ok ? '' : 'none';
      if (ok) shown++;
    });
    if (foot) {
      foot.textContent = shown === rows.length
        ? footBase
        : 'Showing ' + shown + ' of ' + rows.length + ' loaded agents.';
    }
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-filter') || 'all';
      chips.forEach(function (c) { c.classList.remove('ad-chip-on'); });
      chip.classList.add('ad-chip-on');
      apply();
    });
  });
  if (search) search.addEventListener('input', apply);
})();
</script>
`;

  return renderPage({
    title: "Agent Dashboard",
    description: "Agent registry, compliance status, enforcement mode, and data governance overview.",
    path: "/dashboard/agents",
    content,
    baseUrl,
  });
}
