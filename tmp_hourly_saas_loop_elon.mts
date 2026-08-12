import "dotenv/config";
import { app } from "./src/app.ts";

const key = process.env.MASTER_API_KEY || process.env.PARSE_ADMIN_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_key" }));
  process.exit(2);
}

async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request("/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
  if (depth > 8) return "[depth]";
  if (Array.isArray(o)) return o.slice(0, 40).map((x) => scrub(x, depth + 1));
  if (o && typeof o === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      if (
        (lk.includes("secret") ||
          lk.includes("token") ||
          lk === "authorization" ||
          lk === "key" ||
          (lk.endsWith("_key") && typeof v === "string" && (v as string).length > 12) ||
          lk.includes("api_key") && typeof v === "string") &&
        typeof v === "string"
      ) {
        out[k] = `[redacted len=${(v as string).length}]`;
        continue;
      }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return o;
}

function walkProps(o: any, acc: any[] = []) {
  if (!o) return acc;
  if (Array.isArray(o)) {
    for (const i of o) walkProps(i, acc);
    return acc;
  }
  if (typeof o === "object") {
    if (o.id && o.title && (o.status || o.idempotency_key || o.idempotencyKey)) acc.push(o);
    for (const v of Object.values(o)) walkProps(v, acc);
  }
  return acc;
}

async function main() {
  const out: any = { has_master: true, path: "local_app_request" };

  const list = await act("admin.improvement_proposal.list", { limit: 50 });
  out.list_status = list.status;
  out.list_error = list.body?.error || list.body?.title || list.body?.detail || null;
  const props = (list.body?.improvement_proposals || list.body?.result?.improvement_proposals || []) as any[];
  const extracted = props.length ? props : walkProps(list.body);
  const byId = new Map(extracted.map((p: any) => [p.id, p]));
  const compact = [...byId.values()]
    .map((p: any) => ({
      id: p.id,
      status: p.status,
      priority: p.priority,
      category: p.category,
      risk: p.risk_level || p.riskLevel,
      source: p.source,
      key: p.idempotency_key || p.idempotencyKey,
      title: String(p.title || "").slice(0, 220),
      created: p.created_at || p.createdAt,
    }))
    .sort((a: any, b: any) => String(b.created || "").localeCompare(String(a.created || "")));
  const statuses: Record<string, number> = {};
  for (const p of compact) statuses[String(p.status)] = (statuses[String(p.status)] || 0) + 1;
  out.list_total = list.body?.total ?? list.body?.result?.total ?? compact.length;
  out.extracted = compact.length;
  out.statuses = statuses;
  out.openish = compact.filter((p: any) =>
    ["proposed", "approved", "revision_requested", "deferred", "open"].includes(String(p.status))
  );
  out.all = compact;

  const snap = await act("admin.dashboard.snapshot", { limit: 10 });
  out.snapshot_status = snap.status;
  out.snapshot = scrub(snap.body);

  const bill = await act("admin.billing.anomaly.scan", {});
  out.billing_status = bill.status;
  out.billing = scrub(bill.body);

  const sup = await act("admin.support.ticket.list", { status: "open", limit: 20 });
  out.support_status = sup.status;
  out.support = scrub(sup.body);

  for (const [action, label] of [
    ["admin.subscription.list", "subs"],
    ["admin.payment.list", "payments"],
    ["admin.entitlement.list", "ents"],
    ["admin.geo.metrics.read", "geo"],
    ["admin.summary.read", "summary"],
    ["admin.api_key.list", "apikeys"],
    ["admin.screening_event.list", "screening"],
  ] as const) {
    const r = await act(action, { limit: 20 });
    out[`${label}_status`] = r.status;
    out[label] = scrub(r.body);
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String(e?.stack || e) }));
  process.exit(1);
});
