import "dotenv/config";
import { writeFileSync } from "fs";
import { app } from "../src/app.ts";

const key = process.env.MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

async function act(target: "local" | "prod", action: string, params: Record<string, unknown> = {}) {
  if (target === "local") {
    const res = await app.request("/v1/admin/actions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
    return { status: res.status, body };
  }
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 400) }; }
  return { status: res.status, body };
}

function scrub(v: any, depth = 0): any {
  if (depth > 8) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 80).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|authorization|password|connectionString/i.test(k) && typeof val === "string") {
        o[k] = (val as string).length > 8 ? `${(val as string).slice(0, 4)}…len=${(val as string).length}` : "[redacted]";
      } else o[k] = scrub(val, depth + 1);
    }
    return o;
  }
  if (typeof v === "string" && v.startsWith("pfa_") && v.length > 12) return v.slice(0, 6) + "…";
  return v;
}

async function main() {
  const actions: Array<[string, string, Record<string, unknown>]> = [
    ["snapshot", "admin.dashboard.snapshot", {}],
    ["proposals", "admin.improvement_proposal.list", { limit: 50, offset: 0 }],
    ["billing", "admin.billing.anomaly.scan", {}],
    ["subs", "admin.subscription.list", { limit: 20 }],
    ["payments", "admin.payment.list", { limit: 10 }],
    ["tickets", "admin.support.ticket.list", { limit: 20 }],
    ["geo", "admin.geo.metrics.read", {}],
    ["screen", "admin.screening_event.list", { limit: 10 }],
    ["ents", "admin.entitlement.list", { limit: 20 }],
    ["summary", "admin.summary.read", {}],
  ];

  const out: any = { prod: {}, local: {} };
  // Prefer prod first for decisioning
  for (const [name, action, params] of actions) {
    try { out.prod[name] = await act("prod", action, params); }
    catch (e: any) { out.prod[name] = { error: String(e).slice(0, 300) }; }
  }
  // local only snapshot + proposals if needed later
  for (const [name, action, params] of [["snapshot", "admin.dashboard.snapshot", {}], ["proposals", "admin.improvement_proposal.list", { limit: 20 }]] as any) {
    try { out.local[name] = await act("local", action, params); }
    catch (e: any) { out.local[name] = { error: String(e).slice(0, 300) }; }
  }
  const cleaned = scrub(out);
  writeFileSync("/tmp/saas_ro_master.json", JSON.stringify(cleaned, null, 2));
  console.log("WROTE /tmp/saas_ro_master.json");
  for (const side of ["prod", "local"] as const) {
    console.log("SIDE", side);
    for (const [name, val] of Object.entries(out[side])) {
      const v: any = val;
      const b = v.body;
      const keys = b && typeof b === "object" ? Object.keys(b).slice(0, 15).join(",") : typeof b;
      console.log(name, "status", v.status, "keys", keys, "code", b?.code || b?.error || b?.title || "");
    }
  }
}

main().catch((e) => { console.error("FATAL", String(e).slice(0, 400)); process.exit(1); });
