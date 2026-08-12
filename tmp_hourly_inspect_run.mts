import { readFileSync } from "node:fs";

function loadEnv() {
  const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  for (const line of env.split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = loadEnv();
const key = env.MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(2);
}

async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, params }),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = { parse_error: true };
  }
  return { status: res.status, body };
}

function scrub(o: any, depth = 0): any {
  if (depth > 7) return "[depth]";
  if (Array.isArray(o)) return o.slice(0, 80).map((x) => scrub(x, depth + 1));
  if (o && typeof o === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      if (
        typeof v === "string" &&
        (lk.includes("secret") ||
          lk.includes("token") ||
          lk === "key" ||
          lk.includes("api_key") ||
          lk === "authorization" ||
          (lk.endsWith("_key") && v.length > 8) ||
          /^pfa_live_/.test(v) ||
          /^sk_/.test(v))
      ) {
        out[k] = `[redacted len=${v.length}]`;
        continue;
      }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return o;
}

async function main() {
  const out: any = { path: "prod_https_master_env" };

  const man = await fetch("https://www.parsethis.ai/v1/admin/manifest", {
    headers: { Authorization: `Bearer ${key}` },
  });
  out.manifest_status = man.status;
  const manBody: any = await man.json().catch(() => ({}));
  const actions = manBody?.actions || manBody?.result?.actions || [];
  out.manifest_action_count = Array.isArray(actions) ? actions.length : null;
  out.has_proposal_create = Array.isArray(actions)
    ? actions.some((a: any) => (a.name || a) === "admin.improvement_proposal.create")
    : null;

  for (const [label, action, params] of [
    ["snap", "admin.dashboard.snapshot", {}],
    ["props", "admin.improvement_proposal.list", { limit: 50 }],
    ["anom", "admin.billing.anomaly.scan", {}],
    ["subs", "admin.subscription.list", { limit: 20 }],
    ["tickets", "admin.support.ticket.list", { limit: 20 }],
    ["geo", "admin.geo.metrics.read", {}],
    ["screen", "admin.screening_event.list", { limit: 15 }],
    ["ents", "admin.entitlement.list", { limit: 20 }],
    ["keys", "admin.api_key.list", { limit: 30 }],
    ["evals", "admin.evaluation.list", { limit: 10 }],
  ] as const) {
    const r = await act(action, params as any);
    out[`${label}_status`] = r.status;
    out[label] = scrub(r.body);
  }

  // try revoke canary keys by name if list exposes ids
  const keyBody = out.keys;
  const arr =
    keyBody?.result?.keys ||
    keyBody?.keys ||
    keyBody?.result?.items ||
    keyBody?.result ||
    [];
  const canaries = Array.isArray(arr)
    ? arr.filter((k: any) => String(k?.name || "").includes("hourly-saas-canary"))
    : [];
  out.canary_matches = canaries.map((k: any) => ({
    id: k.id,
    name: k.name,
    revoked: k.revoked || k.status,
    prefix: k.prefix || k.key_prefix,
  }));
  for (const c of canaries) {
    if (c.id) {
      const rev = await act("admin.api_key.revoke", {
        id: c.id,
        reason: "hourly saas loop canary cleanup",
      });
      out[`revoke_${c.id}`] = { status: rev.status, body: scrub(rev.body) };
    }
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
