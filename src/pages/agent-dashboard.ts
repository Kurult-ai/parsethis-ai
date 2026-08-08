/**
 * Agent Dashboard — SSR page at /dashboard/agents
 *
 * Visualises the agent registry and compliance status:
 *   1. Agent registry table with color-coded status badges
 *   2. Compliance summary cards (total, active, frozen, coverage %, screenings 24h)
 *   3. Enforcement dial status per environment (monitor/warn/block)
 *   4. Recent screening events (last 10)
 *   5. Data governance summary (active grants, egress rules, volume budgets)
 *   6. SIEM forwarding status (connected/disconnected, last forwarded)
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
  if (frozen) return { class: "badge-blue", label: "❄ Frozen" };
  switch (status) {
    case "active":
      return { class: "badge-green", label: "● Active" };
    case "suspended":
      return { class: "badge-yellow", label: "⏸ Suspended" };
    case "decommissioned":
      return { class: "badge-muted", label: "✖ Decommissioned" };
    case "discovered":
      return { class: "badge-accent", label: "✦ Discovered" };
    default:
      return { class: "badge-default", label: escapeHtml(status) };
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
      return "badge-destructive";
    case "warn":
      return "badge-yellow";
    case "monitor":
      return "badge-blue";
    default:
      return "badge-default";
  }
}

function verdictColor(verdict: string): string {
  switch (verdict) {
    case "safe":
      return "badge-green";
    case "low_risk":
      return "badge-green";
    case "medium_risk":
      return "badge-yellow";
    case "high_risk":
      return "badge-destructive";
    case "critical":
      return "badge-destructive";
    default:
      return "badge-default";
  }
}

// ─── Org resolution (same pattern as routes) ──────────────────────────

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
  const existingOrg = await prisma.organization.findFirst({
    where: { ownerId: apiKeyId },
  });
  if (existingOrg) return existingOrg.id;
  try {
    const org = await prisma.organization.create({
      data: {
        name: "Default Organization",
        slug: `org-${apiKeyId.slice(-12)}`,
        ownerId: apiKeyId,
      },
    });
    return org.id;
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
  let decommissionedAgents = 0;
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
  let coveragePct = 0;
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
      totalAgents = agents.length;

      for (const c of counts) {
        if (c.status === "active") activeAgents = c._count;
        if (c.status === "decommissioned") decommissionedAgents = c._count;
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

  // ─── Coverage attestation (best-effort) ────────────────────────────
  if (orgId) {
    try {
      const { getCoverageReport } = await import(
        "../lib/compliance/coverage-attestation.js"
      );
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const to = new Date();
      const report = await getCoverageReport(orgId, { from, to });
      coveragePct = Math.round((report as { coverage_pct?: number }).coverage_pct ?? 0);
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

  // ─── Data governance summary ───────────────────────────────────────
  if (orgId) {
    try {
      activeGrantsCount = await prisma.agentDataGrant.count({
        where: {
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
    } catch {
      // non-fatal
    }

    try {
      egressRulesCount = await prisma.egressRule.count({
        where: { orgId },
      });
    } catch {
      // non-fatal
    }

    try {
      // VolumeBudget has no orgId — count all that belong to org agents
      const orgAgentIds = agentRows.map((a) => a.id);
      if (orgAgentIds.length > 0) {
        volumeBudgetsCount = await prisma.volumeBudget.count({
          where: { agentId: { in: orgAgentIds } },
        });
      }
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

  // Summary cards
  const coverageColor =
    coveragePct >= 85 ? "var(--green)" : coveragePct >= 50 ? "var(--yellow)" : "var(--destructive)";

  const summaryCards = `
    <div class="ad-summary-grid">
      <div class="ad-stat-card">
        <div class="ad-stat-label">Total Agents</div>
        <div class="ad-stat-value">${totalAgents}</div>
      </div>
      <div class="ad-stat-card ad-stat-green">
        <div class="ad-stat-label">Active</div>
        <div class="ad-stat-value">${activeAgents}</div>
      </div>
      <div class="ad-stat-card ad-stat-blue">
        <div class="ad-stat-label">Frozen</div>
        <div class="ad-stat-value">${frozenAgents}</div>
      </div>
      <div class="ad-stat-card">
        <div class="ad-stat-label">Coverage</div>
        <div class="ad-stat-value" style="color:${coverageColor};">${coveragePct}%</div>
      </div>
      <div class="ad-stat-card">
        <div class="ad-stat-label">Screenings (24h)</div>
        <div class="ad-stat-value">${screenings24h}</div>
      </div>
    </div>`;

  // Enforcement dial section
  const enforcementItems = enforcementModes
    .map(
      (e) => `
      <div class="ad-enforcement-item">
        <span class="badge ${enforcementModeClass(e.mode)}">${escapeHtml(e.mode.toUpperCase())}</span>
        <span class="ad-env-label">${escapeHtml(e.environment)}</span>
      </div>`,
    )
    .join("");

  const enforcementSection = `
    <div class="ad-enforcement-row">
      ${enforcementItems}
    </div>`;

  // Agent table rows
  const agentTableRows =
    agentRows.length === 0
      ? `<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:32px;">No agents registered yet. Use <code>POST /v1/agents</code> to register your first agent.</td></tr>`
      : agentRows
          .map((a) => {
            const sb = statusBadge(a.status, a.frozen);
            const rb = riskBadge(a.riskLevel);
            return `
        <tr>
          <td><code class="ad-agent-id">${escapeHtml(a.id.slice(0, 12))}…</code></td>
          <td><strong>${escapeHtml(a.agentName)}</strong>${a.framework ? `<br><span style="font-size:12px;color:var(--text-dim);">${escapeHtml(a.framework)}</span>` : ""}</td>
          <td><span class="badge ${sb.class}">${sb.label}</span></td>
          <td><span class="badge ${rb.class}">${rb.label}</span></td>
          <td style="font-size:13px;color:var(--text-dim);">${timeAgo(a.lastSeenAt)}</td>
          <td style="font-size:13px;color:var(--text-dim);">${safeStr(a.ownerEmail)}</td>
          <td><a href="/v1/agents/${encodeURIComponent(a.id)}" class="btn btn-outline ad-btn-sm">View</a></td>
        </tr>`;
          })
          .join("\n");

  // Recent screening events
  const eventRows =
    recentEvents.length === 0
      ? `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:32px;">No screening events yet.</td></tr>`
      : recentEvents
          .map((e) => {
            const verdict = String(e.verdict ?? "unknown");
            const riskScore = e.riskScore as number | undefined;
            const blocked = e.blocked as boolean;
            const metadata = e.metadata as Record<string, unknown> | null;
            const agentId = metadata?.agent_id ? String(metadata.agent_id) : "—";
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
          <td><span class="badge ${verdictColor(verdict)}">${escapeHtml(verdict)}</span>${blocked ? ' <span class="badge badge-destructive">BLOCKED</span>' : ""}</td>
          <td><strong style="color:${riskColor};">${riskScore !== undefined ? riskScore.toFixed(1) : "—"}</strong></td>
          <td style="font-size:13px;"><code>${escapeHtml(agentId.slice(0, 16))}</code></td>
          <td style="font-size:13px;color:var(--text-dim);">${formatTimestamp(e.createdAt as Date)}</td>
          <td style="font-size:13px;color:var(--text-dim);">${timeAgo(e.createdAt as Date)}</td>
        </tr>`;
          })
          .join("\n");

  // Data governance summary
  const dgSection = `
    <div class="ad-dg-grid">
      <div class="ad-dg-card">
        <div class="ad-dg-label">Active Data Grants</div>
        <div class="ad-dg-value">${activeGrantsCount}</div>
      </div>
      <div class="ad-dg-card">
        <div class="ad-dg-label">Egress Rules</div>
        <div class="ad-dg-value">${egressRulesCount}</div>
      </div>
      <div class="ad-dg-card">
        <div class="ad-dg-label">Volume Budgets</div>
        <div class="ad-dg-value">${volumeBudgetsCount}</div>
      </div>
    </div>`;

  // SIEM status
  const siemBadgeClass = siemConnected ? "badge-green" : "badge-muted";
  const siemBadgeLabel = siemConnected ? "● Connected" : "○ Disconnected";
  const siemSection = `
    <div class="ad-siem-card">
      <div class="ad-siem-header">
        <span class="badge ${siemBadgeClass}" style="font-size:14px;padding:5px 14px;">${siemBadgeLabel}</span>
        <span class="ad-siem-detail">Last forwarded: <strong>${siemLastForwarded ? formatTimestamp(siemLastForwarded) : "never"}</strong></span>
      </div>
      <div class="ad-siem-stats">
        <div class="ad-siem-stat"><span class="ad-dg-label">Destinations</span><strong>${siemDestinations}</strong></div>
        <div class="ad-siem-stat"><span class="ad-dg-label">Queued</span><strong>${siemEventsQueued}</strong></div>
        <div class="ad-siem-stat"><span class="ad-dg-label">Failed</span><strong style="color:${siemFailedCount > 0 ? "var(--destructive)" : "inherit"};">${siemFailedCount}</strong></div>
      </div>
    </div>`;

  const content = `
<style>
  .ad-summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 16px;
    margin-bottom: 32px;
  }
  .ad-stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    text-align: center;
    box-shadow: 0 1px 0 rgba(24,36,50,0.02);
  }
  .ad-stat-green { border-color: var(--green); border-width: 2px; }
  .ad-stat-blue { border-color: var(--accent); border-width: 2px; }
  .ad-stat-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 8px;
  }
  .ad-stat-value {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .ad-enforcement-row {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
    margin-bottom: 8px;
  }
  .ad-enforcement-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .ad-env-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .badge-blue {
    background: var(--accent-dim);
    color: var(--accent2);
  }
  .badge-muted {
    background: var(--surface2);
    color: var(--text-soft);
    border: 1px solid var(--border);
  }
  .risk-low { background: var(--green-dim); color: var(--green); }
  .risk-medium { background: var(--yellow-dim); color: var(--yellow); }
  .risk-high { background: var(--destructive-dim); color: var(--destructive); }
  .risk-critical { background: var(--destructive-dim); color: var(--destructive); font-weight: 700; }
  .risk-unscored { background: var(--surface2); color: var(--text-soft); border: 1px solid var(--border); }
  .ad-agent-id { font-size: 12px; }
  .ad-btn-sm { padding: 4px 12px; font-size: 12px; }
  .ad-dg-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .ad-dg-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 16px 20px;
    text-align: center;
  }
  .ad-dg-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .ad-dg-value {
    font-size: 24px;
    font-weight: 700;
  }
  .ad-siem-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .ad-siem-header {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }
  .ad-siem-detail {
    font-size: 14px;
    color: var(--text-dim);
  }
  .ad-siem-stats {
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
  }
  .ad-siem-stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ad-siem-stat strong {
    font-size: 20px;
  }
  .ad-nav-back {
    margin-bottom: 16px;
    display: inline-block;
    font-size: 14px;
  }
</style>

<a href="/dashboard/compliance" class="ad-nav-back">← Back to Compliance Dashboard</a>

<!-- Summary Cards -->
<div class="section-chunk">
  <h1 style="margin-top:0;">Agent Dashboard</h1>
  <p class="answer-capsule">Agent registry overview, enforcement posture, and data governance status for your organization.</p>
  ${summaryCards}
</div>

<!-- Enforcement Dial -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Enforcement Mode</h2>
  <p class="answer-capsule" style="font-size:14px;">Current enforcement dial per environment. <code>block</code> = dangerous content is actively blocked, <code>warn</code> = annotated but not blocked, <code>monitor</code> = counterfactual logging only.</p>
  ${enforcementSection}
</div>

<!-- Agent Registry Table -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Agent Registry <span style="font-size:14px;font-weight:400;color:var(--text-dim);">(${totalAgents} agents)</span></h2>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Agent ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>Risk Level</th>
          <th>Last Seen</th>
          <th>Owner</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${agentTableRows}
      </tbody>
    </table>
  </div>
</div>

<!-- Recent Screening Events -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Recent Screening Events</h2>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Verdict</th>
          <th>Risk Score</th>
          <th>Agent</th>
          <th>Timestamp</th>
          <th>Time Ago</th>
        </tr>
      </thead>
      <tbody>
        ${eventRows}
      </tbody>
    </table>
  </div>
</div>

<!-- Data Governance Summary -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Data Governance</h2>
  ${dgSection}
</div>

<!-- SIEM Forwarding Status -->
<div class="section-chunk">
  <h2 style="margin-top:0;">SIEM Forwarding</h2>
  ${siemSection}
</div>
`;

  return renderPage({
    title: "Agent Dashboard",
    description: "Agent registry, compliance status, enforcement mode, and data governance overview.",
    path: "/dashboard/agents",
    content,
    baseUrl,
  });
}
