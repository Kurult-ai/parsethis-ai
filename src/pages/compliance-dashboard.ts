/**
 * Compliance Control Panel — Developer Dashboard
 *
 * Renders at /dashboard/compliance?key=<api_key>
 *
 * This is the dashboard that makes Parse's existing detection/screening/
 * policy/audit infrastructure usable as a product. Developers get:
 *   1. Real-time overview (KPIs, charts)
 *   2. Audit trail (every screening event, filterable)
 *   3. Policy levers (toggle screening, set thresholds, configure approvals)
 *   4. Framework mappings (OWASP, NIST, EU AI Act coverage)
 *   5. Evidence export (tamper-evident SHA-256 export)
 *   6. SIEM forwarding (pipe events to Splunk/Datadog/webhook)
 */

import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import { DEFAULT_POLICY, MAX_THRESHOLD_BY_TIER } from "../routes/policy.js";
import { generateCoverageReport } from "../lib/compliance/framework-crosswalk.js";

export async function renderComplianceDashboardPage(baseUrl: string, apiKeyId: string, apiKeyName: string, tier: string): Promise<string> {
  // Fetch all dashboard data
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  let totalScreenings = 0;
  let screenings24h = 0;
  let blockedTotal = 0;
  let blocked24h = 0;
  let auditCount = 0;
  let policyChanges = 0;
  let riskDist: Array<{ verdict: string; count: number }> = [];
  let catGroups: Array<{ category: string; count: number }> = [];
  let recentScreenings: Array<Record<string, unknown>> = [];
  let recentAudit: Array<Record<string, unknown>> = [];
  let topAgents: Array<{ agent_id: string; screenings: number; avg_risk: number }> = [];
  let policy: Record<string, unknown> | null = null;
  let screenings7d: Array<{ date: string; count: number; blocked: number }> = [];

  try {
    const [
      total, last24h, blocked, blocked24, audits, polChanges,
      verdictGroups, categories, recent, recentAudits,
      agents, dbPolicy,
    ] = await Promise.all([
      prisma.screeningEvent.count({ where: { apiKeyId } }),
      prisma.screeningEvent.count({ where: { apiKeyId, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.count({ where: { apiKeyId, blocked: true } }),
      prisma.screeningEvent.count({ where: { apiKeyId, blocked: true, createdAt: { gte: since24h } } }),
      prisma.auditEvent.count({ where: { apiKeyId } }),
      prisma.auditEvent.count({ where: { apiKeyId, action: { in: ["policy_updated", "policy_deleted"] } } }),
      prisma.screeningEvent.groupBy({ by: ["verdict"], where: { apiKeyId }, _count: true, orderBy: { _count: { verdict: "desc" } } }),
      prisma.$queryRaw<Array<{ category: string; count: bigint }>>`SELECT unnest(categories) as category, count(*) as count FROM screening_events WHERE api_key_id = ${apiKeyId} GROUP BY category ORDER BY count DESC LIMIT 10`,
      prisma.screeningEvent.findMany({ where: { apiKeyId }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, riskScore: true, verdict: true, categories: true, blocked: true, createdAt: true, metadata: true } }),
      prisma.auditEvent.findMany({ where: { apiKeyId }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, action: true, detail: true, createdAt: true } }),
      prisma.$queryRaw<Array<{ agent_id: string; count: bigint; avg_risk: number }>>`SELECT (metadata->>'agent_id')::text as agent_id, count(*) as count, AVG(risk_score)::float as avg_risk FROM screening_events WHERE api_key_id = ${apiKeyId} AND metadata->>'agent_id' IS NOT NULL GROUP BY agent_id ORDER BY avg_risk DESC LIMIT 5`,
      prisma.screeningPolicy.findUnique({ where: { idx_screening_policy_key_env: { apiKeyId, environment: "production" } } }),
    ]);

    totalScreenings = total;
    screenings24h = last24h;
    blockedTotal = blocked;
    blocked24h = blocked24;
    auditCount = audits;
    policyChanges = polChanges;
    riskDist = verdictGroups.map(r => ({ verdict: r.verdict, count: r._count }));
    catGroups = categories.map(r => ({ category: r.category, count: Number(r.count) }));
    recentScreenings = recent as Array<Record<string, unknown>>;
    recentAudit = recentAudits as Array<Record<string, unknown>>;
    topAgents = agents.map(r => ({ agent_id: r.agent_id, screenings: Number(r.count), avg_risk: Number(r.avg_risk?.toFixed(2) ?? 0) }));
    policy = dbPolicy ? {
      screenUserInput: dbPolicy.screenUserInput,
      screenToolOutputs: dbPolicy.screenToolOutputs,
      screenForwardedMessages: dbPolicy.screenForwardedMessages,
      screenAllPrompts: dbPolicy.screenAllPrompts,
      autoBlockThreshold: dbPolicy.autoBlockThreshold,
      executeInSandbox: dbPolicy.executeInSandbox,
      bypassEnabled: dbPolicy.bypassEnabled,
    } : { ...DEFAULT_POLICY };

    // 7-day trend
    const trendData = await prisma.$queryRaw<Array<{ date: string; count: bigint; blocked: bigint }>>`
      SELECT DATE(created_at) as date, count(*) as count, count(*) FILTER (WHERE blocked = true) as blocked
      FROM screening_events WHERE api_key_id = ${apiKeyId} AND created_at >= ${since7d}
      GROUP BY DATE(created_at) ORDER BY date ASC
    `;
    screenings7d = trendData.map(r => ({ date: r.date, count: Number(r.count), blocked: Number(r.blocked) }));
  } catch {
    // Tables might not exist yet
  }

  const coverageReport = generateCoverageReport();
  const maxThreshold = MAX_THRESHOLD_BY_TIER[tier] ?? MAX_THRESHOLD_BY_TIER.free;
  const passRate = totalScreenings > 0 ? ((1 - blockedTotal / totalScreenings) * 100).toFixed(1) : "100";

  const verdictColors: Record<string, string> = {
    safe: "#22c55e", low_risk: "#84cc16", medium_risk: "#eab308",
    high_risk: "#f97316", critical: "#ef4444",
  };

  const content = `
<!-- ═══ Control Panel Header ═══ -->
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
  <div>
    <h1 style="margin:0;font-size:28px;">Control Panel</h1>
    <p class="muted" style="margin:4px 0 0;">Agent security, audit trail, and compliance — for <strong>${apiKeyName}</strong></p>
  </div>
  <div style="display:flex;gap:12px;align-items:center;">
    <span class="badge badge-${tier}" style="text-transform:uppercase;font-size:11px;font-weight:700;padding:4px 12px;border-radius:6px;background:var(--surface2);border:1px solid var(--border);">${tier} tier</span>
  </div>
</div>

<!-- ═══ Tab Navigation ═══ -->
<div class="tab-nav" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:24px;">
  <button class="tab-btn active" data-tab="overview" style="padding:10px 20px;border:none;background:none;color:var(--accent2);border-bottom:2px solid var(--accent);cursor:pointer;font-size:14px;font-weight:600;">Overview</button>
  <button class="tab-btn" data-tab="audit" style="padding:10px 20px;border:none;background:none;color:var(--text-dim);border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;">Audit Trail</button>
  <button class="tab-btn" data-tab="policy" style="padding:10px 20px;border:none;background:none;color:var(--text-dim);border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;">Policy Levers</button>
  <button class="tab-btn" data-tab="frameworks" style="padding:10px 20px;border:none;background:none;color:var(--text-dim);border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;">Frameworks</button>
  <button class="tab-btn" data-tab="export" style="padding:10px 20px;border:none;background:none;color:var(--text-dim);border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;">Evidence Export</button>
  <button class="tab-btn" data-tab="siem" style="padding:10px 20px;border:none;background:none;color:var(--text-dim);border-bottom:2px solid transparent;cursor:pointer;font-size:14px;font-weight:600;">SIEM Forwarding</button>
</div>

<!-- ═══ Tab: Overview ═══ -->
<div class="tab-content" id="tab-overview">
  <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:24px;">
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:#60a5fa;">${totalScreenings.toLocaleString()}</div>
      <div class="muted" style="font-size:12px;">Total Screenings</div>
    </div>
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:var(--accent2);">${screenings24h.toLocaleString()}</div>
      <div class="muted" style="font-size:12px;">Last 24h</div>
    </div>
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:var(--destructive);">${blockedTotal.toLocaleString()}</div>
      <div class="muted" style="font-size:12px;">Blocked (${blocked24h} today)</div>
    </div>
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:var(--green);">${passRate}%</div>
      <div class="muted" style="font-size:12px;">Pass Rate</div>
    </div>
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:var(--text-dim);">${auditCount.toLocaleString()}</div>
      <div class="muted" style="font-size:12px;">Audit Events</div>
    </div>
    <div class="card" style="text-align:center;padding:20px;">
      <div style="font-size:2rem;font-weight:700;color:var(--text-dim);">${policyChanges}</div>
      <div class="muted" style="font-size:12px;">Policy Changes</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
    <div class="card">
      <h3 style="margin:0 0 12px;">7-Day Screening Trend</h3>
      <canvas id="trendChart" height="200"></canvas>
    </div>
    <div class="card">
      <h3 style="margin:0 0 12px;">Risk Distribution</h3>
      <canvas id="riskChart" height="200"></canvas>
    </div>
  </div>

  <div class="card" style="margin-bottom:24px;">
    <h3 style="margin:0 0 12px;">Top Risk Categories</h3>
    ${catGroups.length > 0 ? `
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${catGroups.map(c => `
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="min-width:160px;font-size:13px;">${c.category.replace(/_/g, " ")}</span>
          <div style="flex:1;background:var(--surface2);border-radius:4px;height:24px;overflow:hidden;">
            <div style="width:${Math.min((c.count / catGroups[0].count) * 100, 100)}%;background:var(--accent);height:100%;border-radius:4px;transition:width 0.3s;"></div>
          </div>
          <span style="min-width:40px;text-align:right;font-size:13px;color:var(--text-dim);">${c.count}</span>
        </div>
      `).join("")}
    </div>` : '<p class="muted">No data yet.</p>'}
  </div>

  ${topAgents.length > 0 ? `
  <div class="card">
    <h3 style="margin:0 0 12px;">Agents by Risk</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr><th style="text-align:left;padding:8px;border-bottom:1px solid var(--border);">Agent ID</th><th style="text-align:right;padding:8px;border-bottom:1px solid var(--border);">Screenings</th><th style="text-align:right;padding:8px;border-bottom:1px solid var(--border);">Avg Risk</th></tr></thead>
      <tbody>
        ${topAgents.map(a => `<tr><td style="padding:8px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:12px;">${a.agent_id}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">${a.screenings}</td><td style="padding:8px;text-align:right;border-bottom:1px solid var(--border);color:${a.avg_risk >= 7 ? "var(--destructive)" : a.avg_risk >= 5 ? "#eab308" : "var(--green)"};font-weight:600;">${a.avg_risk}</td></tr>`).join("")}
      </tbody>
    </table>
  </div>` : ""}
</div>

<!-- ═══ Tab: Audit Trail ═══ -->
<div class="tab-content" id="tab-audit" style="display:none;">
  <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
    <select id="audit-verdict-filter" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:6px;">
      <option value="">All verdicts</option>
      <option value="safe">Safe</option>
      <option value="low_risk">Low Risk</option>
      <option value="medium_risk">Medium Risk</option>
      <option value="high_risk">High Risk</option>
      <option value="critical">Critical</option>
    </select>
    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-dim);"><input type="checkbox" id="audit-blocked-only" style="accent-color:var(--accent);"> Blocked only</label>
    <button id="audit-refresh" class="btn btn-sm" style="background:var(--accent);color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;">Refresh</button>
  </div>
  <div id="audit-events-list" class="card" style="padding:0;overflow:hidden;">
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr><th style="text-align:left;padding:10px;border-bottom:1px solid var(--border);">Time</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--border);">Verdict</th><th style="text-align:center;padding:10px;border-bottom:1px solid var(--border);">Score</th><th style="text-align:left;padding:10px;border-bottom:1px solid var(--border);">Categories</th><th style="text-align:center;padding:10px;border-bottom:1px solid var(--border);">Blocked</th></tr></thead>
      <tbody id="audit-tbody">
        ${recentScreenings.map(s => {
          const verdict = String(s.verdict ?? "");
          const color = verdictColors[verdict] ?? "#888";
          const score = Number(s.riskScore ?? 0);
          const scoreColor = score >= 7 ? "var(--destructive)" : score >= 5 ? "#eab308" : "var(--green)";
          const cats = (s.categories as string[] ?? []).map(c => `<span style="display:inline-block;background:var(--surface2);padding:2px 8px;border-radius:4px;font-size:11px;margin:2px;">${c.replace(/_/g," ")}</span>`).join("");
          return `<tr>
            <td style="padding:10px;border-bottom:1px solid var(--border);font-family:var(--mono);font-size:11px;color:var(--text-dim);">${new Date(s.createdAt as string).toLocaleString()}</td>
            <td style="padding:10px;border-bottom:1px solid var(--border);"><span style="color:${color};font-weight:600;">${verdict.replace(/_/g," ")}</span></td>
            <td style="padding:10px;text-align:center;border-bottom:1px solid var(--border);color:${scoreColor};font-weight:700;font-size:15px;">${score.toFixed(1)}</td>
            <td style="padding:10px;border-bottom:1px solid var(--border);">${cats}</td>
            <td style="padding:10px;text-align:center;border-bottom:1px solid var(--border);">${s.blocked ? '⛔' : '✅'}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>
  <p class="muted" style="font-size:12px;margin-top:12px;">Showing latest 15 events. Use the API for full pagination: <code>GET /v1/compliance/audit-trail?limit=500</code></p>
</div>

<!-- ═══ Tab: Policy Levers ═══ -->
<div class="tab-content" id="tab-policy" style="display:none;">
  <div class="card" style="margin-bottom:16px;">
    <h3 style="margin:0 0 16px;">Screening Controls</h3>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${policyLever("Screen user input", "screenUserInput", Boolean(policy?.screenUserInput), "Screen every prompt the agent receives")}
      ${policyLever("Screen tool outputs", "screenToolOutputs", Boolean(policy?.screenToolOutputs), "Screen every output from agent tools (MCP, APIs)")}
      ${policyLever("Screen forwarded messages", "screenForwardedMessages", Boolean(policy?.screenForwardedMessages), "Screen messages forwarded from other agents or users")}
      ${policyLever("Screen all prompts (paranoid mode)", "screenAllPrompts", Boolean(policy?.screenAllPrompts), "Force-screen even when bypass is active")}
      ${policyLever("Execute in sandbox", "executeInSandbox", Boolean(policy?.executeInSandbox), "Run agent actions in isolated sandbox before allowing")}
    </div>
  </div>

  <div class="card" style="margin-bottom:16px;">
    <h3 style="margin:0 0 16px;">Auto-Block Threshold</h3>
    <p class="muted" style="margin:0 0 16px;font-size:13px;">Risk score (0-10) at which prompts are automatically blocked. Max for ${tier} tier: <strong>${maxThreshold}</strong></p>
    <div style="display:flex;align-items:center;gap:16px;">
      <input type="range" id="threshold-slider" min="1" max="${maxThreshold}" value="${policy?.autoBlockThreshold ?? 7}" style="flex:1;accent-color:var(--accent);" />
      <span id="threshold-value" style="font-size:24px;font-weight:700;color:var(--accent2);min-width:40px;text-align:center;">${policy?.autoBlockThreshold ?? 7}</span>
    </div>
    <div style="margin-top:12px;display:flex;justify-content:space-between;font-size:11px;color:var(--text-dim);">
      <span>1 = Block everything</span><span>5 = Moderate</span><span>${maxThreshold} = Only critical threats</span>
    </div>
  </div>

  <div class="card">
    <h3 style="margin:0 0 16px;">Approval Workflow</h3>
    <p class="muted" style="margin:0 0 12px;font-size:13px;">When approval is required, actions are held until a human approves them via HMAC-signed tokens.</p>
    <div style="display:flex;flex-direction:column;gap:12px;">
      ${policyLever("Require approval for personal data", "approvalRequiredForPersonalData", true, "Agent actions touching PII need human approval")}
      ${policyLever("Require approval for location data", "approvalRequiredForLocation", true, "Agent actions accessing location need human approval")}
      ${policyLever("Require approval for future plans", "approvalRequiredForFuturePlans", true, "Agent actions about future actions need human approval")}
      <div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--surface2);border-radius:8px;">
        <span style="font-size:13px;">Default action when approval times out:</span>
        <select id="approval-default-action" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:4px 8px;border-radius:4px;">
          <option value="deny" selected>Deny (safe)</option>
          <option value="allow">Allow (risky)</option>
        </select>
      </div>
    </div>
  </div>
</div>

<!-- ═══ Tab: Frameworks ═══ -->
<div class="tab-content" id="tab-frameworks" style="display:none;">
  <div class="card-grid" style="margin-bottom:24px;">
    ${coverageReport.map(f => `
      <div class="card" style="text-align:center;padding:20px;">
        <div style="font-size:2rem;font-weight:700;color:${f.coverage_percentage >= 80 ? "var(--green)" : f.coverage_percentage >= 50 ? "#eab308" : "var(--destructive)"};">${f.coverage_percentage}%</div>
        <div class="muted" style="font-size:11px;margin-top:4px;">${f.covered}/${f.total_controls} controls</div>
        <div style="font-size:12px;margin-top:8px;font-weight:600;">${f.framework.split("(")[0].trim()}</div>
      </div>
    `).join("")}
  </div>

  <div class="card">
    <h3 style="margin:0 0 12px;">Compliance Coverage Details</h3>
    <div style="display:flex;flex-direction:column;gap:16px;">
      ${coverageReport.map(f => `
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <strong style="font-size:14px;">${f.framework}</strong>
            <span style="font-size:12px;color:var(--text-dim);">${f.covered} covered · ${f.partially_covered} partial · ${f.not_covered} gaps</span>
          </div>
          <div style="background:var(--surface2);border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${f.coverage_percentage}%;background:${f.coverage_percentage >= 80 ? "var(--green)" : f.coverage_percentage >= 50 ? "#eab308" : "var(--destructive)"};height:100%;border-radius:4px;"></div>
          </div>
        </div>
      `).join("")}
    </div>
    <p class="muted" style="font-size:12px;margin-top:16px;">Full crosswalk: <code>GET /v1/compliance/framework-map</code></p>
  </div>
</div>

<!-- ═══ Tab: Evidence Export ═══ -->
<div class="tab-content" id="tab-export" style="display:none;">
  <div class="card">
    <h3 style="margin:0 0 16px;">Generate Evidence Export</h3>
    <p class="muted" style="margin:0 0 20px;font-size:13px;">Produces a tamper-evident (SHA-256 signed) evidence pack containing all screening events, audit logs, and framework mappings for the specified date range.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
      <div>
        <label style="display:block;font-size:13px;margin-bottom:6px;">From date</label>
        <input type="date" id="export-from" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;" />
      </div>
      <div>
        <label style="display:block;font-size:13px;margin-bottom:6px;">To date</label>
        <input type="date" id="export-to" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;" />
      </div>
    </div>
    <div style="margin-bottom:20px;">
      <label style="display:block;font-size:13px;margin-bottom:6px;">Framework filter</label>
      <select id="export-framework" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;">
        <option value="all">All frameworks</option>
        <option value="owasp-llm">OWASP Top 10 for LLMs</option>
        <option value="nist-ai-rmf">NIST AI RMF</option>
        <option value="eu-ai-act">EU AI Act</option>
        <option value="iso-42001">ISO/IEC 42001</option>
        <option value="soc2">SOC 2</option>
      </select>
    </div>
    <button id="generate-export" class="btn" style="background:var(--accent);color:white;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;">Generate Export</button>
    <div id="export-result" style="margin-top:20px;"></div>
  </div>
</div>

<!-- ═══ Tab: SIEM Forwarding ═══ -->
<div class="tab-content" id="tab-siem" style="display:none;">
  <div class="card" style="margin-bottom:16px;">
    <h3 style="margin:0 0 16px;">SIEM Integration</h3>
    <p class="muted" style="margin:0 0 20px;font-size:13px;">Forward screening events and audit logs to your security operations platform.</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
      <div>
        <label style="display:block;font-size:13px;margin-bottom:6px;">Platform</label>
        <select id="siem-platform" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;">
          <option value="splunk">Splunk (HEC)</option>
          <option value="datadog">Datadog Logs</option>
          <option value="elastic">Elastic / ELK</option>
          <option value="sentinel">Azure Sentinel</option>
          <option value="generic_webhook">Generic Webhook</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:13px;margin-bottom:6px;">Format</label>
        <select id="siem-format" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;">
          <option value="json">JSON</option>
          <option value="cef">CEF (Common Event Format)</option>
          <option value="leef">LEEF (IBM QRadar)</option>
        </select>
      </div>
    </div>
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:13px;margin-bottom:6px;">Endpoint URL</label>
      <input type="text" id="siem-endpoint" placeholder="https://splunk.example.com:8088/services/collector" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;font-family:var(--mono);font-size:13px;" />
    </div>
    <div style="margin-bottom:16px;">
      <label style="display:block;font-size:13px;margin-bottom:6px;">Auth token (HEC token / API key)</label>
      <input type="password" id="siem-auth" placeholder="••••••••••••" style="width:100%;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:10px;border-radius:6px;" />
    </div>
    <div style="display:flex;gap:12px;">
      <button id="test-siem" class="btn btn-sm" style="background:var(--surface2);color:var(--text);border:1px solid var(--border);padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;">Test Connection</button>
      <button id="save-siem" class="btn" style="background:var(--accent);color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">Save Configuration</button>
    </div>
    <div id="siem-test-result" style="margin-top:16px;"></div>
  </div>
  <div id="siem-configs-list" class="card">
    <h3 style="margin:0 0 12px;">Active SIEM Configurations</h3>
    <p class="muted" style="font-size:13px;">No configurations yet.</p>
  </div>
</div>

<script>
// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.style.color = 'var(--text-dim)';
      b.style.borderBottom = '2px solid transparent';
    });
    btn.classList.add('active');
    btn.style.color = 'var(--accent2)';
    btn.style.borderBottom = '2px solid var(--accent)';
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById('tab-' + btn.dataset.tab).style.display = 'block';
  });
});

// Threshold slider
const slider = document.getElementById('threshold-slider');
if (slider) {
  slider.addEventListener('input', (e) => {
    document.getElementById('threshold-value').textContent = e.target.value;
  });
}

// Charts
if (typeof Chart !== 'undefined') {
  const trendData = ${JSON.stringify(screenings7d)};
  const riskData = ${JSON.stringify(riskDist)};
  const verdictColors = ${JSON.stringify(verdictColors)};

  if (document.getElementById('trendChart') && trendData.length > 0) {
    new Chart(document.getElementById('trendChart'), {
      type: 'line',
      data: {
        labels: trendData.map(d => d.date),
        datasets: [
          { label: 'Screened', data: trendData.map(d => d.count), borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.1)', fill: true, tension: 0.3 },
          { label: 'Blocked', data: trendData.map(d => d.blocked), borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', fill: true, tension: 0.3 },
        ],
      },
      options: { responsive: true, plugins: { legend: { labels: { color: '#8888a0', font: { size: 11 } } } }, scales: { x: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { display: false } }, y: { ticks: { color: '#8888a0', font: { size: 10 } }, grid: { color: '#2a2a3e' } } } },
    });
  }
  if (document.getElementById('riskChart') && riskData.length > 0) {
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: { labels: riskData.map(d => d.verdict.replace(/_/g, " ")), datasets: [{ data: riskData.map(d => d.count), backgroundColor: riskData.map(d => verdictColors[d.verdict] || '#888') }] },
      options: { responsive: true, plugins: { legend: { position: 'right', labels: { color: '#8888a0', font: { size: 11 } } } } },
    });
  }
}
</script>
`;

  return renderPage({
    title: "Compliance Console — Parse",
    description: "Agent security control panel: audit trail, policy levers, compliance frameworks, evidence export, and SIEM forwarding.",
    path: "/dashboard/compliance",
    content,
    baseUrl,
    headExtra: '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js" crossorigin="anonymous"></script>',
  });
}

function policyLever(label: string, key: string, value: boolean, description: string): string {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--surface2);border-radius:8px;">
      <div>
        <div style="font-size:14px;font-weight:600;">${label}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:2px;">${description}</div>
      </div>
      <label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;">
        <input type="checkbox" class="policy-toggle" data-key="${key}" ${value ? "checked" : ""} style="opacity:0;width:0;height:0;" />
        <span class="toggle-slider" style="position:absolute;inset:0;background:${value ? "var(--accent)" : "var(--border)"};border-radius:24px;transition:0.3s;">
          <span style="position:absolute;height:18px;width:18px;left:${value ? "24px" : "3px"};bottom:3px;background:white;border-radius:50%;transition:0.3s;"></span>
        </span>
      </label>
    </div>`;
}
