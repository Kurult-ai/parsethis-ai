import { config } from "dotenv";
import { writeFileSync } from "fs";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
async function j(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", accept: "application/json", ...(opts.headers || {}) },
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
    body,
    text: body ? undefined : text.slice(0, 400),
  };
}
function scrub(v: any, d = 0): any {
  if (d > 8) return "[d]";
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|password|authorization|url/i.test(k) && typeof val === "string") {
        const s = val as string;
        if (/^https?:\/\//.test(s)) {
          // keep URL path, strip query secrets
          try {
            const u = new URL(s);
            o[k] = `${u.origin}${u.pathname}` + (u.search ? "?…" : "");
          } catch {
            o[k] = s.slice(0, 60) + "…";
          }
        } else o[k] = s.length > 8 ? s.slice(0, 4) + "…len=" + s.length : "[redacted]";
      } else if (typeof val === "string" && /^pfa_/.test(val)) o[k] = val.slice(0, 8) + "…";
      else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  return v;
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  const health = await j("GET", "/health");
  out.commit = health.body?.deployment?.commit;

  // openapi keys/self schema
  const oa = await j("GET", "/openapi.json");
  const selfPath = oa.body?.paths?.["/v1/keys/self"];
  out.openapi_keys_self = scrub(selfPath);
  out.openapi_has_evaluate = !!oa.body?.paths?.["/v1/evaluate"];
  out.openapi_evaluate = scrub(oa.body?.paths?.["/v1/evaluate"]);
  out.openapi_billing_paths = Object.keys(oa.body?.paths || {}).filter((p: string) => /billing|checkout|portal|usage/i.test(p));

  // free key
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `uniq-${Date.now()}` } });
  const freeKey = kg.body?.key as string | undefined;
  const auth = freeKey ? { Authorization: `Bearer ${freeKey}` } : {};
  out.keygen = scrub({ status: kg.status, scopes: kg.body?.scopes, tier: kg.body?.tier, id: kg.body?.id, note: kg.body?.note });

  // keys/self variants
  for (const p of ["/v1/keys/self", "/v1/keys/me", "/v1/me", "/v1/account", "/v1/keys"]) {
    out[`GET ${p}`] = scrub(await j("GET", p, { headers: auth }));
  }
  out[`DELETE /v1/keys/self`] = scrub(await j("DELETE", "/v1/keys/self", { headers: auth }));

  // usage full body
  const usage = await j("GET", "/v1/billing/usage", { headers: auth });
  out.usage = scrub(usage);

  // evaluate free path
  const evalBodies = [
    { prompt: "hi", model: "openai/gpt-4o-mini" },
    { prompt: "hi", models: ["openai/gpt-4o-mini"] },
    { prompt: "hi" },
    { text: "hi", model: "openai/gpt-4o-mini" },
  ];
  out.evaluate = [];
  for (const body of evalBodies) {
    const r = await j("POST", "/v1/evaluate", { headers: auth, body });
    out.evaluate.push(scrub({ body_sent: body, status: r.status, code: r.body?.code, detail: r.body?.detail, title: r.body?.title, keys: r.body && Object.keys(r.body), help: r.body?._help }));
  }

  // models free?
  out.models = scrub(await j("GET", "/v1/models", { headers: auth }));
  out.models_unauth = scrub(await j("GET", "/v1/models"));

  // chat scope
  out.chat = scrub(await j("POST", "/v1/chat", { headers: auth, body: { message: "hi" } }));

  // screen-output
  out.screen_output = scrub(await j("POST", "/v1/screen-output", { headers: auth, body: { output: "hello", prompt: "hi" } }));

  // analyze
  out.analyze = scrub(await j("POST", "/v1/analyze", { headers: auth, body: { url: "https://example.com" } }));

  // checkout shape - does it mint a second key?
  const ck = await j("POST", "/v1/billing/signup-checkout", { headers: auth, body: { tier: "solo" } });
  out.checkout_solo = scrub({
    status: ck.status,
    keys: ck.body && Object.keys(ck.body),
    id: ck.body?.id,
    expires_at: ck.body?.expires_at,
    has_checkout_url: !!ck.body?.checkout_url,
    checkout_host: ck.body?.checkout_url ? new URL(ck.body.checkout_url).host : null,
    same_key_returned: !!(ck.body?.key && freeKey && ck.body.key === freeKey),
    new_key_returned: !!(ck.body?.key && freeKey && ck.body.key !== freeKey),
    detail: ck.body?.detail,
    code: ck.body?.code,
  });

  // policy full interesting fields
  const pol = await j("GET", "/v1/policy", { headers: auth });
  out.policy = scrub({
    status: pol.status,
    max_threshold: pol.body?.max_threshold ?? pol.body?.maxThreshold,
    autoBlockThreshold: pol.body?.autoBlockThreshold ?? pol.body?.auto_block_threshold,
    approvalRequiredForLocation: pol.body?.approvalRequiredForLocation,
    approvalRequiredForFuturePlans: pol.body?.approvalRequiredForFuturePlans,
    approvalRequiredForPersonalData: pol.body?.approvalRequiredForPersonalData,
    approvalDefaultAction: pol.body?.approvalDefaultAction,
    keys: pol.body && Object.keys(pol.body),
  });

  // coverage full
  const cov = await j("GET", "/v1/coverage", { headers: auth });
  out.coverage = scrub({
    status: cov.status,
    org_id: cov.body?.org_id,
    coverage_pct: cov.body?.coverage_pct,
    reason: cov.body?.reason,
    keys: cov.body && Object.keys(cov.body),
    body: cov.body,
  });

  // gateway status
  const gs = await j("GET", "/v1/gateway/status", { headers: auth });
  out.gateway_status = scrub(gs);

  // hold/approve discoverability via openapi
  out.openapi_holdish = Object.keys(oa.body?.paths || {}).filter((p: string) => /hold|approv|override/i.test(p));

  // portal variants
  for (const p of ["/v1/billing/portal", "/v1/billing/customer-portal", "/v1/billing/portal-session"]) {
    out[`POST ${p}`] = scrub(await j("POST", p, { headers: auth, body: {} }));
  }

  // support ticket with email
  out.support_ok = scrub(await j("POST", "/v1/support/tickets", { headers: auth, body: { email: "probe@example.com", subject: "ro-probe", message: "automated read-only probe; ignore" } }));

  // get-started HTML: does it still link dashboard/agents?
  const gsHtml = await fetch(BASE + "/get-started").then((r) => r.text());
  out.get_started_links = {
    dashboard_agents: /\/dashboard\/agents/i.test(gsHtml),
    dashboard: /\/dashboard/i.test(gsHtml),
    signup: /\/signup/i.test(gsHtml),
    account: /\/account/i.test(gsHtml),
    keys_generate: /\/v1\/keys\/generate/i.test(gsHtml),
    checkout: /checkout|billing\/signup/i.test(gsHtml),
  };

  // pricing page CTA
  const pricingHtml = await fetch(BASE + "/pricing").then((r) => r.text());
  out.pricing_page = {
    generate_free: /generate.*key|\/v1\/keys\/generate|get-started/i.test(pricingHtml),
    href_generate: (pricingHtml.match(/href=\"([^\"]*keys\/generate[^\"]*)\"/i) || [])[1],
    checkout_mentions: /signup-checkout|checkout/i.test(pricingHtml),
    solo_cta: /solo/i.test(pricingHtml),
  };

  // llms bootstrap honesty
  const llms = await fetch(BASE + "/llms.txt").then((r) => r.text());
  const boot = llms.split("\n").filter((l) => /bootstrap|adopt|organization|org_admin|confirmed email/i.test(l)).slice(0, 20);
  out.llms_org_lines = boot;

  writeFileSync("/tmp/saas_unique_probe.json", JSON.stringify(scrub(out), null, 2));
  console.log(JSON.stringify(scrub(out), null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
