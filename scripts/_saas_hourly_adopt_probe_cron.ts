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
  let body: any; try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, body, text: text.slice(0, 1200), ct: res.headers.get("content-type") };
}
async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}
async function main() {
  const out: any = { observed_at: new Date().toISOString() };
  const kg = await j("POST", "/v1/keys/generate", { body: { name: `elon-adopt-${Date.now()}` } });
  const key = kg.body?.key as string;
  const auth = { Authorization: `Bearer ${key}` };

  // bootstrap help full
  const boot = await j("POST", "/v1/orgs/bootstrap", { headers: auth, body: { name: "x" } });
  out.bootstrap = { status: boot.status, body: boot.body };

  // adopt attempts
  out.adopt_noauth = await j("POST", "/account/keys/adopt", { body: { key } });
  out.adopt_bearer = await j("POST", "/account/keys/adopt", { headers: auth, body: { key } });
  out.adopt_get = await j("GET", "/account/keys/adopt");

  // agents help full
  const ag = await j("POST", "/v1/agents", { headers: auth, body: { name: "a", tools: [] } });
  out.agents = { status: ag.status, body: ag.body };

  // openapi has adopt/bootstrap?
  const oa = await j("GET", "/openapi.json");
  const paths = Object.keys(oa.body?.paths || {});
  out.oa = paths.filter(p => /org|adopt|account|agent|signup|checkout|billing/i.test(p));

  // llms mentions adopt/bootstrap/stripe
  const llms = await j("GET", "/llms.txt");
  out.llms_hits = llms.text.split(/\n/).filter((l: string) => /adopt|bootstrap|stripe|checkout|organization|Solo|billing/i.test(l)).slice(0, 30);

  // flag id contract - proposal search
  const pl = await admin("admin.improvement_proposal.list", { limit: 100, offset: 0 });
  let all = [...(pl.body?.improvement_proposals || [])];
  for (let off = 100; off < 300; off += 100) {
    const page = await admin("admin.improvement_proposal.list", { limit: 100, offset: off });
    const r = page.body?.improvement_proposals || [];
    all.push(...r);
    if (!r.length) break;
  }
  const flagHits = all.filter((p: any) => /screen-output.*flag|flag.*screen-output|flag contract|flags lack|missing id|flag id/i.test(p.title||"") || /screen-output-flag|flag-contract/i.test(p.idempotency_key||""));
  out.flag_props = flagHits.map((p: any) => ({ id: p.id, title: p.title?.slice(0,100), status: p.status }));

  // Is unpaid signup flood proposal still accurate? count signup keys last 50
  const kl = await admin("admin.api_key.list", { limit: 50, offset: 0 });
  const rows = kl.body?.api_keys || [];
  out.signup_ratio = {
    n: rows.length,
    signup: rows.filter((k: any) => /Signup Key/i.test(k.name||"")).length,
    elon: rows.filter((k: any) => /elon|probe|saas|edge|verify|adopt|org-/i.test(k.name||"")).length,
  };

  // create proposal action schema from manifest
  const man = await j("GET", "/v1/admin/manifest", { headers: { Authorization: `Bearer ${master}` } });
  const actions = man.body?.actions || man.body?.admin_actions || [];
  const create = (Array.isArray(actions) ? actions : Object.values(actions)).find((a: any) => a?.name === "admin.improvement_proposal.create" || a?.action === "admin.improvement_proposal.create");
  out.create_action = create || (man.body && Object.keys(man.body).slice(0, 20));
  out.manifest_keys = man.body ? Object.keys(man.body) : [];
  // find create in nested
  const flat: any[] = [];
  const walk = (x: any) => {
    if (!x) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === "object") {
      if (x.name && /improvement_proposal/.test(x.name)) flat.push({ name: x.name, risk: x.risk, fields: x.params || x.input || x.schema });
      Object.values(x).forEach(walk);
    }
  };
  walk(man.body);
  out.proposal_actions = flat;

  writeFileSync("/tmp/saas_hourly_adopt.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2).slice(0, 14000));
}
main().catch(e => { console.error(String(e).slice(0,400)); process.exit(1); });
