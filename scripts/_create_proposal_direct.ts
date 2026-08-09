import "dotenv/config";
import fs from "fs";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const idempotencyKey = "elon-migration-gap-13-tables-unmigrated-2026-08-09";

  // Check if proposal already exists (dedupe)
  const existing = await prisma.adminImprovementProposal.findFirst({
    where: { idempotencyKey },
    select: { id: true, title: true, status: true }
  });

  if (existing) {
    console.log("DEDUPED - proposal already exists:");
    console.log(JSON.stringify(existing, null, 2));
    await prisma.$disconnect();
    return;
  }

  const proposal = await prisma.adminImprovementProposal.create({
    data: {
      idempotencyKey,
      title: "P0 DEPLOY BLOCKER: 13 tables + 5 columns have zero migration files — production deploy of current code will break the entire admin plane",
      category: "reliability",
      priority: 10,
      riskLevel: "high-if-ignored",
      evidence: {
        unmigrated_tables: [
          "agent_data_grants", "agent_registry", "compliance_exports",
          "compliance_receipts", "data_sources", "delegation_chains",
          "egress_rules", "organizations", "policy_revisions",
          "siem_configs", "signed_identities", "sso_providers", "volume_budgets"
        ],
        unmigrated_columns: {
          api_keys: ["role", "org_id"],
          screening_events: ["environment", "would_block", "enforcement_mode"]
        },
        migrated_table_count: 15,
        total_table_count: 27,
        production_commit: "a26b3761a4530912a3f3a064d814e7c70a5bb128",
        local_head: "d8d5351",
        commits_ahead: 23,
        live_symptom: "admin.dashboard.snapshot returns 500 (screeningEvent.findMany fails), admin.billing.anomaly.scan returns 500 (subscription.findMany fails with include:{apiKey} hitting api_keys.role column drift)",
        source: "live collector run 2026-08-09T00:05Z plus local DB introspection"
      },
      impact: "Production is frozen 23 commits behind local. Every commit after a26b376 added schema without a migration SQL file. Deploying current code will crash every admin action that touches any of these 13 tables or the 5 unmigrated columns. This blocks ALL SaaS-readiness work: no deploy, no fix, no ship.",
      acceptanceCriteria: [
        "prisma/migrations/011_add_compliance_and_org_tables.sql exists with CREATE TABLE IF NOT EXISTS for all 13 unmigrated tables matching the Prisma schema exactly",
        "prisma/migrations/012_add_missing_columns.sql adds api_keys.role, api_keys.org_id, screening_events.environment, screening_events.would_block, screening_events.enforcement_mode",
        "All migration files are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)",
        "Running all migrations sequentially on a fresh empty DB produces the same schema as the local development DB",
        "admin.dashboard.snapshot returns 200 on production after deploy",
        "admin.billing.anomaly.scan returns 200 on production after deploy"
      ],
      taskTitle: "Create migration files for 13 unmigrated tables + 5 unmigrated columns",
      taskBody: [
        "## Problem",
        "13 tables and 5 columns exist in schema.prisma but have NO migration SQL files.",
        "Production DB (at commit a26b376) lacks them entirely. Local DB has them (created via prisma db push or ad hoc SQL).",
        "The gap was introduced by feature commits between 58c7698 and d8d5351.",
        "",
        "## Unmigrated Tables (13)",
        "agent_data_grants, agent_registry, compliance_exports, compliance_receipts,",
        "data_sources, delegation_chains, egress_rules, organizations, policy_revisions,",
        "siem_configs, signed_identities, sso_providers, volume_budgets",
        "",
        "## Unmigrated Columns (5)",
        "- api_keys: role (varchar, default developer), org_id (varchar, nullable)",
        "- screening_events: environment (varchar, default production), would_block (boolean nullable), enforcement_mode (varchar nullable)",
        "",
        "## Fix",
        "1. Generate prisma/migrations/011_add_compliance_and_org_tables.sql with CREATE TABLE IF NOT EXISTS for all 13 tables.",
        "2. Generate prisma/migrations/012_add_missing_columns.sql with ALTER TABLE ADD COLUMN IF NOT EXISTS for all 5 columns.",
        "3. Both files must be idempotent (safe to run on local DB which already has them).",
        "4. Verify: npx prisma generate succeeds, then run a count() query on each of the 13 models.",
        "",
        "## Safety gates",
        "- Do NOT run prisma migrate reset on any DB",
        "- Do NOT run prisma db push (it creates schema without migration history)",
        "- Test migrations on a fresh throwaway DB first",
        "- Production deployment of migrations requires Dannys explicit approval",
        "- After deploy: verify admin.dashboard.snapshot and admin.billing.anomaly.scan return 200"
      ].join("\n"),
      taskAssignee: "triage",
      source: "elon_hourly_saas_improvement_loop",
      status: "proposed"
    }
  });

  console.log("CREATED PROPOSAL:");
  console.log("  ID:", proposal.id);
  console.log("  Title:", proposal.title);
  console.log("  Status:", proposal.status);
  console.log("  IdempotencyKey:", proposal.idempotencyKey);

  await prisma.$disconnect();
}

main().catch(e => { console.error("ERROR:", e.message.substring(0, 500)); process.exit(1); });
