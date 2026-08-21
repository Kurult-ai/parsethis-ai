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
  return {
    status: res.status,
    ct: res.headers.get("content-type"),
    loc: res.headers.get("location"),
    title: (text.match(/<title[^>]*>([^<]+)/i) || [])[1] || null,
    body,
    head: body ? undefined : text.slice(0, 250).replace(/\s+/g, " "),
    keys: body && typeof body === "object" ? Object.keys(body).slice(0, 30) : [],
  };
}
function red(v: any): any {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map(red);
  const o: any = {};
  for (const [k, val] of Object.entries(v)) {
    if (/key|token|secret|authorization|password/i.test(k) && typeof val === "string") {
      const s = val as string;
      o[k] = s.length > 8 ? s.slice(0, 4) + "…len=" + s.length : "[redacted]";
    } else if (typeof val === "string" && /^pfa_/.test(val)) o[k] = val.slice(0, 8) + "…";
    else o[k] = red(val);
  }
  return o;
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `edge-${Date.now()}` } });
  const freeKey = kg.body?.key;
  const auth = freeKey ? { Authorization: `Bearer ${freeKey}` } : {};
  out.keygen = { status: kg.status, has_key: !!freeKey, scopes: kg.body?.scopes, tier: kg.body?.tier };

  const paths = [
    ["GET", "/v1/billing/usage"],
    ["POST", "/v1/billing/portal", {}],
    ["GET", "/v1/keys/self"],
    ["GET", "/v1/policy"],
    ["GET", "/v1/coverage"],
    ["GET", "/v1/gateway/status"],
    ["POST", "/v1/support/tickets", { subject: "probe", message: "ro probe do not act" }],
    ["GET", "/support"],
    ["GET", "/contact"],
    ["GET", "/get-started"],
    ["GET", "/pricing"],
    ["GET", "/install"],
    ["GET", "/demo"],
    ["GET", "/docs/quickstart"],
    ["GET", "/acceptable-use"],
    ["GET", "/aup"],
    ["GET", "/refund"],
    ["GET", "/refund-policy"],
    ["GET", "/privacy"],
    ["GET", "/security"],
    ["GET", "/sitemap.xml"],
    ["GET", "/mcp.json"],
    ["GET", "/v1/orgs"],
    ["POST", "/v1/orgs", { name: "x" }],
    ["POST", "/account/keys/adopt", { key: "x" }],
    ["POST", "/v1/agents", { name: "a", tools: ["browser_use"] }],
    ["POST", "/v1/orgs/bootstrap", { name: "probe" }],
  ];
  for (const item of paths) {
    const method = item[0] as string;
    const path = item[1] as string;
    const body = item[2];
    const withAuth = path.startsWith("/v1/") || path.startsWith("/account/");
    const r = await j(method, path, {
      headers: withAuth ? auth : {},
      body: method === "GET" || method === "HEAD" ? undefined : body ?? {},
    });
    out[`${method} ${path}`] = {
      status: r.status,
      ct: r.ct,
      loc: r.loc,
      title: r.title,
      code: r.body?.code,
      detail: typeof r.body?.detail === "string" ? r.body.detail.slice(0, 220) : r.body?.detail,
      help: red(r.body?._help),
      keys: r.keys,
      // interesting billing fields
      included: r.body?.includedRequests ?? r.body?.included_requests ?? r.body?.usage?.includedRequests,
      current: r.body?.currentPeriodUsage ?? r.body?.current_period_usage,
      tier: r.body?.tier,
      org_id: r.body?.org_id,
      x402: r.body?.x402,
      enabled: r.body?.enabled,
      head: r.head,
    };
  }

  // unauth parse help
  out.unauth_parse = red(await j("POST", "/v1/parse", { body: { prompt: "hi" } }));

  // pricing JSON
  out.pricing = red(await j("GET", "/v1/pricing"));

  // openapi billing + adopt presence
  const oa = await j("GET", "/openapi.json");
  const pathsO = oa.body?.paths ? Object.keys(oa.body.paths) : [];
  out.openapi_billing = pathsO.filter((p: string) => /billing|checkout|portal|usage|key/i.test(p));
  out.openapi_support = pathsO.filter((p: string) => /support|contact/i.test(p));
  out.openapi_adopt = pathsO.filter((p: string) => /adopt|signup|account/i.test(p));

  // llms snippet for adopt/bootstrap/x402 claims
  const llms = await fetch(BASE + "/llms.txt").then((r) => r.text());
  out.llms_mentions = {
    adopt: /adopt/i.test(llms),
    bootstrap: /bootstrap/i.test(llms),
    x402: /x402/i.test(llms),
    org: /organization|org_admin/i.test(llms),
    snippets: (llms.match(/.{0,80}(adopt|bootstrap|x402|organization).{0,80}/gi) || []).slice(0, 12),
  };

  writeFileSync("/tmp/saas_edge_probe.json", JSON.stringify(red(out), null, 2));
  console.log(JSON.stringify(red(out), null, 2).slice(0, 12000));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
