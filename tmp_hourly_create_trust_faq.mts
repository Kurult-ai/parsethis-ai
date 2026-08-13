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
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
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
  idempotency_key: "elon-trust-vendor-faq-false-yes-overclaims-2026-08-13",
  title:
    "P0 TRUST/ENTERPRISE: /trust vendor questionnaire answers absolute Yes to SSO+MFA, SIEM real-time, pen-tests-under-NDA, multi-instance DR, and 99.9% SLA while live product contradicts — diligence surface is a lie factory",
  category: "docs_trust_legal",
  priority: 10,
  risk_level: "low",
  source: "elon_hourly_saas_improvement_loop",
  evidence: {
    observed_at: "2026-08-13T08:33:00Z",
    production_commit: "be8ec48",
    local_main: "9e75dd7",
    business_snapshot: {
      active_subscriptions: 0,
      payments_total: 0,
      api_keys_active: 42,
      screening_events_24h: 191,
      blocked_24h: 79,
      geo_7d_surface_hits: 2812,
      geo_7d_unique_clients: 275,
      trust_page_hits_7d: 177,
      open_improvement_proposals: 133,
      open_p0_priority_ge_9: 99,
    },
    live_probes: {
      "GET /trust": {
        http: 200,
        vendor_faq_questions: 30,
        absolute_yes_samples: [
          "Q8 MFA and SSO supported? => Yes. OAuth 2.0 / OIDC-based SSO (Team + Compliance tiers). MFA enforced for administrative access.",
          "Q23 Are penetration tests performed? => Yes. On a scheduled basis and prior to major releases. Reports available under NDA.",
          "Q26 Is SIEM integration available? => Yes. SIEM forwarding via HTTP webhook on Compliance tier. Real-time event forwarding.",
          "Q29 BCP/DR => Yes. Documented BCP/DR procedures. Multi-instance failover.",
          "Q30 uptime => Target 99.9% uptime. Formal SLA available on Compliance and Enterprise tiers.",
        ],
        soc2_badge: "SOC 2 Type II — In Progress (Q1 2027)",
        email_obfuscation_artifact: "[email protected] plain-text mangling on security contact answers",
      },
      "GET /v1/siem/status": { http: 404, body: "Not found" },
      "GET /v1/sso/login": { http: 404, body: "Not found" },
      "GET /v1/gateway/status with free self-serve key": {
        http: 200,
        status: "not_configured",
        gateway_mode: "available",
        org_id: null,
      },
      "POST /v1/orgs/bootstrap with free self-serve key": {
        http: 403,
        reason: "anonymous_key",
        note: "default keygen path cannot reach org-gated SSO/SIEM/gateway controls the FAQ sells",
      },
      "FEATURE_STATUS product-facts": {
        "SOC 2 Certification": "planned",
        "HIPAA Compliance": "planned",
        "ISO 27001 Certification": "planned",
        "SIEM Forwarding": "shipped in code facts, but live /v1/siem/status 404 on prod be8ec48",
      },
      brand_rules: {
        source: "docs/brand-guidelines.md + scripts/brand-lint.ts",
        note: "SOC2 must stay aligned/in-progress until a report exists; absolute Yes on unshipped enterprise controls still fails diligence even if lint allows 'in progress' phrasing",
      },
    },
    why_this_beats_backlog_noise:
      "Trust is the #6 agent/human discovery surface (177/7d). Enterprise buyers paste this FAQ into security reviews. False Yes answers create legal/reputational blast radius larger than another conversion micro-fix already filed 10 times.",
  },
  impact:
    "Unblocks honest enterprise procurement. Stops security questionnaires from being filled with claims prod cannot demonstrate. Reduces diligence rejection and brand/legal risk before first paid Compliance/Team deals.",
  acceptance_criteria: [
    "Every /trust vendor FAQ answer is classified against live capability: shipped-and-demoable | partial | planned | not offered",
    "No absolute Yes remains for controls that 404, are org-gated with no self-serve path, or lack a reproducible demo on production",
    "Q8 SSO/MFA, Q26 SIEM, Q23 pen-test NDA, Q29 multi-instance failover, Q30 formal 99.9% SLA either become demoable on prod or are rewritten to precise current state with no Yes theater",
    "SIEM answer matches live route reality (today GET /v1/siem/status = 404) or SIEM status endpoint is shipped and green before any Yes",
    "Security contact emails render as real addresses (no Cloudflare '[email protected]' mangled text) and match security.txt",
    "Add a CI/claims fixture that fails if /trust FAQ answers Yes for FEATURE_STATUS planned controls or known-missing routes",
    "Manual review by Danny on any residual SOC2/HIPAA/ISO/SLA wording before publish; no new certification claims",
  ],
  task_title:
    "Rewrite /trust vendor FAQ to live-demoable truth; kill false Yes on SSO/MFA/SIEM/pen-test/DR/SLA",
  task_body: `## Goal
Make /trust a diligence asset instead of a lie factory. Every vendor FAQ answer must survive contact with production.

## Evidence (prod be8ec48, 2026-08-13)
- GET /trust returns 30-question vendor FAQ with absolute Yes on SSO+MFA enforced, SIEM real-time, scheduled pen tests with NDA reports, multi-instance failover, and 99.9% uptime/formal SLA language.
- GET /v1/siem/status -> 404
- GET /v1/sso/login -> 404
- Free self-serve key: gateway status not_configured/org_id null; POST /v1/orgs/bootstrap -> 403 anonymous_key
- product-facts: SOC2/HIPAA/ISO = planned
- GEO: /trust ~177 hits/7d; business still 0 active paid subscriptions / 0 payments

## Implementation
1. Inventory each FAQ answer vs code route + FEATURE_STATUS + a production probe.
2. Rewrite non-demoable Yes answers to exact current state (planned / not offered / available after X).
3. Prefer linking to working endpoints (/status, /.well-known/security.txt, /v1/gateway/status) over adjectives.
4. Fix email obfuscation rendering for security@ and support@ contacts.
5. Add claims/brand fixture covering the FAQ Yes-list so it cannot silently regress.
6. Optional follow-up (separate gated task): implement missing status routes before restoring Yes.

## Safety gates
- Do NOT invent certifications, pen-test report availability, SLA contracts, or customer logos.
- Do NOT enable SSO/SIEM/MFA in production as part of this copy fix unless separately approved with tests.
- Do NOT change billing, auth hardening, secret material, or public incident language beyond trust-page accuracy.
- Copy-only PR is default blast radius; any control implementation is a separate approval.
- Danny reviews final SOC2/HIPAA/ISO/SLA sentences before merge if wording is stronger than "aligned" / "in progress" / "planned".

## Verification
- curl -s https://www.parsethis.ai/trust | fixtures assert no banned absolute Yes for known-missing controls
- npm run claims-lint && npm run brand-lint
- Probe matrix: /v1/siem/status, /v1/sso/*, /v1/gateway/status, security.txt contacts
- Receipt: before/after FAQ answer table in PR

Assignee: triage
Source: elon_hourly_saas_improvement_loop
`,
  task_assignee: "triage",
};

const created = await act("admin.improvement_proposal.create", proposal);
const body = created.body || {};
const prop =
  body.improvement_proposal ||
  body.result?.improvement_proposal ||
  body.proposal ||
  null;

console.log(
  JSON.stringify(
    scrub({
      http_status: created.status,
      deduped: body.deduped ?? body.result?.deduped ?? false,
      id: prop?.id,
      title: prop?.title,
      status: prop?.status,
      priority: prop?.priority,
      idempotency_key: prop?.idempotency_key || prop?.idempotencyKey,
      source: prop?.source,
      receipt_id: body.receipt?.id || body.result?.receipt?.id,
      raw_keys: Object.keys(body),
    }),
    null,
    2,
  ),
);
