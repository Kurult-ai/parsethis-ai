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
const key = loadEnv().MASTER_API_KEY!;
async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const ids = [
  "cmsqkqhrg004if91elo2d61cl", // hourly-saas-canary
  "cmsqks5kc004vf91egb6d0nvn",
  "cmsqks6mh004wf91ecqwdybqk", // signup checkout mint
  "cmsqktuhn0052f91e6weqrh25",
  "cmsqkue9c0053f91e612uh1xl",
  "cmsqkvv2i005tf91ersua06zf",
  "cmsqkwgkp005xf91e62cseiou",
];
const out: any[] = [];
for (const id of ids) {
  const r = await act("admin.api_key.revoke", { id, reason: "hourly saas loop probe cleanup" });
  out.push({ id, status: r.status, err: (r.body as any)?.error || (r.body as any)?.detail || (r.body as any)?.title || (r.body as any)?.result?.status || "ok" });
}
// also try list with different shape
const list = await act("admin.api_key.list", { limit: 20 });
const body = list.body as any;
const keys = body?.result?.keys || body?.keys || body?.result || [];
const activeProbes = (Array.isArray(keys) ? keys : []).filter((k: any) => /hourly|probe|canary|Signup Key 2026-08-12/i.test(String(k?.name||"")) && !k.revoked_at && k.status !== 'revoked').slice(0, 20);
for (const k of activeProbes) {
  if (ids.includes(k.id)) continue;
  const r = await act("admin.api_key.revoke", { id: k.id, reason: "hourly saas loop probe cleanup" });
  out.push({ id: k.id, name: k.name, status: r.status });
}
console.log(JSON.stringify({ revoke_results: out, list_status: list.status, active_probe_names: activeProbes.map((k:any)=>({id:k.id,name:k.name,status:k.status})) }, null, 2));
