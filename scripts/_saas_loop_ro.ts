import fs from "fs";
import { app } from "../src/app.ts";

const key = JSON.parse(fs.readFileSync("/Users/kublai/.hermes/secrets/parse-kublai-admin-key.json", "utf8")).key;

async function localAct(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request("/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { status: res.status, body };
}

async function prodAct(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  return { status: res.status, body };
}

function scrub(v: any, depth = 0): any {
  if (depth > 10) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 40).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|authorization|password/i.test(k) && typeof val === "string") {
        o[k] = (val as string).length > 8 ? (val as string).slice(0, 4) + "…" + `len=${(val as string).length}` : "[redacted]";
      } else o[k] = scrub(val, depth + 1);
    }
    return o;
  }
  if (typeof v === "string" && v.startsWith("pfa_") && v.length > 20) return v.slice(0, 4) + "…";
  return v;
}

const actions: Array<[string, string, Record<string, unknown>]> = [
  ["snapshot", "admin.dashboard.snapshot", {}],
  ["proposals", "admin.improvement_proposal.list", { limit: 40, offset: 0 }],
  ["billing", "admin.billing.anomaly.scan", {}],
  ["subs", "admin.subscription.list", { limit: 20 }],
  ["payments", "admin.payment.list", { limit: 10 }],
  ["tickets", "admin.support.ticket.list", { limit: 20 }],
  ["geo", "admin.geo.metrics.read", {}],
  ["screen", "admin.screening_event.list", { limit: 8 }],
  ["ents", "admin.entitlement.list", { limit: 20 }],
];

const out: any = { local: {}, prod: {} };
for (const [name, action, params] of actions) {
  try { out.local[name] = await localAct(action, params); }
  catch (e) { out.local[name] = { error: String(e).slice(0, 400) }; }
  try { out.prod[name] = await prodAct(action, params); }
  catch (e) { out.prod[name] = { error: String(e).slice(0, 400) }; }
}
console.log(JSON.stringify(scrub(out), null, 2));
