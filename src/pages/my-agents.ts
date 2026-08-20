/**
 * "My agents" — the page for the person the control is done to.
 *
 * Every other surface in this product is built for whoever bought Parse.
 * Prospect run 8 walked it from the other end: a platform engineer inside a
 * governed org, role `developer`, whose legitimate integration stopped working
 * on a Monday with no memo. He tried eight endpoints and got one 200, and that
 * one omitted the ban that was blocking him. `/dashboard/org` answered a
 * browser with raw problem+json. The docs' only use of the word "exception"
 * was the sentence saying they do not exist.
 *
 * Renaming his tool took ten seconds and worked.
 *
 * This page is the alternative he did not have. Four zones, in the order the
 * questions actually arrive:
 *
 *   1. What is blocked        — the thing that broke, and who decided it
 *   2. My agents              — each one, its tools, and each tool's verdict
 *   3. My exception requests  — what I have asked for and where it got to
 *   4. The rules I work under — the org policy, readable, with contacts
 *
 * House rules, inherited from org-control-panel.ts and equally load-bearing:
 *   - The GET never writes.
 *   - Every read has its own try/catch; a degraded database renders an empty
 *     section, not a 500.
 *   - Every query is scoped to this key's org.
 *   - Absent data renders "—", never a red 0.
 *
 * Deliberately available to every role including `developer`. It shows only
 * what that person is already subject to, and one honest page beats the
 * workaround it replaces.
 */

import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import { issueCsrfToken, CSRF_HEADER } from "../lib/csrf.js";
import { getOrgToolPolicy } from "../lib/tool-policy-store.js";
import { resolveToolList, type ToolRule } from "../lib/tool-policy.js";
import { listToolRefusals, type ToolRefusal } from "../lib/tool-refusals.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function safeStr(val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  return escapeHtml(String(val));
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "never";
  const d = typeof date === "string" ? new Date(date) : date;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ACTION_CLASS: Record<string, string> = {
  block: "ma-act-block",
  require_approval: "ma-act-hold",
  allow: "ma-act-allow",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "ma-st-pending",
  approved: "ma-st-approved",
  denied: "ma-st-denied",
  withdrawn: "ma-st-dim",
  expired: "ma-st-dim",
};

interface AgentRow {
  id: string;
  agentName: string;
  tools: string[];
  frozen: boolean;
  frozenReason: string | null;
  lastSeenAt: Date | null;
}

export async function renderMyAgentsPage(
  baseUrl: string,
  apiKeyId: string,
  apiKeyName: string,
  role: string,
): Promise<string> {
  const csrf = issueCsrfToken(apiKeyId);

  // ── Which org, if any ──
  let orgId: string | null = null;
  let orgName: string | null = null;
  try {
    const key = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true, organization: { select: { name: true } } },
    });
    orgId = key?.orgId ?? null;
    orgName = key?.organization?.name ?? null;
  } catch {
    orgId = null;
  }

  if (!orgId) {
    return renderPage({
      title: "My agents | Parse",
      description: "Your agents and the org rules they run under.",
      path: "/dashboard/my-agents",
      baseUrl,
      content: `
<div class="ma-head"><div><h1>My agents</h1>
<div class="ma-who">signed in as ${escapeHtml(apiKeyName)}</div></div></div>
<section class="ma-zone"><div class="ma-empty">
<p><strong>This key belongs to no organization.</strong></p>
<p>Nothing is governing it, so there is nothing here to show. Every tool your
agents declare is permitted, and no ban applies.</p>
<p class="ma-dim">If your team runs an organization, an admin can claim this key
into it with <code>POST /v1/orgs/:orgId/claim-keys</code>. To start one yourself,
<code>POST /v1/orgs/bootstrap</code>.</p>
</div></section>${STYLE}`,
    });
  }

  // ── Rules, agents, requests, all independently guarded ──
  let rules: ToolRule[] = [];
  let mode: "blocklist" | "allowlist" = "blocklist";
  try {
    const policy = await getOrgToolPolicy(orgId);
    rules = policy.rules;
    mode = policy.mode;
  } catch {
    rules = [];
  }

  let agents: AgentRow[] = [];
  try {
    agents = (await prisma.agentRegistry.findMany({
      where: { orgId, status: { not: "decommissioned" } },
      select: {
        id: true,
        agentName: true,
        tools: true,
        frozen: true,
        frozenReason: true,
        lastSeenAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    })) as AgentRow[];
  } catch {
    agents = [];
  }

  let requests: Array<{
    id: string;
    tool: string;
    status: string;
    reason: string;
    createdAt: Date;
    decisionNote: string | null;
    expiresAt: Date | null;
  }> = [];
  try {
    requests = await prisma.toolExceptionRequest.findMany({
      where: { orgId, requestedByKeyId: apiKeyId },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        tool: true,
        status: true,
        reason: true,
        createdAt: true,
        decisionNote: true,
        expiresAt: true,
      },
    });
  } catch {
    requests = [];
  }

  let admins: Array<{ name: string; email: string | null }> = [];
  try {
    const rows = await prisma.apiKey.findMany({
      where: { orgId, role: "org_admin", revokedAt: null },
      select: { name: true, user: { select: { email: true } } },
      take: 10,
    });
    admins = rows.map((r) => ({
      name: r.name,
      email: r.user?.email && !r.user.email.endsWith(".invalid") ? r.user.email : null,
    }));
  } catch {
    admins = [];
  }

  // Refusals this key actually hit. When a deploy is refused the tool never
  // reaches the registry, so resolving registered agents alone would show an
  // empty panel at the exact moment someone is holding a 422 and wondering
  // what to do. The refusal is the record.
  let refusals: ToolRefusal[] = [];
  try {
    refusals = await listToolRefusals(apiKeyId);
  } catch {
    refusals = [];
  }

  // ── Resolve every declared tool for every agent ──
  const perAgent = agents.map((a) => {
    const resolved = resolveToolList(a.tools ?? [], rules, mode, {
      agentId: a.id,
      apiKeyId,
      role,
    });
    return { agent: a, decisions: resolved.decisions, blocked: resolved.blocked };
  });

  const agentNameById = new Map(agents.map((a) => [a.id, a.agentName]));

  // Registered-and-blocked, plus refused-and-never-registered, deduped by tool.
  const blockedAll: Array<{
    tool: string;
    reason: string;
    agentLabel: string;
    agentId: string | null;
    when: string | null;
  }> = perAgent.flatMap((p) =>
    p.blocked.map((d) => ({
      tool: d.tool,
      reason: d.reason,
      agentLabel: p.agent.agentName,
      agentId: p.agent.id,
      when: null,
    })),
  );
  const seenTools = new Set(blockedAll.map((b) => `${b.tool}::${b.agentId ?? ""}`));
  for (const r of refusals) {
    const label = r.agent_id ? (agentNameById.get(r.agent_id) ?? r.agent_id) : "not yet registered";
    const dedupeKey = `${r.tool}::${r.agent_id ?? ""}`;
    if (seenTools.has(dedupeKey)) continue;
    // Drop a stale refusal if the tool now resolves to allowed — an approved
    // exception should clear the panel rather than leave a ghost grievance.
    const now = resolveToolList([r.tool], rules, mode, {
      agentId: r.agent_id ?? undefined,
      apiKeyId,
      role,
    });
    if (now.blocked.length === 0) continue;
    seenTools.add(dedupeKey);
    blockedAll.push({
      tool: r.tool,
      reason: r.reason,
      agentLabel: label,
      agentId: r.agent_id,
      when: r.at,
    });
  }
  const openRequestTools = new Set(
    requests.filter((r) => r.status === "pending").map((r) => r.tool.toLowerCase()),
  );

  // ═══ Zone 1 · What is blocked ═══
  const blockedZone = blockedAll.length === 0
    ? `<div class="ma-empty"><p><strong>Nothing you run is blocked.</strong></p>
       <p class="ma-dim">Every tool your ${agents.length === 1 ? "agent declares" : "agents declare"} resolves to
       allowed under the current org policy, and nothing has been refused recently.</p></div>`
    : `<table class="ma-t"><thead><tr>
         <th>Tool</th><th>Agent</th><th>Who decided, and why</th><th>What you can do</th>
       </tr></thead><tbody>
       ${blockedAll
         .map((b) => {
           const asked = openRequestTools.has(b.tool.toLowerCase());
           return `<tr>
             <td><span class="ma-nm">${safeStr(b.tool)}</span>
                 <span class="ma-act ma-act-block">block</span></td>
             <td><span class="ma-nm">${safeStr(b.agentLabel)}</span>
                 ${b.when ? `<span class="ma-sub">refused ${escapeHtml(timeAgo(b.when))}</span>` : ""}</td>
             <td class="ma-why">${safeStr(b.reason)}</td>
             <td>${
               asked
                 ? `<span class="ma-st ma-st-pending">request open</span>`
                 : `<button class="ma-btn ma-btn-go" data-tool="${escapeHtml(b.tool)}" data-agent="${escapeHtml(b.agentId ?? "")}">Request an exception</button>`
             }</td>
           </tr>`;
         })
         .join("")}
       </tbody></table>
       <p class="ma-note">An exception is decided by an org admin, scoped to the one agent that
       asked, and expires. It does not change what anyone else can do.</p>`;

  // ═══ Zone 2 · My agents ═══
  const agentsZone = perAgent.length === 0
    ? `<div class="ma-empty">No agents registered under this organization yet.</div>`
    : perAgent
        .map(
          ({ agent, decisions }) => `
      <div class="ma-agent">
        <div class="ma-agent-head">
          <span class="ma-nm">${safeStr(agent.agentName)}</span>
          ${agent.frozen ? `<span class="ma-act ma-act-block">frozen</span>` : ""}
          <span class="ma-sub">last seen ${escapeHtml(timeAgo(agent.lastSeenAt))}</span>
        </div>
        ${
          agent.frozen
            ? `<p class="ma-note ma-warn">This agent is frozen by your organization: ${safeStr(
                agent.frozenReason,
              )} Every screening call it makes is refused until an admin unfreezes it.</p>`
            : ""
        }
        ${
          decisions.length === 0
            ? `<p class="ma-note ma-dim">This agent declares no tools, so org tool rules cannot be
               applied to its requests. That is not the same as being allowed — declare tools with
               <code>metadata.tool_permissions</code> so the rules can answer.</p>`
            : `<div class="ma-tools">${decisions
                .map(
                  (d) =>
                    `<span class="ma-chip ${ACTION_CLASS[d.action] ?? ""}" title="${escapeHtml(d.reason)}">${safeStr(
                      d.tool,
                    )}</span>`,
                )
                .join("")}</div>`
        }
      </div>`,
        )
        .join("");

  // ═══ Zone 3 · My requests ═══
  const requestsZone = requests.length === 0
    ? `<div class="ma-empty ma-dim">You have not asked for any exceptions.</div>`
    : `<table class="ma-t"><thead><tr>
         <th>Tool</th><th>Status</th><th>Asked</th><th>Outcome</th>
       </tr></thead><tbody>
       ${requests
         .map(
           (r) => `<tr>
             <td><span class="ma-nm">${safeStr(r.tool)}</span>
                 <span class="ma-sub">${safeStr(r.reason.slice(0, 90))}</span></td>
             <td><span class="ma-st ${STATUS_CLASS[r.status] ?? "ma-st-dim"}">${safeStr(r.status)}</span></td>
             <td class="ma-mono">${escapeHtml(timeAgo(r.createdAt))}</td>
             <td class="ma-why">${
               r.status === "approved"
                 ? `Granted${r.expiresAt ? ` until ${escapeHtml(r.expiresAt.toISOString().slice(0, 10))}` : ""}.${
                     r.decisionNote ? ` ${safeStr(r.decisionNote)}` : ""
                   }`
                 : r.status === "denied"
                   ? safeStr(r.decisionNote ?? "Denied, with no note.")
                   : r.status === "pending"
                     ? `<span class="ma-dim">Waiting on an org admin.</span>`
                     : "—"
             }</td>
           </tr>`,
         )
         .join("")}
       </tbody></table>`;

  // ═══ Zone 4 · The rules I work under ═══
  const rulesZone = rules.length === 0
    ? `<div class="ma-empty ma-dim">Your organization has no tool rules. Nothing is banned.</div>`
    : `<table class="ma-t"><thead><tr>
         <th>Rule</th><th>Effect</th><th>Reason given</th>
       </tr></thead><tbody>
       ${rules
         .map(
           (r) => `<tr>
             <td><span class="ma-nm">${safeStr(r.pattern)}</span>
                 <span class="ma-sub">${safeStr(r.kind)}${
                   r.scopeType ? ` · scoped to ${safeStr(r.scopeType)}` : " · whole org"
                 }</span></td>
             <td><span class="ma-act ${ACTION_CLASS[r.action] ?? ""}">${safeStr(r.action)}</span></td>
             <td class="ma-why">${safeStr(r.reason ?? "No reason was recorded.")}</td>
           </tr>`,
         )
         .join("")}
       </tbody></table>
       <p class="ma-note">Mode: <code>${escapeHtml(mode)}</code> — ${
         mode === "blocklist"
           ? "every tool is allowed until a rule blocks it."
           : "every tool is blocked until a rule allows it."
       }</p>`;

  const adminsLine = admins.length
    ? admins
        .map((a) => (a.email ? `${escapeHtml(a.name)} (${escapeHtml(a.email)})` : escapeHtml(a.name)))
        .join(", ")
    : "—";

  const content = `
<div class="ma-head">
  <div>
    <h1>My agents</h1>
    <div class="ma-who">${escapeHtml(orgName ?? "your organization")} · signed in as ${escapeHtml(
      apiKeyName,
    )} · role ${escapeHtml(role)}</div>
  </div>
  <div class="ma-count">${agents.length} ${agents.length === 1 ? "agent" : "agents"} · ${
    blockedAll.length
  } blocked ${blockedAll.length === 1 ? "tool" : "tools"}</div>
</div>

<section class="ma-zone ma-zone-primary">
  <div class="ma-zone-head"><h2>What is blocked</h2><span class="ma-meta">AND WHO DECIDED IT</span></div>
  ${blockedZone}
</section>

<section class="ma-zone">
  <div class="ma-zone-head"><h2>My agents</h2><span class="ma-meta">DECLARED TOOLS AND THEIR VERDICTS</span></div>
  ${agentsZone}
</section>

<section class="ma-zone">
  <div class="ma-zone-head"><h2>My exception requests</h2><span class="ma-meta">WHAT I ASKED FOR</span></div>
  ${requestsZone}
</section>

<section class="ma-zone">
  <div class="ma-zone-head"><h2>The rules I work under</h2><span class="ma-meta">ORG TOOL POLICY</span>
    <span class="ma-right">admins: ${adminsLine}</span></div>
  ${rulesZone}
</section>

<dialog id="ma-ask">
  <form method="dialog" id="ma-ask-form">
    <h3>Request an exception</h3>
    <p class="ma-dim" id="ma-ask-what"></p>
    <label>Why is this tool the only way your agent can do its job?
      <textarea id="ma-ask-reason" rows="5" required
        placeholder="The payer portal has no API. Statuses are only available through the web UI, so the agent drives a headless browser to read them."></textarea>
    </label>
    <p class="ma-dim">An org admin reads exactly this. Be specific about what breaks without it.</p>
    <div class="ma-ask-actions">
      <button value="cancel" class="ma-btn">Cancel</button>
      <button value="send" class="ma-btn ma-btn-go" id="ma-ask-send">Send request</button>
    </div>
    <p class="ma-status" id="ma-ask-status"></p>
  </form>
</dialog>

<script>
(function () {
  var dlg = document.getElementById('ma-ask');
  var form = document.getElementById('ma-ask-form');
  var what = document.getElementById('ma-ask-what');
  var reason = document.getElementById('ma-ask-reason');
  var status = document.getElementById('ma-ask-status');
  var current = null;

  document.querySelectorAll('button[data-tool]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      current = { tool: btn.getAttribute('data-tool'), agent: btn.getAttribute('data-agent') };
      what.textContent = 'Asking for "' + current.tool + '" on agent ' + current.agent + '.';
      status.textContent = '';
      reason.value = '';
      dlg.showModal();
    });
  });

  form.addEventListener('submit', function (e) {
    if (!current) return;
    var submitter = e.submitter || document.activeElement;
    if (submitter && submitter.value === 'cancel') return;
    e.preventDefault();
    if (!reason.value.trim()) { status.textContent = 'A reason is required.'; return; }
    status.textContent = 'Sending…';
    fetch('/v1/exception-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json', '${CSRF_HEADER}': '${csrf}' },
      body: JSON.stringify({ tool: current.tool, agent_id: current.agent, reason: reason.value.trim() })
    }).then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
      .then(function (res) {
        if (res.ok) { status.textContent = 'Sent. Reloading…'; setTimeout(function(){ location.reload(); }, 700); }
        else { status.textContent = (res.body && (res.body.detail || res.body.title)) || 'Could not send that.'; }
      })
      .catch(function () { status.textContent = 'Network error. Nothing was sent.'; });
  });
})();
</script>
${STYLE}`;

  return renderPage({
    title: "My agents | Parse",
    description: "Your agents, what your organization blocks, and how to ask for an exception.",
    path: "/dashboard/my-agents",
    baseUrl,
    content,
  });
}

const STYLE = `
<style>
  .ma-head { display:flex; align-items:flex-end; gap:16px; flex-wrap:wrap; padding-bottom:18px; border-bottom:1px solid var(--border); }
  .ma-head h1 { margin:0; font-size:2.1em; }
  .ma-who { font-family:var(--mono); font-size:12px; color:var(--text-soft); letter-spacing:.08em; }
  .ma-count { margin-left:auto; font-family:var(--mono); font-size:12px; color:var(--text-soft); }
  .ma-zone { margin-top:28px; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
  .ma-zone-primary { border-color:var(--border2); position:relative; }
  .ma-zone-primary::before { content:""; position:absolute; top:0; left:0; right:0; height:1px; background:linear-gradient(90deg, rgba(61,123,255,.55), rgba(109,93,252,.55) 45%, rgba(255,180,84,.45) 80%, transparent); }
  .ma-zone-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; padding:16px 20px; border-bottom:1px solid var(--border); }
  .ma-zone-head h2 { margin:0; font-size:1.15em; font-weight:600; letter-spacing:-.01em; }
  .ma-zone-primary .ma-zone-head h2 { font-size:1.45em; }
  .ma-meta { font-family:var(--mono); font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--text-soft); }
  .ma-right { margin-left:auto; font-family:var(--mono); font-size:11.5px; color:var(--text-soft); }
  table.ma-t { width:100%; border-collapse:collapse; font-size:14px; }
  table.ma-t th { font-family:var(--mono); font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:var(--text-soft); text-align:left; font-weight:400; padding:10px 20px; border-bottom:1px solid var(--border); }
  table.ma-t td { padding:12px 20px; border-bottom:1px solid var(--border); vertical-align:top; color:var(--text-dim); }
  table.ma-t tr:last-child td { border-bottom:0; }
  .ma-nm { color:var(--text); font-weight:500; }
  .ma-sub { display:block; font-family:var(--mono); font-size:11.5px; color:var(--text-soft); margin-top:2px; }
  .ma-dim { color:var(--text-soft); }
  .ma-mono { font-family:var(--mono); font-size:12.5px; }
  .ma-why { font-size:13px; line-height:1.55; }
  .ma-empty { padding:28px 20px; color:var(--text-dim); }
  .ma-empty p { margin:0 0 10px; }
  .ma-note { margin:0; padding:12px 20px; font-size:13px; color:var(--text-soft); border-top:1px solid var(--border); }
  .ma-note code { font-family:var(--mono); font-size:12px; color:var(--gold); }
  .ma-warn { color:var(--yellow); border-top:0; }
  .ma-act { font-family:var(--mono); font-size:11.5px; padding:2px 9px; border-radius:999px; display:inline-block; margin-left:8px; }
  .ma-act-block { background:var(--destructive-dim); color:var(--destructive); }
  .ma-act-hold { background:var(--yellow-dim); color:var(--yellow); }
  .ma-act-allow { background:var(--green-dim); color:var(--green); }
  .ma-st { font-family:var(--mono); font-size:11.5px; padding:2px 9px; border-radius:999px; display:inline-block; }
  .ma-st-pending { background:var(--yellow-dim); color:var(--yellow); }
  .ma-st-approved { background:var(--green-dim); color:var(--green); }
  .ma-st-denied { background:var(--destructive-dim); color:var(--destructive); }
  .ma-st-dim { background:var(--surface2); color:var(--text-soft); }
  .ma-agent { padding:16px 20px; border-bottom:1px solid var(--border); }
  .ma-agent:last-child { border-bottom:0; }
  .ma-agent-head { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .ma-tools { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .ma-chip { font-family:var(--mono); font-size:11.5px; padding:3px 10px; border-radius:6px; background:var(--surface2); color:var(--text-dim); cursor:help; }
  .ma-btn { font-family:var(--sans); font-size:12.5px; font-weight:600; padding:7px 15px; border-radius:8px; border:1px solid var(--border2); background:transparent; color:var(--text-dim); cursor:pointer; }
  .ma-btn:hover { color:var(--text); border-color:rgba(255,255,255,.3); }
  .ma-btn-go { background:var(--text); color:#000; border-color:var(--text); }
  dialog#ma-ask { background:var(--surface); color:var(--text); border:1px solid var(--border2); border-radius:12px; padding:24px; max-width:560px; width:92%; }
  dialog#ma-ask::backdrop { background:rgba(0,0,0,.6); }
  dialog#ma-ask h3 { margin:0 0 8px; font-size:1.2em; }
  dialog#ma-ask label { display:flex; flex-direction:column; gap:6px; font-size:13px; color:var(--text-soft); margin-top:14px; }
  dialog#ma-ask textarea { background:var(--surface2); border:1px solid var(--border); color:var(--text); padding:10px; border-radius:6px; font-family:var(--sans); font-size:13.5px; resize:vertical; }
  .ma-ask-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; }
  .ma-status { font-family:var(--mono); font-size:12px; color:var(--text-soft); min-height:16px; margin:10px 0 0; }
  @media (max-width: 760px) {
    table.ma-t th:nth-child(3), table.ma-t td:nth-child(3) { display:none; }
  }
</style>`;
