import "dotenv/config";
import { writeFileSync } from "fs";
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
async function j(method: string, path: string, opts: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(opts.headers || {}),
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      Accept: opts.accept || "*/*",
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    status: res.status,
    ct: res.headers.get("content-type"),
    body,
    text: text.slice(0, 8000),
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
  out.pages = {};
  for (const path of ["/docs", "/docs/api", "/docs/override", "/get-started"]) {
    const r = await j("GET", path, { accept: "text/html,text/markdown,*/*" });
    const t = r.text || "";
    const idx = t.toLowerCase().indexOf("override");
    out.pages[path] = {
      status: r.status,
      has_id_override: /id=["']override["']|name=["']override["']/i.test(t),
      has_hash_override: /#override/i.test(t),
      has_bypass: /bypassCodeword|bypass_codeword/i.test(t),
      has_put_policy: /PUT\s+\/v1\/policy/i.test(t),
      has_post_policy: /POST\s+\/v1\/policy(?!\/)/i.test(t),
      stripe: /stripe|billing\/checkout|signup-checkout/i.test(t),
      slice: idx >= 0 ? t.slice(Math.max(0, idx - 40), idx + 180) : "",
    };
  }

  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-deep-probe-${Date.now()}` } });
  const freeKey = kg.body?.key as string;
  const auth = { Authorization: `Bearer ${freeKey}` };
  out.keygen = { status: kg.status, id: kg.body?.id };

  const p = await j("POST", "/v1/parse", { headers: auth, body: { prompt: "hello deep budget fields" } });
  out.parse_budget_fields = {
    status: p.status,
    layers: p.body?.layers,
    analysis_method: p.body?.analysis_method,
    policy: p.body?.policy,
    top: p.body ? Object.keys(p.body).filter((k) => /budget|deep|mode|layer|upgrade|policy|determinism/i.test(k)) : [],
  };
  out.activity = (await j("GET", "/v1/activity", { headers: auth })).body;

  const put5 = await j("PUT", "/v1/policy", { headers: auth, body: { autoBlockThreshold: 5 } });
  out.put_threshold_5 = {
    status: put5.status,
    autoBlockThreshold: put5.body?.autoBlockThreshold,
    max_threshold: put5.body?.max_threshold,
    error: put5.body?.error,
  };
  out.policy_after_5 = (await j("GET", "/v1/policy", { headers: auth })).body;

  const putMon = await j("PUT", "/v1/policy", { headers: auth, body: { enforcementMode: "monitor" } });
  out.put_monitor = {
    status: putMon.status,
    mode: putMon.body?.enforcementMode,
    error: putMon.body?.error,
    detail: (putMon.body?.detail || "").toString().slice(0, 160),
  };

  // restore safer defaults if monitor stuck
  await j("PUT", "/v1/policy", { headers: auth, body: { enforcementMode: "block", autoBlockThreshold: 5 } });

  const putBy = await j("PUT", "/v1/policy", {
    headers: auth,
    body: {
      bypassCodeword: "owner-secret-codeword-test-99",
      bypassEnabled: true,
      bypassExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      bypassReason: "hourly probe",
    },
  });
  out.put_bypass = {
    status: putBy.status,
    error: putBy.body?.error || putBy.body?.code,
    detail: (putBy.body?.detail || putBy.body?.error || "").toString().slice(0, 220),
    bypassEnabled: putBy.body?.bypassEnabled,
    configured: putBy.body?.bypassCodewordConfigured,
    keys: putBy.body ? Object.keys(putBy.body).filter((k) => /bypass/i.test(k)) : [],
  };

  const postBy = await j("POST", "/v1/policy", {
    headers: auth,
    body: {
      bypassCodeword: "owner-secret-codeword-test-99",
      bypassEnabled: true,
    },
  });
  out.post_bypass = {
    status: postBy.status,
    error: postBy.body?.error || postBy.body?.code || postBy.body?.title,
    detail: (postBy.body?.detail || postBy.body?.error || postBy.body?.title || "").toString().slice(0, 220),
    keys: postBy.body ? Object.keys(postBy.body) : [],
  };

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
  const needles = [
    "docs#override",
    "enforcementMode=monitor",
    "monitor/warn",
    "safe:true",
    "bypassExpiresAt",
    "POST /v1/policy",
    "owner-override",
  ];
  function blob(p: any) {
    return `${p.title} ${p.idempotencyKey || ""} ${JSON.stringify(p.evidence || {})}`.toLowerCase();
  }
  out.related = {};
  for (const n of needles) {
    out.related[n] = all
      .filter((p) => blob(p).includes(n.toLowerCase()))
      .slice(0, 2)
      .map((p) => ({ id: p.id, status: p.status, title: (p.title || "").slice(0, 110) }));
  }

  if (kg.body?.id) {
    await j("PUT", "/v1/policy", {
      headers: auth,
      body: { bypassEnabled: false, bypassCodeword: null, enforcementMode: "block" },
    });
    out.revoked = await admin("admin.api_key.revoke", {
      id: kg.body.id,
      reason: "hourly saas loop probe cleanup",
    });
  }

  writeFileSync("/tmp/saas_live_probe5.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 16000));
}
main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
