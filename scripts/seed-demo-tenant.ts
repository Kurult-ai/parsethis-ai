/**
 * Demo Tenant Provisioning — Task 13.5
 *
 * Creates a sandbox organization ("Demo Industries") with:
 * - 6 registered agents across risk levels
 * - A compliance-tier API key
 * - A policy revision (production = block mode)
 * - 50 realistic screening events across 72 hours
 * - A SIEM config (webhook placeholder)
 *
 * Idempotent: safe to run multiple times. Cleans up existing demo data first.
 *
 * Usage: npx tsx scripts/seed-demo-tenant.ts
 */

import "dotenv/config";
import { prisma } from "../src/db.js";
import { createApiKey } from "../src/api-key-service.js";

const DEMO_ORG_SLUG = "demo-industries";
const DEMO_OWNER_ID = "demo-owner-1";

const DEMO_AGENTS = [
  {
    agentName: "support-router",
    agentVersion: "2.1.0",
    framework: "openai-assistants",
    description: "Routes customer support tickets to the right specialist agent.",
    tools: ["zendesk", "stripe", "internal-crm"],
    dataAccess: ["public", "internal"],
    riskLevel: "medium",
    status: "active",
    ownerEmail: "ops@demo.industries",
  },
  {
    agentName: "code-review-bot",
    agentVersion: "1.4.2",
    framework: "langchain",
    description: "Reviews pull requests for security issues and style violations.",
    tools: ["github", "sonarqube"],
    dataAccess: ["public", "internal", "confidential"],
    riskLevel: "high",
    status: "active",
    ownerEmail: "eng@demo.industries",
  },
  {
    agentName: "rag-research",
    agentVersion: "0.9.1",
    framework: "crewai",
    description: "Answers internal research questions from a document corpus.",
    tools: ["pinecone", "web-search"],
    dataAccess: ["public", "internal"],
    riskLevel: "medium",
    status: "active",
    ownerEmail: "research@demo.industries",
  },
  {
    agentName: "payment-agent",
    agentVersion: "3.0.0",
    framework: "custom",
    description: "Processes refund requests and applies credits to customer accounts.",
    tools: ["stripe", "internal-billing"],
    dataAccess: ["confidential", "restricted"],
    riskLevel: "critical",
    status: "active",
    ownerEmail: "finance@demo.industries",
  },
  {
    agentName: "content-moderator",
    agentVersion: "1.2.0",
    framework: "autogen",
    description: "Reviews user-generated content for policy violations.",
    tools: ["content-api", "azure-content-safety"],
    dataAccess: ["public"],
    riskLevel: "low",
    status: "active",
    ownerEmail: "trust@demo.industries",
  },
  {
    agentName: "legacy-scrape-bot",
    agentVersion: "0.3.0",
    framework: "custom",
    description: "Scrapes competitor pricing pages weekly. No active owner.",
    tools: ["web-search", "puppeteer"],
    dataAccess: ["public"],
    riskLevel: "high",
    status: "suspended",
    frozen: true,
    frozenReason: "Flagged for unauthorized egress to unlisted domain — under investigation.",
    ownerEmail: "security@demo.industries",
  },
];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomRiskEvent() {
  const templates = [
    { verdict: "safe", riskScore: 0.4, categories: [], blocked: false, mode: "full" },
    { verdict: "safe", riskScore: 1.2, categories: [], blocked: false, mode: "full" },
    { verdict: "safe", riskScore: 0.0, categories: [], blocked: false, mode: "full" },
    { verdict: "elevated", riskScore: 4.5, categories: ["indirect_injection"], blocked: false, wouldBlock: true, mode: "full" },
    { verdict: "elevated", riskScore: 5.1, categories: ["social_engineering"], blocked: false, wouldBlock: true, mode: "full" },
    { verdict: "high_risk", riskScore: 7.8, categories: ["prompt_injection", "role_hijack"], blocked: true, mode: "full" },
    { verdict: "high_risk", riskScore: 8.4, categories: ["data_exfiltration", "code_execution"], blocked: true, mode: "full" },
    { verdict: "critical", riskScore: 9.6, categories: ["jailbreak", "credential_theft"], blocked: true, mode: "full" },
    { verdict: "safe", riskScore: 1.8, categories: [], blocked: false, mode: "full" },
    { verdict: "safe", riskScore: 0.9, categories: [], blocked: false, mode: "full" },
  ];
  const tpl = randomFrom(templates);
  const surfaces = ["input", "tool_result", "rag", "output", "handoff"];
  const environments = ["production", "staging", "development"];
  return {
    ...tpl,
    latencyMs: Math.floor(Math.random() * 800) + 120,
    surface: randomFrom(surfaces),
    environment: randomFrom(environments),
  };
}

async function seedDemoTenant() {
  console.log("🎭 Seeding demo tenant: Demo Industries\n");

  // 1. Clean up existing demo data
  const existingOrg = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
  });

  if (existingOrg) {
    console.log("  [cleanup] Removing existing demo org and all related data...");
    // Cascade deletes handle agents, policy revisions, SIEM configs, exports
    await prisma.screeningEvent.deleteMany({
      where: { apiKey: { orgId: existingOrg.id } },
    });
    await prisma.apiKey.deleteMany({
      where: { orgId: existingOrg.id },
    });
    await prisma.organization.delete({ where: { id: existingOrg.id } });
    console.log("  [cleanup] Done.\n");
  }

  // 2. Create organization
  const org = await prisma.organization.create({
    data: {
      name: "Demo Industries",
      slug: DEMO_ORG_SLUG,
      ownerId: DEMO_OWNER_ID,
      planTier: "compliance",
    },
  });
  console.log(`  [org] Created: ${org.name} (${org.slug}) — tier: ${org.planTier}`);

  // 3. Create API key (compliance tier)
  const { key, record: apiKey } = await createApiKey(
    DEMO_OWNER_ID,
    "Demo Compliance Key",
    "compliance",
    org.id,
  );
  console.log(`  [key] Created compliance-tier key (prefix: ${apiKey.keyPrefix})`);
  console.log(`        Demo key: ${key}`);

  // 4. Register agents
  for (const agent of DEMO_AGENTS) {
    const now = new Date();
    const daysAgo = Math.floor(Math.random() * 30) + 1;
    const firstSeen = new Date(now.getTime() - daysAgo * 86400000);
    const lastSeen = new Date(now.getTime() - Math.floor(Math.random() * 86400000));

    await prisma.agentRegistry.create({
      data: {
        orgId: org.id,
        agentName: agent.agentName,
        agentVersion: agent.agentVersion,
        framework: agent.framework,
        description: agent.description,
        tools: agent.tools,
        dataAccess: agent.dataAccess,
        riskLevel: agent.riskLevel,
        status: agent.status,
        frozen: agent.frozen || false,
        frozenReason: agent.frozenReason || null,
        frozenAt: agent.frozen ? new Date(now.getTime() - 86400000) : null,
        ownerEmail: agent.ownerEmail,
        deployedAt: firstSeen,
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen,
      },
    });
    console.log(`  [agent] ${agent.agentName} (${agent.riskLevel}, ${agent.status})`);
  }

  // 5. Create policy revision
  const policySnapshot = {
    enforcementMode: "block",
    environments: {
      production: { mode: "block", riskThreshold: 7.0 },
      staging: { mode: "warn", riskThreshold: 7.0 },
      development: { mode: "monitor", riskThreshold: 7.0 },
    },
    autoBlockCategories: ["prompt_injection", "data_exfiltration", "credential_theft"],
    siemForwarding: true,
    coverageAttestation: true,
    version: 1,
  };

  await prisma.policyRevision.create({
    data: {
      orgId: org.id,
      version: 1,
      policySnapshot: policySnapshot,
      changedBy: DEMO_OWNER_ID,
      changeReason: "Initial compliance-tier policy — production set to block mode.",
    },
  });
  console.log(`  [policy] Created v1 (production=block, staging=warn, development=monitor)`);

  // 6. Create SIEM config
  await prisma.sIEMConfig.create({
    data: {
      orgId: org.id,
      platform: "datadog",
      endpoint: "https://http-intake.logs.datadoghq.com/v1/input/placeholder",
      authHeader: "DD-API-KEY-PLACEHOLDER",
      format: "json",
      eventTypes: ["screening", "audit", "policy_change", "approval"],
      active: false, // disabled placeholder
    },
  });
  console.log(`  [siem] Created Datadog config (disabled placeholder)`);

  // 7. Seed screening events (50 events across last 72 hours)
  const now = Date.now();
  for (let i = 0; i < 50; i++) {
    const event = randomRiskEvent();
    const hoursAgo = Math.floor(Math.random() * 72);
    const createdAt = new Date(now - hoursAgo * 3600000);

    await prisma.screeningEvent.create({
      data: {
        apiKeyId: apiKey.id,
        riskScore: event.riskScore,
        verdict: event.verdict,
        categories: event.categories,
        mode: event.mode,
        latencyMs: event.latencyMs,
        blocked: event.blocked,
        wouldBlock: event.wouldBlock || null,
        enforcementMode: event.environment === "production" ? "block" : "warn",
        environment: event.environment,
        metadata: { surface: event.surface },
        createdAt,
      },
    });
  }
  console.log(`  [events] Seeded 50 screening events across 72 hours`);

  // 8. Summary
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Demo tenant provisioned.");
  console.log(`   Org: ${org.name} (${org.id})`);
  console.log(`   Tier: ${org.planTier}`);
  console.log(`   Agents: ${DEMO_AGENTS.length}`);
  console.log(`   Screening events: 50`);
  console.log(`   Policy: v1 (block in production)`);
  console.log(`   SIEM: configured (disabled)`);
  console.log("");
  console.log(`   View dashboard:`);
  console.log(`   https://www.parsethis.ai/dashboard/agents`);
  console.log(`   https://www.parsethis.ai/dashboard/compliance`);
  console.log("");
  console.log(`   Demo API key: ${key}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

seedDemoTenant()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
