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
    idempotency_key: "elon-first-mile-401-help-name-optional-lie-2026-08-20",
    title:
      "P0 FIRST-MILE: every unauth 401 _help says keygen name is optional, but POST /v1/keys/generate 400s without name",
    category: "onboarding_first_mile",
    priority: 9,
    risk_level: "low",
    source: "elon_hourly_saas_improvement_loop",
    evidence: {
      observed_at: observedAt,
      production_commit: "4034cc1",
      business_context: {
        active_subscriptions: 0,
        payments_total_count: 0,
        api_keys_active: 317,
        screening_events_last_24h: 403,
        geo_7d_surface_hits: 4897,
        geo_7d_unique_clients: 1029,
        open_proposals_sample_window: "244 total / 0 approved in control-loop proposal",
      },
      live_probes: {
        "POST /v1/keys/generate {}": {
          http: 400,
          code: "validation.required",
          detail:
            "name is required and must be a non-empty string. Use a descriptive label like 'my-app-prod' or '<project>-<env>' so you can identify and revoke this key later.",
        },
        "POST /v1/keys/generate {name: hourly-saas-probe-do-not-keep}": {
          http: 201,
          scopes: ["analyze", "evaluate"],
          expires_at_shape: "90 idle-day window (~2026-11-18)",
        },
        unauth_401_help_name_field: "string (optional)",
        surfaces_with_optional_lie: [
          "/v1/parse",
          "/v1/screen-output",
          "/v1/explain",
          "/v1/analyze",
          "/v1/evaluate",
          "/v1/agent/trust/verify",
          "/v1/billing/checkout",
          "/v1/billing/usage",
        ],
        truthful_surfaces: {
          "OpenAPI KeyGenerateRequest.required": ["name"],
          "llms.txt example": 'POST /v1/keys/generate with {"name":"your-agent"}',
          "skill example": ' -d \'{"name":"my-agent"}\'',
        },
        openapi_nit: "paths./v1/keys/generate.post.requestBody.required=false while schema requires name",
        mcp_unauth_tools_call:
          "error data has generate_key=/v1/keys/generate but no body schema; agents often fall through to REST 401 help",
      },
      why_this_is_not_duplicate: [
        "Existing conversion proposals cover missing Stripe checkout on agent surfaces (still true; separate spine).",
        "Existing keygen name-gate proposal is about refusing synthetic probe names, not about optional-vs-required docs lie.",
        "No open proposal pins the machine-readable 401 _help.generate_key.body.name='string (optional)' vs live 400.",
      ],
      note: "Agents that only read the 401 challenge do the wrong first keygen call. Humans reading llms/skill are fine. This is pure agent first-mile friction on the highest-traffic auth failure path.",
    },
    impact:
      "GEO shows ~1k unique clients / 4.9k surface hits in 7d hitting OpenAPI/llms/MCP/docs. The default agent auth failure path is unauth REST 401 → _help.generate_key. That help currently teaches a body that hard-fails. First contact becomes a validation error instead of a key, which increases abandon rate before parse/checkout ever runs. Fix is copy/schema alignment only — no billing or security-policy change.",
    acceptance_criteria: [
      "Every unauth 401 `_help.generate_key.body` marks name as required (not optional), with a non-empty example value",
      "POST /v1/keys/generate without name remains 400 validation.required; with name remains 201",
      "OpenAPI requestBody.required is true for /v1/keys/generate OR the body schema clearly fails closed when body omitted; KeyGenerateRequest.required continues to include name",
      "MCP unauth tools/call error data either includes the required body shape {name:string} or points to a help object that does",
      "Regression test: walk auth-challenge help builders and assert no 'name' field is labeled optional while server requires it",
      "No change to key scopes, tiers, rate limits, Stripe prices, entitlements, or retention policy in this task",
    ],
    task_title: "Fix 401 _help keygen body: name is required, not optional",
    task_body: [
      "## Problem",
      "As of prod commit 4034cc1 (2026-08-20), unauthenticated REST 401 bodies advertise:",
      '  _help.generate_key.body = { name: "string (optional)" }',
      "but live POST /v1/keys/generate with {} returns HTTP 400 validation.required requiring a non-empty name.",
      "Named keygen still 201. OpenAPI KeyGenerateRequest.required=[name]. llms.txt/skill examples already send name.",
      "Affected 401 surfaces probed: /v1/parse, /v1/screen-output, /v1/explain, /v1/analyze, /v1/evaluate, /v1/agent/trust/verify, /v1/billing/checkout, /v1/billing/usage.",
      "",
      "## Why it matters",
      "Agent first-mile is 401 → follow machine help → keygen. The help is wrong, so first keygen fails.",
      "Business context: 0 active subs, 0 payments, 4897 GEO hits / 1029 unique clients (7d). Do not waste the only auth recovery path.",
      "",
      "## Implementation",
      "1. Find the shared 401/_help builder (auth challenge) and change generate_key.body.name to required with example 'my-agent' / '<project>-<env>'.",
      "2. Align OpenAPI: requestBody.required=true for POST /v1/keys/generate (schema already requires name).",
      "3. Optionally enrich MCP unauth tools/call error data with {method,url,body:{name}} matching REST help.",
      "4. Add a unit/route test that fails if any auth-help marks name optional while handler requires it.",
      "",
      "## Safety gates",
      "- Proposal only until Danny clicks Create implementation task in /admin",
      "- Do NOT change Stripe, x402, prices, entitlements, scopes, rate limits, or retention windows",
      "- Do NOT contact customers",
      "- Do NOT bulk-revoke keys in this task",
      "- Do NOT weaken name validation (keep required non-empty)",
      "- Do NOT deploy without separate deploy approval; verify www.parsethis.ai/version after any approved deploy",
      "- Probe keys used in verification must be named clearly and revoked via DELETE /v1/keys/self immediately",
      "",
      "## Verification",
      "- Unauth POST /v1/parse 401 help shows name required + example",
      "- POST /v1/keys/generate {} still 400",
      "- POST /v1/keys/generate {name} still 201; then DELETE /v1/keys/self",
      "- openapi.json requestBody/schema agree name required",
      "- focused test green; no secrets printed",
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
    priority: ip.priority,
    category: ip.category,
    idempotency_key: ip.idempotency_key || ip.idempotencyKey,
    receipt_id: body.receipt?.id,
    error: body.error || body.code || body.title || body.detail,
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e).slice(0, 400) }));
  process.exit(1);
});
