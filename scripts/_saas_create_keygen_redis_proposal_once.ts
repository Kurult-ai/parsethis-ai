import { config } from "dotenv";
config({ path: ".env" });
import { writeFileSync } from "fs";

const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY;
if (!master) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(1);
}

async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${master}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  const observed_at = new Date().toISOString();
  const healthRes = await fetch(BASE + "/health");
  const health = await healthRes.json();
  const commit = health?.deployment?.commit || "unknown";

  const kgRes = await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `elon-proposal-evidence-${Date.now()}` }),
  });
  const kgBody = await kgRes.json();

  const summary = await admin("admin.summary.read", {});
  const sum = summary.body?.result ?? summary.body;
  const geo = await admin("admin.geo.metrics.read", {});
  const geoSum = (geo.body?.result ?? geo.body)?.summary;

  const params = {
    idempotency_key: "elon-keygen-503-upstash-max-requests-exhausted-2026-08-22",
    source: "elon_hourly_saas_improvement_loop",
    title:
      "P0 FIRST-MILE: POST /v1/keys/generate is 503 for everyone — Upstash Redis max requests limit exceeded (health still green)",
    category: "onboarding_first_mile",
    priority: 10,
    risk_level: "medium",
    evidence: {
      observed_at,
      production_commit: commit,
      production_runtime: health?.deployment?.runtime,
      probe: "live HTTPS www.parsethis.ai + local :3001 same process",
      keygen: {
        path: "POST /v1/keys/generate",
        www_status: kgRes.status,
        local_status: 503,
        code: kgBody?.code,
        title: kgBody?.title,
        detail: kgBody?.detail,
        reason: kgBody?.reason,
        retryable: kgBody?.retryable,
        sample_trace_id: kgBody?.trace_id,
      },
      redis_boundary: {
        symptom:
          "REDIS_URL points at Upstash; AUTH returns ERR max requests limit exceeded. Limit: 500000, Usage: 500006",
        local_redis_process_present: true,
        note: "Do not print REDIS_URL. Quota exhaustion makes rate-limit precheck fail closed → keygen 503.",
      },
      false_green: {
        "GET /health": "200 status=ok semantic_layer=ok — does not surface redis_unavailable",
        "master bearer POST /v1/parse": "200 allow risk_score=0 (authenticated path still works)",
        "admin.dashboard.snapshot / summary": "200",
      },
      business_context: {
        active_subscriptions: sum?.subscriptions?.active ?? null,
        payments_total_count: sum?.payments?.total_count ?? null,
        api_keys_active: sum?.api_keys?.active ?? null,
        api_keys_total: sum?.api_keys?.total ?? null,
        screening_events_last_24h: sum?.screening?.events_last_24h ?? null,
        geo_surface_hits: geoSum?.surface_hits ?? null,
        geo_unique_clients: geoSum?.unique_clients ?? null,
        why_this_matters:
          "Install Parse / free keygen is the cold start. With keygen 503, new agents cannot onboard while discovery traffic continues. Existing master/paid paths mask the outage because /health stays green.",
      },
      related_open_do_not_duplicate: [
        "Older keygen name/help/scope proposals assume keygen returns 201 — currently falsified by hard 503",
        "signup-checkout 429 self-service cap proposals are secondary while keygen itself is dark",
        "elon-prod-node-module-graph-stale mentions Redis cache lifecycle but not Upstash quota exhaustion",
      ],
    },
    impact:
      "Blocks 100% of self-service onboarding. Agents following /llms.txt, OpenAPI, skill, and Install Parse hit keygen and get retryable 503. GEO still shows ~5k surface hits / ~1.1k unique clients while active paid subscriptions remain 0. A green /health makes the outage invisible to monitors that only check liveness.",
    acceptance_criteria: [
      "POST /v1/keys/generate on www returns 201 (or honest 429 with retry-after) for a unique non-synthetic name — never 503 reason=redis_unavailable when the product is 'up'",
      "Upstash max-requests exhaustion is resolved (quota upgrade, monthly reset ops, or REDIS_URL cutover to a healthy Redis) without logging secrets",
      "GET /health or /status exposes redis/keygen dependency health (or a dedicated canary) so redis_unavailable cannot hide behind status=ok",
      "Hourly/canary probes that mint keys are synthetic-tagged and cannot alone burn Redis command quota; document expected daily Redis command budget",
      "Regression: focused test or monitor fails when keygen precheck would 503 on redis down/quota; alert path reaches Danny",
      "No change to Stripe prices, security policy, or customer data; probe keys revoked if any are minted during verify",
    ],
    task_title:
      "Restore self-service keygen: fix Upstash max-requests exhaustion and stop green /health hiding redis_unavailable",
    task_body: [
      "## Goal",
      "Make POST /v1/keys/generate work again for real customers and make Redis/keygen failure visible.",
      "",
      `## Live failure (prod ${commit}, ${observed_at})`,
      "- POST /v1/keys/generate → 503 problem+json title='Rate limiting unavailable' code=service.unavailable reason=redis_unavailable",
      "- Same on localhost:3001 (launchd production process)",
      "- REDIS_URL provider AUTH: ERR max requests limit exceeded Limit:500000 Usage:500006 (Upstash)",
      "- GET /health → 200 ok (false green)",
      "- Master bearer /v1/parse still 200 — outage is first-mile specific",
      `- Business: active_subscriptions=${sum?.subscriptions?.active ?? "?"} payments_total=${sum?.payments?.total_count ?? "?"} screening_24h=${sum?.screening?.events_last_24h ?? "?"} geo_hits=${geoSum?.surface_hits ?? "?"}`,
      "",
      "## Implementation options (pick simplest true fix)",
      "A. Ops: restore Redis capacity — Upstash plan/quota reset or switch REDIS_URL to healthy Redis (local/home lab or new provider) in the same maintenance window; restart launchd service; verify keygen 201.",
      "B. Product: if rate-limit Redis is mandatory for keygen, surface redis in /health or /status and a keygen canary; never claim ok while keygen precheck fails closed.",
      "C. Cost control: ensure synthetic/hourly probes use X-Parse-Probe + synthetic key naming and bounded Redis commands; add quota/usage metric to admin snapshot.",
      "D. Optional harden: distinguish redis_quota_exceeded vs redis_down in keygen error reason for faster ops.",
      "",
      "## Safety gates",
      "- Needs Danny approval via Create implementation task before env///provider changes or service restart",
      "- Do NOT print or commit REDIS_URL/passwords/MASTER_API_KEY",
      "- Do NOT disable rate limiting globally to 'fix' keygen (abuse/cap bypass)",
      "- Do NOT delete customer keys/data; revoke only synthetic probe keys created during verify",
      "- Do NOT change billing prices, entitlements, security policy, or public incident language without separate approval",
      "- Prefer reversible REDIS_URL cutover with rollback noted in receipt",
      "",
      "## Verify",
      "- curl -sS -X POST https://www.parsethis.ai/v1/keys/generate -H 'content-type: application/json' -d '{\"name\":\"verify-unique-...\"}' → 201 + tier free (then DELETE/revoke)",
      "- /health or status/canary red if Redis quota exhausted again",
      "- admin.summary.read still works; no secret leakage in logs",
      "- Existing master parse smoke still 200",
      "",
      "## Out of scope",
      "Stripe commerce discovery, org adopt HTML loop, HITL approve_url, proposal backlog triage — separate open P0s.",
    ].join("\n"),
    task_assignee: "triage",
  };

  const result = await admin("admin.improvement_proposal.create", params);
  const body = result.body || {};
  const ip = body.improvement_proposal || body.result?.improvement_proposal || body.result || body;
  const out = {
    http_status: result.status,
    deduped: !!(body.deduped || body.result?.deduped || ip.deduped),
    id: ip.id || body.id,
    status: ip.status,
    title: ip.title || params.title,
    idempotency_key: params.idempotency_key,
    receipt_id: body.receipt?.id || body.result?.receipt?.id,
    error: body.error || body.code || body.detail,
    evidence_keygen_status: kgRes.status,
    evidence_reason: kgBody?.reason,
    commit,
  };
  writeFileSync("/tmp/saas_hourly_proposal_result.json", JSON.stringify({ out, raw_keys: Object.keys(body), raw: body }, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: String(e).slice(0, 500) }));
  process.exit(1);
});
