import { readFileSync, existsSync } from "node:fs";

function loadEnvKey(): string {
  const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
  for (const line of env.split(/\n/)) {
    if (line.startsWith("MASTER_API_KEY=")) {
      return line.slice("MASTER_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
  throw new Error("no_master");
}

const key = loadEnvKey();

async function actProd(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json().catch(() => ({ parse_error: true }));
  return { status: res.status, body };
}

function scrub(o: any, depth = 0): any {
  if (depth > 6) return "[depth]";
  if (Array.isArray(o)) return o.slice(0, 60).map((x) => scrub(x, depth + 1));
  if (o && typeof o === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(o)) {
      const lk = k.toLowerCase();
      if (
        typeof v === "string" &&
        (lk.includes("secret") ||
          lk.includes("token") ||
          lk === "key" ||
          lk.includes("api_key") ||
          (lk.endsWith("_key") && v.length > 8) ||
          lk === "authorization")
      ) {
        out[k] = `[redacted len=${v.length}]`;
        continue;
      }
      out[k] = scrub(v, depth + 1);
    }
    return out;
  }
  return o;
}

async function main() {
  const out: any = { path: "prod_https_master_env" };

  const man = await fetch("https://www.parsethis.ai/v1/admin/manifest", {
    headers: { Authorization: `Bearer ${key}` },
  });
  out.manifest_status = man.status;
  const manBody = await man.json().catch(() => ({} as any));
  const actions = manBody?.actions || manBody?.result?.actions || [];
  out.manifest_action_count = Array.isArray(actions) ? actions.length : null;
  out.manifest_err = manBody?.detail || manBody?.title || null;
  if (Array.isArray(actions)) {
    out.has_proposal_create = actions.some((a: any) => a?.name === "admin.improvement_proposal.create");
  }

  const list = await actProd("admin.improvement_proposal.list", { limit: 50 });
  out.list_status = list.status;
  out.list_err = list.body?.error || list.body?.title || list.body?.detail || null;
  const props = (list.body?.improvement_proposals ||
    list.body?.result?.improvement_proposals ||
    []) as any[];
  const compact = props.map((p: any) => ({
    id: p.id,
    status: p.status,
    priority: p.priority,
    category: p.category,
    risk: p.risk_level || p.riskLevel,
    source: p.source,
    key: p.idempotency_key || p.idempotencyKey,
    title: String(p.title || "").slice(0, 200),
    created: p.created_at || p.createdAt,
  }));
  out.total = list.body?.total ?? list.body?.result?.total ?? compact.length;
  out.statuses = compact.reduce((a: any, p: any) => {
    a[p.status] = (a[p.status] || 0) + 1;
    return a;
  }, {} as Record<string, number>);
  out.openish = compact.filter((p: any) =>
    ["proposed", "approved", "revision_requested", "deferred", "open"].includes(String(p.status))
  );
  out.recent = compact.slice(0, 40);

  const snap = await actProd("admin.dashboard.snapshot", { limit: 10 });
  out.snapshot_status = snap.status;
  out.snapshot = scrub(snap.body);

  const bill = await actProd("admin.billing.anomaly.scan", {});
  out.billing_status = bill.status;
  out.billing = scrub(bill.body);

  const sup = await actProd("admin.support.ticket.list", { status: "open", limit: 20 });
  out.support_status = sup.status;
  out.support = scrub(sup.body);

  for (const [action, label] of [
    ["admin.subscription.list", "subs"],
    ["admin.payment.list", "payments"],
    ["admin.entitlement.list", "ents"],
    ["admin.geo.metrics.read", "geo"],
    ["admin.summary.read", "summary"],
    ["admin.api_key.list", "apikeys"],
  ] as const) {
    const r = await actProd(action, { limit: 20 });
    out[label] = { status: r.status, body: scrub(r.body) };
  }

  const canaryId = "cmspy6au90061ud1e85gpndqp";
  const revoke = await actProd("admin.api_key.revoke", {
    api_key_id: canaryId,
    reason: "hourly saas loop probe cleanup; temporary named keygen smoke key",
  });
  out.revoke = {
    status: revoke.status,
    detail: revoke.body?.detail || revoke.body?.title || revoke.body?.error || null,
    id: revoke.body?.api_key?.id || revoke.body?.result?.api_key?.id || null,
    st: revoke.body?.api_key?.status || revoke.body?.result?.api_key?.status || null,
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ fatal: String(e) }));
  process.exit(1);
});
