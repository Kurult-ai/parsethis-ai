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
import { Prisma } from "../generated/prisma/client.js";
import type { AppEnv } from "../types.js";
import { auditLog } from "../lib/audit-log.js";
import { randomUUID } from "node:crypto";
import {
  generateFullCrosswalk,
  generateCoverageReport,
} from "../lib/compliance/framework-crosswalk.js";
import { generateEvidencePack } from "../lib/compliance/evidence-pack.js";
import {
  getCoverageReport as getAttestationReport,
  getAgentCoverageRows,
  coverageRowsToCSV,
  resolveOrgIdForCoverage,
} from "../lib/compliance/coverage-attestation.js";
import {
  forwardToSIEM,
  testSIEMConnection,
  type PrismaSIEMConfig,
} from "../lib/compliance/siem-forwarder.js";
import {
  DEFAULT_ALERT_RULE_TEMPLATES,
  instantiateTemplate,
  type AlertRuleDBRow,
  type AlertRuleTemplate,
} from "../lib/compliance/alert-rules.js";
import { getSIEMStatus, checkDestinationHealth } from "../lib/compliance/siem-worker.js";
import { policyHistoryScope } from "../lib/compliance/policy-history-scope.js";
import { sealSecret } from "../lib/secret-box.js";
import { resolveOrgId, orgScopedWhere, auditScopedWhere } from "../lib/org-scope.js";
import { requireRole } from "../lib/rbac.js";
import { problem, ErrorCode, serviceDependencyProblem } from "../lib/problem-response.js";

export const complianceRoutes = new Hono<AppEnv>();

// ─── GET /v1/compliance/summary — Dashboard data ───────────────────────

complianceRoutes.get("/v1/compliance/summary", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // The org this key belongs to, or itself. Everything below is scoped through
  // this — an org_admin asking about compliance is asking about their
  // organisation, not about the traffic they personally generated.
  const orgId = await resolveOrgId(apiKey.id);
  const scope = orgScopedWhere(orgId, apiKey.id);
  const auditScope = await auditScopedWhere(orgId, apiKey.id);
  // The two raw aggregates below join api_keys to reach org_id.
  const orgFilter = orgId
    ? Prisma.sql`k.org_id = ${orgId}`
    : Prisma.sql`e.api_key_id = ${apiKey.id}`;

  try {
    const [
      totalScreenings,
      screenings24h,
      blockedTotal,
      blocked24h,
      verdictGroups,
      dispositionGroups,
      catGroups,
      recentScreenings,
      auditCount,
      recentAudit,
      policyChanges,
      topAgentsByRisk,
      policyRow,
    ] = await Promise.all([
      prisma.screeningEvent.count({ where: scope }),
      prisma.screeningEvent.count({ where: { ...scope, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.count({ where: { ...scope, blocked: true } }),
      prisma.screeningEvent.count({ where: { ...scope, blocked: true, createdAt: { gte: since24h } } }),
      prisma.screeningEvent.groupBy({
        by: ["verdict"],
        where: scope,
        _count: true,
        orderBy: { _count: { verdict: "desc" } },
      }),
      // What Parse DID, beside what it found. "We screened N prompts" and "we
      // screened N and reported rather than refused M of them" are different
      // sentences to an auditor, and only the first one was answerable.
      prisma.screeningEvent.groupBy({
        by: ["disposition"],
        where: scope,
        _count: true,
      }),
      prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
        SELECT unnest(e.categories) as category, count(*) as count
        FROM screening_events e
        JOIN api_keys k ON k.id = e.api_key_id
        WHERE ${orgFilter}
        GROUP BY category
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.screeningEvent.findMany({
        where: scope,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          riskScore: true,
          verdict: true,
          categories: true,
          blocked: true,
          disposition: true,
          analysisRole: true,
          createdAt: true,
          metadata: true,
        },
      }),
      prisma.auditEvent.count({ where: auditScope }),
      prisma.auditEvent.findMany({
        where: auditScope,
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, action: true, detail: true, createdAt: true },
      }),
      prisma.auditEvent.count({
        where: { ...auditScope, action: { in: ["policy_updated", "policy_deleted", "org_policy_defaults.updated", "org_tool_rule.created", "org_tool_rule.deleted"] } },
      }),
      prisma.$queryRaw<Array<{ agent_id: string; count: bigint; avg_risk: number }>>`
        SELECT
          (e.metadata->>'agent_id')::text as agent_id,
          count(*) as count,
          AVG(e.risk_score)::float as avg_risk
        FROM screening_events e
        JOIN api_keys k ON k.id = e.api_key_id
        WHERE ${orgFilter}
          AND e.metadata->>'agent_id' IS NOT NULL
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
      // block = refused. report = the caller declared the content is subject
      // matter, so the finding stands and the refusal does not. Rows with a
      // null disposition predate the column (migration 019).
      dispositions: dispositionGroups.map(r => ({ disposition: r.disposition ?? "unrecorded", count: r._count })),
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
      dispositions: [],
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

complianceRoutes.get("/v1/compliance/audit-trail", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const limit = Math.min(Number(c.req.query("limit") ?? "100"), 500);
  const offset = Number(c.req.query("offset") ?? "0");
  const fromDate = c.req.query("from");
  const toDate = c.req.query("to");
  const verdict = c.req.query("verdict");
  const blockedOnly = c.req.query("blocked") === "true";
  const dispositionFilter = c.req.query("disposition");

  // The decision log for the caller's organisation, not for the caller's own
  // key. An org_admin asking "what did we screen" was previously answered with
  // "what did you personally screen", which for an admin who runs no traffic is
  // an empty list.
  const orgId = await resolveOrgId(apiKey.id);
  const where: Record<string, unknown> = { ...orgScopedWhere(orgId, apiKey.id) };
  if (fromDate || toDate) {
    where.createdAt = {};
    if (fromDate) (where.createdAt as Record<string, unknown>).gte = new Date(fromDate);
    if (toDate) (where.createdAt as Record<string, unknown>).lte = new Date(toDate);
  }
  if (verdict) where.verdict = verdict;
  // `blocked` now means refused, so this filter returns refusals rather than
  // every high-scoring finding including the ones deliberately not refused.
  if (blockedOnly) where.blocked = true;
  // Answers the auditor's second question directly: show me the screens that
  // were reported rather than refused because a caller declared them.
  if (dispositionFilter) where.disposition = dispositionFilter;

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

complianceRoutes.get("/v1/compliance/framework-map", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const crosswalk = generateFullCrosswalk();
  return c.json(crosswalk);
});

complianceRoutes.get("/v1/compliance/framework-map/:framework", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
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

complianceRoutes.get("/v1/compliance/coverage", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  return c.json({ frameworks: generateCoverageReport() });
});

// ─── POST /v1/compliance/export — Generate structured evidence pack ─────

complianceRoutes.post("/v1/compliance/export", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json().catch(() => ({}));

  const framework = body.framework ?? body.fw ?? "all";
  const dateFrom = body.date_from ? new Date(body.date_from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const dateTo = body.date_to ? new Date(body.date_to) : new Date();
  const format = body.format ?? "json";
  const download = body.download === true || c.req.query("download") === "true";

  try {
    const evidencePack = await generateEvidencePack(
      apiKey.id,
      framework,
      dateFrom,
      dateTo,
      await resolveOrgId(apiKey.id),
    );

    // Store export record (best effort — table might not exist yet)
    try {
      await prisma.$executeRaw`
        INSERT INTO compliance_exports (id, org_id, requested_by, status, framework, date_from, date_to, format, artifact_hash, event_count, size_bytes, completed_at, created_at)
        VALUES (${randomUUID()}, ${apiKey.id}, ${apiKey.id}, 'ready', ${evidencePack.framework}, ${dateFrom}, ${dateTo}, ${format}, ${evidencePack.integrityHash}, ${evidencePack.summary.totalEvents}, ${Buffer.byteLength(JSON.stringify(evidencePack))}, NOW(), NOW())
      `;
    } catch {
      // Table might not exist yet — non-blocking
    }

    auditLog({
      action: "compliance_export_generated",
      apiKeyId: apiKey.id,
      detail: `Evidence pack: ${evidencePack.summary.totalEvents} events, framework=${evidencePack.framework}, controls=${evidencePack.controlMappings.length}`,
    });

    // Return with Content-Disposition for download
    const headers: Record<string, string> = {
      "X-Evidence-Pack-Hash": evidencePack.integrityHash,
      "X-Evidence-Pack-Framework": evidencePack.framework,
    };

    if (download) {
      const filename = `evidence-pack-${evidencePack.framework}-${dateFrom.toISOString().slice(0, 10)}_to_${dateTo.toISOString().slice(0, 10)}.json`;
      headers["Content-Disposition"] = `attachment; filename="${filename}"`;
      headers["Content-Type"] = "application/json";
    }

    // Set headers on the response
    for (const [k, v] of Object.entries(headers)) {
      c.header(k, v);
    }

    return c.json(evidencePack);
  } catch (err) {
    console.error("[compliance] export error:", (err as Error).message);
    return c.json({ error: "Failed to generate evidence pack", detail: (err as Error).message }, 500);
  }
});

// ─── SIEM Configuration ─────────────────────────────────────────────────

complianceRoutes.get("/v1/compliance/siem", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");
  try {
    // Scoped by organisation, not by the calling key's id. `org_id = apiKey.id`
    // was the same conflation fixed in policy-history after run 7 — it meant an
    // admin never saw the destinations their own org had configured.
    const orgId = await resolveOrgId(apiKey.id);
    if (!orgId) return c.json({ configs: [] });

    const configs = (await prisma.sIEMConfig.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    })) as unknown as PrismaSIEMConfig[];
    // Don't expose auth headers
    const safe = configs.map(({ authHeader, ...rest }) => ({ ...rest, auth_header_configured: Boolean(authHeader) }));
    return c.json({ configs: safe });
  } catch (err) {
    console.error("[compliance] siem list error:", (err as Error).message);
    return c.json({ configs: [], note: "SIEM destinations could not be read." });
  }
});

complianceRoutes.post("/v1/compliance/siem", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json();

  const { platform, endpoint, auth_header, format, event_types } = body;

  // The schema has said "stored encrypted at rest" since this table shipped and
  // the value went in as plaintext. Seal it. A missing PARSE_SECRET_KEY is a
  // 503, not a quiet fallback to writing the token in the clear.
  let sealedAuthHeader: string | null = null;
  if (auth_header) {
    try {
      sealedAuthHeader = sealSecret(String(auth_header));
    } catch (err) {
      console.error("[compliance] SIEM auth header could not be sealed:", (err as Error).message);
      return problem(c, {
        status: 503,
        title: "Secret storage unavailable",
        detail: "This deployment cannot encrypt secrets at rest, so the credential was not stored. Set PARSE_SECRET_KEY and try again.",
        code: ErrorCode.SERVICE_UNAVAILABLE,
        retryable: true,
      });
    }
  }

  if (!platform || !endpoint) {
    return c.json({ error: "platform and endpoint are required" }, 400);
  }

  const validPlatforms = ["splunk", "datadog", "elastic", "sentinel", "generic_webhook"];
  if (!validPlatforms.includes(platform)) {
    return c.json({ error: `Invalid platform. Valid: ${validPlatforms.join(", ")}` }, 400);
  }

  const fmt = format ?? "json";
  const evtTypes = event_types ?? ["screening", "audit", "policy_change", "approval"];

  // A SIEM destination belongs to an organisation, not to the key that happened
  // to create it — `siem_configs.org_id` has a foreign key to organizations(id).
  // This used to be `apiKey.id`, so even once the column names matched, the
  // insert would have failed that constraint.
  const orgId = await resolveOrgId(apiKey.id);
  if (!orgId) {
    return problem(c, {
      status: 400,
      title: "No organization",
      detail:
        "SIEM forwarding is configured per organization and this key belongs to none. Create one with POST /v1/orgs/bootstrap, then configure forwarding as its org_admin.",
      code: ErrorCode.VALIDATION_INVALID_INPUT,
      retryable: false,
    });
  }

  try {
    // Written through the Prisma client rather than raw SQL so a column name
    // cannot drift from the schema again. That drift is what made this endpoint
    // return 500 on every call since the table shipped.
    const created = await prisma.sIEMConfig.create({
      data: {
        orgId,
        platform,
        endpoint,
        authHeader: sealedAuthHeader,
        format: fmt,
        eventTypes: evtTypes,
        active: true,
      },
      select: { id: true, platform: true, endpoint: true, format: true, eventTypes: true, active: true },
    });

    auditLog({
      action: "siem_config_created",
      apiKeyId: apiKey.id,
      detail: `SIEM config created: ${platform} → ${endpoint}`,
    });

    return c.json({
      id: created.id,
      platform: created.platform,
      endpoint: created.endpoint,
      format: created.format,
      event_types: created.eventTypes,
      status: created.active ? "active" : "inactive",
    });
  } catch (err) {
    // Never hand the driver's message back to the caller: on an authenticated
    // endpoint that is a free read of the schema. Log it, return a problem.
    console.error("[compliance] siem create error:", (err as Error).message);
    return problem(c, {
      status: 500,
      title: "SIEM destination could not be saved",
      detail: "Parse could not store this SIEM destination. The error has been logged; try again, and contact support if it persists.",
      code: ErrorCode.INTERNAL_ERROR,
      retryable: true,
    });
  }
});

complianceRoutes.post("/v1/compliance/siem/test", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
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

complianceRoutes.delete("/v1/compliance/siem/:id", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
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

// ─── Alert Routing Rules ─────────────────────────────────────────────────
//
// GET    /v1/siem/alert-rules          — List all alert rules for this org
// POST   /v1/siem/alert-rules          — Create a new alert rule
// PUT    /v1/siem/alert-rules/:id      — Update an alert rule
// DELETE /v1/siem/alert-rules/:id      — Delete an alert rule
// POST   /v1/siem/alert-rules/templates/:template_id — Instantiate from template

complianceRoutes.get("/v1/siem/alert-rules", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");
  try {
    const rows = await prisma.$queryRaw<AlertRuleDBRow[]>`
      SELECT * FROM alert_rules WHERE org_id = ${apiKey.id} ORDER BY priority ASC, created_at DESC
    `;
    return c.json({ rules: rows });
  } catch {
    return c.json({ rules: [], note: "Alert rules table not yet migrated." });
  }
});

complianceRoutes.post("/v1/siem/alert-rules", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const body = await c.req.json().catch(() => ({}));

  const { name, destination_id, condition, enabled, priority } = body;

  if (!name) {
    return c.json({ error: "name is required" }, 400);
  }

  const id = crypto.randomUUID();
  const destId = destination_id ?? "*";
  const isEnabled = enabled !== false;
  const prio = typeof priority === "number" ? priority : 50;
  const verdict = condition?.verdict ?? null;
  const riskThreshold = typeof condition?.risk_score_threshold === "number" ? condition.risk_score_threshold : null;
  const patternCategory = condition?.pattern_category ?? null;
  const agentId = condition?.agent_id ?? null;

  try {
    await prisma.$executeRaw`
      INSERT INTO alert_rules (id, org_id, name, destination_id, enabled, priority, verdict, risk_score_threshold, pattern_category, agent_id, created_at, updated_at)
      VALUES (${id}, ${apiKey.id}, ${name}, ${destId}, ${isEnabled}, ${prio}, ${verdict}, ${riskThreshold}, ${patternCategory}, ${agentId}, NOW(), NOW())
    `;

    auditLog({
      action: "alert_rule_created",
      apiKeyId: apiKey.id,
      detail: `Alert rule created: ${name} → ${destId}`,
    });

    return c.json({
      id,
      name,
      destination_id: destId,
      condition: { verdict, risk_score_threshold: riskThreshold, pattern_category: patternCategory, agent_id: agentId },
      enabled: isEnabled,
      priority: prio,
    });
  } catch (err) {
    console.error("[compliance] alert-rule create error:", (err as Error).message);
    return c.json({ error: "Failed to create alert rule", detail: (err as Error).message }, 500);
  }
});

complianceRoutes.put("/v1/siem/alert-rules/:id", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const ruleId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const { name, destination_id, condition, enabled, priority } = body;

  // Build SET clause dynamically for partial updates
  const updates: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
  if (destination_id !== undefined) { updates.push(`destination_id = $${paramIdx++}`); params.push(destination_id); }
  if (enabled !== undefined) { updates.push(`enabled = $${paramIdx++}`); params.push(enabled); }
  if (typeof priority === "number") { updates.push(`priority = $${paramIdx++}`); params.push(priority); }
  if (condition) {
    if (condition.verdict !== undefined) { updates.push(`verdict = $${paramIdx++}`); params.push(condition.verdict); }
    if (typeof condition.risk_score_threshold === "number") { updates.push(`risk_score_threshold = $${paramIdx++}`); params.push(condition.risk_score_threshold); }
    if (condition.pattern_category !== undefined) { updates.push(`pattern_category = $${paramIdx++}`); params.push(condition.pattern_category); }
    if (condition.agent_id !== undefined) { updates.push(`agent_id = $${paramIdx++}`); params.push(condition.agent_id); }
  }

  params.push(apiKey.id, ruleId);

  try {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE alert_rules SET ${updates.join(", ")} WHERE org_id = $${paramIdx++} AND id = $${paramIdx++}`,
      ...params,
    );

    if (result === 0) {
      return c.json({ error: "Alert rule not found" }, 404);
    }

    auditLog({
      action: "alert_rule_updated",
      apiKeyId: apiKey.id,
      detail: `Alert rule ${ruleId} updated`,
    });

    return c.json({ status: "updated", id: ruleId });
  } catch (err) {
    console.error("[compliance] alert-rule update error:", (err as Error).message);
    return c.json({ error: "Failed to update alert rule", detail: (err as Error).message }, 500);
  }
});

complianceRoutes.delete("/v1/siem/alert-rules/:id", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const ruleId = c.req.param("id");

  try {
    const result = await prisma.$executeRaw`
      DELETE FROM alert_rules WHERE id = ${ruleId} AND org_id = ${apiKey.id}
    `;

    if (result === 0) {
      return c.json({ error: "Alert rule not found" }, 404);
    }

    auditLog({
      action: "alert_rule_deleted",
      apiKeyId: apiKey.id,
      detail: `Alert rule ${ruleId} deleted`,
    });

    return c.json({ status: "deleted", id: ruleId });
  } catch (err) {
    return c.json({ error: "Failed to delete alert rule", detail: (err as Error).message }, 500);
  }
});

// GET /v1/siem/alert-rules/templates — List available default rule templates
complianceRoutes.get("/v1/siem/alert-rules/templates", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  return c.json({ templates: DEFAULT_ALERT_RULE_TEMPLATES });
});

// POST /v1/siem/alert-rules/templates/:template_id — Instantiate a rule from a template
complianceRoutes.post("/v1/siem/alert-rules/templates/:template_id", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst"), async (c) => {
  const apiKey = c.get("apiKey");
  const templateId = c.req.param("template_id");
  const body = await c.req.json().catch(() => ({}));

  const template = (DEFAULT_ALERT_RULE_TEMPLATES as readonly AlertRuleTemplate[]).find(
    (t) => t.template_id === templateId,
  );

  if (!template) {
    return c.json({ error: `Unknown template: ${templateId}. Available: ${DEFAULT_ALERT_RULE_TEMPLATES.map((t) => t.template_id).join(", ")}` }, 400);
  }

  const rule = instantiateTemplate(template, body.destination_id);

  const id = crypto.randomUUID();
  const destId = rule.destination_id;
  const verdict = rule.condition.verdict ?? null;
  const riskThreshold = rule.condition.risk_score_threshold ?? null;
  const patternCategory = rule.condition.pattern_category ?? null;
  const agentId = rule.condition.agent_id ?? null;

  try {
    await prisma.$executeRaw`
      INSERT INTO alert_rules (id, org_id, name, destination_id, enabled, priority, verdict, risk_score_threshold, pattern_category, agent_id, created_at, updated_at)
      VALUES (${id}, ${apiKey.id}, ${rule.name}, ${destId}, ${rule.enabled}, ${rule.priority}, ${verdict}, ${riskThreshold}, ${patternCategory}, ${agentId}, NOW(), NOW())
    `;

    auditLog({
      action: "alert_rule_created",
      apiKeyId: apiKey.id,
      detail: `Alert rule instantiated from template: ${templateId}`,
    });

    return c.json({
      id,
      template_id: templateId,
      name: rule.name,
      destination_id: destId,
      condition: rule.condition,
      enabled: rule.enabled,
      priority: rule.priority,
    });
  } catch (err) {
    console.error("[compliance] alert-rule template error:", (err as Error).message);
    return c.json({ error: "Failed to instantiate alert rule", detail: (err as Error).message }, 500);
  }
});

// ─── GET /v1/compliance/policy-history — Policy change history ──────────

complianceRoutes.get("/v1/compliance/policy-history", authMiddleware("evaluate"), requireRole("org_admin", "security_analyst", "auditor"), async (c) => {
  const apiKey = c.get("apiKey");

  // The caller's ORGANIZATION, not the caller's key. These are both cuids, so
  // the wrong one returns an empty list instead of an error — which is exactly
  // how every org's audit trail read empty while the rows sat in the table.
  // resolveOrgId, NOT resolveOrgIdForCoverage — the latter falls back to the
  // API key id when a key has no org, which is how this endpoint read empty in
  // the first place.
  const scope = policyHistoryScope(await resolveOrgId(apiKey.id));
  if (!scope.ok) return c.json({ revisions: [], note: scope.note });

  try {
    const revisions = await prisma.$queryRaw<Array<{
      id: string; version: number; policy_snapshot: unknown; changed_by: string;
      change_reason: string | null; diff: unknown; created_at: Date;
    }>>`
      SELECT * FROM policy_revisions WHERE org_id = ${scope.orgId} ORDER BY created_at DESC LIMIT 50
    `;
    return c.json({ revisions });
  } catch (err) {
    // Never answer a failed query with an empty list. An audit trail that
    // reports "nothing changed" is worse than one that reports it is broken,
    // because the first passes a security review.
    console.error("[compliance] policy-history query failed:", (err as Error).message);
    return serviceDependencyProblem(c, err);
  }
});

// ─── GET /v1/compliance/declarations — guard 3 ─────────────────────────
//
// The share of an org's traffic declaring a non-execute intended_action, over
// time and per key. src/lib/analysis-role.ts has always named this as one of
// the things that stop the subject-role downgrade being a silent off-switch,
// and /docs promised it to customers, and it did not exist.
//
// Why it matters more than a percentage usually does: a caller declaring
// `summarize` gets findings reported rather than refused. That is correct for a
// SOC triaging its own alert queue and wrong for a team that has discovered
// adding one field makes the warnings stop. The org ceiling
// (allowSubjectRole) can forbid it outright, but an admin who has not forbidden
// it has, until now, had no way to notice a team's declaration rate climbing.
// Prospect run 11 downgraded 13 findings including six live injections in
// eleven minutes and nothing anywhere changed.
//
// Read the trend, not the number. A team that always declares is probably
// doing analysis work legitimately; a team whose rate goes from 2% to 90% in a
// week has changed something.

complianceRoutes.get(
  "/v1/compliance/declarations",
  authMiddleware("evaluate"),
  requireRole("org_admin", "security_analyst", "auditor"),
  async (c) => {
    const apiKey = c.get("apiKey");
    const days = Math.min(Math.max(Number(c.req.query("days") ?? "30"), 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orgId = await resolveOrgId(apiKey.id);
    const scope = orgScopedWhere(orgId, apiKey.id);
    const orgFilter = orgId
      ? Prisma.sql`k.org_id = ${orgId}`
      : Prisma.sql`e.api_key_id = ${apiKey.id}`;

    try {
      const [total, declared, downgraded, byKey, daily] = await Promise.all([
        prisma.screeningEvent.count({ where: { ...scope, createdAt: { gte: since } } }),
        prisma.screeningEvent.count({
          where: { ...scope, analysisRole: "subject", createdAt: { gte: since } },
        }),
        // Declarations that actually changed an outcome: the finding stood and
        // the refusal did not. This is the number an auditor asks about.
        prisma.screeningEvent.count({
          where: { ...scope, disposition: "report", createdAt: { gte: since } },
        }),
        prisma.$queryRaw<Array<{ api_key_id: string; name: string | null; total: bigint; declared: bigint }>>`
          SELECT e.api_key_id,
                 k.name,
                 count(*) as total,
                 count(*) FILTER (WHERE e.analysis_role = 'subject') as declared
          FROM screening_events e
          JOIN api_keys k ON k.id = e.api_key_id
          WHERE ${orgFilter} AND e.created_at >= ${since}
          GROUP BY e.api_key_id, k.name
          ORDER BY declared DESC
          LIMIT 50
        `,
        prisma.$queryRaw<Array<{ day: Date; total: bigint; declared: bigint }>>`
          SELECT date_trunc('day', e.created_at) as day,
                 count(*) as total,
                 count(*) FILTER (WHERE e.analysis_role = 'subject') as declared
          FROM screening_events e
          JOIN api_keys k ON k.id = e.api_key_id
          WHERE ${orgFilter} AND e.created_at >= ${since}
          GROUP BY day
          ORDER BY day ASC
        `,
      ]);

      const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 10000) / 100 : null);

      return c.json({
        period: { from: since.toISOString(), to: new Date().toISOString(), days },
        total_screenings: total,
        declared_subject_role: declared,
        declaration_rate_pct: pct(declared, total),
        downgraded_findings: downgraded,
        note:
          "declaration_rate_pct is the share of screens where the caller declared, via metadata.intended_action, that the agent only analyses this content. downgraded_findings counts the ones where that declaration turned a refusal into a reported finding. A rate climbing toward 100% is the control being switched off a request at a time; forbid it org-wide with allowSubjectRole on PUT /v1/org/policy-defaults.",
        by_key: byKey.map((r) => ({
          api_key_id: r.api_key_id,
          name: r.name,
          screenings: Number(r.total),
          declared: Number(r.declared),
          declaration_rate_pct: pct(Number(r.declared), Number(r.total)),
        })),
        daily: daily.map((r) => ({
          date: new Date(r.day).toISOString().slice(0, 10),
          screenings: Number(r.total),
          declared: Number(r.declared),
          declaration_rate_pct: pct(Number(r.declared), Number(r.total)),
        })),
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[compliance] declarations error:", (err as Error).message);
      return serviceDependencyProblem(c, err);
    }
  },
);

// ─── GET /v1/coverage — Coverage attestation report ────────────────────
//
// Returns what percentage of an org's AI agent LLM calls are actually
// being screened by Parse. Identifies agents making calls that are NOT
// being screened (the SDK reports calls but Parse isn't seeing screening
// requests for them).

complianceRoutes.get("/v1/coverage", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const orgId = await resolveOrgIdForCoverage(apiKey.id);

  // Parse date range from query params (default: last 7 days)
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const daysParam = Number(c.req.query("days") ?? "7");

  let from: Date;
  let to: Date;

  if (fromStr) {
    from = new Date(fromStr);
    if (isNaN(from.getTime())) {
      return c.json({ error: "Invalid 'from' date. Use YYYY-MM-DD." }, 400);
    }
  } else {
    const d = Math.min(Math.max(daysParam, 1), 90);
    from = new Date(Date.now() - (d - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
  }

  if (toStr) {
    to = new Date(toStr);
    if (isNaN(to.getTime())) {
      return c.json({ error: "Invalid 'to' date. Use YYYY-MM-DD." }, 400);
    }
    to.setUTCHours(23, 59, 59, 999);
  } else {
    to = new Date();
    to.setUTCHours(23, 59, 59, 999);
  }

  if (from > to) {
    return c.json({ error: "'from' date must be before 'to' date." }, 400);
  }

  try {
    const report = await getAttestationReport(orgId, { from, to });
    return c.json(report);
  } catch (err) {
    console.error("[coverage] report error:", (err as Error).message);
    return c.json(
      {
        org_id: orgId,
        date_range: { from: from.toISOString(), to: to.toISOString() },
        total_agent_calls: 0,
        total_screened: 0,
        coverage_pct: 0,
        uncovered_agents: [],
        daily_breakdown: [],
        generated_at: new Date().toISOString(),
        note: "Coverage data unavailable — Redis may be down or no data collected yet.",
      },
      200,
    );
  }
});

// ─── GET /v1/coverage/export — CSV export for compliance evidence ──────
//
// Returns a CSV with per-agent coverage data suitable for compliance
// evidence and audit attestation.
// Columns: agent_id, total_calls, screened_calls, coverage_pct, last_seen

complianceRoutes.get("/v1/coverage/export", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");

  const orgId = await resolveOrgIdForCoverage(apiKey.id);

  // Parse date range from query params (default: last 7 days)
  const fromStr = c.req.query("from");
  const toStr = c.req.query("to");
  const daysParam = Number(c.req.query("days") ?? "7");

  let from: Date;
  let to: Date;

  if (fromStr) {
    from = new Date(fromStr);
    if (isNaN(from.getTime())) {
      return c.json({ error: "Invalid 'from' date. Use YYYY-MM-DD." }, 400);
    }
  } else {
    const d = Math.min(Math.max(daysParam, 1), 90);
    from = new Date(Date.now() - (d - 1) * 24 * 60 * 60 * 1000);
    from.setUTCHours(0, 0, 0, 0);
  }

  if (toStr) {
    to = new Date(toStr);
    if (isNaN(to.getTime())) {
      return c.json({ error: "Invalid 'to' date. Use YYYY-MM-DD." }, 400);
    }
    to.setUTCHours(23, 59, 59, 999);
  } else {
    to = new Date();
    to.setUTCHours(23, 59, 59, 999);
  }

  if (from > to) {
    return c.json({ error: "'from' date must be before 'to' date." }, 400);
  }

  try {
    const rows = await getAgentCoverageRows(orgId, { from, to });
    const csv = coverageRowsToCSV(rows);

    const filename = `coverage-${orgId}-${from.toISOString().slice(0, 10)}_to_${to.toISOString().slice(0, 10)}.csv`;

    c.header("Content-Type", "text/csv");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);

    auditLog({
      action: "coverage_export_generated",
      apiKeyId: apiKey.id,
      detail: `Coverage CSV export: ${rows.length} agents, ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`,
    });

    return c.body(csv);
  } catch (err) {
    console.error("[coverage] export error:", (err as Error).message);
    return c.json({ error: "Failed to generate coverage export", detail: (err as Error).message }, 500);
  }
});
