import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const idempotencyKey = "elon-draft-role-fullmode-llm-cancel-kills-concession-2026-08-19";

  const existing = await prisma.adminImprovementProposal.findFirst({
    where: { idempotencyKey },
    select: { id: true, title: true, status: true, createdAt: true },
  });
  if (existing) {
    console.log("DEDUPED");
    console.log(JSON.stringify(existing, null, 2));
    await prisma.$disconnect();
    return;
  }

  const title =
    "P0 PRODUCT/DRAFT: default full-mode + LLM cancel flags kill draft role that pattern-only pins and get-started sell";

  const evidence = {
    measured_at: "2026-08-19T19:15:00Z",
    production_host: "https://www.parsethis.ai",
    production_commit: "3bc147e",
    production_version_note: "feat: bind draft redeem and name it for farah-nasser-draft-role",
    health_semantic_layer: "ok (llm green)",
    fixture: "run25 C1 recruiting override + bank-details wire ask",
    contract: {
      docs: "/get-started sells intended_action: draft + redeem review_obligation on /v1/screen-output",
      pin: "src/__tests__/run25-draft-role-pins.test.ts — C1 + draft is review + token in pattern-only",
      openapi_llms: "advertise draft / review_obligation",
    },
    live_matrix: {
      "C1_pattern-only_plain": {
        recommended_action: "block",
        disposition: "block",
        review_obligation: false,
        flag_ids: [
          "pattern.override_instructions",
          "pattern.override_prior_instructions",
          "intent.override_governing_instruction",
          "intent.fuzzy_override_token",
          "intent.direct_instruction_bypass",
        ],
      },
      "C1_pattern-only_draft": {
        recommended_action: "review",
        disposition: "review",
        review_obligation: true,
        note: "matches unit pin and product promise",
      },
      "C1_full_plain": {
        recommended_action: "block",
        disposition: "block",
        review_obligation: false,
        extra_llm_flags: ["llm.social_engineering", "llm.data_exfiltration"],
      },
      "C1_full_draft": {
        recommended_action: "block",
        disposition: "block",
        review_obligation: null,
        analysis_role_declared: "draft",
        analysis_role_reason:
          'intended_action "draft" means the agent may act on this content, so it is screened as an instruction.',
        killer: "llm.data_exfiltration (and llm.social_engineering) enter DRAFT_CANCEL_CATEGORIES so draftReviewEligible returns false only when the semantic layer actually runs",
      },
    },
    mechanism:
      "draftReviewEligible cancels on category data_exfiltration/social_engineering/prompt_injection etc. Default mode is full (pattern+llm). When LLM is healthy it restates the override as llm.data_exfiltration + llm.social_engineering, which voids the concession the override-family was designed to grant. Pattern-only pins and CI stay green while the default customer path never issues review_obligation.",
    free_key_default: "self-service keygen scopes [analyze,evaluate]; /v1/parse defaults to full mode, not pattern-only",
    open_proposal_backlog_context: "233 proposed / 0 with tasks — this is a fresh product contract break on today's draft-role ship, not a stale rehash",
    source: "elon_hourly_saas_improvement_loop live curl matrix 2026-08-19",
  };

  const acceptanceCriteria = [
    "Live default POST /v1/parse (no mode / mode=full) with run25 C1 + metadata.intended_action=draft + source_kind=email returns recommended_action=review, disposition=review, and a non-null review_obligation.token while only override-family deterministic flags plus LLM restatements of that same override are present",
    "LLM flags that merely restate an already-eligible override family must not void draftReviewEligible; true cancel families (e.g. local secret file exfil C4, credential exfil) still force block under draft",
    "run25 pin 'C1 + draft is review + token' still passes in pattern-only; add a full-mode pin that fails closed on today's bug and passes after the fix",
    "Redeem path: POST /v1/screen-output with output + context=inbound + review_obligation token returns obligation redeemed metadata and still screens the draft",
    "get-started / llms / OpenAPI copy continue to match live default-mode behavior (no 'works only in pattern-only' trap)",
    "C4 under draft remains block with no obligation",
  ];

  const taskBody = [
    "## Problem",
    "Prod is on 3bc147e ('bind draft redeem' / farah-nasser-draft-role). get-started sells: drafting agents send intended_action: draft on /v1/parse and redeem review_obligation on /v1/screen-output.",
    "Unit pin passes only in pattern-only. Default full mode with a healthy LLM never issues the obligation for the hero C1 fixture.",
    "",
    "## Live proof (www.parsethis.ai, free self-service key, 2026-08-19)",
    "- C1 pattern-only + draft → recommended_action=review, review_obligation.token present",
    "- C1 full + draft → recommended_action=block, disposition=block, review_obligation=null even though analysis_role.declared=draft",
    "- Full mode adds llm.social_engineering + llm.data_exfiltration; data_exfiltration is in DRAFT_CANCEL_CATEGORIES, so draftReviewEligible flips false only when semantic layer runs",
    "",
    "## Root cause",
    "src/lib/analysis-role.ts draftReviewEligible + DRAFT_CANCEL_CATEGORIES treat LLM restatements of the override as cancel categories. The concession was designed around override-family deterministic flags (pattern-only pin path). Shipping LLM-green full mode as default makes the sold draft role dead on arrival for the recruiting/helpdesk drafting agents the landing page targets.",
    "",
    "## Fix direction (pick one, prove with pins)",
    "1) Preferred: when intended_action=draft and the only block-floor deterministic flags are override-family, do not let LLM categories that lack independent exfil/credential/exec evidence cancel the concession; still cancel on C4-class exfil and true credential theft.",
    "2) Or: if product intent is cancel-on-LLM, stop selling draft as working on default full mode and fail the run25 conversion pins until default mode matches docs — do not leave CI green on a mode customers do not use.",
    "",
    "## Implementation sketch",
    "- Tighten isDraftCancelFlag / draftReviewEligible so LLM flags require independent cancel evidence beyond restating override/social phrasing already covered by eligible deterministic override family",
    "- Ensure issueDraftObligation still binds prompt hash + apiKeyId",
    "- Add full-mode C1+draft pin next to pattern-only pin",
    "- Keep C4+draft block pin",
    "- Smoke redeem on /v1/screen-output with review_obligation + context",
    "",
    "## Safety gates",
    "- Do NOT weaken cancel on data_exfiltration that is independently evidenced (secrets, local files, credential shapes)",
    "- Do NOT auto-allow under draft — only review + obligation",
    "- Do NOT change billing, Stripe, security policy globals, or deploy without Danny approval",
    "- Do NOT contact customers",
    "- Verify with: npx tsx --test src/__tests__/run25-draft-role-pins.test.ts src/lib/draft-obligation.test.ts src/lib/analysis-role.test.ts",
    "- Post-deploy live matrix: C1 full+draft => review+token; C1 plain => block; C4 draft => block; redeem once then spent",
  ].join("\n");

  const proposal = await prisma.adminImprovementProposal.create({
    data: {
      idempotencyKey,
      title,
      category: "product",
      priority: 10,
      riskLevel: "high-if-ignored",
      evidence,
      impact:
        "The draft-role ship is false green. CI and pattern-only pins pass; default customer path (full mode, LLM healthy) never returns review_obligation for the exact drafting-agent fixture get-started and run25 sell. Reply-drafting agents — the landing persona — still only get hard blocks, so the precision control that was meant to convert helpdesk/recruiting agents is dead in production while docs claim it works.",
      acceptanceCriteria,
      taskTitle: "Make draft role issue review_obligation on default full mode for C1-class overrides",
      taskBody,
      taskAssignee: "triage",
      source: "elon_hourly_saas_improvement_loop",
      status: "proposed",
    },
  });

  console.log("CREATED");
  console.log(JSON.stringify({ id: proposal.id, title: proposal.title, status: proposal.status, idempotencyKey: proposal.idempotencyKey }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERROR", String(e).slice(0, 500));
  process.exit(1);
});
