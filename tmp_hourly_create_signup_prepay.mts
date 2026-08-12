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
  if (Array.isArray(o)) return o.slice(0, 50).map((x) => scrub(x, depth + 1));
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
          (lk.endsWith("_key") && v.length > 12 && !lk.includes("idempotency")) ||
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
  const idem = "elon-signup-checkout-mints-free-key-before-payment-2026-08-12";
  const list = await act("admin.improvement_proposal.list", { limit: 200 });
  const props = (list.body?.improvement_proposals ||
    list.body?.result?.improvement_proposals ||
    []) as any[];
  const exact = props.find((p) => (p.idempotency_key || p.idempotencyKey) === idem);
  const semantic = props.filter((p) => {
    const blob = `${p.title} ${p.idempotency_key || ""}`.toLowerCase();
    return (
      blob.includes("before payment") ||
      blob.includes("before stripe") ||
      blob.includes("mints a live free") ||
      blob.includes("free-key abandon") ||
      blob.includes("mints-free-key-before-payment") ||
      (blob.includes("abandon") && blob.includes("checkout") && blob.includes("key"))
    );
  });

  if (exact || semantic.length) {
    console.log(
      JSON.stringify(
        scrub({
          action: "deduped",
          list_status: list.status,
          total: list.body?.total ?? props.length,
          exact: exact
            ? { id: exact.id, status: exact.status, key: exact.idempotency_key, title: exact.title }
            : null,
          semantic: semantic.map((p) => ({
            id: p.id,
            status: p.status,
            key: p.idempotency_key,
            title: p.title,
          })),
        }),
        null,
        2,
      ),
    );
    return;
  }

  const create = await act("admin.improvement_proposal.create", {
    idempotency_key: idem,
    title:
      "P0 REVENUE/INTEGRITY: signup-checkout mints a live free API key before Stripe payment — abandoned checkouts get free prod access and burn the self-service cap",
    category: "revenue",
    priority: 10,
    risk_level: "medium",
    source: "elon_hourly_saas_improvement_loop",
    evidence: {
      observed_at: new Date().toISOString(),
      production_commit: "72a3bd8",
      probes: [
        {
          name: "POST /v1/billing/signup-checkout tier=pro",
          http_status: 201,
          response_fields: ["key", "id", "expires_at", "checkout_url"],
          note: "Full plaintext API key returned before any Stripe payment succeeds",
        },
        {
          name: "pre-payment bearer GET /v1/billing/usage",
          http_status: 200,
          tier: "free",
          subscription: null,
          includedRequests: 0,
        },
        {
          name: "pre-payment bearer POST /v1/parse",
          http_status: 200,
          verdict: "safe",
          note: "Key is fully usable production free-tier access with no payment",
        },
        {
          name: "pricing Start Pro/Team/Solo JS",
          behavior: "on success localStorage.setItem('pfa_key', d2.key) then redirect checkout_url",
        },
      ],
      code_path: {
        file: "src/routes/billing.ts",
        behavior:
          "createApiKey(...) then createCheckoutSession(...); returns key in 201 body. Only revokes key if checkout session creation throws — not if customer abandons Stripe.",
        related_cap: "countSelfServiceKeys() >= 100 blocks further paid signups",
      },
      business_impact:
        "Every cold paid CTA click can mint a working free key. Abandon Stripe => free access until idle expiry. Also consumes the 100 self-service key hardcap that already gates revenue.",
      not_duplicate_of: [
        "signup-checkout 500s (checkout now returns 201)",
        "hardcap 100 counting issues",
        "account Create Key userId=self-service orphan identity",
      ],
    },
    impact:
      "Stops unpaid free-key leakage on the paid funnel and protects the self-service key cap so real buyers can still convert.",
    acceptance_criteria: [
      "Cold POST /v1/billing/signup-checkout does NOT return a usable long-lived API key before payment is confirmed (no plaintext key, or key is payment-gated/unusable until checkout.session.completed)",
      "Abandoned Stripe checkout leaves zero active free keys that can call /v1/parse successfully",
      "Pricing Start Solo/Pro/Team still reaches a live Stripe Checkout URL for cold visitors",
      "Webhook fulfillment still attaches the paid tier to the correct key after payment",
      "Self-service key cap is not incremented by abandoned checkout attempts (or abandoned keys are auto-revoked on session expiry)",
      "Regression test covers: signup-checkout response shape, pre-payment key unusable or absent, post-payment key upgraded, abandon path cleanup",
      "No secrets printed in logs; no security/legal policy changes in this task",
    ],
    task_title: "Gate signup-checkout key mint until Stripe payment (kill free-key abandon leak)",
    task_body: `## Goal
Paid CTA cold path must not mint usable free production API keys before Stripe payment succeeds.

## Evidence (prod commit 72a3bd8, 2026-08-12)
- POST /v1/billing/signup-checkout {tier:pro} -> 201 with fields key,id,expires_at,checkout_url
- That key immediately: GET /v1/billing/usage tier=free subscription=null; POST /v1/parse 200
- src/routes/billing.ts creates API key before createCheckoutSession; revokes only if session create throws
- pricing.ts stores d2.key into localStorage before redirecting to Stripe

## Implementation direction (choose simplest that passes acceptance)
1. Preferred: create Stripe checkout first with client_reference_id / metadata only; mint or activate key in checkout.session.completed webhook.
2. Or: mint key in disabled/pending state that authMiddleware rejects until paid.
3. Or: return checkout_url only; complete key delivery on success URL after session verified paid.
4. Must auto-cleanup abandoned sessions (Stripe session expired webhook or TTL revoke).

## Safety gates
- Do NOT implement/deploy from this proposal alone — admin Create implementation task only
- No live refunds/cancellations/price changes
- No secret rotation, no security-policy global changes, no customer emails
- Keep Stripe as payment source of truth
- Add tests before ship; verify on www.parsethis.ai /version commit after deploy
- Revoke leftover hourly probe keys after verification

## Owner
task_assignee: triage
`,
    task_assignee: "triage",
  });

  // cleanup probe keys by name prefix via list+revoke if actions exist
  const keysList = await act("admin.api_key.list", { limit: 50 });
  const apiKeys = (keysList.body?.api_keys || keysList.body?.result?.api_keys || []) as any[];
  const probeNames = [
    "elon-hourly-evidence-12",
    "elon-hourly-evidence-13",
    "saas-loop-canary",
    "Signup Key 2026-08-12",
  ];
  const revoked: any[] = [];
  for (const k of apiKeys) {
    const name = String(k.name || "");
    if (!probeNames.some((n) => name === n || name.startsWith("elon-hourly-evidence") || name.startsWith("hourly-"))) continue;
    if (k.status === "revoked" || k.revoked) continue;
    const rev = await act("admin.api_key.revoke", {
      id: k.id,
      reason: "hourly saas loop probe cleanup 2026-08-12",
    });
    revoked.push({ id: k.id, name, status: rev.status, ok: rev.status < 300 });
  }

  console.log(
    JSON.stringify(
      scrub({
        action: "created",
        list_status: list.status,
        total_before: list.body?.total ?? props.length,
        create_status: create.status,
        create: create.body,
        cleanup_revoked: revoked,
      }),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ error: String(e?.stack || e) }));
  process.exit(1);
});
