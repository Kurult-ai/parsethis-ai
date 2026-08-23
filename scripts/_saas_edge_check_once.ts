import { config } from "dotenv";
config({ path: ".env" });
const master = process.env.MASTER_API_KEY!;
const BASE = "https://www.parsethis.ai";
async function j(method: string, path: string, body?: any, headers: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let b: any = null;
  try { b = JSON.parse(text); } catch {}
  const scrub = (o: any) => {
    if (!o || typeof o !== "object") return o;
    const out: any = Array.isArray(o) ? [] : {};
    for (const [k, v] of Object.entries(o)) {
      if (/key|token|secret|url|authorization/i.test(k) && typeof v === "string" && v.length > 24) {
        (out as any)[k] = (v as string).slice(0, 12) + "…";
      } else if (v && typeof v === "object") (out as any)[k] = scrub(v);
      else (out as any)[k] = v;
    }
    return out;
  };
  return {
    status: res.status,
    ct: (res.headers.get("content-type") || "").split(";")[0],
    loc: res.headers.get("location"),
    body: scrub(b),
    head: b ? undefined : text.replace(/\s+/g, " ").slice(0, 180),
  };
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  out.signup_checkout_pro = await j("POST", "/v1/billing/signup-checkout", { tier: "pro" });
  out.signup_checkout_solo = await j("POST", "/v1/billing/signup-checkout", { tier: "solo" });
  out.checkout_master = await j("POST", "/v1/billing/checkout", { tier: "pro" }, { Authorization: `Bearer ${master}` });
  out.portal_master = await j("POST", "/v1/billing/portal", {}, { Authorization: `Bearer ${master}` });
  out.terms = await j("GET", "/terms");
  out.aup = await j("GET", "/acceptable-use");
  out.privacy = await j("GET", "/privacy");
  out.trust = await j("GET", "/trust");
  out.support = await j("GET", "/support");
  out.contact = await j("GET", "/contact");
  out.get_started = await j("GET", "/get-started");
  out.pricing_page = await j("GET", "/pricing");
  out.agents_dash = await j("GET", "/dashboard/agents");
  out.adopt_post = await j("POST", "/account/keys/adopt", {});
  out.bootstrap = await j("POST", "/v1/orgs/bootstrap", { name: "edge-check" }, { Authorization: `Bearer ${master}` });
  // status dependency snippet via HTML scrape light
  const st = await fetch(BASE + "/status");
  const html = await st.text();
  out.status_http = st.status;
  out.status_mentions = {
    redis: /redis|cache|rate-?limit/i.test(html),
    operational: (html.match(/Operational/gi) || []).length,
    degraded: (html.match(/Degraded|Unavailable|Down/gi) || []).length,
    has_unavailable_word: /unavailable/i.test(html),
  };
  // support tickets compact
  const tix = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action: "admin.support.ticket.list", params: { limit: 15 } }),
  });
  const tb = await tix.json();
  const tickets = (tb.result ?? tb).tickets || (tb.result ?? tb).support_tickets || [];
  out.tickets = {
    status: tix.status,
    n: tickets.length,
    total: (tb.result ?? tb).total,
    items: tickets.slice(0, 12).map((t: any) => ({
      id: t.id,
      status: t.status,
      category: t.category,
      priority: t.priority,
      subject: String(t.subject || t.title || "").slice(0, 100),
      created: t.createdAt || t.created_at,
    })),
  };
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
