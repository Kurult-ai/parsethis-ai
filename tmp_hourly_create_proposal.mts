import { readFileSync } from "node:fs";

function loadEnv() {
  const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  for (const line of env.split(/\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const key = loadEnv().MASTER_API_KEY;
if (!key) {
  console.log(JSON.stringify({ error: "no_master" }));
  process.exit(2);
}

async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json().catch(() => ({ parse_error: true }));
  return { status: res.status, body };
}

function scrub(o: any, depth = 0): any {
  if (depth > 6) return "[depth]";
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
          (lk.endsWith("_key") && v.length > 8) ||
          /^pfa_live_/.test(v))
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
  // revoke hourly probe keys by listing snapshot-ish via api_key.list
  const keys = await act("admin.api_key.list", { limit: 40 });
  const arr =
    keys.body?.result?.keys ||
    keys.body?.keys ||
    keys.body?.result?.items ||
    keys.body?.result ||
    keys.body?.summary?.api_keys ||
    [];
  const list = Array.isArray(arr) ? arr : [];
  const probe = list.filter((k: any) => {
    const n = String(k?.name || "");
    return (
      n.includes("hourly") ||
      n.includes("probe") ||
      n.includes("canary") ||
      n.includes("Signup Key 2026-08-12")
    );
  });
  const revokes: any[] = [];
  for (const k of probe) {
    if (!k?.id) continue;
    if (k.status === "revoked" || k.revoked_at || k.revoked) continue;
    const r = await act("admin.api_key.revoke", {
      id: k.id,
      reason: "hourly saas loop probe cleanup 2026-08-12T21",
    });
    revokes.push({ id: k.id, name: k.name, status: r.status });
  }

  const idempotency_key =
    "elon-admin-proposal-hygiene-stale-p0-closeout-be8ec48-2026-08-12";

  const proposal = {
    idempotency_key,
    title:
      "P0 ADMIN/CONTROL-LOOP: 53 open improvement proposals; many P0s are stale vs prod be8ec48 — inbox noise blocks one-click triage of real revenue/product blockers",
    category: "admin_observability",
    priority: 9,
    risk_level: "low",
    source: "elon_hourly_saas_improvement_loop",
    evidence: {
      checked_at: "2026-08-12T21:06:00Z",
      production_commit: "be8ec48",
      production_host: "https://www.parsethis.ai",
      collector: "hourly loop live admin+public probes (business_state_context.py missing on host)",
      inbox: {
        proposed_count: 53,
        deferred_count: 1,
        source: "admin.improvement_proposal.list limit=50+",
      },
      business_snapshot: {
        active_subscriptions: 0,
        payments_total: 0,
        active_api_keys: 40,
        screening_events_last_24h: 64,
        blocked_last_24h: 20,
        evaluations_total: 0,
      },
      stale_against_be8ec48: [
        {
          title_signal: "Missing RFC 9116 security.txt + /security 404",
          live: "GET /.well-known/security.txt 200 Contact mailto:security@parsethis.ai; GET /security 200",
        },
        {
          title_signal: "production still serves 72a3bd8; my-agents/exception-requests 404",
          live: "GET /version commit be8ec48; GET /dashboard/my-agents 401 auth; GET /v1/exception-requests 401 auth (routes exist)",
        },
        {
          title_signal: "signup-checkout returns 500 / STRIPE_SECRET_KEY never set / checkout 503",
          live: "POST /v1/billing/signup-checkout tier=solo 201; bearer POST /v1/billing/checkout tier=solo 200 checkout.stripe.com",
        },
        {
          title_signal: "PUT /v1/policy is 503",
          live: "PUT /v1/policy autoBlockThreshold 200 for free key",
        },
        {
          title_signal: "LLM semantic analysis dark / OPENROUTER missing",
          live: "POST /v1/parse analysis_method pattern+llm; layers.llm ran; credential exfil risk_score 10",
        },
        {
          title_signal: "self-service keygen stuck on redis_* ids",
          live: "POST /v1/keys/generate returns cms* DB ids; admin.api_key.list sees them",
        },
        {
          title_signal: "zero legal pages Terms/AUP",
          live: "GET /terms 200, /privacy 200, /acceptable-use 200 (note /aup and /contact still 404 aliases)",
        },
        {
          title_signal: "npm install @parsethis/sdk package does not exist",
          live: "registry.npmjs.org/@parsethis/sdk 200 latest 0.1.0 tarball present; SDK defaults parseBaseUrl https://www.parsethis.ai",
        },
        {
          title_signal: "/version commit unknown / RAILWAY_GIT_COMMIT_SHA",
          live: "GET /version deployment.commit be8ec48 runtime source",
        },
        {
          title_signal: "ScreeningEvent schema drift dashboard 500",
          live: "admin.dashboard.snapshot 200; admin.screening_event.list 200",
        },
      ],
      still_live_do_not_close: [
        {
          issue: "Free default autoBlockThreshold=7 while max_threshold=5",
          probe: "GET /v1/policy tier=free returns both fields; PUT 8 -> 403; PUT 5/3 -> 200",
        },
        {
          issue: "screen-output misses credential exfil parse catches",
          probe: "same sk-proj+AKIA payload: /v1/parse risk 10 critical block; /v1/screen-output risk 0 safe allow",
        },
        {
          issue: "Bearer POST /v1/billing/portal shadowed -> 302 /login",
          probe: "confirmed 302 Location /login on free key",
        },
        {
          issue: "signup-checkout mints usable free key before Stripe pay",
          probe: "201 body includes key+checkout_url; key can call /v1/parse",
        },
        {
          issue: "/skill + llms.txt sell disabled x402; Stripe path invisible",
          probe: "skill x402=14 stripe=0; /v1/pricing enabled=false; noauth /v1/parse 401 not 402",
        },
        {
          issue: "401 _help says keygen name optional; runtime requires name",
          probe: "noauth parse _help body.name string(optional); POST /v1/keys/generate {} -> 400 name required",
        },
        {
          issue: "Free rate_limit=10 bricks agent flows and DELETE /v1/keys/self",
          probe: "12x /v1/parse -> 200 then 429s; DELETE /v1/keys/self 429 same bucket",
        },
        {
          issue: "/v1/chat media-analysis persona + message body 400",
          probe: "messages body 200 media assistant; message body 400",
        },
        {
          issue: "Browser dashboards return problem+json 401 not HTML login",
          probe: "Accept text/html GET /dashboard/billing -> application/problem+json 401",
        },
        {
          issue: "Org bootstrap 403 for anonymous self-service keys; adopt API missing",
          probe: "POST /v1/orgs/bootstrap 403 anonymous_key; POST /account/keys/adopt 302; /v1/account/keys/adopt 404",
        },
      ],
      why_this_is_the_bottleneck:
        "Hourly loop can keep minting duplicate P0s while Danny's /admin inbox is dominated by historically-true but now-false outages. Real conversion killers are already filed and still live; velocity dies if triage cannot trust the queue. Hygiene is the meta-blocker for SaaS ship cadence.",
    },
    impact:
      "Restores a trustworthy /admin proposal inbox so Danny can one-click the still-live revenue and product P0s (portal shadow, signup mint-before-pay, free threshold lie, screen-output miss, skill/x402 honesty, keygen help contract) instead of wading through fixed infra ghosts. Directly increases execution probability of customer-volume readiness work.",
    acceptance_criteria: [
      "Every open proposal with status=proposed is re-probed against https://www.parsethis.ai at the current /version commit; result recorded on the proposal or in an admin receipt (pass/fail/stale)",
      "Proposals proven false on current prod (security.txt present, commit be8ec48+ routes live, checkout/signup-checkout green, policy PUT 200, pattern+llm on, cms DB key ids, legal pages present, @parsethis/sdk on npm, etc.) are moved to rejected or deferred with a one-line stale reason — not left as P0 proposed",
      "Still-live list remains proposed (or approved) and sorted above stale noise: free threshold 7>5, screen-output miss, portal 302, signup mint-before-pay, skill/llms x402 honesty, 401 name-help contract, free rate limit, chat persona/body, dashboard HTML auth, org bootstrap/adopt",
      "Admin UI shows clear stale badge or filter so humans do not re-triage ghosts",
      "No production product behavior change required for hygiene itself; no billing/security-policy/secret/customer-contact mutations",
      "Optional: add admin.improvement_proposal.verify or batch_update_status dry-run action with receipt",
      "Idempotent: re-running verifier does not reopen correctly closed stale items without new failing evidence",
    ],
    task_title:
      "Hygiene pass: verify/close stale /admin P0 proposals against prod be8ec48; keep only still-live SaaS blockers",
    task_body: `## Goal
Make the Parse /admin improvement inbox a trustworthy control loop again. 53 proposed items, many factually stale vs production commit be8ec48, are hiding the still-live conversion and product P0s.

## Evidence (2026-08-12 hourly elon loop)
- admin.improvement_proposal.list: ~53 status=proposed
- GET /version: be8ec48
- Stale examples now green: security.txt 200; my-agents/exception-requests auth 401 not path 404; signup-checkout 201; bearer checkout 200; PUT /v1/policy 200; parse pattern+llm; keys cms* DB ids; /terms /privacy /acceptable-use 200; npm @parsethis/sdk 0.1.0; dashboard snapshot 200
- Still live (do not close): free autoBlockThreshold 7 > max_threshold 5; screen-output risk0 vs parse risk10 on same secrets; portal 302 /login; signup-checkout returns key pre-pay; skill/llms x402 with pricing.enabled=false; 401 help name optional vs required; free 10 rpm bricks DELETE keys/self; chat media persona; dashboard problem+json 401; org bootstrap 403 + adopt path missing

## Implementation
1. Build a read-only verifier script (or admin action) that loads open proposals and re-checks structured probes / acceptance hints against www.parsethis.ai.
2. For each proposal: mark keep | stale-reject | stale-defer with evidence timestamp + prod commit.
3. Batch update_status via admin.improvement_proposal.update_status with reason; write AdminActionReceipts.
4. Add UI filter/badge for stale/verified_at if cheap.
5. Document the still-live top queue for Danny (no silent implement of those product fixes in this task).

## Safety gates
- Proposal/triage only until Create implementation task
- No deploy required for pure status hygiene; if UI badge needs deploy, normal review
- Do NOT change billing, Stripe, security policy, secrets, or contact customers
- Do NOT bulk-reject still-live items listed above
- Do NOT implement product fixes inside the hygiene task
- Revoke any probe keys created during verification

## Assignee
triage
`,
    task_assignee: "triage",
  };

  const created = await act("admin.improvement_proposal.create", proposal);
  console.log(
    JSON.stringify(
      {
        revokes,
        create_status: created.status,
        create: scrub(created.body),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
