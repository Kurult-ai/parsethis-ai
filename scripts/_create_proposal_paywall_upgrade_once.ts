import "dotenv/config";

const key = process.env.MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

const observedAt = new Date().toISOString();

const proposal = {
  action: "admin.improvement_proposal.create",
  params: {
    idempotency_key: "elon-paywall-402-429-upgradeurl-html-only-no-api-checkout-2026-08-20",
    title:
      "P0 CONVERSION: Free 402/429 paywalls sell Solo via upgradeUrl=/pricing#solo only — no machine checkout action while Stripe signup-checkout is live",
    category: "conversion",
    priority: 10,
    risk_level: "low",
    source: "elon_hourly_saas_improvement_loop",
    evidence: {
      observed_at: observedAt,
      production_commit: "4034cc1",
      runtime: "source",
      business_context: {
        active_subscriptions: 0,
        payments_total_count: 0,
        open_proposals_approx: 241,
        note: "Stripe rail works; agents still cannot complete upgrade from the exact responses that tell them to pay.",
      },
      live_probes_this_run: {
        cold_signup_checkout_solo:
          "POST /v1/billing/signup-checkout {tier:solo} → HTTP 201 + checkout.stripe.com (works when under 5/min)",
        free_key_after_burst: {
          "POST /v1/billing/checkout":
            "HTTP 429 rate_limit.exceeded limit=10; upgradeUrl=/pricing#solo; upgrade={tier:solo,message} — NO checkout method/url/body",
          "POST /v1/explain":
            "HTTP 402 payment.required; upgrade={tier:solo,price_per_month:12,message}; upgradeUrl=/pricing#solo — NO API checkout action",
          "GET /v1/billing/usage": "HTTP 429 same upgradeUrl=/pricing#solo",
          "GET /v1/screening/metrics": "HTTP 429 same upgradeUrl=/pricing#solo",
          "POST /v1/agent/trust/verify": "HTTP 429 same upgradeUrl=/pricing#solo",
        },
        important_coupling:
          "Bearer checkout shares free RPM, so the moment an agent is throttled and told to upgrade, the bearer checkout path is also 429. The only live unpaid→paid API left is unauth/cold POST /v1/billing/signup-checkout — and the paywall body does not name it.",
        human_pricing_html: "/pricing contains signup-checkout + billing/checkout strings, but upgradeUrl forces HTML navigation agents often cannot complete",
      },
      related_open_proposals_do_not_replace: [
        "cmt17o1a3 — agent commerce surfaces omit Stripe (discovery docs/MCP/OpenAPI). This proposal is the paywall response body at the conversion moment.",
        "cmsuxix7 / cmszrrwx — free RPM meters billing/checkout (still true). Fixing RPM alone still leaves upgradeUrl HTML-only.",
        "cmsthopvj — explain 402 upsold into then-dead Solo checkout (checkout lockout is live-falsified; upgradeUrl problem remains).",
        "cmss0fb6o — 'Add upgrade guidance to free-tier rate-limit 429' is partially shipped as upgrade+upgradeUrl, but the guidance is not agent-callable.",
      ],
    },
    impact:
      "Every free agent that hits the real purchase moments (RPM wall, explain paywall) is told to buy Solo, then handed a relative HTML URL with no POST /v1/billing/signup-checkout action. Bearer checkout is simultaneously 429 because it shares the free bucket. Net: paid intent dies inside the JSON the agent already has. With 0 active subscriptions and live Stripe sessions available on cold signup-checkout, this is pure conversion leakage at the last mile.",
    acceptance_criteria: [
      "Any free-tier 402 payment.required and rate_limit.exceeded JSON body that recommends Solo/Pro/Team includes a machine-callable upgrade.actions object naming method+url+body for cold POST /v1/billing/signup-checkout (and bearer POST /v1/billing/checkout when not RPM-bound)",
      "upgradeUrl may remain as a human fallback, but must not be the only upgrade path",
      "When bearer checkout is itself rate-limited, the body must not imply Bearer checkout is currently callable; prefer cold signup-checkout action",
      "Regression test: after free RPM exhaustion, /v1/explain 402 and /v1/billing/checkout 429 bodies both contain signup-checkout action fields; curl using only those fields can obtain a checkout.stripe.com URL (or documented dry-run equivalent) without loading /pricing HTML",
      "Do not change prices, entitlements, or auto-charge; discovery/wiring only",
      "No secrets or full API keys in paywall bodies",
    ],
    task_title: "Put machine-callable Stripe checkout actions on free 402/429 upgrade payloads",
    task_body: [
      "## Problem",
      "Prod 4034cc1 (2026-08-20): free agents hitting 402/429 get upgrade.tier=solo and upgradeUrl=/pricing#solo only.",
      "Cold POST /v1/billing/signup-checkout still returns 201 + checkout.stripe.com.",
      "Bearer POST /v1/billing/checkout shares free RPM, so at the upgrade moment it is often also 429.",
      "Business: 0 active subscriptions / 0 payment rows while Stripe sessions can be created.",
      "",
      "## Evidence",
      "- POST /v1/explain free → 402 upgradeUrl=/pricing#solo, no checkout action",
      "- After free burst, POST /v1/billing/checkout → 429 upgradeUrl=/pricing#solo, no checkout action",
      "- Same upgradeUrl on usage/metrics/trust 429s",
      "- Cold signup-checkout solo → 201 stripe checkout URL",
      "",
      "## Implementation",
      "1. Centralize paid-upgrade payload builder used by rate-limit + payment.required responses.",
      "2. Add upgrade.actions.cold_checkout = {method:'POST', url:'/v1/billing/signup-checkout', body:{tier}}",
      "3. Optionally add upgrade.actions.bearer_checkout with note that it consumes/requires RPM headroom",
      "4. Keep human upgradeUrl as secondary",
      "5. Pin regression tests on 402 explain + 429 checkout bodies",
      "6. Prefer not minting durable Signup Keys in CI; if live probe needed, revoke immediately and mark synthetic",
      "",
      "## Safety gates",
      "- Admin approval via Create implementation task before implementation/deploy",
      "- No Stripe price/product/webhook/entitlement changes",
      "- No enabling x402",
      "- No customer contact",
      "- No secret logging",
      "- Do not weaken rate limits globally just to hide this; fix the upgrade payload",
      "- Avoid creating unpaid live keys in tests; if signup-checkout is probed, revoke/orphan-janitor path required",
      "",
      "## Verification",
      "- Free key 402/429 bodies include signup-checkout action",
      "- Agent can create Stripe checkout session using only paywall JSON",
      "- /pricing human path still works",
      "- No full API keys in error bodies",
    ].join("\n"),
    task_assignee: "triage",
    dry_run: false,
  },
};

async function main() {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(proposal),
  });
  const body = await res.json();
  const redacted = JSON.stringify(body, null, 2).replace(/pfa_[A-Za-z0-9_]+/g, "pfa_[REDACTED]");
  console.log(JSON.stringify({ http: res.status, body: JSON.parse(redacted) }, null, 2));
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
