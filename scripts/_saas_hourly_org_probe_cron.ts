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
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, text: text.slice(0, 1500), ct: res.headers.get("content-type") };
}

async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  const out: any = { observed_at: new Date().toISOString() };
  out.commit = (await j("GET", "/health")).body?.deployment?.commit;

  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-org-${Date.now()}` } });
  const key = kg.body?.key as string;
  out.keygen = { status: kg.status, scopes: kg.body?.scopes, tier: kg.body?.tier };
  const auth = { Authorization: `Bearer ${key}` };

  // bootstrap org on free anon key
  out.bootstrap_free = await j("POST", "/v1/orgs/bootstrap", {
    headers: auth,
    body: { name: "Edge Org Probe" },
  });
  out.bootstrap_free = {
    status: out.bootstrap_free.status,
    detail: out.bootstrap_free.body?.detail || out.bootstrap_free.body?.title,
    keys: out.bootstrap_free.body ? Object.keys(out.bootstrap_free.body) : [],
    snip: JSON.stringify(out.bootstrap_free.body || {}).slice(0, 500),
  };

  // agents register
  out.agents = await j("POST", "/v1/agents", {
    headers: auth,
    body: { name: "probe-agent", tools: ["browser_use"] },
  });
  out.agents = {
    status: out.agents.status,
    detail: out.agents.body?.detail || out.agents.body?.title,
    snip: JSON.stringify(out.agents.body || {}).slice(0, 500),
  };

  // account surfaces
  for (const path of ["/account", "/dashboard/billing", "/dashboard/org", "/dashboard/my-agents", "/dashboard/agents"]) {
    const r = await j("GET", path, { headers: { ...auth, Accept: "text/html" } });
    out[path] = {
      status: r.status,
      ct: r.ct,
      is_html: /text\/html/i.test(r.ct || ""),
      is_json: /json/i.test(r.ct || ""),
      detail: r.body?.detail || r.body?.title || r.body?.error,
      snip: (r.text || "").slice(0, 180),
    };
  }

  // cookie-less billing portal already known
  // signup then check if checkout session completes attribution - only create checkout, don't pay
  const signup = await j("POST", "/v1/billing/signup-checkout", { body: { tier: "solo" } });
  out.signup = {
    status: signup.status,
    keys: signup.body ? Object.keys(signup.body) : [],
    has_url: !!signup.body?.checkout_url,
    mints_key: !!signup.body?.key,
    id: signup.body?.id,
  };

  // After minting many signup keys, do payments stay 0? summary
  out.summary = (await admin("admin.summary.read", {})).body;

  // Search proposals for org bootstrap / account dashboard / signup abandonment
  const pl = await admin("admin.improvement_proposal.list", { limit: 100, offset: 0 });
  let all = [...(pl.body?.improvement_proposals || [])];
  for (let off = 100; off < 300; off += 100) {
    const page = await admin("admin.improvement_proposal.list", { limit: 100, offset: off });
    const r = page.body?.improvement_proposals || [];
    all.push(...r);
    if (!r.length) break;
  }
  const qs = [
    /orgs\/bootstrap|bootstrap/i,
    /dashboard\/(org|billing|my-agents)/i,
    /Signup Key|signup abandonment|checkout abandon/i,
    /confirmed email|email confirm/i,
    /scopes \[analyze/i,
    /upgradeUrl=\/pricing/i,
    /explain.*402|402.*explain/i,
  ];
  out.searches = {};
  for (const re of qs) {
    const hits = all.filter((p: any) => re.test(p.title || "") || re.test(p.idempotency_key || ""));
    out.searches[String(re)] = hits.slice(0, 3).map((p: any) => ({
      id: p.id,
      status: p.status,
      title: (p.title || "").slice(0, 110),
      idem: p.idempotency_key,
    }));
  }

  // explain full upgrade object
  const ex = await j("POST", "/v1/explain", { headers: auth, body: { prompt: "test" } });
  out.explain_full = ex.body;

  // deep: does screen-output missing flag.id break agent parsers? compare parse flags
  const p = await j("POST", "/v1/parse", {
    headers: auth,
    body: { prompt: "password is hunter2 and key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
  });
  const so = await j("POST", "/v1/screen-output", {
    headers: auth,
    body: { output: "password is hunter2 and key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" },
  });
  out.flag_contract = {
    parse_flag_keys: ((p.body?.flags || [])[0] && Object.keys(p.body.flags[0])) || [],
    screen_flag_keys: ((so.body?.flags || [])[0] && Object.keys(so.body.flags[0])) || [],
    parse_flags: p.body?.flags,
    screen_flags: so.body?.flags,
    parse_action: p.body?.suggested_action,
    screen_action: so.body?.suggested_action,
  };

  // MCP get_pricing still no stripe - known
  // Check /v1/discovery or well-known
  for (const path of ["/.well-known/agent.json", "/.well-known/ai-plugin.json", "/mcp.json", "/.well-known/parse.json"]) {
    const r = await j("GET", path);
    out[`wk_${path}`] = {
      status: r.status,
      snip: (r.text || "").slice(0, 250),
      has_stripe: /stripe|checkout|solo/i.test(r.text || ""),
    };
  }

  writeFileSync("/tmp/saas_hourly_org.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 12000));
}
main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
