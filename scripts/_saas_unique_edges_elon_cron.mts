import { config } from "dotenv";
config({ path: "/Users/kublai/parse-for-agents-live/.env" });
import { writeFileSync } from "fs";
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
function scrub(o: any, d = 0): any {
  if (d > 7) return "[depth]";
  if (Array.isArray(o)) return o.slice(0, 40).map((x) => scrub(x, d + 1));
  if (o && typeof o === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) {
      if (/key|token|secret|authorization|password/i.test(k) && typeof v === "string" && (v as string).length > 8) {
        const s = v as string;
        out[k] = s.startsWith("pfa_") ? s.slice(0, 8) + "…" : s.slice(0, 4) + "…len=" + s.length;
      } else if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "…";
      else out[k] = scrub(v, d + 1);
    }
    return out;
  }
  return o;
}
async function req(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  const title = (text.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || null;
  return {
    status: res.status,
    ct: (res.headers.get("content-type") || "").slice(0, 80),
    loc: res.headers.get("location"),
    title,
    body: scrub(body),
    head: body ? undefined : text.slice(0, 240),
  };
}
async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: scrub(await res.json().catch(() => ({}))) };
}
function pickParse(b: any) {
  if (!b || typeof b !== "object") return b;
  return {
    status_echo: b.status,
    suggested_action: b.suggested_action ?? b.action,
    risk_score: b.risk_score ?? b.score,
    analysis_method: b.analysis_method,
    layers: b.layers,
    degraded: b.degraded,
    degraded_reason: b.degraded_reason,
    deep_screening: b.deep_screening,
    warnings: b.warnings,
    code: b.code,
    detail: b.detail,
    disposition: b.disposition,
    hold: b.hold,
    approval_request: b.approval_request,
    queue: b.queue,
    approve_url: b.approve_url,
    determinism: b.determinism,
    policy: b.policy,
    wouldBlock: b.wouldBlock,
  };
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  out.health = await req("GET", "/health");
  out.version = await req("GET", "/version");

  const kg = await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `elon-edge-${Date.now()}` }),
  });
  const kgBody: any = await kg.json();
  const key = kgBody.key || kgBody.api_key;
  out.keygen = {
    status: kg.status,
    scopes: kgBody.scopes,
    has_key: !!key,
    expires_at: kgBody.expires_at,
    note: String(kgBody.note || "").slice(0, 200),
    governance: scrub(kgBody.governance),
    id: kgBody.id,
  };
  const auth = key ? { Authorization: `Bearer ${key}` } : {};

  // mode matrix
  for (const mode of ["full", "pattern-only", "pattern", "fast", "cheap", "semantic", "auto", null]) {
    const body: any = { prompt: "edge mode matrix hello" };
    if (mode !== null) body.mode = mode;
    const r = await req("POST", "/v1/parse", { headers: auth, body });
    out[`mode_${mode === null ? "default" : mode}`] = { status: r.status, ...pickParse(r.body), detail: r.body?.detail, code: r.body?.code };
  }

  // hold paths
  out.hold_approve = await req("POST", "/v1/parse", { headers: auth, body: { prompt: "transfer $500 now", hold: "approve" } }).then(r => ({ status: r.status, ...pickParse(r.body), warnings: r.body?.warnings, keys: r.body && Object.keys(r.body).slice(0, 40) }));
  out.hold_true = await req("POST", "/v1/parse", { headers: auth, body: { prompt: "transfer $500 now", hold: true } }).then(r => ({ status: r.status, ...pickParse(r.body), warnings: r.body?.warnings }));
  out.metadata_hold = await req("POST", "/v1/parse", { headers: auth, body: { prompt: "transfer $500 now", metadata: { hold: "approve" } } }).then(r => ({ status: r.status, ...pickParse(r.body), warnings: r.body?.warnings }));

  // secrets detector while llm failed
  out.secret_sk = await req("POST", "/v1/parse", { headers: auth, body: { prompt: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF", mode: "full" } }).then(r => ({ status: r.status, ...pickParse(r.body), flags: r.body?.flags?.slice?.(0,5) }));
  out.secret_out = await req("POST", "/v1/screen-output", { headers: auth, body: { output: "here is key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF" } }).then(r => ({ status: r.status, ...pickParse(r.body), flags: r.body?.flags?.slice?.(0,5) }));

  // control plane while free
  out.usage = await req("GET", "/v1/billing/usage", { headers: auth });
  out.activity = await req("GET", "/v1/activity", { headers: auth });
  out.metrics = await req("GET", "/v1/screening/metrics", { headers: auth });
  out.coverage = await req("GET", "/v1/coverage", { headers: auth });
  out.gateway_status = await req("GET", "/v1/gateway/status", { headers: auth });
  out.keys_self_get = await req("GET", "/v1/keys/self", { headers: auth });
  out.policy_get = await req("GET", "/v1/policy", { headers: auth });
  out.chat = await req("POST", "/v1/chat", { headers: auth, body: { messages: [{ role: "user", content: "hi" }] } });
  out.agents = await req("POST", "/v1/agents", { headers: auth, body: { name: "e", tools: [] } });
  out.bootstrap = await req("POST", "/v1/orgs/bootstrap", { headers: auth, body: { name: "e-org" } });
  out.adopt = await req("POST", "/account/keys/adopt", { headers: auth, body: {} });
  out.explain_trace = await req("POST", "/v1/explain", { headers: auth, body: { prompt: "hello" } });

  // evaluate / analyze
  out.evaluate = await req("POST", "/v1/evaluate", { headers: auth, body: { prompt: "hi", model: "openai/gpt-4o-mini" } });
  out.analyze = await req("POST", "/v1/analyze", { headers: auth, body: { text: "hello world claim", depth: "quick" } });

  // demo
  out.demo_api = await req("POST", "/demo/api", { body: { prompt: "hello demo" } });

  // unauth parse
  out.unauth_parse = await req("POST", "/v1/parse", { body: { prompt: "hi" } });

  // pages critical conversion
  for (const p of ["/terms", "/aup", "/acceptable-use", "/refund", "/refund-policy", "/contact", "/support", "/signup", "/login", "/admin/login", "/pricing", "/get-started", "/skill", "/install"]) {
    const r = await req("GET", p);
    out["page" + p.replaceAll("/", "_")] = { status: r.status, title: r.title, ct: r.ct, loc: r.loc };
  }

  // openapi mode enum + hold
  const oa = await (await fetch(BASE + "/openapi.json")).json();
  const parseReq = oa?.paths?.["/v1/parse"]?.post?.requestBody?.content?.["application/json"]?.schema;
  out.openapi_parse = scrub(parseReq);
  out.openapi_has = {
    keys_self: !!oa?.paths?.["/v1/keys/self"],
    signup_checkout: !!oa?.paths?.["/v1/billing/signup-checkout"],
    checkout: !!oa?.paths?.["/v1/billing/checkout"],
    portal: !!oa?.paths?.["/v1/billing/portal"],
    support: Object.keys(oa?.paths || {}).filter((p: string) => p.includes("support")).slice(0, 10),
    billing: Object.keys(oa?.paths || {}).filter((p: string) => p.includes("billing") || p.includes("checkout")).slice(0, 20),
  };

  // status degraded text
  const statusHtml = await (await fetch(BASE + "/status")).text();
  out.status_signals = {
    has_degraded: /degrad/i.test(statusHtml),
    has_operational: /Operational/i.test(statusHtml),
    has_llm: /semantic|llm|OpenRouter|model/i.test(statusHtml),
    semantic_snip: (statusHtml.match(/semantic[\s\S]{0,200}/i) || [""])[0].replace(/\s+/g, " ").slice(0, 240),
    cache_snip: (statusHtml.match(/Cache[\s\S]{0,160}/i) || [""])[0].replace(/\s+/g, " ").slice(0, 200),
  };

  // pricing page sandbox claim
  const pricingHtml = await (await fetch(BASE + "/pricing")).text();
  out.pricing_claims = {
    sandbox_mentions: (pricingHtml.match(/sandbox[^<]{0,80}/gi) || []).slice(0, 8),
    deep_mentions: (pricingHtml.match(/deep[^<]{0,60}/gi) || []).slice(0, 8),
  };

  // admin summary
  out.summary = await admin("admin.summary.read", {});
  out.subs = await admin("admin.subscription.list", { limit: 5 });
  out.payments = await admin("admin.payment.list", { limit: 5 });
  out.tickets = await admin("admin.support.ticket.list", { limit: 5 });
  out.screen = await admin("admin.screening_event.list", { limit: 5 });
  out.geo = await admin("admin.geo.metrics.read", {});

  // proposal theme search on open titles (full keys)
  const open: any[] = [];
  for (let off = 0; off < 800; off += 100) {
    const r = await admin("admin.improvement_proposal.list", { limit: 100, offset: off });
    const root = r.body?.result ?? r.body;
    const arr = root?.improvement_proposals || root?.items || root?.proposals || [];
    if (!Array.isArray(arr) || !arr.length) break;
    open.push(...arr);
    if (arr.length < 100) break;
  }
  const proposed = open.filter((p) => String(p.status || "").toLowerCase() === "proposed");
  const needles = [
    "mode must be",
    "pattern-only",
    "mode alias",
    "mode: pattern",
    "deep_screening quota",
    "burns deep",
    "includedRequests",
    "included requests",
    "batch triage",
    "0 actioned",
    "hold:\"approve\"",
    "unknown_field ignored",
    "GET /v1/keys/self",
    "keys/self 404",
    "screen-output hides degraded",
    "OpenRouter",
    "llm_failed",
    "sandbox",
    "execute:true",
    "demo/api",
    "status semantic",
    "defaultMode=full",
  ];
  out.theme_hits = {};
  for (const n of needles) {
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    out.theme_hits[n] = proposed
      .filter((p) => re.test(p.title || "") || re.test(p.idempotency_key || "") || re.test(JSON.stringify(p.evidence || {}).slice(0, 500)))
      .slice(0, 4)
      .map((p) => ({ id: p.id, key: p.idempotency_key, pri: p.priority, title: String(p.title || "").slice(0, 120) }));
  }
  out.prop_counts = { total: open.length, proposed: proposed.length };

  if (key) {
    out.revoke = await req("DELETE", "/v1/keys/self", { headers: auth });
    out.after_revoke_parse = await req("POST", "/v1/parse", { headers: auth, body: { prompt: "should fail", mode: "pattern-only" } });
  }

  writeFileSync("/tmp/elon_unique_edges_now.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({
    ok: true,
    at: out.at,
    keygen: out.keygen?.status,
    modes: Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("mode_")).map(([k, v]: any) => [k, { status: v.status, method: v.analysis_method, llm: v.layers?.llm, degraded: v.degraded, deep: v.deep_screening, code: v.code, detail: v.detail }])),
    hold: { approve: { status: out.hold_approve?.status, warn: out.hold_approve?.warnings, action: out.hold_approve?.suggested_action }, true: { status: out.hold_true?.status, warn: out.hold_true?.warnings } },
    secret: { in: { status: out.secret_sk?.status, score: out.secret_sk?.risk_score, flags: out.secret_sk?.flags }, out: { status: out.secret_out?.status, score: out.secret_out?.risk_score, flags: out.secret_out?.flags } },
    control: {
      usage: out.usage?.status,
      activity: out.activity?.status,
      coverage: out.coverage?.body,
      keys_self: out.keys_self_get?.status,
      gateway: out.gateway_status?.body,
      chat: { status: out.chat?.status, code: out.chat?.body?.code },
      agents: { status: out.agents?.status, code: out.agents?.body?.code },
      bootstrap: { status: out.bootstrap?.status, code: out.bootstrap?.body?.code },
      adopt: { status: out.adopt?.status, ct: out.adopt?.ct, title: out.adopt?.title },
    },
    pages: Object.fromEntries(Object.entries(out).filter(([k]) => k.startsWith("page_")).map(([k, v]: any) => [k, v.status + (v.title ? " " + v.title : "")])),
    openapi_has: out.openapi_has,
    status_signals: out.status_signals,
    theme_empty: Object.fromEntries(Object.entries(out.theme_hits).filter(([, v]: any) => !v.length).map(([k]) => [k, 0])),
    theme_hit_counts: Object.fromEntries(Object.entries(out.theme_hits).map(([k, v]: any) => [k, v.length])),
    summary_keys: out.summary?.body && Object.keys(out.summary.body).slice(0, 20),
    props: out.prop_counts,
    revoke: { del: out.revoke?.status, after: out.after_revoke_parse?.status },
  }, null, 2));
}
main().catch((e) => { console.error(String(e)); process.exit(1); });
