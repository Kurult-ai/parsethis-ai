import { config } from "dotenv";
config({ path: ".env" });
import { writeFileSync } from "fs";

const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY;
if (!master) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

async function j(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {}
  const ct = res.headers.get("content-type") || "";
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  return {
    status: res.status,
    ct,
    title: titleMatch?.[1]?.slice(0, 120) || null,
    body,
    text_head: body ? undefined : text.slice(0, 300),
    keys: body && typeof body === "object" ? Object.keys(body).slice(0, 25) : [],
  };
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
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 400) };
  }
  return { status: res.status, body };
}

function scrub(v: any, d = 0): any {
  if (d > 8) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 80).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (
        /key|token|secret|authorization|password|connectionString/i.test(k) &&
        typeof val === "string"
      ) {
        const s = val as string;
        o[k] = s.length > 8 ? `${s.slice(0, 4)}…len=${s.length}` : "[redacted]";
      } else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  if (typeof v === "string" && /^pfa_/.test(v) && v.length > 12)
    return v.slice(0, 8) + "…";
  return v;
}

async function main() {
  const out: any = { observed_at: new Date().toISOString() };
  out.health = await j("GET", "/health");
  out.version = await j("GET", "/version");

  const kg = await j("POST", "/v1/keys/generate", {
    body: { name: `elon-saas-loop-${Date.now()}` },
  });
  const freeKey = kg.body?.key || kg.body?.api_key || kg.body?.token;
  out.keygen = {
    status: kg.status,
    tier: kg.body?.tier,
    scopes: kg.body?.scopes,
    note: kg.body?.note,
    expires_at: kg.body?.expires_at,
    has_key: !!freeKey,
    code: kg.body?.code,
    detail: kg.body?.detail,
  };
  const auth = freeKey ? { Authorization: `Bearer ${freeKey}` } : {};

  out.parse_unauth = {
    status: (await j("POST", "/v1/parse", { body: { prompt: "hello world" } }))
      .status,
  };
  if (freeKey) {
    const pf = await j("POST", "/v1/parse", {
      headers: auth,
      body: { prompt: "hello world" },
    });
    out.parse_free = {
      status: pf.status,
      suggested_action: pf.body?.suggested_action,
      score: pf.body?.risk_score ?? pf.body?.score,
      flags_len: Array.isArray(pf.body?.flags) ? pf.body.flags.length : null,
      code: pf.body?.code,
      detail: pf.body?.detail,
    };
    out.agents = await j("POST", "/v1/agents", {
      headers: auth,
      body: { name: "probe-agent", tools: [] },
    });
    out.bootstrap = await j("POST", "/v1/orgs/bootstrap", {
      headers: auth,
      body: { name: "probe-org" },
    });
    out.claim_keys = await j("POST", "/v1/orgs/claim-keys", {
      headers: auth,
      body: {},
    });
  }

  out.adopt_post_noauth = await j("POST", "/account/keys/adopt", { body: {} });
  out.adopt_post_bearer = freeKey
    ? await j("POST", "/account/keys/adopt", {
        headers: auth,
        body: { key: "redacted" },
      })
    : null;
  out.adopt_get = await j("GET", "/account/keys/adopt");

  // signup / account surfaces
  out.signup = await j("GET", "/signup");
  out.login = await j("GET", "/login");
  out.account = await j("GET", "/account");
  out.account_keys = await j("GET", "/account/keys");

  for (const tier of ["solo", "pro", "team"] as const) {
    if (!freeKey) continue;
    const r = await j("POST", "/v1/billing/signup-checkout", {
      headers: auth,
      body: { tier },
    });
    out[`checkout_${tier}`] = {
      status: r.status,
      code: r.body?.code,
      detail: r.body?.detail,
      title: r.body?.title,
      has_url: !!(r.body?.url || r.body?.checkout_url || r.body?.session_url),
      keys: r.keys,
    };
  }

  // dashboard surfaces
  for (const p of [
    "/dashboard/agents",
    "/dashboard/org",
    "/dashboard/billing",
    "/dashboard/my-agents",
    "/dashboard/screening",
    "/admin",
  ]) {
    const r = await j("GET", p);
    out[`page_${p}`] = {
      status: r.status,
      ct: r.ct,
      title: r.title,
      code: r.body?.code,
      detail: r.body?.detail,
    };
  }

  // discovery
  for (const p of [
    "/mcp",
    "/openapi.json",
    "/llms.txt",
    "/v1/pricing",
    "/trust",
    "/terms",
    "/dpa",
    "/status",
    "/health",
  ]) {
    const r = await j("GET", p);
    out[`disc_${p}`] = {
      status: r.status,
      ct: r.ct?.slice(0, 40),
      title: r.title,
      detail: r.body?.detail || r.body?.title || null,
    };
  }

  // openapi adopt presence
  try {
    const oa = await j("GET", "/openapi.json");
    const paths = oa.body?.paths ? Object.keys(oa.body.paths) : [];
    out.openapi_paths_count = paths.length;
    out.openapi_has_adopt = paths.some((p) => /adopt/i.test(p));
    out.openapi_has_bootstrap = paths.some((p) => /bootstrap/i.test(p));
    out.openapi_has_agents = paths.some((p) => /\/v1\/agents/.test(p));
    out.openapi_accountish = paths.filter((p) => /account|signup|orgs/i.test(p)).slice(0, 40);
  } catch (e: any) {
    out.openapi_err = String(e).slice(0, 200);
  }

  out.snapshot = await admin("admin.dashboard.snapshot", {});
  out.billing_anom = await admin("admin.billing.anomaly.scan", {});
  out.subs = await admin("admin.subscription.list", { limit: 20 });
  out.payments = await admin("admin.payment.list", { limit: 10 });
  out.tickets = await admin("admin.support.ticket.list", { limit: 20 });
  out.ents = await admin("admin.entitlement.list", { limit: 20 });
  out.summary = await admin("admin.summary.read", {});
  out.geo = await admin("admin.geo.metrics.read", {});
  out.screen = await admin("admin.screening_event.list", { limit: 10 });

  const proposals: any[] = [];
  let page0: any = null;
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await admin("admin.improvement_proposal.list", {
      limit: 100,
      offset,
    });
    if (offset === 0) page0 = page;
    const root = page.body?.result ?? page.body;
    const items =
      root?.items ||
      root?.proposals ||
      (Array.isArray(root) ? root : null) ||
      page.body?.items ||
      [];
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
      out.proposals_page0_shape = {
        status: page.status,
        keys: page.body ? Object.keys(page.body) : [],
        result_keys: page.body?.result ? Object.keys(page.body.result) : [],
        sample: scrub(page.body).toString?.() ? undefined : scrub(page.body),
      };
      // keep a compact dump
      writeFileSync(
        "/tmp/saas_proposals_page0.json",
        JSON.stringify(scrub(page), null, 2),
      );
      break;
    }
    proposals.push(...arr);
    if (arr.length < 100) break;
  }
  out.proposals_count = proposals.length;
  const closed = new Set([
    "rejected",
    "done",
    "implemented",
    "completed",
    "closed",
    "shipped",
  ]);
  out.proposals_open = proposals
    .filter((p: any) => !closed.has(String(p.status || "").toLowerCase()))
    .map((p: any) => ({
      id: p.id,
      status: p.status,
      priority: p.priority,
      category: p.category,
      source: p.source,
      title: String(p.title || "").slice(0, 180),
      idempotency_key: p.idempotency_key,
      created_at: p.created_at || p.createdAt,
    }));
  out.proposals_by_status = proposals.reduce((a: any, p: any) => {
    const s = String(p.status || "unknown");
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {});

  // compact admin facts
  function compactAdmin(label: string, resp: any) {
    const b = resp?.body;
    const r = b?.result ?? b;
    return {
      status: resp?.status,
      ok: b?.ok,
      code: b?.code || b?.error,
      keys: r && typeof r === "object" ? Object.keys(r).slice(0, 30) : [],
      // common fields
      active_subscriptions: r?.active_subscriptions ?? r?.subscriptions_active,
      payments_total: r?.payments_total ?? r?.total_payments,
      open_tickets: r?.open_tickets,
      keys_active: r?.keys_active ?? r?.api_keys_active,
      summary: typeof r?.summary === "string" ? r.summary.slice(0, 300) : undefined,
      counts: r?.counts,
      anomalies: Array.isArray(r?.anomalies)
        ? r.anomalies.slice(0, 10)
        : Array.isArray(r?.items)
          ? r.items.slice(0, 5)
          : undefined,
      items_len: Array.isArray(r?.items)
        ? r.items.length
        : Array.isArray(r)
          ? r.length
          : undefined,
      sample: scrub(
        Array.isArray(r?.items)
          ? r.items.slice(0, 3)
          : Array.isArray(r?.subscriptions)
            ? r.subscriptions.slice(0, 3)
            : Array.isArray(r?.payments)
              ? r.payments.slice(0, 3)
              : r?.metrics || r?.scorecard || null,
      ),
    };
  }

  out.admin_compact = {
    snapshot: compactAdmin("snapshot", out.snapshot),
    billing_anom: compactAdmin("billing", out.billing_anom),
    subs: compactAdmin("subs", out.subs),
    payments: compactAdmin("payments", out.payments),
    tickets: compactAdmin("tickets", out.tickets),
    ents: compactAdmin("ents", out.ents),
    summary: compactAdmin("summary", out.summary),
    geo: compactAdmin("geo", out.geo),
    screen: compactAdmin("screen", out.screen),
  };

  // scrub bulky raw admin before write
  const slim = { ...out };
  for (const k of [
    "snapshot",
    "billing_anom",
    "subs",
    "payments",
    "tickets",
    "ents",
    "summary",
    "geo",
    "screen",
  ]) {
    slim[k] = { status: out[k]?.status, body_keys: out[k]?.body ? Object.keys(out[k].body) : [] };
  }
  // keep help trails for first-mile
  if (out.agents?.body) {
    slim.agents = {
      status: out.agents.status,
      code: out.agents.body.code,
      detail: out.agents.body.detail,
      title: out.agents.body.title,
      help: scrub(out.agents.body._help),
    };
  }
  if (out.bootstrap?.body) {
    slim.bootstrap = {
      status: out.bootstrap.status,
      code: out.bootstrap.body.code,
      detail: out.bootstrap.body.detail,
      title: out.bootstrap.body.title,
      help: scrub(out.bootstrap.body._help),
    };
  }
  for (const k of ["adopt_post_noauth", "adopt_post_bearer", "adopt_get", "claim_keys"]) {
    if (out[k]) {
      slim[k] = {
        status: out[k].status,
        ct: out[k].ct,
        title: out[k].title,
        code: out[k].body?.code,
        detail: out[k].body?.detail,
        text_head: out[k].text_head,
      };
    }
  }

  writeFileSync("/tmp/saas_hourly_elon_live.json", JSON.stringify(scrub(slim), null, 2));
  console.log("WROTE /tmp/saas_hourly_elon_live.json");
  console.log(
    "health",
    out.health.status,
    out.health.body?.deployment?.commit,
  );
  console.log("keygen", JSON.stringify(out.keygen));
  console.log("parse_free", JSON.stringify(slim.parse_free));
  console.log("agents", JSON.stringify(slim.agents));
  console.log("bootstrap", JSON.stringify(slim.bootstrap));
  console.log(
    "adopt_noauth",
    slim.adopt_post_noauth?.status,
    slim.adopt_post_noauth?.ct,
    slim.adopt_post_noauth?.title,
  );
  console.log(
    "checkout",
    JSON.stringify({
      solo: out.checkout_solo,
      pro: out.checkout_pro,
      team: out.checkout_team,
    }),
  );
  console.log("admin_compact", JSON.stringify(out.admin_compact, null, 2).slice(0, 4000));
  console.log("proposals", out.proposals_count, JSON.stringify(out.proposals_by_status));
  console.log("OPEN");
  for (const p of out.proposals_open || []) {
    console.log(
      `${p.priority}\t${p.status}\t${p.id}\t${p.idempotency_key || ""}\t${p.title}`,
    );
  }
}

main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 500));
  process.exit(1);
});
