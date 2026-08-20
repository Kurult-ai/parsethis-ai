import "dotenv/config";

const key = process.env.MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

const proposal = {
  action: "admin.improvement_proposal.create",
  params: {
    idempotency_key: "elon-agent-commerce-omit-live-stripe-2026-08-20",
    title:
      "P0 CONVERSION: Stripe Solo/Pro/Team checkout is LIVE, but every agent-facing commerce surface still sells dead x402 only",
    category: "conversion",
    priority: 10,
    risk_level: "low",
    source: "elon_hourly_saas_improvement_loop",
    evidence: {
      observed_at: "2026-08-20T07:40:00Z",
      production_commit: "4034cc1",
      business: {
        active_subscriptions: 0,
        payments_total_count: 0,
        screening_events_last_24h: 414,
        geo_7d_surface_hits: 4906,
        geo_7d_unique_clients: 1037,
        x402_payment_required_7d: 0,
        x402_revenue_usdc: "0.000000",
      },
      live_stripe_works: {
        "POST /v1/billing/signup-checkout solo|pro|team": "HTTP 201 + checkout.stripe.com URL",
        "Bearer POST /v1/billing/checkout solo (free key)": "HTTP 200 + checkout.stripe.com URL",
        "human /pricing HTML": "contains signup-checkout + Solo/Pro CTAs",
      },
      agent_surfaces_omit_stripe: {
        "MCP tools/list": ["screen_prompt", "screen_output", "verify_agent_trust", "get_pricing"],
        "MCP get_pricing": "returns /v1/pricing x402 catalog only; enabled:false facilitator:not_configured; no Solo/Pro/Team/$12/Stripe/checkout fields",
        "MCP screen_prompt 401 data": "docs=/llms.txt generate_key=/v1/keys/generate pricing=/v1/pricing — no billing/checkout",
        "OpenAPI paths": "has /v1/keys/generate; missing /v1/billing/checkout and /v1/billing/signup-checkout",
        "OpenAPI corpus": "stripe:false solo:false checkout:false signup-checkout:false; x402:true",
        "/llms.txt": "documents x402 disabled + free keygen; tells agents to use Pro/Team/Enterprise for volume but never names Stripe checkout endpoints",
        "/get-started": "keys_generate:true x402:true; signup-checkout:false billing_checkout:false",
        "/docs/quickstart": "keys_generate:true; no signup-checkout/billing checkout",
        "/docs/api": "auth section still presents Bearer + x402; GET /v1/pricing described as x402 payment pricing",
        "unauth POST /v1/parse 401 _help": "only generate_key + docs/skill; no paid upgrade path",
      },
      related_open_proposals_do_not_replace: [
        "cmsvhr5ft — get_pricing x402-only (still true; this proposal binds the full agent commerce surface set now that Stripe is green)",
        "cmswyyo3m — /get-started omits checkout (still true)",
        "cmswk5h0p — MCP tools/list missing generate_key/checkout (still true)",
        "Older signup-checkout 429 lockout proposals are live-falsified as of this run",
      ],
      note: "Binding constraint is discovery/wiring, not payment processor availability.",
    },
    impact:
      "Parse is getting agent discovery traffic (4.9k GEO hits / 1k unique clients in 7d) and the paid Stripe rail works, but agents that only read MCP/OpenAPI/llms/get-started/401-help can never find Solo/Pro/Team checkout. They either stay on free forever or attempt disabled x402. Result: 0 active subscriptions and $0 payment rows while human /pricing can buy. Every day this stays open burns the only real conversion path for agent customers.",
    acceptance_criteria: [
      "MCP get_pricing returns a commerce object that includes: x402 status AND Stripe plans (solo/pro/team price, interval) AND concrete upgrade actions: POST /v1/billing/signup-checkout (cold) and POST /v1/billing/checkout (bearer)",
      "When /v1/pricing.enabled is false, get_pricing and /llms.txt explicitly say x402 is unavailable and point to Stripe checkout — never imply a working 402→USDC path",
      "OpenAPI documents POST /v1/billing/signup-checkout and POST /v1/billing/checkout with request/response shapes (no secrets)",
      "Unauthenticated 401 bodies for /v1/parse and MCP tool auth errors include upgrade URLs/actions for Stripe checkout, not only free keygen + /v1/pricing",
      "/get-started, /docs/quickstart, /docs/api, and /llms.txt each mention at least one working Stripe checkout path for Solo/Pro/Team",
      "Live probe: unauth agent reading only MCP tools/list + get_pricing + OpenAPI can discover a 201/200 Stripe checkout URL path without loading /pricing HTML",
      "No change to price amounts, Stripe product IDs, or paid entitlements without separate billing approval",
    ],
    task_title: "Wire live Stripe Solo/Pro/Team checkout into MCP/OpenAPI/llms/401 agent commerce surfaces",
    task_body: [
      "## Problem",
      "As of 2026-08-20 prod commit 4034cc1, Stripe cold signup-checkout and bearer checkout are green, but agent-facing commerce surfaces still expose only disabled x402.",
      "Business state: 0 active subscriptions, 0 payment rows, 4906 GEO hits / 1037 unique clients (7d), x402 revenue 0.",
      "",
      "## Evidence (live)",
      "- POST /v1/billing/signup-checkout {solo,pro,team} → 201 checkout.stripe.com",
      "- Bearer POST /v1/billing/checkout {solo} on free key → 200 checkout.stripe.com",
      "- MCP tools: screen_prompt, screen_output, verify_agent_trust, get_pricing",
      "- MCP get_pricing → /v1/pricing enabled:false facilitator:not_configured only",
      "- OpenAPI: no /v1/billing/checkout, no /v1/billing/signup-checkout, stripe/solo/checkout mentions false",
      "- /llms.txt + /get-started + quickstart: free keygen yes, Stripe checkout endpoints no",
      "- unauth /v1/parse 401 _help: generate_key only",
      "",
      "## Implementation",
      "1. Extend MCP get_pricing (and ideally /v1/pricing companion field or /v1/billing/plans read) to return Stripe plan catalog + checkout actions while keeping x402 block honest when disabled.",
      "2. Add OpenAPI paths for POST /v1/billing/signup-checkout and POST /v1/billing/checkout.",
      "3. Update 401/_help and MCP auth error data to include checkout actions when x402 disabled.",
      "4. Update /llms.txt, /get-started, /docs/quickstart, /docs/api so agent///human install paths name the working Stripe endpoints.",
      "5. Add a regression probe: agent-surface commerce discovery test that fails if Stripe checkout is live but undiscoverable from MCP+OpenAPI+llms.",
      "",
      "## Safety gates",
      "- Proposal/implementation only after admin approval via Create implementation task",
      "- Do NOT enable x402 or configure facilitators in this task",
      "- Do NOT change Stripe prices, product IDs, webhooks, entitlements, or grant paid tier without payment",
      "- Do NOT contact customers",
      "- Do NOT mint extra live Signup Keys in tests; prefer dry-run fixtures or immediate revoke of probe keys",
      "- Do NOT deploy without Danny approval; verify on www.parsethis.ai/version after any approved deploy",
      "- Keep /pricing human CTA behavior working; this is additive discovery, not a redesign of checkout charge logic",
      "",
      "## Verification",
      "- curl MCP get_pricing shows stripe plans + checkout actions",
      "- openapi.json includes billing checkout paths",
      "- llms.txt names checkout endpoints",
      "- unauth parse 401 help includes upgrade/checkout action",
      "- signup-checkout still 201; bearer checkout still 200",
      "- no secrets in OpenAPI/MCP/llms output",
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
  const ip = body.improvement_proposal || body;
  const out = {
    http_status: res.status,
    deduped: !!body.deduped,
    id: ip.id || body.improvement_proposal?.id,
    title: ip.title || body.improvement_proposal?.title,
    status: ip.status || body.improvement_proposal?.status,
    idempotency_key: ip.idempotency_key || ip.idempotencyKey,
    receipt_id: body.receipt?.id,
    error: body.error || body.code || body.title,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e).slice(0, 400) }));
  process.exit(1);
});
