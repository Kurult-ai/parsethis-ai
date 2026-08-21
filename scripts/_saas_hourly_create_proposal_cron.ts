import "dotenv/config";
import { writeFileSync } from "fs";

const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
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

  const params = {
    idempotency_key: "elon-org-adopt-200-html-login-not-api-2026-08-21",
    source: "elon_hourly_saas_improvement_loop",
    title:
      "P0 GOVERNANCE/FIRST-MILE: Default keygen→/v1/agents→bootstrap→adopt is a closed lie loop — adopt returns 200 HTML Login, not a JSON API",
    category: "onboarding",
    priority: 9,
    risk_level: "low",
    evidence: {
      observed_at,
      production_commit: commit,
      probe: "live HTTPS www.parsethis.ai, free self-serve key",
      chain: [
        {
          step: "POST /v1/keys/generate {name}",
          result: "201 free key scopes=[analyze,evaluate] anonymous",
        },
        {
          step: "POST /v1/agents",
          result:
            "403 Organization required; _help.create_an_organization → POST /v1/orgs/bootstrap",
        },
        {
          step: "POST /v1/orgs/bootstrap {name}",
          result:
            "403 anonymous_key; detail tells agent to sign up + confirm email OR POST /account/keys/adopt; _help.adopt.method=POST url=/account/keys/adopt",
        },
        {
          step: "POST /account/keys/adopt (no auth and with free Bearer)",
          result:
            "HTTP 200 content-type=text/html title='Log In | Parse' (canonical /login) — not problem+json, not an adopt receipt. Agents treating 200 as success will mark org onboarding done while nothing was adopted.",
        },
        {
          step: "GET /account/keys/adopt",
          result: "404 JSON not found",
        },
      ],
      openapi: {
        has_bootstrap: true,
        has_agents: true,
        has_account_keys_adopt: false,
        note: "Adopt is advertised in runtime _help but absent from OpenAPI machine contract",
      },
      business_context: {
        active_subscriptions: 0,
        payments_total: 0,
        why_this_matters:
          "Flagship org governance (registry, tool policy, policy ceiling) is unreachable from the default Install Parse path. Discovery can convert free keys forever without ever touching the product customers actually buy governance for.",
      },
      related_open_proposals_do_not_duplicate_broadly: [
        "cmspr1exw00004q1er3x1pene (bootstrap anonymous deadend — this proposal pins the sharper adopt=200 HTML failure)",
        "cmsv2qacg0000re1e5p302w5n (dashboard session gaps)",
      ],
    },
    impact:
      "Blocks the entire org-governance wedge from cold install. Every agent that follows runtime _help hits a 200 HTML login and cannot create/join an org, register agents, or enforce tool policy. Free-key top-of-funnel never reaches the paid Team/governance surface.",
    acceptance_criteria: [
      "POST /account/keys/adopt is either a real authenticated JSON API (session or bearer) that adopts a key into the signed-in account and returns key id + account/org linkage, OR runtime _help/bootstrap detail stop advertising it until it exists",
      "Unauthenticated or wrong-auth adopt returns problem+json (401/403), never HTTP 200 HTML Login",
      "POST /v1/agents 403 _help for anonymous keys includes a working machine path: sign_up URL + what success looks like + adopt API once real; does not solely point at bootstrap that 403s the same key",
      "OpenAPI documents the real adopt/bootstrap/account linkage contract; no _help-only ghost routes",
      "Live probe: free keygen → documented path → either org membership or explicit human gate with JSON next_action; never 200 HTML on an advertised API POST",
      "Regression test pins: adopt never returns text/html; bootstrap _help.adopt.url either works as JSON or is removed",
    ],
    task_title:
      "Fix org first-mile: make key adopt a real JSON API or stop advertising it; close agents→bootstrap→adopt lie loop",
    task_body: [
      "## Goal",
      "Make the default Install Parse path able to reach org governance without lying.",
      "",
      "## Live failure (prod " + commit + ", " + observed_at + ")",
      "1. Free POST /v1/keys/generate works (anonymous).",
      "2. POST /v1/agents → 403 org required → help points to POST /v1/orgs/bootstrap.",
      "3. bootstrap → 403 anonymous_key → help points to POST /account/keys/adopt.",
      "4. POST /account/keys/adopt → **200 text/html Log In page** (with or without Bearer). Not an API.",
      "",
      "## Implementation options (pick simplest that is true)",
      "A. Implement POST /account/keys/adopt as session-auth JSON: body {key} or {key_id}, adopts into account, returns {adopted, account_id, org_id?}; 401 problem+json if not signed in.",
      "B. Or remove adopt from bootstrap/_help until A ships; replace with explicit {sign_up:'/signup', after:'create key while signed in then POST /v1/orgs/bootstrap'}.",
      "C. Optionally: allow paid non-anonymous keys to bootstrap per product-facts; keep free anonymous blocked but with honest JSON next_action.",
      "",
      "## Safety gates",
      "- Do NOT loosen org isolation or let anonymous keys become org_admin without account binding.",
      "- Do NOT implement silent auto-org for free anonymous keys (reopens governed-member escape).",
      "- Do NOT change billing prices, refunds, or security policy globally.",
      "- No secret logging. No production data deletes.",
      "- Prefer additive API + honest _help; keep claim-keys org_admin path intact.",
      "",
      "## Verify",
      "- curl adopt unauth → 401 problem+json (not 200 HTML)",
      "- signed-in adopt → JSON receipt; key shows account/org linkage",
      "- free anonymous: agents 403 help is followable without ghost routes",
      "- openapi lists real routes only",
      "- npm test focused on adopt/bootstrap help + html content-type guard",
      "",
      "## Out of scope",
      "Stripe copy, x402 facilitator, proposal inbox triage, hold/approve action_hash (separate open P0s).",
    ].join("\n"),
    task_assignee: "triage",
  };

  const result = await admin("admin.improvement_proposal.create", params);
  writeFileSync(
    "/tmp/saas_hourly_proposal_result.json",
    JSON.stringify({ params_title: params.title, params_idem: params.idempotency_key, result }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        http_status: result.status,
        idempotency_key: params.idempotency_key,
        title: params.title,
        result: result.body,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 500));
  process.exit(1);
});
