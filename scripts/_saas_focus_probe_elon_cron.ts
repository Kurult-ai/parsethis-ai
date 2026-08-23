import { config } from "dotenv";
config({ path: "/Users/kublai/parse-for-agents-live/.env" });
import { writeFileSync } from "fs";
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
if (!master) { console.log(JSON.stringify({ error: "no_master" })); process.exit(1); }
async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}
function scrub(v: any, d = 0): any {
  if (d > 8) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 80).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|authorization|password|connectionString/i.test(k) && typeof val === "string") {
        const s = val as string;
        o[k] = s.length > 8 ? `${s.slice(0, 4)}…len=${s.length}` : "[redacted]";
      } else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  if (typeof v === "string" && /^pfa_/.test(v) && v.length > 12) return v.slice(0, 8) + "…";
  return v;
}
async function j(method: string, path: string, body?: any, headers: any = {}, base = BASE) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let b: any = null; try { b = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get("content-type"), location: res.headers.get("location"), body: scrub(b), head: b ? undefined : text.slice(0, 250) };
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  out.health = await j("GET", "/health");
  out.keygen_www = await j("POST", "/v1/keys/generate", { name: `elon-loop-${Date.now()}` });
  out.keygen_local = await j("POST", "/v1/keys/generate", { name: `elon-loop-local-${Date.now()}` }, {}, "http://127.0.0.1:3001");
  out.summary = await admin("admin.summary.read", {});
  out.snapshot = await admin("admin.dashboard.snapshot", {});
  out.proposals = await admin("admin.improvement_proposal.list", { limit: 100, offset: 0 });
  out.subs = await admin("admin.subscription.list", { limit: 50 });
  out.payments = await admin("admin.payment.list", { limit: 20 });
  out.tickets = await admin("admin.support.ticket.list", { limit: 20 });
  out.geo = await admin("admin.geo.metrics.read", {});
  out.screen = await admin("admin.screening_event.list", { limit: 5 });
  out.ents = await admin("admin.entitlement.list", { limit: 20 });
  out.billing_anom = await admin("admin.billing.anomaly.scan", {});
  out.pricing = await j("GET", "/v1/pricing");
  out.mcp = await j("GET", "/mcp");
  const llms = await fetch(BASE + "/llms.txt");
  const llmsText = await llms.text();
  out.llms = {
    status: llms.status,
    len: llmsText.length,
    has_stripe: /stripe/i.test(llmsText),
    has_signup_checkout: /signup-checkout/i.test(llmsText),
    has_billing_checkout: /billing\/checkout/i.test(llmsText),
    has_x402: /x402/i.test(llmsText),
    has_keys_generate: /keys\/generate/i.test(llmsText),
  };
  const oa = await (await fetch(BASE + "/openapi.json")).json();
  const paths = Object.keys(oa.paths || {});
  out.openapi_billing = paths.filter((p: string) => /billing|checkout|key|signup|adopt|orgs/i.test(p));
  out.openapi_has = {
    signup_checkout: paths.includes("/v1/billing/signup-checkout"),
    checkout: paths.includes("/v1/billing/checkout"),
    keys_generate: paths.includes("/v1/keys/generate"),
    adopt: paths.some((p: string) => /adopt/i.test(p)),
  };
  out.parse_master = await j("POST", "/v1/parse", { prompt: "hello world" }, { Authorization: `Bearer ${master}` });
  // compact summary numbers
  const sum = out.summary.body?.result ?? out.summary.body;
  const snap = out.snapshot.body?.result ?? out.snapshot.body;
  const geo = out.geo.body?.result ?? out.geo.body;
  const propsRoot = out.proposals.body?.result ?? out.proposals.body;
  const propItems = propsRoot?.improvement_proposals || propsRoot?.items || propsRoot?.proposals || [];
  out.compact = {
    commit: out.health.body?.deployment?.commit,
    keygen_www: { status: out.keygen_www.status, code: out.keygen_www.body?.code, detail: out.keygen_www.body?.detail },
    keygen_local: { status: out.keygen_local.status, code: out.keygen_local.body?.code, detail: out.keygen_local.body?.detail, has_key: !!(out.keygen_local.body?.key || out.keygen_local.body?.api_key) },
    parse_master: { status: out.parse_master.status, action: out.parse_master.body?.suggested_action, score: out.parse_master.body?.risk_score ?? out.parse_master.body?.score },
    summary: scrub(sum),
    snapshot_summary: scrub(snap?.summary || snap),
    geo_summary: scrub(geo?.summary || geo),
    subs_total: (out.subs.body?.result ?? out.subs.body)?.total,
    payments_total: (out.payments.body?.result ?? out.payments.body)?.total,
    tickets_total: (out.tickets.body?.result ?? out.tickets.body)?.total,
    ents_total: (out.ents.body?.result ?? out.ents.body)?.total,
    screen_total: (out.screen.body?.result ?? out.screen.body)?.total,
    anomalies: scrub((out.billing_anom.body?.result ?? out.billing_anom.body)?.anomalies),
    proposals_status: out.proposals.status,
    proposals_keys: propsRoot && typeof propsRoot === "object" ? Object.keys(propsRoot) : [],
    proposals_count: Array.isArray(propItems) ? propItems.length : null,
    proposals_total: propsRoot?.total,
    openapi_has: out.openapi_has,
    openapi_billing: out.openapi_billing,
    llms: out.llms,
    pricing_enabled: out.pricing.body?.enabled,
    mcp_tools: Array.isArray(out.mcp.body?.tools) ? out.mcp.body.tools.map((t: any) => t.name || t) : out.mcp.body ? Object.keys(out.mcp.body).slice(0, 20) : [],
  };
  // list open proposals if any
  if (Array.isArray(propItems)) {
    const closed = new Set(["rejected", "done", "implemented", "completed", "closed", "shipped"]);
    out.compact.proposals_open = propItems
      .filter((p: any) => !closed.has(String(p.status || "").toLowerCase()))
      .map((p: any) => ({
        id: p.id,
        status: p.status,
        priority: p.priority,
        category: p.category,
        source: p.source,
        title: String(p.title || "").slice(0, 160),
        idempotency_key: p.idempotency_key || p.idempotencyKey,
      }));
    out.compact.proposals_by_status = propItems.reduce((a: any, p: any) => {
      const s = String(p.status || "unknown");
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {});
  }
  writeFileSync("/tmp/saas_focus_probe_elon.json", JSON.stringify(scrub(out), null, 2));
  console.log(JSON.stringify(out.compact, null, 2));
}
main().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
