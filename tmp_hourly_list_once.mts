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
const all: any[] = [];
let offset = 0;
let total = 0;
while (offset < 500) {
  const list = await act("admin.improvement_proposal.list", { limit: 100, offset });
  const props = list.body?.improvement_proposals || list.body?.result?.improvement_proposals || [];
  total = list.body?.total ?? list.body?.result?.total ?? total;
  all.push(...props);
  if (!props.length || all.length >= total) break;
  offset += props.length;
}
const compact = all.map((p:any)=>({
  id:p.id, status:p.status, priority:p.priority, category:p.category,
  key:p.idempotency_key || p.idempotencyKey,
  title:String(p.title||''),
  source:p.source,
  created:p.created_at||p.createdAt,
}));
const statuses: Record<string, number> = {};
for (const p of compact) statuses[String(p.status)] = (statuses[String(p.status)]||0)+1;
const needles = [
  'aup','acceptable','keys/self','get /v1/keys/self','usage truth','includedRequests','included requests',
  'meter','quota','footer','legal','determinism','acquittal','released verdict','chat persona','wrong product',
  'gateway','deploy','stale','scope','openapi','x402','portal','signup','orphan','csrf','dashboard',
  'billing usage','rate_limit','self-service','screen-output','credential','python','1010','cloudflare',
  'homepage','landing','install package','npm','skill','mcp','evaluate','false contract','messages','message',
  'governance','bootstrap','adopt','account','login','post-pay','stripe','checkout','fulfillment','redis',
  'free tier','threshold','sandbox','execute','analyze','openrouter','telemetry','screening event'
];
const search: Record<string, any> = {};
for (const n of needles) {
  const hits = compact.filter(p => (p.key||'').toLowerCase().includes(n) || (p.title||'').toLowerCase().includes(n));
  search[n] = { count: hits.length, sample: hits.slice(0,5).map(h=>({status:h.status,key:h.key,title:h.title.slice(0,140)})) };
}
const newest = [...compact].sort((a,b)=>String(b.created).localeCompare(String(a.created))).slice(0,25)
  .map(p=>({created:p.created,status:p.status,priority:p.priority,key:p.key,title:p.title.slice(0,140)}));
console.log(JSON.stringify({ total: compact.length, reported_total: total, statuses, newest, search }, null, 2));
