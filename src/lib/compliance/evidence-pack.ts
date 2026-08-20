/**
 * Evidence Pack Generator
 *
 * Produces structured, framework-mapped compliance evidence packs from
 * screening events, policy revisions, audit events, and agent registry data.
 *
 * Each pack maps observed findings to framework controls (OWASP LLM 2025,
 * NIST AI RMF 1.0, EU AI Act, ISO/IEC 42001, SOC 2 TSC) and includes a
 * SHA-256 integrity hash for tamper evidence.
 */

import { createHash } from "node:crypto";
import { prisma } from "../../db.js";
import { orgScopedWhere, auditScopedWhere } from "../org-scope.js";
import {
  OWASP_LLM_2025,
  NIST_AI_RMF,
  EU_AI_ACT,
  ISO_42001,
  SOC2_TSC,
} from "./framework-crosswalk.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type FrameworkId =
  | "owasp-llm"
  | "nist-ai-rmf"
  | "eu-ai-act"
  | "iso-42001"
  | "soc2"
  | "all";

export interface ControlMapping {
  controlId: string;
  controlName: string;
  evidence: string;
  status: "covered" | "partially_covered" | "not_covered";
}

export interface EvidencePackSummary {
  totalEvents: number;
  screeningCount: number;
  blockedCount: number;
  /**
   * What Parse did, counted. "We screened N prompts" is the sentence the pack
   * already supported; "of those, M were reported rather than refused because
   * a caller declared the content was subject matter" is the one an auditor
   * asks next, and it had no answer anywhere in the product.
   */
  dispositionCounts: Record<string, number>;
  topRiskCategories: Array<{ category: string; count: number }>;
  policyChanges: number;
  agentCount: number;
}

/** One screening decision, as it appears in the evidence. No prompt text. */
export interface EvidencePackDecision {
  at: string;
  screeningId: string;
  apiKeyId: string;
  agentId?: string;
  riskScore: number;
  verdict: string;
  categories: string[];
  /** block | report | review | allow — what Parse did about the finding. */
  disposition: string;
  /** instruction | subject — whether the caller declared this as material to analyse. */
  analysisRole?: string;
  /** The declaration itself, when one was made: summarize | extract | route | reply | execute. */
  intendedAction?: string;
  ruleIds: string[];
}

export interface EvidencePack {
  generatedAt: string;
  period: { from: string; to: string };
  framework: string;
  summary: EvidencePackSummary;
  /**
   * Every screen in the period where the caller declared the content as subject
   * matter, and what Parse did about it. Most will be `report` — the finding
   * stood and the refusal did not — but a declaration that was refused anyway
   * (the org ceiling forbids downgrades) or allowed anyway (nothing was found)
   * belongs here too: the question is who declared what, not only which
   * declarations changed an outcome.
   *
   * This is the list an auditor asks for by name, and the reason the pack
   * exists rather than the control descriptions below.
   */
  declaredDecisions: EvidencePackDecision[];
  /** The refusals, for the same period. */
  refusals: EvidencePackDecision[];
  /**
   * The org-wide ceiling across the period, so a reader can see whether member
   * keys were permitted to downgrade at all, and when that changed.
   */
  subjectRoleControl: {
    allowSubjectRole: boolean | null;
    locked: boolean;
    changes: Array<{ at: string; from: unknown; to: unknown; reason: string }>;
  };
  controlMappings: ControlMapping[];
  integrityHash: string;
}

// ─── Internal: normalise framework aliases ────────────────────────────────

const FRAMEWORK_ALIASES: Record<string, FrameworkId> = {
  owasp: "owasp-llm",
  "owasp-llm": "owasp-llm",
  owasp_llm_2025: "owasp-llm",
  nist: "nist-ai-rmf",
  "nist-ai-rmf": "nist-ai-rmf",
  nist_ai_rmf: "nist-ai-rmf",
  eu: "eu-ai-act",
  "eu-ai-act": "eu-ai-act",
  eu_ai_act: "eu-ai-act",
  iso: "iso-42001",
  "iso-42001": "iso-42001",
  iso_42001: "iso-42001",
  soc2: "soc2",
  "soc-2": "soc2",
  soc2_tsc: "soc2",
  all: "all",
};

function normaliseFramework(raw: string): FrameworkId {
  const lower = raw.toLowerCase().trim();
  return FRAMEWORK_ALIASES[lower] ?? "all";
}

// ─── Main entry point ─────────────────────────────────────────────────────

export async function generateEvidencePack(
  apiKeyId: string,
  frameworkRaw: string,
  dateFrom: Date,
  dateTo: Date,
  /**
   * The caller's ORGANIZATION, when they have one. Screening and audit events
   * belong to a key; policy revisions and the agent registry belong to an
   * organization. This parameter used to be called `orgId` and was passed a key
   * id, so the pack reported "0 policy changes" and zero agents for every
   * organization that has ever existed — the same conflation that made
   * GET /v1/compliance/policy-history read empty.
   */
  orgId?: string | null,
): Promise<EvidencePack> {
  const framework = normaliseFramework(frameworkRaw);

  // ── Gather evidence from all data sources in parallel ──
  // Scoped to the organisation when there is one. A pack covering only the
  // admin's own key is a pack covering no traffic, which is what prospect run
  // 11 generated: 11,456 bytes describing capabilities, with zero screening
  // decisions in it, for an org that had just screened twenty prompts.
  const screeningScope = orgScopedWhere(orgId ?? null, apiKeyId);
  const auditScope = await auditScopedWhere(orgId ?? null, apiKeyId);

  const [screenings, auditEvents, policyRevisions, agents] = await Promise.all([
    prisma.screeningEvent.findMany({
      where: { ...screeningScope, createdAt: { gte: dateFrom, lte: dateTo } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.auditEvent.findMany({
      where: { ...auditScope, createdAt: { gte: dateFrom, lte: dateTo } },
      orderBy: { createdAt: "asc" },
    }),
    // PolicyRevision table may not exist yet — use raw query, swallow errors
    orgId
      ? prisma.$queryRawUnsafe(
          `SELECT * FROM policy_revisions WHERE org_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at ASC`,
          orgId,
          dateFrom,
          dateTo,
        )
          .then((r) => r as unknown[])
          .catch(() => [] as unknown[])
      : Promise.resolve([] as unknown[]),
    orgId
      ? prisma.$queryRawUnsafe(`SELECT * FROM agent_registry WHERE org_id = $1`, orgId)
          .then((r) => r as unknown[])
          .catch(() => [] as unknown[])
      : Promise.resolve([] as unknown[]),
  ]);

  // ── Build summary ──
  const categoryCounts = new Map<string, number>();
  for (const s of screenings) {
    for (const cat of s.categories) {
      categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
    }
  }
  const topRiskCategories = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const blockedCount = screenings.filter((s) => s.blocked).length;

  // Counted from the disposition column, not from the score. A finding the
  // caller declared as subject matter is reported, not refused, and counting it
  // as a block is what let a customer's dashboard overstate its own enforcement.
  const dispositionCounts: Record<string, number> = {};
  for (const s of screenings) {
    const d = (s.disposition ?? "unrecorded") as string;
    dispositionCounts[d] = (dispositionCounts[d] ?? 0) + 1;
  }

  const toDecision = (s: (typeof screenings)[number]): EvidencePackDecision => {
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    return {
      at: s.createdAt.toISOString(),
      screeningId: s.id,
      apiKeyId: s.apiKeyId,
      agentId: typeof meta.agent_id === "string" ? meta.agent_id : undefined,
      riskScore: s.riskScore,
      verdict: s.verdict,
      categories: s.categories,
      disposition: (s.disposition ?? "unrecorded") as string,
      analysisRole: (s.analysisRole ?? undefined) as string | undefined,
      intendedAction: typeof meta.intended_action === "string" ? meta.intended_action : undefined,
      ruleIds: Array.isArray(meta.rule_ids) ? (meta.rule_ids as string[]) : [],
    };
  };

  // The two lists an auditor actually reads: what we found and declined to
  // refuse because the caller declared it, and what we refused.
  const declaredDecisions = screenings
    .filter((s) => s.analysisRole === "subject" || s.disposition === "report")
    .map(toDecision);
  const refusals = screenings.filter((s) => s.disposition === "block").map(toDecision);

  const summary: EvidencePackSummary = {
    totalEvents: screenings.length + auditEvents.length,
    screeningCount: screenings.length,
    blockedCount,
    dispositionCounts,
    topRiskCategories,
    policyChanges: policyRevisions.length,
    agentCount: agents.length,
  };

  // The state of the org-wide downgrade control across the period, and every
  // change to it. "Prove it was set for the whole period" is the question this
  // answers; behaviour alone could not.
  const ceilingRow = orgId
    ? await prisma.orgPolicyDefault
        .findUnique({ where: { orgId }, select: { allowSubjectRole: true, lockedFields: true } })
        .catch(() => null)
    : null;
  const subjectRoleControl = {
    allowSubjectRole: ceilingRow?.allowSubjectRole ?? null,
    locked: (ceilingRow?.lockedFields ?? []).includes("allowSubjectRole"),
    changes: (policyRevisions as Array<Record<string, unknown>>).flatMap((r) => {
      const diff = (r.diff ?? {}) as Record<string, { old?: unknown; new?: unknown }>;
      const change = diff.allowSubjectRole;
      if (!change) return [];
      return [{
        at: new Date(r.created_at as string).toISOString(),
        from: change.old ?? null,
        to: change.new ?? null,
        reason: String(r.change_reason ?? ""),
      }];
    }),
  };

  // ── Build framework control mappings ──
  const controlMappings = buildControlMappings(framework, {
    screenings,
    auditEvents,
    policyRevisions,
    agents,
    topRiskCategories,
  });

  // ── Assemble pack and compute integrity hash ──
  const pack: Omit<EvidencePack, "integrityHash"> = {
    generatedAt: new Date().toISOString(),
    period: { from: dateFrom.toISOString(), to: dateTo.toISOString() },
    framework,
    summary,
    declaredDecisions,
    refusals,
    subjectRoleControl,
    controlMappings,
  };

  const integrityHash = createHash("sha256")
    .update(JSON.stringify(pack))
    .digest("hex");

  return { ...pack, integrityHash };
}

// ─── Control mapping builders ─────────────────────────────────────────────

interface EvidenceContext {
  screenings: Array<{
    id: string;
    riskScore: number;
    verdict: string;
    categories: string[];
    blocked: boolean;
    createdAt: Date;
    metadata: unknown;
  }>;
  auditEvents: Array<{
    id: string;
    action: string;
    detail: string | null;
    createdAt: Date;
  }>;
  policyRevisions: unknown[];
  agents: unknown[];
  topRiskCategories: Array<{ category: string; count: number }>;
}

function buildControlMappings(
  framework: FrameworkId,
  ctx: EvidenceContext,
): ControlMapping[] {
  switch (framework) {
    case "owasp-llm":
      return mapOWASP(ctx);
    case "nist-ai-rmf":
      return mapNIST(ctx);
    case "eu-ai-act":
      return mapEUAIAct(ctx);
    case "iso-42001":
      return mapISO42001(ctx);
    case "soc2":
      return mapSOC2(ctx);
    case "all":
      return [
        ...mapOWASP(ctx),
        ...mapNIST(ctx),
        ...mapEUAIAct(ctx),
        ...mapISO42001(ctx),
        ...mapSOC2(ctx),
      ];
  }
}

/** Count screening events matching any of the given categories */
function countByCategory(
  ctx: EvidenceContext,
  categories: string[],
): { total: number; blocked: number } {
  if (categories.length === 0) return { total: 0, blocked: 0 };
  const matching = ctx.screenings.filter((s) =>
    s.categories.some((c) => categories.includes(c)),
  );
  return {
    total: matching.length,
    blocked: matching.filter((s) => s.blocked).length,
  };
}

// ── OWASP Top 10 for LLM Applications (2025) ──

function mapOWASP(ctx: EvidenceContext): ControlMapping[] {
  return OWASP_LLM_2025.map((m) => {
    const { total, blocked } = countByCategory(ctx, m.parse_categories);
    const observedCategories = ctx.topRiskCategories
      .filter((c) => m.parse_categories.includes(c.category))
      .map((c) => `${c.category} (${c.count} events)`)
      .join(", ");

    const evidenceParts: string[] = [];
    if (total > 0) {
      evidenceParts.push(
        `${total} screening event(s) matched this control (${blocked} blocked)`,
      );
    }
    if (observedCategories) {
      evidenceParts.push(`Observed categories: ${observedCategories}`);
    }
    evidenceParts.push(
      `Parse capabilities: ${m.parse_capabilities.join(", ")}`,
    );

    return {
      controlId: m.owasp_id,
      controlName: m.title,
      evidence: evidenceParts.join(". "),
      status: m.parse_categories.length > 0 && total > 0
        ? ("covered" as const)
        : m.parse_capabilities.length > 0
          ? ("partially_covered" as const)
          : ("not_covered" as const),
    };
  });
}

// ── NIST AI RMF 1.0 ──

function mapNIST(ctx: EvidenceContext): ControlMapping[] {
  return NIST_AI_RMF.map((m) => {
    const evidenceParts: string[] = [m.parse_coverage];
    const hasExternal = m.parse_coverage.includes("Not directly covered") ||
      m.parse_coverage.includes("N/A");

    // Add data-driven evidence where relevant
    if (m.evidence_source.includes("ScreeningEvent")) {
      evidenceParts.push(
        `${ctx.screenings.length} screening events in period`,
      );
    }
    if (m.evidence_source.includes("PolicyRevision")) {
      evidenceParts.push(
        `${ctx.policyRevisions.length} policy revision(s) in period`,
      );
    }
    if (m.evidence_source.includes("AgentRegistry")) {
      evidenceParts.push(
        `${ctx.agents.length} registered agent(s)`,
      );
    }
    if (m.evidence_source.includes("AuditEvent")) {
      evidenceParts.push(
        `${ctx.auditEvents.length} audit event(s) in period`,
      );
    }

    return {
      controlId: m.category.split(":")[0].trim(),
      controlName: m.category.replace(/^[^:]+:\s*/, ""),
      evidence: evidenceParts.join(". "),
      status: hasExternal
        ? ("not_covered" as const)
        : ("covered" as const),
    };
  });
}

// ── EU AI Act ──

function mapEUAIAct(ctx: EvidenceContext): ControlMapping[] {
  return EU_AI_ACT.map((m) => {
    const evidenceParts: string[] = [m.parse_coverage];

    if (m.evidence_source.includes("ScreeningEvent")) {
      evidenceParts.push(
        `${ctx.screenings.length} screening events in period (${ctx.screenings.filter((s) => s.blocked).length} blocked)`,
      );
    }
    if (m.evidence_source.includes("PolicyRevision")) {
      evidenceParts.push(
        `${ctx.policyRevisions.length} policy revision(s) in period`,
      );
    }
    if (m.evidence_source.includes("AuditEvent")) {
      evidenceParts.push(
        `${ctx.auditEvents.length} audit event(s) in period`,
      );
    }
    if (m.evidence_source.includes("ComplianceExport")) {
      evidenceParts.push("Evidence pack generated with SHA-256 integrity hash");
    }
    if (m.evidence_source.includes("approvals")) {
      evidenceParts.push("Approval workflow active for high-risk actions");
    }

    const statusMap = {
      fully_covered: "covered" as const,
      partially_covered: "partially_covered" as const,
      not_covered: "not_covered" as const,
      external: "not_covered" as const,
    };

    return {
      controlId: m.article,
      controlName: m.title,
      evidence: evidenceParts.join(". "),
      status: statusMap[m.status],
    };
  });
}

// ── ISO/IEC 42001 ──

function mapISO42001(ctx: EvidenceContext): ControlMapping[] {
  return ISO_42001.map((m) => {
    const evidenceParts: string[] = [m.parse_coverage];
    evidenceParts.push(
      `Period data: ${ctx.screenings.length} screenings, ${ctx.policyRevisions.length} policy revisions, ${ctx.agents.length} registered agents`,
    );

    return {
      controlId: `Clause ${m.clause}`,
      controlName: m.title,
      evidence: evidenceParts.join(". "),
      status: "covered" as const,
    };
  });
}

// ── SOC 2 Trust Services Criteria ──

function mapSOC2(ctx: EvidenceContext): ControlMapping[] {
  return SOC2_TSC.map((m) => {
    const evidenceParts: string[] = [m.parse_coverage];

    if (m.criteria.startsWith("CC7")) {
      evidenceParts.push(
        `${ctx.screenings.length} screening events, ${ctx.auditEvents.length} audit events, ${ctx.screenings.filter((s) => s.blocked).length} blocks in period`,
      );
    }
    if (m.criteria === "CC8.1") {
      evidenceParts.push(
        `${ctx.policyRevisions.length} policy change(s) with full audit trail (versioned, diffed, attributed)`,
      );
    }

    return {
      controlId: m.criteria,
      controlName: m.title,
      evidence: evidenceParts.join(". "),
      status: "covered" as const,
    };
  });
}
