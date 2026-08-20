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
  return {
    status: res.status,
    headers: {
      limit: res.headers.get("x-ratelimit-limit"),
      remaining: res.headers.get("x-ratelimit-remaining"),
      reset: res.headers.get("x-ratelimit-reset"),
    },
    body,
    text: text.slice(0, 800),
  };
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
  // Inspect MAX map and tier handling via source is known. Live: create free key, burn RPM for 429 body.
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-rpm-probe-${Date.now()}` } });
  const freeKey = kg.body?.key as string;
  out.key_id = kg.body?.id;
  const results = [];
  for (let i = 0; i < 15; i++) {
    const r = await j("POST", "/v1/parse", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { prompt: `rpm probe ${i} ${Date.now()}` },
    });
    results.push({
      i,
      status: r.status,
      headers: r.headers,
      code: r.body?.code,
      upgradeUrl: r.body?.upgradeUrl,
      upgrade: r.body?.upgrade,
      detail: (r.body?.detail || "").toString().slice(0, 180),
      keys: r.body && r.status >= 400 ? Object.keys(r.body) : undefined,
    });
    if (r.status === 429) break;
  }
  out.rpm = results;

  // Does billing checkout share RPM?
  const bc = await j("POST", "/v1/billing/checkout", {
    headers: { Authorization: `Bearer ${freeKey}` },
    body: { tier: "solo" },
  });
  out.checkout_while_maybe_throttled = {
    status: bc.status,
    code: bc.body?.code,
    has_url: /checkout\.stripe\.com/i.test(bc.text || ""),
    detail: (bc.body?.detail || bc.body?.title || "").toString().slice(0, 200),
    upgradeUrl: bc.body?.upgradeUrl,
    keys: bc.body ? Object.keys(bc.body) : [],
  };

  // usage/activity after throttle
  out.usage = (await j("GET", "/v1/billing/usage", { headers: { Authorization: `Bearer ${freeKey}` } })).body;
  out.activity = (await j("GET", "/v1/activity", { headers: { Authorization: `Bearer ${freeKey}` } })).body;

  // Admin: find any solo/pro tier keys and read their policy max if possible
  const snap = await admin("admin.dashboard.snapshot", {});
  const keys = snap.body?.api_keys || [];
  out.tier_counts = keys.reduce((m: any, k: any) => {
    const t = k.tier || "unknown";
    m[t] = (m[t] || 0) + 1;
    return m;
  }, {});
  // list subscriptions detail
  const subs = await admin("admin.subscription.list", { limit: 20 });
  out.subs = (subs.body?.subscriptions || []).map((s: any) => ({
    id: s.id,
    status: s.status,
    tier: s.tier || s.plan,
    price: s.price || s.amount,
    currentPeriodEnd: s.currentPeriodEnd || s.current_period_end,
  }));

  // Source-level solo map confirmation via public policy docs example
  const docs = await j("GET", "/docs/api");
  out.docs_threshold = {
    mentions_max: /max_threshold|autoBlockThreshold/i.test(docs.text || ""),
  };

  // Proposal overlap for rpm 10 / 429 upgrade
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
    "x-ratelimit-limit",
    "rpm 10",
    "10 rpm",
    "rate limit",
    "429",
    "usage stays 0",
    "currentPeriodUsage",
    "includedRequests\": 0",
    "free usage meter",
    "billableUsage",
    "screened_total",
    "override.how",
    "POST /v1/policy",
    "docs#override",
  ];
  function blob(p: any) {
    return `${p.title} ${p.idempotencyKey || ""} ${JSON.stringify(p.evidence || {})}`.toLowerCase();
  }
  out.related = {};
  for (const n of needles) {
    out.related[n] = all.filter((p) => blob(p).includes(n.toLowerCase())).slice(0, 3).map((p) => ({
      id: p.id, status: p.status, title: (p.title || "").slice(0, 110),
    }));
  }

  if (out.key_id) {
    out.revoked = await admin("admin.api_key.revoke", { id: out.key_id, reason: "hourly saas loop rpm probe cleanup" });
  }
  writeFileSync("/tmp/saas_live_probe4.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 14000));
}
main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
