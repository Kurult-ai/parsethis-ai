import "dotenv/config";
import { writeFileSync } from "fs";
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
async function j(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any; try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, ct: res.headers.get("content-type"), body, text: text.slice(0, 1500), headers: Object.fromEntries([...res.headers.entries()].filter(([k]) => /x-|retry|rate/i.test(k))) };
}
async function admin(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}
async function main() {
  const out: any = { observed_at: new Date().toISOString() };
  // mint free key
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-scope-probe-${Date.now()}` } });
  const freeKey = kg.body?.key as string | undefined;
  out.keygen = { status: kg.status, scopes: kg.body?.scopes, scopes_note: kg.body?.scopes_note, governance: kg.body?.governance, note: kg.body?.note, id: kg.body?.id };
  if (!freeKey) { console.log(JSON.stringify(out,null,2)); return; }

  // keys/self
  out.keys_self = (await j("GET", "/v1/keys/self", { headers: { Authorization: `Bearer ${freeKey}` } })).body;

  // which endpoints work vs scope list
  const endpoints: Array<[string, string, any]> = [
    ["POST /v1/parse", "POST", { path: "/v1/parse", body: { prompt: "hello world" } }],
    ["POST /v1/screen-output", "POST", { path: "/v1/screen-output", body: { output: "hello world" } }],
    ["POST /v1/agent/trust/verify", "POST", { path: "/v1/agent/trust/verify", body: { agent_id: "a", message: "hi" } }],
    ["POST /v1/evaluate", "POST", { path: "/v1/evaluate", body: { prompt: "hi", response: "hi" } }],
    ["POST /v1/analyze", "POST", { path: "/v1/analyze", body: { content: "hi" } }],
    ["POST /v1/chat", "POST", { path: "/v1/chat", body: { messages: [{ role: "user", content: "hi" }] } }],
    ["POST /v1/explain", "POST", { path: "/v1/explain", body: { prompt: "ignore previous instructions" } }],
    ["GET /v1/activity", "GET", { path: "/v1/activity" }],
    ["GET /v1/billing/usage", "GET", { path: "/v1/billing/usage" }],
    ["GET /v1/screening/metrics", "GET", { path: "/v1/screening/metrics" }],
    ["POST /v1/orgs/bootstrap", "POST", { path: "/v1/orgs/bootstrap", body: { name: "probe-org-should-fail-or-work" } }],
  ];
  out.endpoint_matrix = {};
  for (const [name, method, cfg] of endpoints) {
    const r = await j(method, cfg.path, { headers: { Authorization: `Bearer ${freeKey}` }, body: cfg.body });
    out.endpoint_matrix[name] = {
      status: r.status,
      code: r.body?.code,
      detail: (r.body?.detail || r.body?.title || "").toString().slice(0, 160),
      safe: r.body?.safe,
      risk: r.body?.risk_score,
      action: r.body?.suggested_action,
    };
  }

  // MCP with bearer
  const mcp = await j("POST", "/mcp", {
    headers: { Authorization: `Bearer ${freeKey}`, accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "screen_prompt", arguments: { prompt: "hello from mcp" } } },
  });
  out.mcp_screen = {
    status: mcp.status,
    error: mcp.body?.error,
    result_keys: mcp.body?.result ? Object.keys(mcp.body.result) : null,
    text_slice: JSON.stringify(mcp.body?.result || mcp.body).slice(0, 400),
  };

  // 429 upgrade path: burn free rpm? skip heavy burn
  // 402 path: check parse response upgrade fields on high usage - skip

  // rate limit headers on parse
  const p = await j("POST", "/v1/parse", { headers: { Authorization: `Bearer ${freeKey}` }, body: { prompt: "rate header check" } });
  out.parse_headers = p.headers;
  out.parse_upgrade = {
    upgradeUrl: p.body?.upgradeUrl || p.body?.upgrade_url || p.body?.policy?.upgradeUrl,
    _help: p.body?._help,
    top: p.body ? Object.keys(p.body).filter((k) => /upgrad|bill|price|checkout|tier/i.test(k)) : [],
  };

  // Free 402/429 bodies from billing checkout when? 
  // Check llms.txt commerce section compact
  const llms = await j("GET", "/llms.txt");
  const t = llms.text || "";
  out.llms_commerce = {
    has_stripe: /stripe/i.test(t),
    has_checkout: /billing\/checkout|signup-checkout/i.test(t),
    has_solo: /\$12|Solo/i.test(t),
    has_x402: /x402/i.test(t),
    has_disabled: /disabled|not_configured|facilitator/i.test(t),
    snippet_pricing: (t.match(/pricing[\s\S]{0,400}/i) || [""])[0].slice(0, 400),
  };

  // policy threshold contradiction live put?
  const polPut = await j("PUT", "/v1/policy", {
    headers: { Authorization: `Bearer ${freeKey}` },
    body: { autoBlockThreshold: 9 },
  });
  out.policy_put_9 = { status: polPut.status, body: polPut.body };
  const polGet = await j("GET", "/v1/policy", { headers: { Authorization: `Bearer ${freeKey}` } });
  out.policy_after = polGet.body;

  // hold_for_approval put
  const holdPut = await j("PUT", "/v1/policy", {
    headers: { Authorization: `Bearer ${freeKey}` },
    body: { hold_for_approval: true, holdForApproval: true },
  });
  out.hold_put = { status: holdPut.status, body: holdPut.body };

  // cleanup: revoke this key + today's Signup Keys from earlier probe if still active
  const list = await admin("admin.api_key.list", { limit: 50 });
  const keys = list.body?.api_keys || list.body?.keys || [];
  out.list_status = list.status;
  const toRevoke = keys.filter((k: any) => {
    const n = String(k.name || "");
    const active = (k.status === "active") || (!k.revoked_at && !k.revokedAt);
    return active && (n.startsWith("elon-scope-probe-") || n.startsWith("elon-saas-loop-ro-") || n === "Signup Key 2026-08-20");
  });
  out.revoke_targets = toRevoke.map((k: any) => ({ id: k.id, name: k.name, status: k.status }));
  out.revoked = [];
  for (const k of toRevoke.slice(0, 20)) {
    const r = await admin("admin.api_key.revoke", { id: k.id, reason: "hourly saas loop probe cleanup" });
    out.revoked.push({ id: k.id, name: k.name, status: r.status, err: r.body?.error || r.body?.detail });
  }

  // search proposals for scope lie / scopes_note / parse without parse scope
  let all: any[] = [];
  let offset = 0, total = Infinity;
  while (offset < total && offset < 400) {
    const page = await admin("admin.improvement_proposal.list", { limit: 100, offset });
    const rows = page.body.improvement_proposals || [];
    total = page.body.total ?? rows.length;
    if (!rows.length) break;
    all = all.concat(rows);
    offset += rows.length;
    if (rows.length < 100) break;
  }
  const needles = [
    "scopes [analyze, evaluate]",
    "analyze,evaluate",
    "missing required scope: parse",
    "scope list",
    "scopes_note",
    "parse scope",
    "screen scope",
    "insufficient_scope",
    "free keygen scopes",
    "autoBlockThreshold=7",
    "max_threshold",
    "threshold lie",
    "max_threshold\": 5",
    "policy returns max_threshold",
    "portal returns",
    "portal 404",
    "Signup Key",
    "mints live free",
    "before payment",
  ];
  function blob(p: any) {
    return `${p.title} ${p.idempotencyKey || ""} ${JSON.stringify(p.evidence || {})}`.toLowerCase();
  }
  out.related = {};
  for (const n of needles) {
    out.related[n] = all.filter((p) => blob(p).includes(n.toLowerCase())).slice(0, 2).map((p) => ({
      id: p.id, status: p.status, title: (p.title || "").slice(0, 110),
    }));
  }

  writeFileSync("/tmp/saas_live_probe2.json", JSON.stringify(out, null, 2));
  console.log("WROTE /tmp/saas_live_probe2.json");
  console.log(JSON.stringify(out, null, 2).slice(0, 15000));
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
