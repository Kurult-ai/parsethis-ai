import { config } from "dotenv";
config({ path: "/Users/kublai/parse-for-agents-live/.env" });
import { writeFileSync } from "fs";

const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
if (!master) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

function scrub(o: any): any {
  if (!o || typeof o !== "object") return o;
  const out: any = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) {
    if (/key|token|secret|authorization|password/i.test(k) && typeof v === "string" && (v as string).length > 8) {
      const s = v as string;
      out[k] = s.startsWith("pfa_") ? s.slice(0, 8) + "…" : s.slice(0, 4) + "…len=" + s.length;
    } else if (typeof v === "string" && v.length > 500) out[k] = v.slice(0, 500) + "…";
    else if (v && typeof v === "object") out[k] = scrub(v);
    else out[k] = v;
  }
  return out;
}

async function j(method: string, path: string, body?: any, headers: any = {}, base = BASE) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let b: any = null;
  try {
    b = JSON.parse(text);
  } catch {}
  return {
    status: res.status,
    loc: res.headers.get("location"),
    body: scrub(b),
    head: b ? undefined : text.slice(0, 300),
  };
}

async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body: scrub(body) };
}

function pickParse(body: any) {
  if (!body || typeof body !== "object") return body;
  return {
    suggested_action: body.suggested_action ?? body.action,
    score: body.score ?? body.risk_score ?? body.riskScore,
    mode: body.mode,
    flags_n: Array.isArray(body.flags) ? body.flags.length : undefined,
    layers: body.layers,
    usage: body.usage,
    determinism: body.determinism,
    error: body.error,
    code: body.code,
    detail: body.detail,
    warnings: body.warnings,
    tool_policy: body.tool_policy,
    deep_screening: body.deep_screening || body.quota || body.budgets,
    degraded: body.degraded,
    model: body.model,
  };
}

async function main() {
  const out: any = { at: new Date().toISOString() };
  out.health = await j("GET", "/health");
  out.version = await j("GET", "/version");
  out.status = await j("GET", "/status");
  out.pricing = await j("GET", "/v1/pricing");

  const kg = await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `elon-fresh-${Date.now()}` }),
  });
  const kgBody: any = await kg.json();
  const key = kgBody.key || kgBody.api_key;
  out.keygen = {
    status: kg.status,
    tier: kgBody.tier,
    scopes: kgBody.scopes,
    has_key: !!key,
    note: String(kgBody.note || "").slice(0, 180),
    expires_at: kgBody.expires_at,
    code: kgBody.code,
    detail: String(kgBody.detail || "").slice(0, 220),
    id: kgBody.id || kgBody.key_id,
  };

  if (key) {
    const auth = { Authorization: `Bearer ${key}` };
    const p1 = await j("POST", "/v1/parse", { prompt: "hello world from hourly loop", mode: "pattern" }, auth);
    const p2 = await j("POST", "/v1/parse", { prompt: "hello world from hourly loop full", mode: "full" }, auth);
    const so = await j(
      "POST",
      "/v1/screen-output",
      { output: "The capital of France is Paris.", prompt: "What is the capital of France?" },
      auth,
    );
    out.parse_pattern = { status: p1.status, ...pickParse(p1.body) };
    out.parse_full = { status: p2.status, ...pickParse(p2.body), raw_keys: p2.body ? Object.keys(p2.body).slice(0, 40) : [] };
    out.screen_out = { status: so.status, ...pickParse(so.body), raw_keys: so.body ? Object.keys(so.body).slice(0, 40) : [] };
    out.self = await j("GET", "/v1/keys/self", undefined, auth);
    out.usage = await j("GET", "/v1/billing/usage", undefined, auth);
    out.signup_bearer = await j(
      "POST",
      "/v1/billing/signup-checkout",
      {
        tier: "solo",
        success_url: "https://www.parsethis.ai/dashboard/billing?ok=1",
        cancel_url: "https://www.parsethis.ai/pricing",
      },
      auth,
    );
    out.checkout_bearer = await j(
      "POST",
      "/v1/billing/checkout",
      {
        tier: "solo",
        success_url: "https://www.parsethis.ai/dashboard/billing?ok=1",
        cancel_url: "https://www.parsethis.ai/pricing",
      },
      auth,
    );
  }

  out.signup_noauth = await j("POST", "/v1/billing/signup-checkout", {
    tier: "pro",
    success_url: "https://www.parsethis.ai/dashboard/billing?ok=1",
    cancel_url: "https://www.parsethis.ai/pricing",
  });

  for (const p of [
    "/pricing",
    "/get-started",
    "/demo",
    "/trust",
    "/terms",
    "/privacy",
    "/status",
    "/admin",
    "/dashboard/billing",
    "/llms.txt",
    "/openapi.json",
    "/mcp",
  ]) {
    const r = await fetch(BASE + p, { redirect: "manual" });
    const t = await r.text();
    let bj: any = null;
    try {
      bj = JSON.parse(t);
    } catch {}
    out["page" + p.replace(/\W+/g, "_")] = {
      status: r.status,
      ct: (r.headers.get("content-type") || "").slice(0, 50),
      title: (t.match(/<title[^>]*>([^<]+)/i) || [])[1] || null,
      len: t.length,
      has_503: /503|max requests|rate limit exceeded/i.test(t),
      has_stripe: /stripe|checkout/i.test(t),
      has_sandbox_claim: /sandbox/i.test(t) && /\/hr|per hour|quota/i.test(t),
      json_keys: bj && typeof bj === "object" ? Object.keys(bj).slice(0, 30) : undefined,
      paths_billing:
        bj && bj.paths
          ? Object.keys(bj.paths).filter((x: string) => /billing|checkout|signup|key/i.test(x)).slice(0, 30)
          : undefined,
    };
  }

  // OpenAPI path presence specifically
  try {
    const oa = await (await fetch(BASE + "/openapi.json")).json();
    const paths = Object.keys(oa.paths || {});
    out.openapi_check = {
      signup_checkout: paths.includes("/v1/billing/signup-checkout"),
      checkout: paths.includes("/v1/billing/checkout"),
      keys_generate: paths.includes("/v1/keys/generate"),
      parse: paths.includes("/v1/parse"),
      billing_paths: paths.filter((p: string) => /billing|checkout|portal|usage/i.test(p)),
      n_paths: paths.length,
    };
  } catch (e: any) {
    out.openapi_check = { error: String(e.message || e) };
  }

  // llms.txt claims scan
  try {
    const llms = await (await fetch(BASE + "/llms.txt")).text();
    out.llms_scan = {
      len: llms.length,
      has_stripe: /stripe/i.test(llms),
      has_signup_checkout: /signup-checkout/i.test(llms),
      has_billing_checkout: /billing\/checkout/i.test(llms),
      has_x402: /x402/i.test(llms),
      has_keys_generate: /keys\/generate/i.test(llms),
      sandbox_lines: llms
        .split(/\n/)
        .filter((l) => /sandbox/i.test(l))
        .slice(0, 12),
      pricing_lines: llms
        .split(/\n/)
        .filter((l) => /\$|solo|pro|team|free tier|overage/i.test(l))
        .slice(0, 20),
    };
  } catch (e: any) {
    out.llms_scan = { error: String(e.message || e) };
  }

  // proposals for dedupe
  let props: any[] = [];
  let off = 0;
  for (let i = 0; i < 6; i++) {
    const page = await admin("admin.improvement_proposal.list", { limit: 100, offset: off });
    const rows =
      page.body?.improvement_proposals ||
      page.body?.result?.improvement_proposals ||
      page.body?.data?.improvement_proposals ||
      [];
    if (!Array.isArray(rows) || !rows.length) {
      out.prop_page0_keys = page.body ? Object.keys(page.body) : [];
      out.prop_page0_status = page.status;
      break;
    }
    props.push(...rows);
    off += rows.length;
    if (rows.length < 100) break;
  }
  const byStatus: any = {};
  const byCat: any = {};
  for (const p of props) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1;
    byCat[p.category] = (byCat[p.category] || 0) + 1;
  }
  out.prop_stats = { n: props.length, byStatus, byCat };
  out.prop_open = props
    .filter((p) => p.status === "proposed")
    .map((p) => ({
      id: p.id,
      pri: p.priority,
      cat: p.category,
      title: p.title,
      key: p.idempotency_key,
      src: p.source,
    }));

  out.screen_events = await admin("admin.screening_event.list", { limit: 12 });
  out.tickets = await admin("admin.support.ticket.list", { limit: 12 });
  out.subs = await admin("admin.subscription.list", { limit: 20 });
  out.payments = await admin("admin.payment.list", { limit: 10 });
  out.summary = await admin("admin.summary.read", {});

  // master full parse to see llm layer with privileged key
  const mp = await j("POST", "/v1/parse", { prompt: "master full mode check " + Date.now(), mode: "full" }, {
    Authorization: `Bearer ${master}`,
  });
  out.parse_master_full = { status: mp.status, ...pickParse(mp.body), raw_keys: mp.body ? Object.keys(mp.body).slice(0, 40) : [] };

  writeFileSync("/tmp/elon_fresh_probe.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, at: out.at, keygen: out.keygen?.status, props: out.prop_stats }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
