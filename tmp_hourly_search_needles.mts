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
let offset = 0;
let total = 999;
while (all.length < total && offset < 500) {
  const body = await act("admin.improvement_proposal.list", { limit: 100, offset });
  const props = body.improvement_proposals || body.result?.improvement_proposals || [];
  total = body.total ?? body.result?.total ?? all.length;
  all.push(...props);
  if (!props.length) break;
  offset += props.length;
}
const needles = [
  "get-started",
  "kurult",
  "mailto:d@",
  "email-protection",
  "pricing page cta",
  "pricing cta",
  "hard-coded mailto",
  "chat media",
  "media literacy",
  "wrong product",
  "screen-output",
  "credential leak",
  "includedRequests",
  "zero quota",
  "proposal backlog",
  "proposal hygiene",
  "stale-p0",
  "support-100pct",
  "probe pollution",
  "gateway-unreachable",
  "module-graph-stale",
  "homepage footer",
  "landing footer",
  "status footer",
  "npm package",
  "@parsethis/sdk",
  "sdk published",
  "adopt path",
  "keys/self",
  "introspection",
];
for (const n of needles) {
  const hits = all.filter((p) => ((p.idempotency_key || p.idempotencyKey || "") + " " + p.title).toLowerCase().includes(n.toLowerCase()));
  console.log(`\n${n}: ${hits.length}`);
  for (const h of hits.slice(0, 6)) {
    console.log(" ", h.status, (h.idempotency_key || h.idempotencyKey || "").slice(0, 100));
    console.log("   ", String(h.title).slice(0, 130));
  }
}
console.log("\nTOTAL", all.length);
