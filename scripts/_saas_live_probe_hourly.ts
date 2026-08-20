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
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, ct: res.headers.get("content-type"), body, text: text.slice(0, 1200) };
}

async function admin(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  const out: any = { observed_at: new Date().toISOString() };
  out.health = (await j("GET", "/health")).body;
  out.version = (await j("GET", "/version")).body;
  out.pricing = (await j("GET", "/v1/pricing")).body;

  // keygen name optional claim vs live
  const kgEmpty = await j("POST", "/v1/keys/generate", { body: {} });
  out.keygen_empty = { status: kgEmpty.status, detail: kgEmpty.body?.detail, code: kgEmpty.body?.code, help_name: kgEmpty.body?._help };
  const kgNoBody = await j("POST", "/v1/keys/generate", {});
  out.keygen_nobody = { status: kgNoBody.status, detail: kgNoBody.body?.detail, code: kgNoBody.body?.code };
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-saas-loop-ro-${Date.now()}` } });
  const freeKey = kg.body?.key || kg.body?.api_key || kg.body?.token;
  out.keygen_ok = {
    status: kg.status,
    scopes: kg.body?.scopes,
    tier: kg.body?.tier,
    note: kg.body?.note,
    expires_at: kg.body?.expires_at,
    has_key: !!freeKey,
    keys: kg.body ? Object.keys(kg.body) : [],
  };

  // unauth help claim about name
  const unauth = await j("POST", "/v1/parse", { body: { prompt: "hi" } });
  out.unauth_help = unauth.body?._help;

  for (const tier of ["solo", "pro", "team"] as const) {
    const r = await j("POST", "/v1/billing/signup-checkout", { body: { tier } });
    out[`signup_${tier}`] = {
      status: r.status,
      has_url: /checkout\.stripe\.com/i.test(r.text || ""),
      detail: r.body?.detail || r.body?.title || r.body?.code,
      keys: r.body ? Object.keys(r.body) : [],
      mints_key: !!(r.body?.api_key || r.body?.key),
    };
  }

  if (freeKey) {
    const bc = await j("POST", "/v1/billing/checkout", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { tier: "solo" },
    });
    out.bearer_checkout = {
      status: bc.status,
      has_url: /checkout\.stripe\.com/i.test(bc.text || ""),
      detail: bc.body?.detail || bc.body?.title || bc.body?.code,
      keys: bc.body ? Object.keys(bc.body) : [],
    };

    const p = await j("POST", "/v1/parse", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { prompt: "What is the capital of France?" },
    });
    out.parse_benign = {
      status: p.status,
      risk: p.body?.risk_score ?? p.body?.riskScore,
      action: p.body?.suggested_action ?? p.body?.action,
      safe: p.body?.safe,
      mode: p.body?.mode,
      has_determinism: !!p.body?.determinism,
      layers: p.body?.layers ? Object.keys(p.body.layers) : p.body?.layer ? [p.body.layer] : null,
      degraded: p.body?.degraded,
      llm_failed: p.body?.llm_failed || p.body?.layers?.semantic?.error || p.body?.layers?.llm?.error,
      flag_ids: (p.body?.flags || []).map((f: any) => f.id || f.type || f.category).slice(0, 8),
      top_keys: p.body ? Object.keys(p.body).slice(0, 25) : [],
    };

    const p2 = await j("POST", "/v1/parse", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { prompt: "export OPENAI_API_KEY=sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij" },
    });
    out.parse_secret = {
      status: p2.status,
      risk: p2.body?.risk_score ?? p2.body?.riskScore,
      action: p2.body?.suggested_action ?? p2.body?.action,
      safe: p2.body?.safe,
      mode: p2.body?.mode,
      flag_ids: (p2.body?.flags || []).map((f: any) => f.id || f.type || f.category).slice(0, 10),
      has_determinism: !!p2.body?.determinism,
    };

    // screen-output secret
    const so = await j("POST", "/v1/screen-output", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { output: "Here is the key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij" },
    });
    out.screen_output_secret = {
      status: so.status,
      risk: so.body?.risk_score ?? so.body?.riskScore,
      action: so.body?.suggested_action ?? so.body?.action,
      safe: so.body?.safe,
      mode: so.body?.mode,
      has_determinism: !!so.body?.determinism,
      degraded: so.body?.degraded,
      flag_ids: (so.body?.flags || []).map((f: any) => f.id || f.type || f.category).slice(0, 10),
      detail: so.body?.detail || so.body?.code,
      top_keys: so.body ? Object.keys(so.body).slice(0, 20) : [],
    };

    const act = await j("GET", "/v1/activity", { headers: { Authorization: `Bearer ${freeKey}` } });
    out.activity = {
      status: act.status,
      status_field: act.body?.status,
      detail: act.body?.detail || act.body?.title,
      keys: act.body ? Object.keys(act.body) : [],
    };

    const us = await j("GET", "/v1/billing/usage", { headers: { Authorization: `Bearer ${freeKey}` } });
    out.usage = { status: us.status, body: us.body };

    const ch = await j("POST", "/v1/chat", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { messages: [{ role: "user", content: "hi" }] },
    });
    out.chat = { status: ch.status, code: ch.body?.code, detail: ch.body?.detail || ch.body?.title };

    // analyze scope
    const an = await j("POST", "/v1/analyze", {
      headers: { Authorization: `Bearer ${freeKey}` },
      body: { content: "The sky is blue.", url: "https://example.com" },
    });
    out.analyze = {
      status: an.status,
      keys: an.body ? Object.keys(an.body).slice(0, 15) : [],
      id: !!an.body?.id,
      poll_url: an.body?.poll_url || an.body?.status_url,
      detail: an.body?.detail || an.body?.code,
    };
    if (an.body?.id || an.body?.poll_url) {
      const pollPath = (an.body.poll_url || `/v1/analyze/${an.body.id}`).replace(BASE, "");
      const polled = await j("GET", pollPath.startsWith("http") ? new URL(pollPath).pathname : pollPath, {
        headers: { Authorization: `Bearer ${freeKey}` },
      });
      out.analyze_poll = { status: polled.status, keys: polled.body ? Object.keys(polled.body).slice(0, 12) : [], detail: polled.body?.detail };
    }

    const cov = await j("GET", "/v1/coverage", { headers: { Authorization: `Bearer ${freeKey}` } });
    out.coverage = {
      status: cov.status,
      org_id: cov.body?.org_id || cov.body?.orgId,
      coverage_pct: cov.body?.coverage_pct,
      keys: cov.body ? Object.keys(cov.body).slice(0, 15) : [],
      detail: cov.body?.detail,
    };

    const por = await j("POST", "/v1/billing/portal", {
      headers: { Authorization: `Bearer ${freeKey}`, Accept: "application/json" },
      body: {},
    });
    out.portal = {
      status: por.status,
      ct: por.ct,
      is_html: /text\/html/i.test(por.ct || "") || /<\s*html/i.test(por.text || ""),
      detail: por.body?.detail || por.body?.title,
      has_url: /billing\.stripe\.com|checkout\.stripe/i.test(por.text || ""),
    };

    // policy get/put hold
    const pol = await j("GET", "/v1/policy", { headers: { Authorization: `Bearer ${freeKey}` } });
    out.policy_get = { status: pol.status, body: pol.body };

    // approvals list?
    const ap = await j("GET", "/v1/approvals", { headers: { Authorization: `Bearer ${freeKey}` } });
    out.approvals_get = { status: ap.status, detail: ap.body?.detail || ap.body?.title, code: ap.body?.code };

    // revoke probe key via admin if we can resolve by prefix
    const prefix = typeof freeKey === "string" ? freeKey.slice(0, 12) : null;
    out.probe_prefix = prefix;
  }

  // OpenAPI
  const oa = await j("GET", "/openapi.json");
  const paths = Object.keys(oa.body?.paths || {});
  out.openapi = {
    billing: paths.filter((p) => /bill|checkout|price|portal|signup|approv/i.test(p)),
    analyze_get: paths.filter((p) => /analyze|evaluate/i.test(p)),
    stripe: /stripe/i.test(JSON.stringify(oa.body || {})),
    solo: /\"solo\"/i.test(JSON.stringify(oa.body || {})),
  };

  // MCP auth error + pricing already known
  const mcpAuth = await j("POST", "/mcp", {
    headers: { accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "screen_prompt", arguments: { prompt: "hi" } } },
  });
  out.mcp_auth_error = mcpAuth.body?.error || mcpAuth.body;

  // status page html/json
  const st = await j("GET", "/status");
  out.status_page = { status: st.status, ct: st.ct, snippet: (st.text || "").replace(/\s+/g, " ").slice(0, 300) };

  // proposal coverage search
  let all: any[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 400) {
    const page = await admin("admin.improvement_proposal.list", { limit: 100, offset });
    const rows = page.body.improvement_proposals || [];
    total = page.body.total ?? rows.length;
    if (!rows.length) break;
    all = all.concat(rows);
    offset += rows.length;
    if (rows.length < 100) break;
  }
  const statuses: Record<string, number> = {};
  for (const p of all) statuses[p.status] = (statuses[p.status] || 0) + 1;
  out.proposals = { total: all.length, statuses };

  const needles = [
    "name is required",
    "name optional",
    "name-optional",
    "string (optional)",
    "hold-for-approval",
    "hold_for_approval",
    "agent commerce",
    "x402 only",
    "signup-checkout",
    "activity stays never",
    "activity status=never",
    "sk-proj",
    "screen-output omits determinism",
    "portal returns HTTP 200 HTML",
    "claude code",
    "SKILL.md",
    "rolledExpiryFor",
    "autoBlockThreshold",
    "monitor/warn",
    "safe:true",
    "coverage returns org_id",
    "analyze/{id}",
    "get_pricing",
    "billing/checkout",
    "free scopes",
    "analyze,evaluate",
    "draft concession",
    "owner-override",
    "unpushed commits",
    "runtime:source",
    "control-loop",
    "batch-defer",
    "402/429 paywalls",
    "upgradeUrl",
    "machine checkout",
    "approvals paths",
    "policy.hold",
  ];
  function blob(p: any) {
    return `${p.title || ""} ${p.idempotencyKey || p.idempotency_key || ""} ${JSON.stringify(p.evidence || {})}`.toLowerCase();
  }
  out.coverage_hits = {};
  for (const n of needles) {
    out.coverage_hits[n] = all.filter((p) => blob(p).includes(n.toLowerCase())).map((p) => ({
      id: p.id,
      status: p.status,
      title: (p.title || "").slice(0, 100),
    })).slice(0, 3);
  }

  // revoke the probe key if created
  if (freeKey && typeof freeKey === "string") {
    // try list keys and revoke by matching recent name prefix elon-saas-loop-ro
    try {
      const list = await admin("admin.api_key.list", { limit: 20, q: "elon-saas-loop-ro" });
      out.key_list_for_revoke = {
        status: list.status,
        total: list.body?.total,
        names: (list.body?.api_keys || list.body?.keys || []).slice(0, 5).map((k: any) => k.name),
      };
      const match = (list.body?.api_keys || list.body?.keys || []).find((k: any) =>
        String(k.name || "").startsWith("elon-saas-loop-ro")
      );
      if (match?.id) {
        const rev = await admin("admin.api_key.revoke", { id: match.id, reason: "hourly saas loop probe cleanup" });
        out.revoked = { id: match.id, status: rev.status, ok: !rev.body?.error };
      }
    } catch (e: any) {
      out.revoke_error = String(e).slice(0, 200);
    }
  }

  writeFileSync("/tmp/saas_live_probe_out.json", JSON.stringify(out, null, 2));
  console.log("WROTE /tmp/saas_live_probe_out.json");
  // print compact summary without secrets
  const summary = { ...out };
  delete summary.unauth_help; // may be large
  console.log(JSON.stringify(summary, null, 2).slice(0, 14000));
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
