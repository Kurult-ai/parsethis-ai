import "dotenv/config";
import { writeFileSync, readFileSync, existsSync } from "fs";

const key = process.env.MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  // list all proposals
  let all: any[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total && offset < 500) {
    const page = await act("admin.improvement_proposal.list", { limit: 100, offset });
    const rows = page.body.improvement_proposals || [];
    total = page.body.total ?? rows.length;
    if (!rows.length) break;
    all = all.concat(rows);
    offset += rows.length;
    if (rows.length < 100) break;
  }

  const statuses: Record<string, number> = {};
  for (const p of all) statuses[p.status] = (statuses[p.status] || 0) + 1;

  const kws = [
    "name optional",
    "name is required",
    "name-optional",
    "401 _help",
    "cloudflare",
    "1010",
    "browser signature",
    "user-agent",
    "tls fingerprint",
    "bot fight",
    "waf",
    "rate limit: max 5",
    "5 signups",
    "signup per minute",
    "signup-checkout",
    "x402 only",
    "agent-facing commerce",
    "commerce surface",
    "ua-probe",
    "self-service smoke",
    "canary keys",
    "keygen name-gate",
  ];
  function blob(p: any) {
    return `${p.title || ""} ${p.idempotencyKey || p.idempotency_key || ""} ${p.taskTitle || p.task_title || ""} ${JSON.stringify(p.evidence || {})}`.toLowerCase();
  }
  const matches = all
    .map((p) => ({
      id: p.id,
      status: p.status,
      title: (p.title || "").slice(0, 140),
      key: (p.idempotencyKey || p.idempotency_key || "").slice(0, 90),
      hits: kws.filter((k) => blob(p).includes(k.toLowerCase())),
      priority: p.priority,
      created: p.createdAt || p.created_at,
    }))
    .filter((x) => x.hits.length);

  // snapshot active key names for synthetic pollution
  const snap = await act("admin.dashboard.snapshot", {});
  const keys = snap.body.api_keys || [];
  const active = keys.filter((k: any) => !k.revoked_at && !k.revokedAt);
  const nameCounts: Record<string, number> = {};
  for (const k of active) {
    const n = (k.name || "").toLowerCase();
    const bucket = /canary|probe|hourly|saas-loop|smoke|ua-probe|do-not-keep|test|ignore/.test(n)
      ? "syntheticish"
      : "other";
    nameCounts[bucket] = (nameCounts[bucket] || 0) + 1;
  }

  // content analysis from saved curl bodies if present
  function fileText(p: string) {
    return existsSync(p) ? readFileSync(p, "utf8") : "";
  }
  const pricing = fileText("/tmp/p_pricing.json");
  const llms = fileText("/tmp/p_llms.txt");
  const getstarted = fileText("/tmp/p_getstarted.html");
  const openapi = fileText("/tmp/p_openapi.json");
  const signup = fileText("/tmp/p_signup_solo.json");
  const parseUnauth = fileText("/tmp/p_parse_unauth.json");
  const keygenEmpty = fileText("/tmp/p_keygen_empty.json");

  function flags(s: string) {
    const low = s.toLowerCase();
    return {
      len: s.length,
      stripe: low.includes("stripe"),
      signup_checkout: low.includes("signup-checkout"),
      billing_checkout: low.includes("/v1/billing/checkout") || low.includes("billing/checkout"),
      x402: low.includes("x402"),
      solo: low.includes("solo"),
      generate_key: low.includes("keys/generate") || low.includes("generate_key"),
      name_optional: /name[^\n]{0,40}optional/i.test(s) || low.includes('"name":"string (optional)"') || low.includes("name (optional)"),
    };
  }

  let openapiPaths: string[] = [];
  try {
    openapiPaths = Object.keys(JSON.parse(openapi).paths || {});
  } catch {}

  const out = {
    total_proposals: total,
    returned: all.length,
    statuses,
    match_count: matches.length,
    matches: matches.slice(0, 60),
    recent: all
      .slice()
      .sort((a, b) => String(b.createdAt || b.created_at || "").localeCompare(String(a.createdAt || a.created_at || "")))
      .slice(0, 12)
      .map((p) => ({
        id: p.id,
        status: p.status,
        title: (p.title || "").slice(0, 130),
        key: (p.idempotencyKey || p.idempotency_key || "").slice(0, 80),
      })),
    active_keys_in_snapshot: active.length,
    nameCounts,
    content: {
      pricing: flags(pricing),
      llms: flags(llms),
      getstarted: flags(getstarted),
      openapi: { ...flags(openapi), path_count: openapiPaths.length, billing_paths: openapiPaths.filter((p) => p.includes("billing") || p.includes("checkout") || p.includes("keys")) },
      signup_solo_body: signup.slice(0, 200),
      parse_unauth: flags(parseUnauth),
      parse_unauth_snip: parseUnauth.slice(0, 400),
      keygen_empty_snip: keygenEmpty.slice(0, 300),
      keygen_empty_flags: flags(keygenEmpty),
    },
  };
  writeFileSync("/tmp/saas_proposal_scan.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 500));
  process.exit(1);
});
