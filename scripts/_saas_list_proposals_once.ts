import { config } from "dotenv";
import { writeFileSync } from "fs";
config({ path: ".env" });
const master = process.env.MASTER_API_KEY!;
async function admin(action: string, params: any = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}
function scrub(v: any, d = 0): any {
  if (d > 10) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|password|authorization/i.test(k) && typeof val === "string") {
        const s = val as string;
        o[k] = s.length > 8 ? s.slice(0, 4) + "…len=" + s.length : "[redacted]";
      } else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  return v;
}
async function main() {
  const all: any[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await admin("admin.improvement_proposal.list", { limit: 100, offset });
    // response may be unwrapped already
    const root = r.body?.result ?? r.body;
    const items = root?.improvement_proposals || root?.items || root?.proposals || [];
    const arr = Array.isArray(items) ? items : [];
    console.log("page", offset, "status", r.status, "n", arr.length, "total", root?.total, "top", Object.keys(r.body||{}));
    if (!arr.length) break;
    all.push(...arr);
    if (arr.length < 100) break;
  }
  writeFileSync("/tmp/saas_proposals_all_clean.json", JSON.stringify(scrub(all), null, 2));
  const byStatus: any = {};
  for (const p of all) byStatus[p.status||"unknown"] = (byStatus[p.status||"unknown"]||0)+1;
  console.log("TOTAL", all.length, byStatus);
  const closed = new Set(["rejected","done","implemented","completed","closed","shipped"]);
  const open = all.filter(p => !closed.has(String(p.status||"").toLowerCase()));
  open.sort((a,b) => (b.priority||0)-(a.priority||0));
  console.log("OPEN", open.length);
  for (const p of open) {
    console.log([p.priority, p.status, p.category, p.id, p.idempotency_key||"", String(p.title||"").slice(0,140)].join("\t"));
  }
}
main().catch(e=>{console.error(e); process.exit(1);});
