/**
 * Compliance Control Panel API Routes
 *
 * /v1/compliance/audit-trail      — Query the complete audit trail (screening events + audit events)
 * /v1/compliance/summary          — Dashboard summary: counts, risk distribution, trends, top categories
 * /v1/compliance/framework-map    — Framework crosswalk (OWASP, NIST, EU AI Act, ISO 42001, SOC 2)
 * /v1/compliance/export           — Generate tamper-evident evidence export (JSON/CSV)
 * /v1/compliance/siem             — Configure SIEM forwarding (Splunk, Datadog, Elastic, Sentinel, webhook)
 * /v1/compliance/siem/test        — Test SIEM connection
 *
 * Auth: requires 'evaluate' scope (same as policy routes)
 * Access: per-API-key, scoped to the key's org
 */

import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { prisma } from "../db.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { createHash, randomUUID } from "node:crypto";
import {
  generateFullCrosswalk,
  generateCoverageReport,
} from "../lib/compliance/framework-crosswalk.js";
import {
  forwardToSIEM,
  testSIEMConnection,
  type PrismaSIEMConfig,
} from "../lib/compliance/siem-forwarder.js";

export const complianceRoutes = new Hono<AppEnv>();

// ─── GET /v1/compliance/summary — Dashboard data ───────────────────────

complianceRoutes.get("/v1/compliance/summary", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    const [
      totalScreenings,
      screenings24h,
      blockedTotal,
      blocked24h,
      verdictGroups,
      catGroups,
      recentScreenings,
      auditCount,
      recentAudit,
      policyChanges,
      topAgentsByRisk,
      policyRow,
    ] = await Promise.all([
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id } }),
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id, blocked: true } }),
      prisma.screeningEvent.count({ where: { apiKeyId: apiKey.id, blocked: true, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.groupBy({
        by: ["verdict"],
        where: { apiKeyId: apiKey.id },
        _count: true,
        orderBy: { _count: { verdict: "desc" } },
      }),
      prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
        SELECT unnest(categories) as category, count(*) as count
        FROM screening_events
        WHERE api_key_id = ${apiKey.id}
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.screeningEvent.findMany({
        where: { apiKeyId: apiKey.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          riskScore: true,
          verdict: true,
          categories: true,
          blocked: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.auditEvent.count({ where: { apiKeyId: apiKey.id } }),
      prisma.auditEvent.findMany({
        where: { apiKeyId: apiKey.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, detail: true, createdAt: true },
      }),
      prisma.auditEvent.count({
        where: { apiKeyId: apiKey.id, action: { in: ["policy_updated", "policy_deleted"] } },
      }),
      prisma.$queryRaw<Array<{ agent_id: string; count: bigint; avg_risk: number }>>`
        SELECT
          (metadata->>'agent_id')::text as agent_id,
          count(*) as count,
          AVG(risk_score)::float as avg_risk
        FROM screening_events
        WHERE api_key_id = ${apiKey.id}
          AND metadata->>'agent_id' IS NOT NULL
        GROUP BY agent_id
        ORDER BY avg_risk DESC
        LIMIT 5
      `,
      prisma.screeningPolicy.findUnique({ where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment: "production" } } }),
    ]);

    // Compute active enforcement holes count
    let holeCount = 0;
    if (policyRow) {
      const now = Date.now();
      // Bypass codeword (active or expired-but-not-cleaned)
      if (policyRow.bypassEnabled && policyRow.bypassCodewordHash) holeCount++;
      // Monitor enforcement mode
      if (policyRow.enforcementMode === "monitor") holeCount++;
      // Disabled screening toggles
      if (!policyRow.screenUserInput) holeCount++;
      if (!policyRow.screenToolOutputs) holeCount++;
      if (!policyRow.screenForwardedMessages) holeCount++;
      if (!policyRow.executeInSandbox) holeCount++;
    }

    return c.json({
      kpis: {
        total_screenings: totalScreenings,
        screenings_24h: screenings24h,
        total_blocked: blockedTotal,
        blocked_24h: blocked24h,
        pass_rate: totalScreenings > 0 ? ((1 - blockedTotal / totalScreenings) * 100).toFixed(1) : "100",
        total_audit_events: auditCount,
        policy_changes: policyChanges,
      },
      risk_distribution: verdictGroups.map(r => ({ verdict: r.verdict, count: r._count })),
      top_categories: catGroups.map(r => ({ category: r.category, count: Number(r.count) })),
      recent_screenings: recentScreenings,
      recent_audit: recentAudit,
      top_agents_by_risk: topAgentsByRisk.map(r => ({
        agent_id: r.agent_id,
        screenings: Number(r.count),
        avg_risk: Number(r.avg_risk?.toFixed(2) ?? 0),
      })),
      enforcement_holes: holeCount,
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[compliance] summary error:", (err as Error).message);
    return c.json({
      kpis: { total_screenings: 0, screenings_24h: 0, total_blocked: 0, blocked_24h: 0, pass_rate: "100", total_audit_events: 0, policy_changes: 0 },
      risk_distribution: [],
      top_categories: [],
      recent_screenings: [],
      recent_audit: [],
      top_agents_by_risk: [],
      enforcement_holes: 0,
      generated_at: new Date().toISOString(),
    });
  }
});

// ─── GET /v1/compliance/audit-trail — Full audit trail ──────────────────

complianceRoutes.get("/v1/compliance/audit-trail", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const offset = Number(c.req.query("offset") ?? "0");
  const fromDate = c.req.query("from");
  const toDate = c.req.query("to");
  const verdict = c.req.query("verdict");
  const blockedOnly = c.req.query("blocked") === "true";

  const where: Record<string, unknown> = { apiKeyId: apiKey.id };
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) (where.createdAt as Record<string, unknown>).gte = new Date(fromDate);
    if (toDate) (where.createdAt as Record<string, unknown>).lte = new Date(toDate);
  }
  if (verdict) where.verdict = verdict;
  if (blockedOnly) where.blocked = true;

  try {
    const [events, total] = await Promise.all([
      prisma.screeningEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.screeningEvent.count({ where }),
    ]);

    return c.json({
      events,
      total,
      limit,
      offset,
      has_more: offset + events.length < total,
    });
  } catch (err) {
    console.error("[compliance] audit-trail error:", (err as Error).message);
    return c.json({ events: [], total: 0, limit, offset, has_more: false });
  }
});

// ─── GET /v1/compliance/framework-map — Framework crosswalk ─────────────

complianceRoutes.get("/v1/compliance/framework-map", authMiddleware("evaluate"), async (c) => {
  const crosswalk = generateFullCrosswalk();
  return c.json(crosswalk);
});

complianceRoutes.get("/v1/compliance/framework-map/:framework", authMiddleware("evaluate"), async (c) => {
  const framework = c.req.param("framework");
  const crosswalk = generateFullCrosswalk();

  switch (framework) {
    case "owasp":
    case "owasp-llm":
      return c.json({ framework: "owasp_llm_2025", controls: crosswalk.frameworks.owasp_llm_2025 });
    case "nist":
    case "nist-ai-rmf":
      return c.json({ framework: "nist_ai_rmf", controls: crosswalk.frameworks.nist_ai_rmf });
    case "eu":
    case "eu-ai-act":
      return c.json({ framework: "eu_ai_act", controls: crosswalk.frameworks.eu_ai_act });
    case "iso":
    case "iso-42001":
      return c.json({ framework: "iso_42001", controls: crosswalk.frameworks.iso_42001 });
    case "soc2":
      return c.json({ framework: "soc2_tsc", controls: crosswalk.frameworks.soc2_tsc });
    default:
      return c.json({ error: `Unknown framework: ${framework}. Valid: owasp-llm, nist-ai-rmf, eu-ai-act, iso-42001, soc2` }, 400);
  }
});

// ─── GET /v1/compliance/coverage — Framework coverage report ────────────

complianceRoutes.get("/v1/compliance/coverage", authMiddleware("evaluate"), async (c) => {
  return c.json({ frameworks: generateCoverageReport() });
});

// ─── POST /v1/compliance/export — Generate evidence export ──────────────

complianceRoutes.post("/v1/compliance/export", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json().catch(() => ({}));

  const framework = body.framework ?? "all";
  const dateFrom = body.date_from ? new Date(body.date_from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = body.date_to ? new Date(body.date_to) : new Date();
  const format = body.format ?? "json";

  try {
    // Gather all evidence
    const [screenings, auditEvents] = await Promise.all([
      prisma.screeningEvent.findMany({
        where: { apiKeyId: apiKey.id, createdAt: { gte: dateFrom, lte: dateTo } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.auditEvent.findMany({
        where: { apiKeyId: apiKey.id, createdAt: { gte: dateFrom, lte: dateTo } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const crosswalk = generateFullCrosswalk();

    const evidence = {
      export_metadata: {
        generated_at: new Date().toISOString(),
        api_key_id: apiKey.id,
        api_key_name: apiKey.name,
        date_range: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
        framework,
        format,
      },
      summary: {
        total_screening_events: screenings.length,
        total_audit_events: auditEvents.length,
        blocked_events: screenings.filter(s => s.blocked).length,
        risk_distribution: screenings.reduce((acc, s) => {
          acc[s.verdict] = (acc[s.verdict] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        categories_observed: [...new Set(screenings.flatMap(s => s.categories))],
      },
      framework_crosswalk: framework === "all" ? crosswalk : {
        [framework]: (crosswalk.frameworks as Record<string, unknown[]>)[framework] ?? [],
      },
      screening_events: screenings,
      audit_events: auditEvents,
    };

    const jsonStr = JSON.stringify(evidence, null, 2);
    const hash = createHash("sha256").update(jsonStr).digest("hex");

    // Store export record (best effort — table might not exist yet)
    try {
      await prisma.$executeRaw`
        INSERT INTO compliance_exports (id, org_id, requested_by, status, framework, date_from, date_to, format, artifact_hash, event_count, size_bytes, completed_at, created_at)
        VALUES (${randomUUID()}, ${apiKey.id}, ${apiKey.id}, 'ready', ${framework}, ${dateFrom}, ${dateTo}, ${format}, ${hash}, ${screenings.length + auditEvents.length}, ${Buffer.byteLength(jsonStr)}, NOW(), NOW())
      `;
    } catch {
      // Table might not exist yet — non-blocking
    }

    auditLog({
      action: "compliance_export_generated",
      apiKeyId: apiKey.id,
      detail: `Evidence export: ${screenings.length} screening events, ${auditEvents.length} audit events, framework=${framework}`,
    });

    // Return the export directly (for smaller exports) or with download URL
    if (Buffer.byteLength(jsonStr) < 5_000_000) {
      return c.json({
        ...evidence,
        export_integrity: {
          sha256: hash,
          note: "Verify this hash to ensure the export has not been tampered with.",
        },
      });
    }

    return c.json({
      status: "ready",
      sha256: hash,
      event_count: screenings.length + auditEvents.length,
      size_bytes: Buffer.byteLength(jsonStr),
      note: "Export too large for inline response. Implement storage-backed delivery.",
    });
  } catch (err) {
    console.error("[compliance] export error:", (err as Error).message);
    return c.json({ error: "Failed to generate export", detail: (err as Error).message }, 500);
  }
});

// ─── SIEM Configuration ─────────────────────────────────────────────────

complianceRoutes.get("/v1/compliance/siem", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  try {
    const configs = await prisma.$queryRaw<PrismaSIEMConfig[]>`
      SELECT * FROM siem_configs WHERE org_id = ${apiKey.id} ORDER BY created_at DESC
    `;
    // Don't expose auth headers
    const safe = configs.map(({ authHeader, ...rest }) => ({ ...rest, auth_header_configured: Boolean(authHeader) }));
    return c.json({ configs: safe });
  } catch {
    return c.json({ configs: [], note: "SIEM table not yet migrated. Run prisma migrate." });
  }
});

complianceRoutes.post("/v1/compliance/siem", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  const { platform, endpoint, auth_header, format, event_types } = body;

  if (!platform || !endpoint) {
    return c.json({ error: "platform and endpoint are required" }, 400);
  }

  const validPlatforms = ["splunk", "datadog", "elastic", "sentinel", "generic_webhook"];
  if (!validPlatforms.includes(platform)) {
    return c.json({ error: `Invalid platform. Valid: ${validPlatforms.join(", ")}` }, 400);
  }

  const id = crypto.randomUUID();
  const orgId = apiKey.id;
  const fmt = format ?? "json";
  const evtTypes = event_types ?? ["screening", "audit", "policy_change", "approval"];

  try {
    await prisma.$executeRaw`
      INSERT INTO siem_configs (id, org_id, platform, endpoint, auth_header, format, event_types, active, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${platform}, ${endpoint}, ${auth_header ?? null}, ${fmt}, ${evtTypes}, true, NOW(), NOW())
    `;

    auditLog({
      action: "siem_config_created",
      apiKeyId: apiKey.id,
      detail: `SIEM config created: ${platform} → ${endpoint}`,
    });

    return c.json({ id, platform, endpoint, format: fmt, event_types: evtTypes, status: "active" });
  } catch (err) {
    console.error("[compliance] siem create error:", (err as Error).message);
    return c.json({ error: "Failed to create SIEM config", detail: (err as Error).message }, 500);
  }
});

complianceRoutes.post("/v1/compliance/siem/test", authMiddleware("evaluate"), async (c) => {
  const body = await c.req.json();
  const { platform, endpoint, auth_header, format } = body;

  if (!platform || !endpoint) {
    return c.json({ error: "platform and endpoint are required" }, 400);
  }

  const testConfig: PrismaSIEMConfig = {
    id: "test",
    orgId: "test",
    platform,
    endpoint,
    authHeader: auth_header ?? null,
    format: format ?? "json",
    eventTypes: ["test"],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const result = await testSIEMConnection(testConfig);
  return c.json(result);
});

complianceRoutes.delete("/v1/compliance/siem/:id", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const configId = c.req.param("id");
  const orgId = apiKey.id;

  try {
    await prisma.$executeRaw`DELETE FROM siem_configs WHERE id = ${configId} AND org_id = ${orgId}`;
    auditLog({ action: "siem_config_deleted", apiKeyId: apiKey.id, detail: `SIEM config ${configId} deleted` });
    return c.json({ status: "deleted", id: configId });
  } catch (err) {
    return c.json({ error: "Failed to delete", detail: (err as Error).message }, 500);
  }
});

// ─── GET /v1/compliance/policy-history — Policy change history ──────────

complianceRoutes.get("/v1/compliance/policy-history", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const orgId = apiKey.id;

  try {
    const revisions = await prisma.$queryRaw<Array<{
      id: string; version: number; policy_snapshot: unknown; changed_by: string;
      change_reason: string | null; diff: unknown; created_at: Date;
    }>>`
      SELECT * FROM policy_revisions WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 50
    `;
    return c.json({ revisions });
  } catch {
    return c.json({ revisions: [], note: "Policy revision table not yet migrated." });
  }
});
