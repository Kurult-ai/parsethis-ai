import { config } from "dotenv";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
if (!master) throw new Error("MASTER_API_KEY missing");

async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${master}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const idempotency_key = "elon-deep-quota-burns-on-llm-failed-full-mode-2026-08-23";
  const title =
    "P0 BILLING/TRUST: full-mode /v1/parse burns deep_screening quota while layers.llm=failed (pattern-only fallback still increments used)";

  const evidence = {
    probed_at: new Date().toISOString(),
    host: BASE,
    deploy_commit: "28f64a6",
    health_semantic_layer: {
      startup_check: "ok",
      detail: "Model provider credentials accepted at startup.",
      checked_at: "2026-08-23T00:16:06.145Z",
      note: "startup-ok is false green vs runtime llm_failed",
    },
    live_series: [
      {
        call: 1,
        mode: "full",
        http: 200,
        analysis_method: "pattern",
        layers: { pattern: "ran", llm: "failed" },
        degraded: true,
        degraded_reason: "llm_failed",
        deep_screening: { status: "ok", used: 1, included: 50, remaining: 49, window: "day" },
        suggested_action: "allow",
        risk_score: 0,
      },
      {
        call: 2,
        mode: "full",
        http: 200,
        analysis_method: "pattern",
        layers: { pattern: "ran", llm: "failed" },
        degraded: true,
        degraded_reason: "llm_failed",
        deep_screening: { status: "ok", used: 2, included: 50, remaining: 48, window: "day" },
      },
      {
        call: 3,
        mode: "full",
        http: 200,
        analysis_method: "pattern",
        layers: { pattern: "ran", llm: "failed" },
        degraded: true,
        degraded_reason: "llm_failed",
        deep_screening: { status: "ok", used: 3, included: 50, remaining: 47, window: "day" },
      },
      {
        call: "pattern-only control",
        mode: "pattern-only",
        http: 200,
        analysis_method: "pattern_only",
        layers: { pattern: "ran", llm: "skipped_pattern_only" },
        deep_screening: null,
        note: "pattern-only does not attach deep_screening — only failed full-mode burns the deep counter",
      },
    ],
    also_true_on: [
      "POST /v1/parse free key",
      "POST /v1/parse master key",
      "POST /demo/api",
      "POST /v1/screen-output",
    ],
    related_open_but_not_same: [
      "elon-openrouter-credits-402-kills-semantic-layer-2026-08-16 — LLM down root cause",
      "elon-semantic-runtime-llm-failed-health-false-green-2026-08-15 — health false green",
      "elon-screen-output-burns-deep-activity-never-2026-08-18 — screen-output burn + activity never; this card is parse full-mode deep meter under llm_failed",
    ],
    why_now:
      "Paid tiers sell deep screening volume. Live full-mode is pattern-only under llm_failed but still decrements remaining. Customer volume will hit deep caps without receiving the semantic layer they paid for. Separate from restoring OpenRouter: metering must not charge failed deep attempts.",
  };

  const impact =
    "Stops false deep-quota consumption during semantic outages; preserves paid deep budget for real LLM screens; makes degraded mode honest for Solo/Pro/Team conversion and retention.";

  const acceptance_criteria = [
    "When layers.llm === 'failed' (or analysis_method is pattern-only fallback from a requested full mode), deep_screening.used MUST NOT increment and remaining MUST NOT decrement for that request.",
    "Response still sets degraded:true + degraded_reason:'llm_failed' (or equivalent) so clients can see the outage.",
    "mode:'pattern-only' continues to skip deep metering (no regression).",
    "When LLM succeeds on full mode, deep_screening.used increments exactly once per successful deep/semantic attempt (pin with unit + live smoke).",
    "Add regression test: simulated llm_failed full-mode series keeps used constant; successful LLM series increments.",
    "Optional but preferred: /health.semantic_layer exposes a runtime probe (last success/fail), not only startup credential check — can be follow-on, not required to close metering bug.",
    "No billing/price/plan copy changes in this task unless a claim currently promises deep screens during outage — if so, gate copy change separately.",
  ];

  const task_title =
    "Do not burn deep_screening quota when full-mode falls back to pattern-only (llm_failed)";

  const task_body = `## Problem
Live prod commit 28f64a6 (2026-08-23 probe): POST /v1/parse mode=full returns layers.llm=failed, analysis_method=pattern, degraded_reason=llm_failed, HTTP 200 allow — and deep_screening.used still climbs 1→2→3 (included 50). pattern-only control does not attach deep_screening. Health still reports semantic_layer.startup_check=ok.

Customers on free/paid deep budgets are metered for semantic work they did not receive. This is a billing/trust defect independent of restoring OpenRouter.

## Related (do not reopen)
- OpenRouter/LLM restore: elon-openrouter-credits-402-kills-semantic-layer-2026-08-16 + semantic health false-green cards
- screen-output burn/activity: elon-screen-output-burns-deep-activity-never-2026-08-18

## Fix
1. In deep-screening accounting, only increment used when the semantic/deep layer actually ran successfully (or explicitly partially ran under a defined billable partial policy — default: failed = not used).
2. Keep degraded telemetry honest.
3. Pin with tests + a redacted prod smoke after deploy.

## Safety gates
- Read-only diagnosis first; no price/tier/limit number changes without Danny approval.
- No security-policy loosening.
- No customer emails.
- No secret rotation.
- Deploy only through normal review; verify /health deployment.commit, then smoke: three llm_failed full-mode calls must not move used (or if LLM is green again, inject fail path in unit test and confirm live success path still meters once).
- Rollback: revert metering condition if used stops incrementing on successful deep screens.

## Acceptance
See proposal acceptance_criteria.
`;

  const params = {
    idempotency_key,
    title,
    category: "billing",
    priority: 10,
    risk_level: "low",
    evidence,
    impact,
    acceptance_criteria,
    task_title,
    task_body,
    task_assignee: "triage",
    source: "elon_hourly_saas_improvement_loop",
  };

  const created = await admin("admin.improvement_proposal.create", params);
  const root = created.body?.result ?? created.body;
  const proposal =
    root?.improvement_proposal ||
    root?.proposal ||
    root?.admin_improvement_proposal ||
    root;

  console.log(
    JSON.stringify(
      {
        http: created.status,
        ok: created.status >= 200 && created.status < 300,
        deduped: Boolean(root?.deduped || root?.idempotent || proposal?.deduped),
        id: proposal?.id || root?.id,
        status: proposal?.status || root?.status,
        title: proposal?.title || title,
        idempotency_key,
        error: created.body?.error || created.body?.detail || created.body?.message,
        raw_keys: created.body && typeof created.body === "object" ? Object.keys(created.body) : [],
        result_keys: root && typeof root === "object" ? Object.keys(root) : [],
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
