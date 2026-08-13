import "dotenv/config";
import { app } from "./src/app.ts";
const key = process.env.MASTER_API_KEY!;
async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request("/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return await res.json();
}
const all: any[] = [];
let offset = 0, total = 0;
while (offset < 500) {
  const body = await act("admin.improvement_proposal.list", { limit: 100, offset });
  const props = body.improvement_proposals || body.result?.improvement_proposals || [];
  total = body.total ?? body.result?.total ?? total;
  all.push(...props);
  if (!props.length || all.length >= total) break;
  offset += props.length;
}
const compact = all.map((p:any)=>({
  id:p.id, status:p.status, priority:p.priority,
  key:p.idempotency_key || p.idempotencyKey || '',
  title:String(p.title||''),
  source:p.source||'',
}));
const needles = [
  'v1/pricing','pricing enabled','payTo','not_configured','contact 404','/contact','refunds',
  'sitemap lastmod','lastmod','status page','npm exists','npm view','@parsethis/sdk',
  'docs/x402','x402 enabled false','pricing endpoint','free_tier url',
  'get-started','install parse','hero cta','billing/checkout href',
  'trust page','soc 2','soc2','hipaa','iso','gdpr claim',
  'support form','public_support','probe pollution close',
  'determinism','verdict cache','seed','temperature',
  'coverage_pct','recordAgentCall','orphan org',
  'exception-request','my-agents','tool_policy evaluated',
  'PARSE_SECRET_KEY','gateway config','siem',
  'launchd','kickstart','working directory dirty',
  'cron collector missing','business_state_context',
  'chat media analysis','wrong product',
  'rate_limit remaining','429',
  'stripe customer portal',
  'webhook',
  'bullmq','worker',
  'redis fallback',
  'keygen smoke',
  'includedRequests',
  'self-service userId',
];
const out:any = { total: compact.length };
for (const n of needles) {
  const hits = compact.filter(p => (p.key+p.title).toLowerCase().includes(n.toLowerCase()));
  out[n] = { count: hits.length, sample: hits.slice(0,4).map(h=>({status:h.status,pri:h.priority,key:h.key.slice(0,90),title:h.title.slice(0,120)})) };
}
// also list proposed P0 count
out.p0 = compact.filter(p=>p.priority>=9 && p.status==='proposed').length;
out.p10 = compact.filter(p=>p.priority>=10 && p.status==='proposed').length;
console.log(JSON.stringify(out,null,2));
