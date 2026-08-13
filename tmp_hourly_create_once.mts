import "dotenv/config";
import { app } from "./src/app.ts";

const key = process.env.MASTER_API_KEY;
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
    body = { parse_error: true, status: res.status };
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
        typeof v === "string" &&
        (lk.includes("secret") ||
          lk.includes("token") ||
          lk === "key" ||
          lk.includes("api_key") ||
          lk === "authorization" ||
          (lk.endsWith("_key") && v.length > 12) ||
          /^pfa_live_/.test(v) ||
          /^sk_/.test(v) ||
          v.includes("cs_live_"))
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

const proposal = {
  idempotency_key: "elon-pricing-mailto-while-stripe-checkout-live-2026-08-13",
  title:
    "P0 CONVERSION: Pricing Solo/Pro/Team CTAs are hard-wired mailto:d@kurult.ai while Stripe checkout is live — paid self-serve never fires from the page humans see",
  category: "conversion_friction",
  priority: 10,
  risk_level: "low",
  source: "elon_hourly_saas_improvement_loop",
  evidence: {
    observed_at: "2026-08-13T07:20:00Z",
    production_commit: "be8ec48",
    local_main: "9e75dd7",
    business_snapshot: {
      active_subscriptions: 0,
      payments_total: 0,
      geo_7d_surface_hits: 2770,
      geo_7d_unique_clients: 265,
      screening_events_24h: 190,
    },
    live_probes: {
      "POST /v1/billing/checkout tier=pro with free bearer key": {
        http: 200,
        returns: "checkout.stripe.com session URL",
      },
      "POST /v1/billing/signup-checkout tier=pro email=canary": {
        http: 201,
        returns: "checkout_url + free API key mint (separate integrity issue already filed)",
      },
      "GET /pricing HTML CTAs": {
        mailto_d_kurult_ai_count: 6,
        subjects: ["Solo Plan", "Pro Plan", "Team Plan"],
        cloudflare_email_protection_ctas: [
          "Talk to sales",
          "Get Started",
          "Contact Sales",
          "Book Consultation",
        ],
        stripe_word_count: 0,
        checkout_string_count: 16,
        note: "page contains checkout strings/JS residue but visible paid buttons are mailto/email-protection, not live Stripe session creation",
      },
      "GET / and /get-started and /llms.txt and /skill": {
        stripe_mentions: 0,
        x402_mentions: { home: 12, get_started: 1, llms: 8, skill: 14 },
        "GET /v1/pricing enabled": false,
        unauth_parse_http: 401,
        note: "agent+landing discovery still sells disabled x402; human paid ladder is email",
      },
    },
    why_not_duplicate: {
      existing_gmail_fallback_proposal:
        "elon-pricing-paid-cta-mailto-personal-gmail-fallback-2026-08-11 assumed checkout 500s and personal gmail; live checkout is 200 and mailto is now d@kurult.ai",
      existing_wire_proposal:
        "elon-pricing-wire-free-keygen-to-working-bearer-checkout-2026-08-07 is adjacent but pre-dates current green checkout+signup-checkout evidence and does not name the hard-wired mailto buttons as the binding human conversion blocker",
    },
    related_open_but_not_this: [
      "elon-signup-checkout-mints-free-key-before-payment-2026-08-12",
      "elon-openapi-billing-stripe-paths-missing-2026-08-12",
      "elon-llms-txt-sells-disabled-x402-hides-stripe-2026-08-12",
      "elon-skill-mcp-install-sell-disabled-x402-hide-stripe-2026-08-12",
    ],
  },
  impact:
    "Parse has discovery traffic (265 unique clients / 2770 surface hits in 7d) and a working Stripe checkout API, but $0 payments and 0 active subscriptions. The human pricing page routes Solo/Pro/Team intent into email instead of the live checkout session. Every cold paid visitor is trained to wait on sales. Delete the mailto paid path; wire buttons to signup-checkout or bearer checkout.",
  acceptance_criteria: [
    "GET /pricing Solo/Pro/Team primary CTAs do not use mailto: or /cdn-cgi/l/email-protection for self-serve tiers",
    "Clicking Start/Subscribe on Solo or Pro creates a Stripe Checkout session (signup-checkout for logged-out, bearer checkout for keyed) and redirects to checkout.stripe.com",
    "No personal or operator mailbox is required to begin Solo/Pro self-serve payment",
    "Team/Compliance may remain sales-led only if explicitly labeled Contact sales; Solo/Pro must be self-serve",
    "Playwright or curl smoke: unauthenticated Start Pro -> 2xx with checkout_url host checkout.stripe.com",
    "Pricing page copy mentions card/Stripe self-serve for Solo/Pro; do not advertise disabled x402 as the paid path",
    "No secrets in client JS; no price id leakage beyond what Stripe checkout already requires",
  ],
  task_title: "Wire /pricing Solo+Pro CTAs to live Stripe checkout; delete mailto paid path",
  task_assignee: "triage",
  task_body: `## Goal
Make the human pricing page use the already-working Stripe checkout paths so Solo/Pro self-serve can convert without email.

## Live evidence (2026-08-13, prod be8ec48)
- POST /v1/billing/checkout {tier:pro} with free key -> 200 checkout.stripe.com URL
- POST /v1/billing/signup-checkout {tier:pro,email} -> 201 checkout_url
- GET /pricing -> 6x mailto:d@kurult.ai (Solo/Pro/Team) + CF email-protection Get Started/Contact Sales
- Business: 0 active subs, 0 payments, 265 unique discovery clients / 7d

## Implementation sketch
1. Replace Solo/Pro primary buttons with JS that calls:
   - logged-out: POST /v1/billing/signup-checkout {tier, email?} OR intermediate email capture modal then signup-checkout
   - keyed browser session: POST /v1/billing/checkout {tier}
2. On 200/201, redirect to checkout_url.
3. Delete mailto for Solo/Pro self-serve. Keep Contact sales only for Team/Compliance/Enterprise if desired, clearly labeled.
4. Add visible error state if checkout returns 503/500 (no silent mailto fallback to operator inbox).
5. Optional: add "Pay with card" microcopy; do not point paid humans at disabled x402.

## Safety gates
- Do NOT change Stripe prices, products, webhooks, or live subscription state
- Do NOT enable x402
- Do NOT print or log full API keys or checkout session secrets
- Do NOT auto-deploy; PR + review
- signup-checkout currently mints a free key before payment (separate open proposal elon-signup-checkout-mints-free-key-before-payment-2026-08-12) — if touching that path, prefer deferred key mint or mark key unpaid until webhook; do not expand free pre-pay access
- No customer emails/outbound
- No security policy / scope / rate limit changes in this task

## Verification
1. curl -sS -X POST https://www.parsethis.ai/v1/billing/signup-checkout -H 'content-type: application/json' -d '{"tier":"pro","email":"verify@example.com"}' | jq -r .checkout_url | grep checkout.stripe.com
2. Browser: /pricing Start Pro -> lands on Stripe Checkout, not mail client
3. View-source/CTA audit: zero mailto:d@kurult.ai on Solo/Pro buttons
4. Team/Compliance sales path still reachable if intentional
5. npm test / typecheck for touched files

## Rollback
Revert pricing page CTA JS/HTML to previous commit; no DB migration expected.
`,
};

async function main() {
  // cleanup leftover canaries named in this loop window if still active
  const listKeys = await act("admin.api_key.list", { limit: 40 });
  const keys = listKeys.body?.api_keys || listKeys.body?.result?.api_keys || [];
  const cleanup = [];
  for (const k of keys) {
    const name = String(k.name || "");
    if (/hourly-saas-canary-2026-08-13|hourly-chat-shape|Signup Key 2026-08-13/i.test(name) && k.status === "active") {
      const r = await act("admin.api_key.revoke", { id: k.id, reason: "hourly saas loop canary cleanup" });
      cleanup.push({ name, id: k.id, prefix: k.key_prefix, status: r.status });
    }
  }

  const created = await act("admin.improvement_proposal.create", proposal);
  const body = created.body || {};
  const prop = body.improvement_proposal || body.result?.improvement_proposal;
  const receipt = body.receipt || body.result?.receipt;
  console.log(
    JSON.stringify(
      scrub({
        create_status: created.status,
        deduped: body.deduped || body.result?.deduped || false,
        proposal_id: prop?.id,
        title: prop?.title,
        status: prop?.status,
        priority: prop?.priority,
        category: prop?.category,
        idempotency_key: prop?.idempotency_key || prop?.idempotencyKey,
        source: prop?.source,
        receipt_id: receipt?.id,
        cleanup,
        error: body.error || body.title || body.detail || null,
        raw_keys: body && typeof body === "object" ? Object.keys(body) : [],
      }),
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ fatal: String(e?.stack || e) }));
  process.exit(1);
});
