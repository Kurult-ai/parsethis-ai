import { config } from "dotenv";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY;
if (!master) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}
async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${master}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  const health = await (await fetch(BASE + "/health")).json();
  out.health = {
    status: health.status,
    commit: health?.deployment?.commit,
    semantic: health?.semantic_layer,
  };

  const kgName = `elon-hourly-probe-${Date.now()}`;
  const kgRes = await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: kgName }),
  });
  const kgBody = await kgRes.json().catch(() => ({}));
  out.keygen = {
    status: kgRes.status,
    code: kgBody.code,
    title: kgBody.title,
    detail: typeof kgBody.detail === "string" ? kgBody.detail.slice(0, 200) : kgBody.detail,
    reason: kgBody.reason,
    has_key: Boolean(kgBody.key || kgBody.api_key || kgBody.token),
    key_prefix: (kgBody.key || kgBody.api_key || "").toString().slice(0, 12) || null,
    id: kgBody.id || kgBody.key_id || null,
  };
  const freeKey = kgBody.key || kgBody.api_key || null;

  const coRes = await fetch(BASE + "/v1/billing/signup-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "solo" }),
  });
  const coBody = await coRes.json().catch(() => ({}));
  out.checkout = {
    status: coRes.status,
    code: coBody.code,
    title: coBody.title,
    detail: typeof coBody.detail === "string" ? coBody.detail.slice(0, 220) : null,
  };

  async function parseWith(auth: string | null, mode: string, prompt: string) {
    const headers: any = { "content-type": "application/json" };
    if (auth) headers.Authorization = `Bearer ${auth}`;
    const res = await fetch(BASE + "/v1/parse", {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt, mode }),
    });
    const body = await res.json().catch(() => ({}));
    return {
      status: res.status,
      analysis_method: body.analysis_method,
      degraded: body.degraded,
      degraded_reason: body.degraded_reason,
      layers: body.layers,
      deep_screening: body.deep_screening,
      suggested_action: body.suggested_action,
      risk_score: body.risk_score,
      code: body.code,
      title: body.title,
      detail: typeof body.detail === "string" ? body.detail.slice(0, 160) : null,
    };
  }

  out.parse_master_full = await parseWith(master!, "full", "hello world benign probe");
  out.parse_master_pattern = await parseWith(master!, "pattern-only", "hello world benign probe");
  if (freeKey) {
    out.parse_free_full_1 = await parseWith(freeKey, "full", "hello world free probe 1");
    out.parse_free_full_2 = await parseWith(freeKey, "full", "hello world free probe 2");
    out.parse_free_pattern = await parseWith(freeKey, "pattern-only", "hello world free pattern");
    const soRes = await fetch(BASE + "/v1/screen-output", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${freeKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ output: "The capital of France is Paris." }),
    });
    const soBody = await soRes.json().catch(() => ({}));
    out.screen_output_free = {
      status: soRes.status,
      degraded: soBody.degraded,
      degraded_reason: soBody.degraded_reason,
      deep_screening: soBody.deep_screening,
      analysis_method: soBody.analysis_method,
      layers: soBody.layers,
      code: soBody.code,
    };
  }

  const demoRes = await fetch(BASE + "/demo/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "demo benign" }),
  });
  const demoBody = await demoRes.json().catch(() => ({}));
  out.demo = {
    status: demoRes.status,
    degraded: demoBody.degraded,
    degraded_reason: demoBody.degraded_reason,
    layers: demoBody.layers,
    deep_screening: demoBody.deep_screening,
    analysis_method: demoBody.analysis_method,
  };

  const summary = await admin("admin.summary.read", {});
  const sum = summary.body?.result ?? summary.body;
  out.summary_status = summary.status;
  out.summary = {
    subscriptions: sum?.subscriptions,
    payments: sum?.payments,
    api_keys: sum?.api_keys,
    screening: sum?.screening,
    support: sum?.support,
    evaluations: sum?.evaluations,
    entitlements: sum?.entitlements,
  };

  const props = await admin("admin.improvement_proposal.list", { limit: 100 });
  out.props_status = props.status;
  const pr = props.body?.result ?? props.body;
  const rows = pr?.improvement_proposals || [];
  const hist: Record<string, number> = {};
  for (const p of rows) {
    const s = String(p.status || "unknown");
    hist[s] = (hist[s] || 0) + 1;
  }
  out.prop_status_hist = hist;
  out.prop_total = rows.length;
  out.recent_props = rows.slice(0, 50).map((p: any) => ({
    id: p.id,
    title: (p.title || "").slice(0, 140),
    status: p.status,
    priority: p.priority,
    idem: p.idempotencyKey || p.idempotency_key,
    source: p.source,
    created_at: p.createdAt || p.created_at,
  }));
  out.openish = rows
    .filter((p: any) => !["rejected", "done", "completed", "implemented", "closed"].includes(String(p.status || "").toLowerCase()))
    .map((p: any) => ({
      id: p.id,
      title: (p.title || "").slice(0, 140),
      status: p.status,
      priority: p.priority,
      idem: p.idempotencyKey || p.idempotency_key,
      source: p.source,
    }));

  const geo = await admin("admin.geo.metrics.read", {});
  out.geo_status = geo.status;
  const g = geo.body?.result ?? geo.body;
  out.geo = g?.summary || g;

  const anom = await admin("admin.billing.anomaly.scan", {});
  out.anom_status = anom.status;
  const a = anom.body?.result ?? anom.body;
  out.anom = a && typeof a === "object"
    ? { count: a.count ?? a.anomalies?.length ?? a.items?.length, sample: (a.anomalies || a.items || []).slice?.(0, 8) || a }
    : a;

  const tickets = await admin("admin.support.ticket.list", { limit: 20 });
  out.tickets_status = tickets.status;
  const t = tickets.body?.result ?? tickets.body;
  const trows = t?.tickets || t?.support_tickets || [];
  out.tickets_openish = (Array.isArray(trows) ? trows : [])
    .filter((x: any) => !["closed", "resolved"].includes(String(x.status || "").toLowerCase()))
    .slice(0, 10)
    .map((x: any) => ({
      id: x.id,
      status: x.status,
      subject: (x.subject || x.title || "").slice(0, 100),
      category: x.category,
      priority: x.priority,
    }));

  if (out.keygen.id) {
    try {
      const rev = await admin("admin.api_key.revoke", { id: out.keygen.id, reason: "hourly saas probe cleanup" });
      out.key_revoked = { status: rev.status, ok: rev.status < 400 };
    } catch (e: any) {
      out.key_revoke_error = String(e?.message || e).slice(0, 120);
    }
  }

  const paths = ["/mcp", "/openapi.json", "/llms.txt", "/v1/pricing", "/trust", "/status", "/admin"];
  out.public = {} as any;
  for (const p of paths) {
    const r = await fetch(BASE + p, { method: "GET" });
    out.public[p] = r.status;
  }

  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(1);
});
