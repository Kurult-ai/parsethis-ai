import { config } from "dotenv";
import { writeFileSync } from "fs";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
async function j(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get("content-type"), loc: res.headers.get("location"), body, text: body ? undefined : text.slice(0, 500) };
}
function scrub(v: any, d = 0): any {
  if (d > 8) return "[d]";
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|password|authorization/i.test(k) && typeof val === "string") {
        const s = val as string;
        o[k] = s.startsWith("http") ? s.split("?")[0] + (s.includes("?") ? "?…" : "") : s.length > 8 ? s.slice(0, 4) + "…len=" + s.length : "[r]";
      } else if (typeof val === "string" && /^pfa_/.test(val)) o[k] = val.slice(0, 8) + "…";
      else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  return v;
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  out.health = (await j("GET", "/health")).body?.deployment;

  // fresh free key — never delete
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `fresh-${Date.now()}` } });
  const freeKey = kg.body?.key as string;
  const freeId = kg.body?.id;
  const auth = { Authorization: `Bearer ${freeKey}` };
  out.free = scrub({ status: kg.status, id: freeId, scopes: kg.body?.scopes, expires_at: kg.body?.expires_at, tier: kg.body?.tier, note: kg.body?.note });

  // core product matrix
  const calls: Array<[string, string, any?]> = [
    ["POST", "/v1/parse", { prompt: "hello from probe" }],
    ["POST", "/v1/screen-output", { output: "hello", prompt: "hi" }],
    ["POST", "/v1/analyze", { content: "hello world article about markets" }],
    ["POST", "/v1/evaluate", { prompt: "hi", model: "openai/gpt-4o-mini" }],
    ["POST", "/v1/evaluate", { prompt: "hi", models: ["meta-llama/llama-3.3-70b-instruct:free"] }],
    ["POST", "/v1/evaluate", { prompt: "hi", model: "meta-llama/llama-3.3-70b-instruct:free" }],
    ["POST", "/v1/chat", { message: "hi" }],
    ["GET", "/v1/billing/usage", undefined],
    ["GET", "/v1/policy", undefined],
    ["GET", "/v1/coverage", undefined],
    ["GET", "/v1/gateway/status", undefined],
    ["GET", "/v1/keys/self", undefined],
    ["POST", "/v1/billing/signup-checkout", { tier: "solo" }],
    ["POST", "/v1/billing/checkout", { tier: "solo" }],
    ["POST", "/v1/agents", { name: "a", tools: [] }],
    ["POST", "/v1/orgs/bootstrap", { name: "o" }],
  ];
  out.matrix = [];
  for (const [m, p, b] of calls) {
    const r = await j(m, p, { headers: auth, body: b });
    out.matrix.push(scrub({
      m, p,
      req: b,
      status: r.status,
      code: r.body?.code,
      detail: typeof r.body?.detail === "string" ? r.body.detail.slice(0, 180) : r.body?.error || r.body?.title,
      suggested_action: r.body?.suggested_action,
      score: r.body?.risk_score ?? r.body?.score,
      help: r.body?._help,
      keys: r.body && typeof r.body === "object" ? Object.keys(r.body).slice(0, 20) : [],
      included: r.body?.includedRequests ?? r.body?.included_requests,
      current: r.body?.currentPeriodUsage,
      has_checkout: !!(r.body?.checkout_url || r.body?.url),
      new_key: !!(r.body?.key && r.body.key !== freeKey),
      expires_at: r.body?.expires_at,
      org_id: r.body?.org_id,
      coverage_pct: r.body?.coverage_pct,
      tier: r.body?.tier,
      upgradeUrl: r.body?.upgradeUrl || r.body?.upgrade_url,
    }));
  }

  // pricing page: is Generate Free Key a GET link to POST endpoint?
  const pricing = await fetch(BASE + "/pricing").then((r) => r.text());
  const hrefs = [...pricing.matchAll(/href=\"([^\"]+)\"/g)].map((m) => m[1]);
  const buttons = [...pricing.matchAll(/<a[^>]+>([^<]{0,80})<\/a>/gi)].map((m) => m[0].slice(0, 200));
  out.pricing_hrefs_interesting = hrefs.filter((h) => /key|checkout|signup|get-started|dashboard|billing|solo|pro|team/i.test(h)).slice(0, 40);
  out.pricing_cta_snippets = buttons.filter((b) => /key|start|solo|pro|team|buy|upgrade|generate/i.test(b)).slice(0, 20);

  // GET the generate link target
  if (out.pricing_hrefs_interesting.includes("/v1/keys/generate")) {
    out.get_keys_generate = scrub(await j("GET", "/v1/keys/generate"));
  }

  // get-started dashboard link behavior
  const gs = await fetch(BASE + "/get-started").then((r) => r.text());
  out.get_started_agent_hrefs = [...gs.matchAll(/href=\"([^\"]*dashboard[^\"]*)\"/g)].map((m) => m[1]);
  out.get_started_snippet = (gs.match(/dashboard\/agents[\s\S]{0,200}/) || [])[0]?.slice(0, 250);

  // unauth signup-checkout (no bearer)
  out.unauth_signup_checkout = scrub(await j("POST", "/v1/billing/signup-checkout", { body: { tier: "solo" } }));
  out.unauth_checkout = scrub(await j("POST", "/v1/billing/checkout", { body: { tier: "solo" } }));

  // 401 help name optional?
  const unauth = await j("POST", "/v1/parse", { body: { prompt: "x" } });
  out.unauth_help = scrub(unauth.body?._help);
  out.keygen_empty_name = scrub(await j("POST", "/v1/keys/generate", { body: {} }));

  // openapi billing absence + keys/self methods
  const oa = await j("GET", "/openapi.json");
  out.openapi_path_count = Object.keys(oa.body?.paths || {}).length;
  out.openapi_billing = Object.keys(oa.body?.paths || {}).filter((p: string) => /billing|checkout|portal|usage|stripe/i.test(p));
  out.openapi_keys_self_methods = oa.body?.paths?.["/v1/keys/self"] && Object.keys(oa.body.paths["/v1/keys/self"]);
  out.openapi_evaluate_req = scrub(oa.body?.paths?.["/v1/evaluate"]?.post?.requestBody);

  writeFileSync("/tmp/saas_fresh_probe.json", JSON.stringify(scrub(out), null, 2));
  console.log(JSON.stringify(scrub(out), null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
