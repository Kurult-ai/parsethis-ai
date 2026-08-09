/**
 * Agent Dashboard — "Event Horizon" console at /dashboard/agents (2026-08-09).
 *
 * Self-contained dark document with the sidebar shell: workspace switcher,
 * Miller-chunked nav, Fleet topbar with live UTC clock, posture strip,
 * data-driven Fleet Orbit map (radius = risk, color = state, labels = real
 * agents, beams = check-in flashes), registry table, verdicts feed, and the
 * enforcement strip. Rendering stays strictly read-only: every DB read is
 * individually guarded and absent data renders as an empty state, never 500.
 */

import { prisma } from "../db.js";
import { isRedisAvailable } from "../redis.js";
import { getLogoMarkSvg } from "../lib/logo.js";

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
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface AgentRow {
  id: string;
  agentName: string;
  status: string;
  frozen: boolean;
  riskLevel: string;
  lastSeenAt: Date | null;
  framework: string | null;
  ownerEmail: string | null;
}

function needsAttention(a: { status: string; frozen: boolean; riskLevel: string }): boolean {
  return a.frozen || a.status === "suspended" || a.riskLevel === "high" || a.riskLevel === "critical";
}

function statusChip(a: AgentRow): { cls: string; label: string } {
  if (a.frozen) return { cls: "st-f", label: "frozen" };
  switch (a.status) {
    case "active": return { cls: "st-a", label: "active" };
    case "suspended": return { cls: "st-s", label: "suspended" };
    case "decommissioned": return { cls: "st-x", label: "retired" };
    case "discovered": return { cls: "st-f", label: "discovered" };
    default: return { cls: "st-x", label: escapeHtml(a.status) };
  }
}

function riskCls(risk: string): string {
  if (risk === "high" || risk === "critical") return "rk-h";
  if (risk === "medium") return "rk-m";
  if (risk === "low") return "rk-l";
  return "rk-u";
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
  workspaceName = "Parse",
): Promise<string> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let totalAgents = 0;
  let activeAgents = 0;
  let frozenAgents = 0;
  let agentRows: AgentRow[] = [];
  let screenings24h = 0;
  let coveragePct: number | null = null;
  let enforcementModes: Array<{ environment: string; mode: string }> = [];
  let recentEvents: Array<Record<string, unknown>> = [];
  let siemConnected = false;
  let siemEventsQueued = 0;

  const orgId = await resolveOrgId(apiKeyId);

  if (orgId) {
    try {
      const [agents, counts] = await Promise.all([
        prisma.agentRegistry.findMany({
          where: { orgId },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: {
            id: true, agentName: true, status: true, frozen: true,
            riskLevel: true, lastSeenAt: true, framework: true, ownerEmail: true, createdAt: true,
          },
        }),
        prisma.agentRegistry.groupBy({ by: ["status"], where: { orgId }, _count: true }),
      ]);
      agentRows = agents.map((a) => ({
        id: a.id, agentName: a.agentName, status: a.status, frozen: a.frozen,
        riskLevel: a.riskLevel, lastSeenAt: a.lastSeenAt, framework: a.framework, ownerEmail: a.ownerEmail,
      }));
      totalAgents = counts.reduce((sum, c) => sum + (c._count ?? 0), 0);
      if (totalAgents < agents.length) totalAgents = agents.length;
      for (const c of counts) if (c.status === "active") activeAgents = c._count;
      frozenAgents = await prisma.agentRegistry.count({ where: { orgId, frozen: true } });
    } catch {
      // table might not exist
    }
  }

  try {
    screenings24h = await prisma.screeningEvent.count({
      where: { apiKeyId, createdAt: { gte: since24h } },
    });
  } catch { /* non-fatal */ }

  try {
    recentEvents = (await prisma.screeningEvent.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, riskScore: true, verdict: true, blocked: true, createdAt: true, metadata: true },
    })) as unknown as Array<Record<string, unknown>>;
  } catch { /* non-fatal */ }

  if (orgId) {
    try {
      const { getCoverageReport } = await import("../lib/compliance/coverage-attestation.js");
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const report = await getCoverageReport(orgId, { from, to: new Date() });
      const pct = (report as { coverage_pct?: number }).coverage_pct;
      coveragePct = typeof pct === "number" ? Math.round(pct) : null;
    } catch { /* coverage may be unavailable */ }
  }

  try {
    const policies = await prisma.screeningPolicy.findMany({
      where: { apiKeyId },
      select: { environment: true, enforcementMode: true },
    });
    enforcementModes = policies.map((p) => ({ environment: p.environment, mode: p.enforcementMode }));
    if (enforcementModes.length === 0) enforcementModes = [{ environment: "production", mode: "block" }];
  } catch {
    enforcementModes = [{ environment: "production", mode: "block" }];
  }

  try {
    if (isRedisAvailable()) {
      const { getSIEMStatus } = await import("../lib/compliance/siem-worker.js");
      const status = await getSIEMStatus();
      siemEventsQueued = status.events_queued;
      siemConnected = status.destinations.length > 0 && status.destinations.some((d) => d.reachable);
    }
  } catch { /* non-fatal */ }

  // ─── Derived view data ─────────────────────────────────────────────

  const attentionCount = agentRows.filter(needsAttention).length;
  const agentNameById = new Map(agentRows.map((a) => [a.id, a.agentName]));
  const prodMode = enforcementModes.find((e) => e.environment === "production")?.mode
    ?? enforcementModes[0]?.mode ?? "block";

  // Orbit satellites: 6 most recently seen agents. radius = risk band.
  const orbiters = [...agentRows]
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
    .slice(0, 6)
    .map((a, i) => {
      const high = a.riskLevel === "high" || a.riskLevel === "critical";
      const radius = a.frozen || high ? 112 : a.riskLevel === "medium" ? 79 : 46;
      const color = a.frozen ? "#8ab8ff" : high ? "var(--red)" : a.riskLevel === "medium" ? "var(--amber)" : "var(--green)";
      const glow = a.frozen ? "rgba(138,184,255,.7)" : high ? "rgba(255,93,93,.8)" : a.riskLevel === "medium" ? "rgba(255,180,84,.7)" : "rgba(61,220,132,.7)";
      const dur = [26, 34, 44, 52, 80, 66][i] ?? 40 + i * 9;
      const delay = [0, -12, -6, -20, -30, -8][i] ?? -(i * 7);
      const reverse = i % 3 === 2;
      return { a, radius, color, glow, dur, delay, reverse, ping: high && !a.frozen };
    });

  const orbitCss = orbiters
    .map((o, i) => {
      const n = i + 1;
      return `
  .osat.s${n} { animation-duration: ${o.dur}s; animation-delay: ${o.delay}s;${o.reverse ? " animation-direction: reverse;" : ""} }
  .osat.s${n} .arm { transform: translateY(-${o.radius}px); }
  .osat.s${n} b { background: ${o.color}; box-shadow: 0 0 8px ${o.glow}; }
  .osat.s${n} .lbl { animation-duration: ${o.dur}s; animation-delay: ${o.delay}s;${o.reverse ? "" : " animation-direction: normal;"}${o.reverse ? " animation-direction: reverse;" : ""} ${o.ping ? "color: var(--red);" : ""} }
  .osat.s${n} .beam { top: -${o.radius}px; height: ${o.radius}px; background: linear-gradient(0deg, transparent, ${o.glow}); animation: beamFlash ${9 + i * 2}s linear infinite ${1 + i * 2.3}s; }
  ${o.ping ? `.osat.s${n} b::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 1px solid rgba(255,93,93,.6); animation: oping 2.8s ease-out infinite; }` : ""}`;
    })
    .join("\n");

  const orbitHtml = orbiters
    .map((o, i) => {
      const n = i + 1;
      const name = o.a.agentName.length > 20 ? o.a.agentName.slice(0, 19) + "…" : o.a.agentName;
      return `<div class="osat s${n}"><i class="beam"></i><span class="arm"><b></b><span class="lbl">${escapeHtml(name)}</span></span></div>`;
    })
    .join("\n          ");

  const registryRows = agentRows.slice(0, 8)
    .map((a) => {
      const st = statusChip(a);
      return `<tr>
        <td><span class="nm">${escapeHtml(a.agentName)}</span><span class="fw">${a.framework ? escapeHtml(a.framework) : "—"}</span></td>
        <td><span class="st ${st.cls}">${st.label}</span></td>
        <td class="risk ${riskCls(a.riskLevel)}">${escapeHtml(a.riskLevel)}</td>
        <td class="when" title="${a.lastSeenAt ? escapeHtml(formatTimestamp(a.lastSeenAt)) : "never"}">${timeAgo(a.lastSeenAt)}</td>
        <td class="owner">${safeStr(a.ownerEmail)}</td>
      </tr>`;
    })
    .join("\n");
  const registryBody = registryRows ||
    `<tr><td colspan="5" class="empty">No agents registered yet — <code>POST /v1/agents</code> registers your first.</td></tr>`;

  const verdictRows = recentEvents.slice(0, 6)
    .map((e) => {
      const verdict = String(e.verdict ?? "unknown");
      const blocked = Boolean(e.blocked);
      const riskScore = e.riskScore as number | undefined;
      const meta = e.metadata as Record<string, unknown> | null;
      const agentId = meta?.agent_id ? String(meta.agent_id) : null;
      const agentLabel = agentId ? (agentNameById.get(agentId) ?? `${agentId.slice(0, 12)}…`) : "—";
      const dot = blocked || verdict === "critical" || verdict === "high_risk" ? "vd-b" : verdict === "medium_risk" ? "vd-w" : "vd-a";
      const scoreCls = riskScore === undefined ? "rk-u" : riskScore >= 7 ? "rk-h" : riskScore >= 4 ? "rk-m" : "rk-l";
      return `<div class="vrow">
        <span class="vdot ${dot}"></span>
        <span class="vwhat">${escapeHtml(verdict.replace(/_/g, " "))}${blocked ? " · blocked" : ""}<small>${escapeHtml(agentLabel)} · ${timeAgo(e.createdAt as Date)}</small></span>
        <span class="vscore ${scoreCls}">${riskScore !== undefined ? riskScore.toFixed(1) : "—"}</span>
      </div>`;
    })
    .join("\n");
  const verdictsBody = verdictRows ||
    `<div class="vrow"><span class="vwhat empty">No screening events yet. Calls to <code>POST /v1/parse</code> appear here.</span></div>`;

  const envChips = enforcementModes
    .map((e) => `<span class="kv">${escapeHtml(e.environment)} <b class="md-${escapeHtml(e.mode)}">${escapeHtml(e.mode)}</b></span>`)
    .join("");

  const coverageCell = coveragePct === null
    ? `<div class="k">COVERAGE</div><div class="v" style="color:var(--dim)">—</div><div class="s">no data yet</div>`
    : `<div class="covring" style="background: conic-gradient(var(--green) ${(coveragePct * 3.6).toFixed(0)}deg, rgba(255,255,255,.08) 0);"></div><div class="k">COVERAGE</div><div class="v g">${coveragePct}%</div><div class="s">7-day attestation</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fleet — Parse Console</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#000000">
  <link rel="icon" href="/favicon.svg?v=eclipse" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Michroma&display=swap" rel="stylesheet">
  <style>
  :root {
    --bg: #000; --side: #070708; --panel: #0b0b0d; --panel2: #101013;
    --line: rgba(255,255,255,0.08); --line2: rgba(255,255,255,0.14);
    --white: #f2f2f2; --gray: #b0b4b6; --dim: #83878a;
    --blue: #3d7bff; --violet: #6d5dfc; --cyan: #06b6d4;
    --green: #3ddc84; --red: #ff5d5d; --amber: #ffb454; --gold: #ffd9a0;
    --serif: 'Instrument Serif', serif; --sans: 'Schibsted Grotesk', sans-serif; --mono: 'IBM Plex Mono', monospace;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { overflow-x: clip; max-width: 100%; }
  body { background: var(--bg); color: var(--gray); font-family: var(--sans); font-size: 15px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration: none; }
  .mono { font-family: var(--mono); }
  body::before {
    content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background:
      radial-gradient(min(680px, 90vw) 380px at 78% -6%, rgba(61,123,255,.11), transparent 70%),
      radial-gradient(min(520px, 80vw) 320px at 12% 110%, rgba(109,93,252,.08), transparent 70%),
      radial-gradient(min(420px, 70vw) 280px at 96% 68%, rgba(255,180,84,.05), transparent 70%);
    animation: glowBreathe 30s ease-in-out infinite alternate;
  }
  @keyframes glowBreathe { from { opacity: 1; } to { opacity: .75; } }
  .app { display: grid; grid-template-columns: 236px 1fr; min-height: 100vh; position: relative; z-index: 1; }

  /* sidebar */
  .side { background: var(--side); border-right: 1px solid var(--line); display: flex; flex-direction: column; padding: 14px 12px; position: sticky; top: 0; height: 100vh; }
  .ws { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 9px; }
  .ws svg { width: 26px; height: 26px; flex: none; }
  .ws-name { font-family: 'Michroma', sans-serif; font-size: 12px; font-weight: 400; letter-spacing: .05em; color: var(--white); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  nav.groups { flex: 1; margin-top: 18px; display: flex; flex-direction: column; gap: 22px; overflow-y: auto; }
  .grp-label { font-family: var(--mono); font-size: 11px; letter-spacing: .22em; color: var(--dim); padding: 0 10px; margin-bottom: 6px; }
  .item { position: relative; display: flex; align-items: center; gap: 11px; padding: 8.5px 10px; border-radius: 9px; color: var(--gray); font-size: 14.5px; font-weight: 500; transition: background .12s, color .12s; }
  .item:hover { color: var(--white); background: rgba(255,255,255,.035); }
  .item.on { color: var(--white); background: rgba(255,255,255,.07); }
  .item.on::before { content: ""; position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 1px; background: linear-gradient(180deg, var(--blue), var(--violet), var(--amber)); }
  .item .ic { width: 17px; text-align: center; font-family: var(--mono); font-size: 12.5px; color: var(--dim); flex: none; font-style: normal; }
  .item.on .ic { color: var(--gold); }
  .acct { border-top: 1px solid var(--line); padding: 12px 10px 0; font-family: var(--mono); font-size: 12px; color: var(--dim); display: flex; justify-content: space-between; }
  .acct a:hover { color: var(--white); }

  /* main */
  .main { padding: 0 36px 48px; min-width: 0; }
  .topbar { display: flex; align-items: center; gap: 16px; padding: 22px 0 20px; border-bottom: 1px solid var(--line); margin-bottom: 28px; flex-wrap: wrap; }
  h1 { font-family: var(--serif); font-weight: 400; font-size: 32px; color: var(--white); letter-spacing: .01em; }
  .env { font-family: var(--mono); font-size: 11.5px; letter-spacing: .14em; color: var(--green); border: 1px solid rgba(61,220,132,.3); border-radius: 999px; padding: 4px 12px; text-transform: uppercase; }
  .utc { font-family: var(--mono); font-size: 12px; color: var(--dim); letter-spacing: .1em; font-variant-numeric: tabular-nums; }
  .top-actions { margin-left: auto; display: flex; gap: 10px; }
  .btn { display: inline-flex; align-items: center; gap: 8px; font-family: var(--sans); font-size: 13.5px; font-weight: 600; padding: 8px 18px; border-radius: 9px; border: 1px solid var(--line2); color: var(--gray); transition: all .15s; cursor: pointer; background: none; }
  .btn:hover { color: var(--white); border-color: rgba(255,255,255,.3); }
  .btn-white { background: var(--white); border-color: var(--white); color: #000; }
  .btn-white:hover { background: #fff; color: #000; box-shadow: 0 0 0 1.5px rgba(255,217,160,.55), 0 6px 24px rgba(255,180,84,.16); }

  /* aurora hairline */
  .aura-line { position: relative; }
  .aura-line::before { content: ""; position: absolute; top: -1px; left: 0; right: 0; height: 1px; z-index: 2; background: linear-gradient(90deg, rgba(61,123,255,.55), rgba(109,93,252,.55) 45%, rgba(255,180,84,.45) 80%, transparent); background-size: 200% 100%; animation: auraLine 12s ease-in-out infinite alternate; }
  @keyframes auraLine { to { background-position: 100% 0; } }

  /* posture strip */
  .strip { display: grid; grid-template-columns: repeat(5, 1fr); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); }
  .cell { padding: 18px 20px; border-left: 1px solid var(--line); opacity: 0; transform: translateY(7px); animation: settle .5s ease-out forwards; }
  .cell:first-child { border-left: 0; }
  .cell:nth-child(1) { animation-delay: .05s; } .cell:nth-child(2) { animation-delay: .13s; }
  .cell:nth-child(3) { animation-delay: .21s; } .cell:nth-child(4) { animation-delay: .29s; } .cell:nth-child(5) { animation-delay: .37s; }
  @keyframes settle { to { opacity: 1; transform: none; } }
  .cell .k { font-family: var(--mono); font-size: 10.5px; letter-spacing: .18em; color: var(--dim); margin-bottom: 8px; }
  .cell .v { font-family: var(--mono); font-size: 26px; font-weight: 500; letter-spacing: -0.02em; color: var(--white); line-height: 1; font-variant-numeric: tabular-nums; }
  .cell .v.g { color: var(--green); } .cell .v.r { color: var(--red); } .cell .v.a { color: var(--amber); } .cell .v.b { color: #8ab8ff; }
  .cell .s { font-size: 12.5px; color: var(--dim); margin-top: 7px; }
  .covring { float: right; width: 34px; height: 34px; border-radius: 50%; -webkit-mask: radial-gradient(farthest-side, transparent 62%, #000 64%); mask: radial-gradient(farthest-side, transparent 62%, #000 64%); }

  /* work grid */
  .work { display: grid; grid-template-columns: 1.9fr 1.1fr; gap: 20px; margin-top: 22px; align-items: start; }
  .col { display: grid; gap: 20px; align-content: start; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
  .card-head { display: flex; align-items: baseline; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
  .card-head h2 { font-size: 15.5px; font-weight: 600; color: var(--white); letter-spacing: -.01em; }
  .card-head .meta { font-family: var(--mono); font-size: 11px; color: var(--dim); letter-spacing: .1em; }
  .card-head .right { margin-left: auto; font-family: var(--mono); font-size: 12px; color: var(--dim); }

  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { font-family: var(--mono); font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--dim); text-align: left; padding: 10px 20px; border-bottom: 1px solid var(--line); font-weight: 400; }
  td { padding: 12px 20px; border-bottom: 1px solid var(--line); color: var(--gray); }
  tr:last-child td { border-bottom: 0; }
  tbody tr { transition: background .12s, transform .15s; }
  tbody tr:hover { background: rgba(255,255,255,.025); transform: translateX(3px); }
  td .nm { color: var(--white); font-weight: 500; display: block; }
  td .fw { display: block; font-family: var(--mono); font-size: 11.5px; color: var(--dim); margin-top: 1px; }
  td.owner { font-size: 12.5px; color: var(--dim); }
  td.empty { text-align: center; color: var(--dim); padding: 30px 20px; }
  td.empty code { font-family: var(--mono); color: var(--gold); font-size: 12px; }
  .st { font-family: var(--mono); font-size: 11.5px; padding: 3px 10px; border-radius: 999px; }
  .st-a { background: rgba(61,220,132,.1); color: var(--green); }
  .st-f { background: rgba(138,184,255,.12); color: #8ab8ff; }
  .st-s { background: rgba(255,180,84,.12); color: var(--amber); }
  .st-x { background: rgba(255,255,255,.06); color: var(--dim); }
  .risk { font-family: var(--mono); font-size: 13px; }
  .rk-l { color: var(--green); } .rk-m { color: var(--amber); } .rk-h { color: var(--red); } .rk-u { color: var(--dim); }
  td.when { font-family: var(--mono); font-size: 12.5px; color: var(--dim); }

  /* orbit map */
  .omap { position: relative; height: 268px; overflow: hidden; }
  .oring { position: absolute; left: 50%; top: 50%; border: 1px solid rgba(255,255,255,.07); border-radius: 50%; }
  .oring.r1 { width: 92px; height: 92px; margin: -46px; }
  .oring.r2 { width: 158px; height: 158px; margin: -79px; }
  .oring.r3 { width: 224px; height: 224px; margin: -112px; border-style: dashed; border-color: rgba(255,255,255,.09); }
  .ocore { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px; border-radius: 50%; background: #000; border: 1px solid rgba(255,217,160,.35); box-shadow: 0 0 0 1.5px rgba(255,217,160,.45), 0 0 22px rgba(255,180,84,.22); }
  .oscale { position: absolute; font-family: var(--mono); font-size: 8.5px; letter-spacing: .08em; color: rgba(255,255,255,.28); left: 50%; transform: translateX(-50%); }
  .oscale.sc1 { top: calc(50% - 58px); } .oscale.sc2 { top: calc(50% - 91px); } .oscale.sc3 { top: calc(50% - 124px); }
  .osat { position: absolute; left: 50%; top: 50%; width: 0; height: 0; animation: orb linear infinite; }
  .osat .arm { position: absolute; left: 0; top: 0; }
  .osat b { position: absolute; left: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; display: block; }
  .osat .lbl { position: absolute; left: 8px; top: -7px; font-family: var(--mono); font-size: 8.5px; letter-spacing: .04em; color: var(--dim); background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.06); padding: 1px 5px; border-radius: 3px; white-space: nowrap; animation: orbCounter linear infinite; }
  .osat .beam { position: absolute; left: -0.5px; width: 1px; display: block; opacity: 0; transform-origin: bottom; }
  ${orbitCss}
  @keyframes orb { to { transform: rotate(360deg); } }
  @keyframes orbCounter { to { transform: rotate(-360deg); } }
  @keyframes beamFlash { 0% { opacity: 0; } 1.5% { opacity: .9; } 6% { opacity: 0; } 100% { opacity: 0; } }
  @keyframes oping { 0% { transform: scale(.4); opacity: .9; } 80% { transform: scale(2.4); opacity: 0; } 100% { opacity: 0; } }
  .omap-legend { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; font-family: var(--mono); font-size: 10px; letter-spacing: .1em; color: var(--dim); }
  .omap-empty { position: absolute; inset: 0; display: grid; place-items: center; font-family: var(--mono); font-size: 11.5px; color: var(--dim); }

  /* verdicts */
  .card-live { position: relative; overflow: hidden; }
  .card-live::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 42%, rgba(255,217,160,.05) 50%, transparent 58%); transform: translateX(-130%); animation: scan 9s ease-in-out infinite 2s; }
  @keyframes scan { 0% { transform: translateX(-130%); } 42% { transform: translateX(130%); } 100% { transform: translateX(130%); } }
  .vrow { display: flex; gap: 12px; align-items: baseline; padding: 12px 20px; border-bottom: 1px solid var(--line); }
  .vrow:last-child { border-bottom: 0; }
  .vdot { position: relative; width: 7px; height: 7px; border-radius: 50%; flex: none; align-self: center; }
  .vdot::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 1px solid currentColor; opacity: 0; animation: vping 4.2s ease-out infinite; }
  .vrow:nth-child(2) .vdot::after { animation-delay: .8s; } .vrow:nth-child(3) .vdot::after { animation-delay: 1.7s; }
  .vrow:nth-child(4) .vdot::after { animation-delay: 2.5s; } .vrow:nth-child(5) .vdot::after { animation-delay: 3.2s; } .vrow:nth-child(6) .vdot::after { animation-delay: 1.2s; }
  @keyframes vping { 0% { transform: scale(.5); opacity: .8; } 55% { transform: scale(2.1); opacity: 0; } 100% { opacity: 0; } }
  .vd-b { background: var(--red); color: var(--red); box-shadow: 0 0 8px rgba(255,93,93,.5); }
  .vd-a { background: var(--green); color: var(--green); opacity: .8; }
  .vd-w { background: var(--amber); color: var(--amber); }
  .vwhat { flex: 1; font-size: 13.5px; color: var(--gray); }
  .vwhat.empty { text-align: center; color: var(--dim); padding: 14px 0; }
  .vwhat code { font-family: var(--mono); color: var(--gold); font-size: 11.5px; }
  .vwhat small { display: block; font-family: var(--mono); font-size: 11px; color: var(--dim); margin-top: 1px; }
  .vscore { font-family: var(--mono); font-size: 13px; }
  .card-foot { padding: 13px 20px; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 11.5px; color: var(--dim); display: flex; justify-content: space-between; }
  .card-foot b { color: var(--gray); font-weight: 500; }

  /* enforcement strip */
  .controls { display: flex; gap: 14px; align-items: center; margin-top: 20px; padding: 14px 20px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); flex-wrap: wrap; }
  .controls .lbl { font-size: 13.5px; font-weight: 600; color: var(--white); }
  .dial { display: flex; border: 1px solid var(--line2); border-radius: 999px; overflow: hidden; font-family: var(--mono); font-size: 11px; }
  .dial span { padding: 7px 15px; color: var(--dim); text-transform: uppercase; }
  .dial span.on { background: var(--white); color: #000; font-weight: 500; animation: dialBreath 5s ease-in-out infinite; }
  @keyframes dialBreath { 0%,100% { box-shadow: none; } 50% { box-shadow: 0 0 14px rgba(255,255,255,.35); } }
  .controls .sep { width: 1px; height: 22px; background: var(--line); }
  .controls .kv { font-family: var(--mono); font-size: 12px; color: var(--dim); }
  .controls .kv b { font-weight: 500; }
  .md-block { color: var(--red); } .md-warn { color: var(--amber); } .md-monitor { color: #8ab8ff; }
  .kv .ok { color: var(--green); }

  @media (max-width: 1080px) {
    .app { grid-template-columns: 1fr; }
    .side { position: static; height: auto; }
    nav.groups { flex-direction: row; flex-wrap: wrap; gap: 18px 26px; }
    nav.groups > div { min-width: 150px; }
    .work { grid-template-columns: 1fr; }
    .strip { grid-template-columns: repeat(2, 1fr); }
    .cell { border-top: 1px solid var(--line); }
  }
  @media (max-width: 720px) {
    .main { padding: 0 18px 40px; }
    .topbar { row-gap: 12px; }
    .top-actions { margin-left: 0; width: 100%; }
    .top-actions .btn { flex: 1; justify-content: center; }
    .strip { grid-template-columns: 1fr; }
    .controls { align-items: flex-start; flex-direction: column; }
    .controls .sep { display: none; }
    th:nth-child(4), td.when, th:nth-child(5), td.owner { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .osat, .osat .lbl, .osat .beam, .osat b::after, .vdot::after, .cell, .covring, .dial span.on, .card-live::after, .aura-line::before, body::before { animation: none; }
    .cell { opacity: 1; transform: none; }
    .vdot::after { display: none; }
  }
  </style>
</head>
<body>
<div class="app">

  <aside class="side">
    <div class="ws">${getLogoMarkSvg()}<span class="ws-name">${escapeHtml(workspaceName)}</span></div>
    <nav class="groups">
      <div>
        <a class="item on" href="/dashboard/agents"><i class="ic">◈</i>Overview</a>
      </div>
      <div>
        <div class="grp-label">FLEET</div>
        <a class="item" href="/dashboard/agents"><i class="ic">⬡</i>Agents</a>
        <a class="item" href="/dashboard/screening"><i class="ic">≋</i>Screening</a>
      </div>
      <div>
        <div class="grp-label">EVIDENCE</div>
        <a class="item" href="/dashboard/compliance"><i class="ic">▤</i>Compliance</a>
      </div>
      <div>
        <div class="grp-label">PLATFORM</div>
        <a class="item" href="/dashboard/billing"><i class="ic">$</i>Billing</a>
        <a class="item" href="/docs"><i class="ic">✎</i>Docs</a>
      </div>
    </nav>
    <div class="acct"><span>console</span><a href="/" title="Back to site">parsethis.ai →</a></div>
  </aside>

  <main class="main">
    <div class="topbar aura-line">
      <h1>Fleet</h1>
      <span class="env">${escapeHtml(prodMode)} · production</span>
      <span class="utc" id="utc">UTC --:--:--</span>
      <div class="top-actions">
        <a class="btn" href="/docs/quickstart">Install snippet</a>
        <a class="btn btn-white" href="/docs">Register agent</a>
      </div>
    </div>

    <div class="strip aura-line">
      <div class="cell"><div class="k">AGENTS</div><div class="v">${totalAgents}</div><div class="s">${activeAgents} active · ${frozenAgents} frozen</div></div>
      <div class="cell"><div class="k">NEEDS ATTENTION</div><div class="v ${attentionCount > 0 ? "a" : ""}">${attentionCount}</div><div class="s">${attentionCount === 0 ? "all clear" : "frozen · suspended · high risk"}</div></div>
      <div class="cell"><div class="k">SCREENINGS · 24H</div><div class="v">${screenings24h.toLocaleString("en-US")}</div><div class="s">across this key</div></div>
      <div class="cell">${coverageCell}</div>
      <div class="cell"><div class="k">PROD DIAL</div><div class="v b">${escapeHtml(prodMode.charAt(0).toUpperCase() + prodMode.slice(1))}</div><div class="s">SIEM ${siemConnected ? "connected" : "not connected"}</div></div>
    </div>

    <div class="work">
      <div class="card">
        <div class="card-head">
          <h2>Registry</h2><span class="meta">NEWEST FIRST</span>
          <span class="right">${agentRows.length < totalAgents ? `showing ${Math.min(8, agentRows.length)} of ${totalAgents}` : `${totalAgents} agents`}</span>
        </div>
        <table>
          <thead><tr><th>Agent</th><th>Status</th><th>Risk</th><th>Last seen</th><th>Owner</th></tr></thead>
          <tbody>
            ${registryBody}
          </tbody>
        </table>
      </div>

      <div class="col">
        <div class="card aura-line">
          <div class="card-head"><h2>Fleet orbit</h2><span class="meta">RISK = RADIUS</span><span class="right">${orbiters.length ? "live" : ""}</span></div>
          <div class="omap">
            <div class="oring r1"></div><div class="oring r2"></div><div class="oring r3"></div>
            ${orbiters.length ? `<span class="oscale sc1">RISK LOW</span><span class="oscale sc2">MED</span><span class="oscale sc3">HIGH · FROZEN</span>
          ${orbitHtml}` : `<div class="omap-empty">no agents in orbit yet</div>`}
            <div class="ocore"></div>
            ${orbiters.length ? `<div class="omap-legend">radius = risk · beam = check-in · ping = high risk</div>` : ""}
          </div>
        </div>

        <div class="card card-live">
          <div class="card-head"><h2>Verdicts</h2><span class="meta">RECENT</span><span class="right">receipts ✓</span></div>
          ${verdictsBody}
          <div class="card-foot"><span><b>${screenings24h.toLocaleString("en-US")}</b> screenings · 24h</span><span>SIEM ${siemConnected ? "✓" : "–"}</span></div>
        </div>
      </div>
    </div>

    <div class="controls">
      <span class="lbl">Enforcement</span>
      <div class="dial"><span${prodMode === "monitor" ? ' class="on"' : ""}>monitor</span><span${prodMode === "warn" ? ' class="on"' : ""}>warn</span><span${prodMode === "block" ? ' class="on"' : ""}>block</span></div>
      <span class="sep"></span>
      ${envChips}
      <span class="sep"></span>
      <span class="kv">SIEM <b class="${siemConnected ? "ok" : ""}">${siemConnected ? "connected" : "off"}</b></span>
      <span class="kv">queue <b>${siemEventsQueued}</b></span>
      ${coveragePct !== null ? `<span class="kv">coverage <b class="ok">${coveragePct}%</b></span>` : ""}
    </div>
  </main>
</div>

<script>
(function () {
  var el = document.getElementById('utc');
  function tick() {
    var d = new Date();
    el.textContent = 'UTC ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ':' + String(d.getUTCSeconds()).padStart(2, '0');
  }
  tick(); setInterval(tick, 1000);
})();
</script>
</body>
</html>`;
}
