import "dotenv/config";
import { app } from "./src/app.ts";
const key = process.env.MASTER_API_KEY;
if (!key) { console.log(JSON.stringify({error:'no_key'})); process.exit(2);} 
async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request("/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = { parse_error: true }; }
  return { status: res.status, body };
}
function scrub(o: any, depth = 0): any {
  if (depth > 6) return "[depth]";
  if (Array.isArray(o)) return o.slice(0, 30).map((x) => scrub(x, depth + 1));
  if (o && typeof o === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      if (typeof v === "string" && (lk.includes("secret") || lk.includes("token") || lk === "key" || lk.includes("api_key") || lk === "authorization" || /^pfa_live_/.test(v) || /^sk_/.test(v))) {
        out[k] = `[redacted len=${v.length}]`;
        continue;
      }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return o;
}
const out: any = {};
for (const [label, action, params] of [
  ["snap", "admin.dashboard.snapshot", {}],
  ["anom", "admin.billing.anomaly.scan", {}],
  ["subs", "admin.subscription.list", { limit: 20 }],
  ["tickets", "admin.support.ticket.list", { limit: 30 }],
  ["geo", "admin.geo.metrics.read", {}],
  ["screen", "admin.screening_event.list", { limit: 10 }],
  ["ents", "admin.entitlement.list", { limit: 20 }],
  ["pays", "admin.payment.list", { limit: 20 }],
] as const) {
  const r = await act(action, params as any);
  out[`${label}_status`] = r.status;
  out[label] = scrub(r.body);
}
const keys = await act("admin.api_key.list", { limit: 100 });
out.keys_status = keys.status;
const arr = keys.body?.keys || keys.body?.result?.keys || keys.body?.api_keys || keys.body?.result || [];
const list = Array.isArray(arr) ? arr : [];
const canaries = list.filter((k:any)=>String(k?.name||"").includes("hourly-loop-smoke") || String(k?.name||"").includes("hourly-saas-canary"));
out.canaries = canaries.map((k:any)=>({id:k.id,name:k.name,prefix:k.prefix||k.key_prefix,revoked:k.revoked||k.status||k.revokedAt}));
out.key_count_sample = list.length;
for (const c of canaries) {
  if (c.id) {
    const rev = await act("admin.api_key.revoke", { id: c.id, reason: "hourly saas loop canary cleanup" });
    out[`revoke_${c.id}`] = { status: rev.status, body: scrub(rev.body) };
  }
}
console.log(JSON.stringify(out, null, 2));
