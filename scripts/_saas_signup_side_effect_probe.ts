import "dotenv/config";
import { app } from "../src/app.ts";

const master = process.env.MASTER_API_KEY!;
const BASE = "https://www.parsethis.ai";

async function admin(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/v1/admin/actions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  // snapshot active key names matching Signup before
  const before = await admin("admin.api_key.list", { limit: 50, status: "active" });
  const rows = before.body?.api_keys || before.body?.keys || [];
  const signupBefore = rows.filter((k: any) => /signup|checkout/i.test(k.name || ""));
  console.log("list_status", before.status, "rows", rows.length, "signupish", signupBefore.length);
  console.log("sample_names", rows.slice(0, 15).map((k: any) => ({ name: k.name, tier: k.tier, status: k.status, created: k.created_at || k.createdAt })));

  // cold signup-checkout solo
  const r = await fetch(`${BASE}/v1/billing/signup-checkout`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-Parse-Probe": "1" },
    body: JSON.stringify({ tier: "solo" }),
  });
  const body = await r.json();
  console.log("signup_checkout", r.status, {
    has_url: !!(body.url || body.checkout_url),
    keys: Object.keys(body),
    api_key_id: body.api_key_id || body.apiKeyId,
    key_prefix: body.key_prefix || body.keyPrefix,
    name: body.name || body.key_name,
    // never print secrets
    has_key: !!(body.key || body.api_key),
  });

  // re-list newest keys via dashboard snapshot
  const snap = await admin("admin.dashboard.snapshot", {});
  const keys = snap.body?.api_keys || [];
  console.log("newest_keys");
  for (const k of keys.slice(0, 8)) {
    console.log({
      name: k.name,
      tier: k.tier,
      status: k.status,
      created: k.created_at,
      revoked_at: k.revoked_at,
      user_id: k.user_id,
      org_id: k.org_id,
      scopes: k.scopes,
    });
  }

  // If a brand-new Signup Key appeared in last minute, note it (do not revoke without care - might be expected). Count signup keys active.
  // Use summary only.
}

main().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
