import { Hono } from "hono";
import { authMiddleware } from "../auth.js";
import { parsePrompt, analyzeOutputRisks, llmOutputInjectionAnalysis, analyzeFetchedContent, analyzeHiddenContent, llmSandboxAnalysis, computeVerdict, computeSuggestedAction } from "../parse.js";
import type { ParseRequest, ExecutionResult } from "../parse.js";
import type { AppEnv } from "../types.js";
import { getRedis, isRedisAvailable, ensureRedisConnected } from "../redis.js";
import { canUseSandbox, executeInSandbox } from "../lib/sandbox-client.js";
import { billableUsageMiddleware } from "../lib/billable-usage-middleware.js";

import { getBaseUrl } from "../lib/route-utils.js";
import { auditLog } from "../lib/audit-log.js";
import { problem, ErrorCode, jsonContentTypeProblem } from "../lib/problem-response.js";
import {
  persistScreeningEventForApiKey,
  screeningDecisionAction,
  screeningRuleIds,
} from "../lib/screening-event-log.js";
import { codewordBypassAllowed } from "../lib/bypass-codeword.js";
import { autoRegisterAgentFromScreening } from "../lib/agent-auto-register.js";
import { recordScreening } from "../lib/compliance/coverage-attestation.js";
import { isAgentFrozen } from "../lib/freeze-cache.js";
import { checkDataAccess } from "../lib/data-governance/check-access.js";
import { checkEgress, type EgressRuleInput } from "../lib/data-governance/check-egress.js";
import { trackUsage, checkBudget } from "../lib/data-governance/volume-tracker.js";
import { evaluateCustomRules, parseCustomRules } from "../lib/policy-engine/custom-rules.js";
import {
  evaluateMatrix,
  normalizeMatrix,
  matrixKey,
  isValidActionType,
  isValidClassification,
} from "../lib/data-governance/approval-matrix.js";
import { prisma } from "../db.js";
import { verifySignature } from "../lib/identity/signed-identity.js";
import { recordActivationEvent, getActivationEventTs } from "../lib/activation-tracker.js";

export const parseRoutes = new Hono<AppEnv>();

// ─── Execution rate limits & cost caps by tier ─────────────────────────────

const EXEC_LIMITS: Record<string, number> = {
  free: 5,
  pro: 50,
  team: 200,
  compliance: 500,
  enterprise: 1000,
};

const DAILY_COST_CAPS: Record<string, number> = {
  free: 0.50,
  pro: 10,
  team: 50,
  compliance: 200,
  enterprise: 500,
};

// ─── POST /v1/parse ────────────────────────────────────────────────────────

parseRoutes.post("/v1/parse", authMiddleware("evaluate"), billableUsageMiddleware(), async (c) => {
  const contentTypeProblem = jsonContentTypeProblem(c);
  if (contentTypeProblem) return contentTypeProblem;

  const body = await c.req.json<ParseRequest>();

  // ── Signed Agent Identity (Task 10.1) ──
  // If the request includes an X-Agent-Signature header, verify it against the
  // agent's registered public key. The result is attached as verified_identity
  // in the response metadata.
  let verifiedIdentity: Record<string, unknown> | undefined;
  const agentSignature = c.req.header("x-agent-signature");
  const sigAgentId = body.metadata?.agent_id;
  if (agentSignature && sigAgentId && typeof sigAgentId === "string") {
    try {
      const identity = await prisma.signedIdentity.findFirst({
        where: { agentId: sigAgentId, status: "active" },
        orderBy: { keyVersion: "desc" },
      });
      if (identity) {
        // The signed payload is the request body (without the metadata that
        // the server controls). We verify against the prompt as the canonical
        // payload that both client and server see.
        const valid = verifySignature(
          identity.publicKey,
          body.prompt,
          agentSignature,
        );
        verifiedIdentity = {
          verified: valid,
          agent_id: sigAgentId,
          key_id: identity.id,
          key_version: identity.keyVersion,
        };
      } else {
        verifiedIdentity = {
          verified: false,
          agent_id: sigAgentId,
          reason: "no_registered_identity",
        };
      }
    } catch (sigErr) {
      console.error("[identity] signature verification failed:", (sigErr as Error).message);
      verifiedIdentity = {
        verified: false,
        agent_id: sigAgentId,
        reason: "verification_error",
      };
    }
  }

  // ── Kill Switch: fast-path check for frozen agents ──
  // If the request includes a metadata.agent_id and that agent is frozen,
  // return an immediate block verdict — skip the entire pipeline.
  const freezeAgentId = body.metadata?.agent_id;
  if (freezeAgentId && typeof freezeAgentId === "string") {
    const frozen = await isAgentFrozen(freezeAgentId);
    if (frozen) {
      return c.json({
        id: crypto.randomUUID(),
        verdict: "block",
        reason: "agent_frozen",
        risk_score: 100,
        safe: false,
        categories: ["agent_frozen"],
        flags: [],
        suggested_action: "block",
        recommended_action: "block",
        frozen: true,
        analyzed_at: new Date().toISOString(),
      });
    }
  }

  // ── Input validation ──
  // Task 11.1: max prompt length raised to 100K chars per platform hardening spec
  if (!body.prompt || typeof body.prompt !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "prompt is required and must be a string",
      code: ErrorCode.VALIDATION_REQUIRED,
      retryable: false,
    });
  }
  if (body.prompt.length > 100_000) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "prompt must be less than 100,000 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.model !== undefined && typeof body.model !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "model must be a string",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.execute !== undefined && body.execute !== "auto" && typeof body.execute !== "boolean") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "execute must be a boolean or \"auto\"",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.test_input !== undefined && typeof body.test_input !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "test_input must be a string",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.test_input && body.test_input.length > 10_000) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "test_input must be less than 10,000 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.mode !== undefined && !["full", "pattern-only"].includes(body.mode)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "mode must be 'full' or 'pattern-only'",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  // pattern-only is a privacy guarantee, not a speed setting: it exists so a
  // caller can keep prompt text away from the model provider. Sandbox execution
  // forwards that text regardless, so honouring only half the request would make
  // the guarantee false. Refuse the combination rather than silently breaking it.
  if (body.mode === "pattern-only" && (body.execute === true || body.execute === "auto")) {
    return problem(c, {
      status: 400,
      title: "Incompatible options",
      detail:
        'mode "pattern-only" cannot be combined with execute. Pattern-only keeps prompt text away from the model provider, and sandbox execution sends it there. Drop execute, or use mode "full".',
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.policy_mode !== undefined && !["strict", "balanced", "low_fp"].includes(body.policy_mode)) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "policy_mode must be 'strict', 'balanced', or 'low_fp'",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.bypass_codeword !== undefined && typeof body.bypass_codeword !== "string") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "bypass_codeword must be a string when provided",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.bypass_codeword && body.bypass_codeword.length > 256) {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "bypass_codeword must be less than 256 characters",
      code: ErrorCode.VALIDATION_TOO_LARGE,
      retryable: false,
    });
  }
  if (body.metadata !== undefined && typeof body.metadata !== "object") {
    return problem(c, {
      status: 400,
      title: "Validation failure",
      detail: "metadata must be an object",
      code: ErrorCode.VALIDATION_INVALID_TYPE,
      retryable: false,
    });
  }
  if (body.metadata && !Array.isArray(body.metadata)) {
    if (body.metadata.source_kind !== undefined && !["user", "email", "retrieved_doc", "web_page", "tool_output", "memory", "agent_handoff"].includes(body.metadata.source_kind)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.source_kind must be one of user, email, retrieved_doc, web_page, tool_output, memory, or agent_handoff",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.trust_level !== undefined && !["trusted", "untrusted", "external"].includes(body.metadata.trust_level)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.trust_level must be trusted, untrusted, or external",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.intended_action !== undefined && !["summarize", "execute", "route", "reply", "extract"].includes(body.metadata.intended_action)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.intended_action must be summarize, execute, route, reply, or extract",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.tool_permissions !== undefined && (!Array.isArray(body.metadata.tool_permissions) || !body.metadata.tool_permissions.every((item) => typeof item === "string"))) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.tool_permissions must be an array of strings",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.data_classification !== undefined && (!Array.isArray(body.metadata.data_classification) || !body.metadata.data_classification.every((item) => typeof item === "string"))) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.data_classification must be an array of strings",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.data_sources !== undefined && (!Array.isArray(body.metadata.data_sources) || !body.metadata.data_sources.every((item) => typeof item === "string"))) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.data_sources must be an array of strings (data source IDs)",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.records_accessed !== undefined && (typeof body.metadata.records_accessed !== "number" || !Number.isInteger(body.metadata.records_accessed) || body.metadata.records_accessed < 0)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.records_accessed must be a non-negative integer",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.bytes_accessed !== undefined && (typeof body.metadata.bytes_accessed !== "number" || !Number.isInteger(body.metadata.bytes_accessed) || body.metadata.bytes_accessed < 0)) {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.bytes_accessed must be a non-negative integer",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (body.metadata.action_type !== undefined && typeof body.metadata.action_type !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "metadata.action_type must be a string",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
  }
  if (body.agent_config !== undefined) {
    if (typeof body.agent_config !== "object") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_config must be an object",
        code: ErrorCode.VALIDATION_INVALID_TYPE,
        retryable: false,
      });
    }
    if (!body.agent_config.model || typeof body.agent_config.model !== "string") {
      return problem(c, {
        status: 400,
        title: "Validation failure",
        detail: "agent_config.model is required and must be a string",
        code: ErrorCode.VALIDATION_REQUIRED,
        retryable: false,
      });
    }
    if (body.agent_config.agent_role !== undefined) {
      if (typeof body.agent_config.agent_role !== "string") {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: "agent_config.agent_role must be a string",
          code: ErrorCode.VALIDATION_INVALID_TYPE,
          retryable: false,
        });
      }
      if (body.agent_config.agent_role.length > 200) {
        return problem(c, {
          status: 400,
          title: "Validation failure",
          detail: "agent_config.agent_role must be 200 characters or less",
          code: ErrorCode.VALIDATION_TOO_LARGE,
          retryable: false,
        });
      }
    }
  }

  const apiKey = c.get("apiKey");
  const effectivePolicy = c.get("policy");

  // ── Activation Funnel: first_screen_attempted (Task 17.1) ──
  // Fire-and-forget — only records the first attempt per apiKeyId
  recordActivationEvent(apiKey.id, "first_screen_attempted").catch(() => {});

  if (body.bypass_codeword && codewordBypassAllowed(body.bypass_codeword, effectivePolicy)) {
    const analyzedAt = new Date().toISOString();
    auditLog({
      action: "screening_codeword_bypass_used",
      apiKeyId: apiKey?.id,
      promptLength: body.prompt.length,
      sourceKind: body.metadata?.source_kind,
      trustLevel: body.metadata?.trust_level,
      intendedAction: body.metadata?.intended_action,
      ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
    });
    return c.json({
      id: crypto.randomUUID(),
      risk_score: 0,
      safe: true,
      verdict: "safe",
      flags: [],
      categories: [],
      suggested_action: "allow",
      recommended_action: "allow",
      bypassed: true,
      bypass_type: "user_codeword",
      bypass_scope: "single_turn",
      policy: {
        auto_block: false,
        threshold: effectivePolicy?.autoBlockThreshold ?? 7,
        tier: apiKey?.tier ?? "free",
      },
      analyzed_at: analyzedAt,
    });
  }
  if ((body.execute === true || body.execute === "auto") && apiKey.id.startsWith("x402:")) {
    return problem(c, {
      status: 400,
      title: "Async execution not supported for x402 callers",
      detail:
        "Async execution (execute: true | \"auto\") requires a stable API key for poll authorization. Either omit execute (or set execute:false) for synchronous execution, or use Bearer key authentication.",
      code: ErrorCode.X402_ASYNC_UNSUPPORTED,
      retryable: false,
    });
  }

  // ── Run risk analysis (synchronous — pattern + LLM) ──
  const parseStart = Date.now();
  const result = await parsePrompt(body);
  const parseLatencyMs = Date.now() - parseStart;

  // A silently degraded semantic layer looks exactly like a clean pass to the
  // caller, so surface it as an operational event rather than letting screening
  // quietly fall back to pattern matching for everyone.
  if (result.degraded) {
    auditLog({
      action: "screening_llm_degraded",
      apiKeyId: c.get("apiKey")?.id,
      requestId: result.id,
      detail: result.degraded_reason,
    });
    // Counter so /status can report the layer's real health rather than
    // inferring it from a key being configured. Best-effort: a screening
    // verdict must never fail because bookkeeping did.
    if (isRedisAvailable()) {
      void (async () => {
        try {
          const connected = await ensureRedisConnected();
          if (!connected) return;
          const redis = getRedis();
          const day = new Date().toISOString().slice(0, 10);
          const key = `screening:llm_degraded:${day}`;
          const count = await redis.incr(key);
          if (count === 1) await redis.expire(key, 35 * 24 * 60 * 60);
        } catch {
          // ignore — telemetry only
        }
      })();
    }
  }

  // ── Custom Rules Engine (Layer 4: org-specific compliance rules) ──
  // Evaluate customer-defined regex rules against the prompt after the 3
  // built-in layers (regex, LLM, sandbox) but BEFORE the ScreeningEvent write
  // and enforcement dial. Matched rules modify the result before persistence.
  let customRuleMatchedIds: string[] = [];
  try {
    const dbPolicy = await prisma.screeningPolicy.findUnique({
      where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment: "production" } },
      select: { customRules: true },
    });
    if (dbPolicy?.customRules) {
      const rules = parseCustomRules(dbPolicy.customRules);
      if (rules.length > 0) {
        const ruleResult = evaluateCustomRules(body.prompt, undefined, rules);
        customRuleMatchedIds = ruleResult.matchedIds;

        // Add matched rule findings as flags
        for (const matched of ruleResult.matched) {
          result.flags.push({
            category: "custom_rule",
            severity: matched.action === "block" ? 10 : matched.action === "warn" ? 6 : 3,
            label: `[Custom Rule] ${matched.name}`,
            detail: matched.reason,
            id: matched.id,
            source: "custom_rule_engine",
          });
        }

        // If any custom rule says block, escalate risk score and verdict
        if (ruleResult.verdict === "block") {
          result.risk_score = Math.max(result.risk_score, 10);
          result.verdict = "critical";
          result.safe = false;
          result.attack_detected = true;
        } else if (ruleResult.verdict === "warn") {
          result.risk_score = Math.max(result.risk_score, 5);
          if (result.verdict === "safe" || result.verdict === "low_risk") {
            result.verdict = "medium_risk";
          }
        }

        if (ruleResult.matched.length > 0 && !result.categories.includes("custom_rule")) {
          result.categories.push("custom_rule");
        }
      }
    }
  } catch (err) {
    console.error("[custom-rules] evaluation failed:", (err as Error).message);
  }

  const ruleIds = screeningRuleIds(result);
  const decisionAction = screeningDecisionAction(result);

  // ── Write ScreeningEvent (fire-and-forget — metadata only, no prompt content) ──
  const apiKeyForEvent = c.get("apiKey");
  const effectiveEnforcementMode = effectivePolicy?.enforcementMode ?? "block";
  persistScreeningEventForApiKey({
    apiKeyId: apiKeyForEvent?.id,
    request: body,
    result,
    latencyMs: parseLatencyMs,
    autoBlockThreshold: c.get("policy")?.autoBlockThreshold ?? 7,
    enforcementMode: effectiveEnforcementMode,
  }).catch((err: Error) => console.error("[screening-event] write failed:", err.message));

  // ── Audit log the screening result ──
  auditLog({
    action: "prompt_screened",
    apiKeyId: c.get("apiKey")?.id,
    riskScore: result.risk_score,
    verdict: result.verdict,
    promptLength: body.prompt.length,
    latencyMs: parseLatencyMs,
    requestId: result.id,
    attackDetected: result.attack_detected ?? false,
    recommendedAction: decisionAction,
    approvalRequired: Boolean(result.approval_request),
    categories: result.categories,
    ruleIds: [...ruleIds, ...customRuleMatchedIds],
    sourceKind: body.metadata?.source_kind,
    trustLevel: body.metadata?.trust_level,
    intendedAction: body.metadata?.intended_action,
    policyMode: body.policy_mode ?? "balanced",
    ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown",
  });

  // ── Auto-register discovered agents (fire-and-forget) ──
  // If the request includes an agent_id that doesn't exist in the registry,
  // create it with status "discovered". Non-blocking — never affects the response.
  autoRegisterAgentFromScreening(apiKey.id, body).catch(() => {});

  // ── Coverage attestation: record this screening (fire-and-forget) ──
  // Tracks which agents are being screened by Parse for coverage reporting.
  const coverageAgentId = body.metadata?.agent_id;
  if (coverageAgentId && typeof coverageAgentId === "string") {
    recordScreening(apiKey.id, coverageAgentId).catch(() => {});
  }

  // ── Attach policy recommendation ──
  const policy = c.get("policy");
  const tier = apiKey?.tier ?? "free";
  result.policy = {
    auto_block: result.risk_score >= (policy?.autoBlockThreshold ?? 7),
    threshold: policy?.autoBlockThreshold ?? 7,
    tier,
    approval_required_for_personal_data: policy?.approvalRequiredForPersonalData ?? true,
    approval_required_for_location: policy?.approvalRequiredForLocation ?? true,
    approval_required_for_future_plans: policy?.approvalRequiredForFuturePlans ?? true,
    approval_default_action: policy?.approvalDefaultAction ?? "deny",
  };

  // ── Enforcement Dial (monitor → warn → block) ──
  // Compute what would happen under "block" mode, then downgrade if policy says so.
  const enforcementMode = policy?.enforcementMode ?? "block";
  const wouldBlock = result.risk_score >= (policy?.autoBlockThreshold ?? 7);

  result.wouldBlock = wouldBlock;
  result.enforcementMode = enforcementMode;

  if (enforcementMode !== "block" && wouldBlock) {
    // monitor / warn: never return a blocking verdict or action
    // Downgrade the verdict to the highest non-blocking level
    result.safe = true; // not actually blocked
    result.recommended_action = "sandbox"; // suggest sandbox instead of block
    result.suggested_action = "sandbox";
    // If risk was critical/high, soften the verdict to medium_risk (still visible but not "critical")
    if (result.risk_score > 6) {
      result.verdict = "medium_risk";
    }
    // For warn mode: add a warning annotation header so the caller knows
    if (enforcementMode === "warn") {
      c.header("X-Screening-Warning", `Content would be blocked under "block" mode (risk_score=${result.risk_score})`);
      (result as unknown as Record<string, unknown>).screening_warning = `This content would be blocked under "block" enforcement mode (risk_score=${result.risk_score}). Current mode: "warn".`;
    }
  }

  result.policy = {
    ...result.policy,
    enforcement_mode: enforcementMode,
  };

  // ── Data Access Governance (Task 8.1) ──
  // When request metadata includes data_sources and an agent_id,
  // check the agent's grants. Ungranted access is a finding.
  // The enforcement dial controls whether it blocks:
  //   monitor → recorded only
  //   warn    → warning annotation added
  //   block   → request blocked
  const dgAgentId = body.metadata?.agent_id;
  const dgDataSources = body.metadata?.data_sources;
  if (
    dgAgentId &&
    typeof dgAgentId === "string" &&
    dgDataSources &&
    Array.isArray(dgDataSources) &&
    dgDataSources.length > 0
  ) {
    try {
      const accessResult = await checkDataAccess(dgAgentId, dgDataSources);
      if (!accessResult.allowed) {
        // Add a flag for each violation
        for (const v of accessResult.violations) {
          result.flags.push({
            category: "data_access_violation",
            severity: 6,
            label: `Ungranted data access: ${v.dataSourceId}`,
            detail: `Agent ${dgAgentId} has no active grant for data source ${v.dataSourceId} (${v.reason})`,
            source: "data_governance",
          });
        }
        if (!result.categories.includes("data_access_violation")) {
          result.categories.push("data_access_violation");
        }
        (result as unknown as Record<string, unknown>).data_access_violations = accessResult.violations;

        // Enforcement: under "block" mode, escalate risk and block
        if (enforcementMode === "block") {
          result.risk_score = Math.max(result.risk_score, 7);
          result.verdict = "critical";
          result.safe = false;
          result.suggested_action = "block";
          result.recommended_action = "block";
          result.wouldBlock = true;
        }
      }
    } catch (dgErr) {
      console.error("[data-governance] access check failed:", (dgErr as Error).message);
      // Fail open — don't block screening on governance check failure
    }
  }

  // ── Tool Allowlist Enforcement (Task 8.2) ──
  // When policy.enforceToolAllowlist is true, compare the tools requested in
  // the screening request (metadata.tool_permissions or body.tools) against
  // the agent's registered tools in AgentRegistry.tools[].
  // Tools outside the allowlist produce a tool_violation flag, enforced
  // through the enforcement dial (same as data governance):
  //   monitor → recorded only
  //   warn    → warning annotation added
  //   block   → request blocked
  if (policy?.enforceToolAllowlist) {
    const toolAgentId = body.metadata?.agent_id;
    // Gather requested tools from metadata.tool_permissions or body.tools
    const bodyTools = (body as any).tools;
    const requestedTools: string[] = Array.isArray(body.metadata?.tool_permissions)
      ? body.metadata!.tool_permissions!
      : Array.isArray(bodyTools)
        ? (bodyTools as string[])
        : [];

    if (
      toolAgentId &&
      typeof toolAgentId === "string" &&
      requestedTools.length > 0
    ) {
      try {
        const agent = await prisma.agentRegistry.findUnique({
          where: { id: toolAgentId },
          select: { tools: true, status: true, agentName: true },
        });

        // "Discovered" agents: enforcement starts OFF — just prompt to review
        if (agent?.status === "discovered") {
          (result as unknown as Record<string, unknown>).tool_allowlist_review_prompt = true;
        } else if (agent) {
          const allowlist = new Set(agent.tools);
          const violations = requestedTools.filter((t) => !allowlist.has(t));

          if (violations.length > 0) {
            for (const vTool of violations) {
              result.flags.push({
                category: "tool_violation",
                severity: 6,
                label: `Unregistered tool: ${vTool}`,
                detail: `Tool "${vTool}" is not in agent "${agent.agentName}"'s registered tool list (${agent.tools.length} tools)`,
                source: "tool_allowlist",
              });
            }
            if (!result.categories.includes("tool_violation")) {
              result.categories.push("tool_violation");
            }
            (result as unknown as Record<string, unknown>).tool_violations = violations;

            // Enforcement: under "block" mode, escalate risk and block
            if (enforcementMode === "block") {
              result.risk_score = Math.max(result.risk_score, 7);
              result.verdict = "critical";
              result.safe = false;
              result.suggested_action = "block";
              result.recommended_action = "block";
              result.wouldBlock = true;
            }
          }
        }
      } catch (taErr) {
        console.error("[tool-allowlist] check failed:", (taErr as Error).message);
        // Fail open — don't block screening on allowlist check failure
      }
    }
  }

  // ── Egress Destination Control (Task 8.3) ──
  // When request metadata includes intended_action with an external destination,
  // evaluate the destination + classification against the org's egress rules.
  // Actions:
  //   block            → add egress_violation flag, enforce through dial
  //   require_approval → create approval request (reuses existing approval flow)
  //   allow            → no action
  const egressDestination = body.metadata?.egress_destination as string | undefined;
  const egressClassification = (body.metadata?.data_classification as string[] | undefined)?.[0];
  if (
    egressDestination &&
    typeof egressDestination === "string" &&
    egressClassification &&
    typeof egressClassification === "string"
  ) {
    try {
      // Resolve org for this API key
      let egressOrgId: string | null = null;
      const egressApiKey = await prisma.apiKey.findUnique({
        where: { id: apiKey.id },
        select: { orgId: true },
      });
      if (egressApiKey?.orgId) {
        egressOrgId = egressApiKey.orgId;
      } else {
        const egressOrg = await prisma.organization.findFirst({
          where: { ownerId: apiKey.id },
        });
        if (egressOrg) egressOrgId = egressOrg.id;
      }

      if (egressOrgId) {
        const dbRules = await prisma.egressRule.findMany({
          where: { orgId: egressOrgId },
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        });

        const rules: EgressRuleInput[] = dbRules.map((r) => ({
          id: r.id,
          destinationPattern: r.destinationPattern,
          maxClassification: r.maxClassification,
          action: r.action,
          priority: r.priority,
        }));

        const egressResult = checkEgress(egressDestination, egressClassification, rules);

        if (egressResult.action === "block") {
          result.flags.push({
            category: "egress_violation",
            severity: 8,
            label: `Egress blocked: ${egressDestination}`,
            detail: `Data classified as "${egressClassification}" is not permitted at destination "${egressDestination}" (rule: ${egressResult.matchedRule?.destinationPattern ?? "default"}, max classification: ${egressResult.matchedRule?.maxClassification ?? "N/A"})`,
            source: "egress_control",
          });
          if (!result.categories.includes("egress_violation")) {
            result.categories.push("egress_violation");
          }
          (result as unknown as Record<string, unknown>).egress_violation = {
            destination: egressDestination,
            classification: egressClassification,
            action: "block",
            matched_rule: egressResult.matchedRule?.id ?? null,
          };

          // Enforcement: under "block" mode, escalate risk and block
          if (enforcementMode === "block") {
            result.risk_score = Math.max(result.risk_score, 8);
            result.verdict = "critical";
            result.safe = false;
            result.suggested_action = "block";
            result.recommended_action = "block";
            result.wouldBlock = true;
          } else if (enforcementMode === "warn") {
            c.header("X-Egress-Warning", `Egress to "${egressDestination}" would be blocked under "block" mode`);
          }
        } else if (egressResult.action === "require_approval") {
          // Create approval request using existing flow structure
          result.flags.push({
            category: "egress_approval_required",
            severity: 5,
            label: `Egress requires approval: ${egressDestination}`,
            detail: `Data classified as "${egressClassification}" requires approval before sending to "${egressDestination}" (rule: ${egressResult.matchedRule?.destinationPattern ?? "default"})`,
            source: "egress_control",
          });
          if (!result.categories.includes("egress_approval_required")) {
            result.categories.push("egress_approval_required");
          }
          (result as unknown as Record<string, unknown>).egress_approval_request = {
            type: "egress_approval",
            destination: egressDestination,
            classification: egressClassification,
            matched_rule: egressResult.matchedRule?.id ?? null,
            default_action: "deny",
            expires_in_seconds: 900,
          };

          // Set suggested action to request approval
          if (result.suggested_action === "allow") {
            result.suggested_action = "request_owner_approval";
          }
          if (result.recommended_action === "allow" || !result.recommended_action) {
            result.recommended_action = "request_owner_approval";
          }
        }
      }
    } catch (egressErr) {
      console.error("[egress] check failed:", (egressErr as Error).message);
      // Fail open — don't block screening on egress check failure
    }
  }

  // ── Volume Budget Tracking (Task 8.4) ──
  // When request metadata includes records_accessed or bytes_accessed,
  // track usage against the agent's volume budgets and enforce limits.
  const volAgentId = body.metadata?.agent_id;
  const recordsAccessed = body.metadata?.records_accessed;
  const bytesAccessed = body.metadata?.bytes_accessed;

  if (
    volAgentId &&
    typeof volAgentId === "string" &&
    (recordsAccessed !== undefined || bytesAccessed !== undefined)
  ) {
    const records = typeof recordsAccessed === "number" && recordsAccessed > 0 ? recordsAccessed : 0;
    const bytes = typeof bytesAccessed === "number" && bytesAccessed > 0 ? bytesAccessed : 0;

    // Track usage for each data source mentioned, plus agent-wide
    const volDataSources = body.metadata?.data_sources;
    try {
      // Track agent-wide usage
      await trackUsage(volAgentId, null, records, bytes);

      // Track per-source usage if data_sources are specified
      if (Array.isArray(volDataSources)) {
        for (const dsId of volDataSources) {
          await trackUsage(volAgentId, dsId, records, bytes);
        }
      }

      // Check budget for each source (or agent-wide if no sources)
      const sourcesToCheck = Array.isArray(volDataSources) && volDataSources.length > 0
        ? volDataSources
        : [null];

      let anyExceeded = false;
      const allViolations: string[] = [];
      const allWarnings: string[] = [];

      for (const dsId of sourcesToCheck) {
        const budgetCheck = await checkBudget(volAgentId, dsId, records);
        if (budgetCheck.exceeded) {
          anyExceeded = true;
          allViolations.push(...budgetCheck.violations);
        }
        if (budgetCheck.warning) {
          allWarnings.push(...budgetCheck.warnings);
        }
      }

      if (anyExceeded) {
        result.flags.push({
          category: "volume_budget_exceeded",
          severity: 8,
          label: "Data volume budget exceeded",
          detail: `Agent ${volAgentId} has exceeded its volume budget: ${allViolations.join("; ")}`,
          source: "volume_tracker",
        });
        if (!result.categories.includes("volume_budget_exceeded")) {
          result.categories.push("volume_budget_exceeded");
        }
        (result as unknown as Record<string, unknown>).volume_budget_exceeded = {
          violations: allViolations,
          agent_id: volAgentId,
        };

        // Enforcement: under "block" mode, escalate risk and block
        if (enforcementMode === "block") {
          result.risk_score = Math.max(result.risk_score, 8);
          result.verdict = "critical";
          result.safe = false;
          result.suggested_action = "block";
          result.recommended_action = "block";
          result.wouldBlock = true;
        } else if (enforcementMode === "warn") {
          c.header("X-Volume-Budget-Warning", "Data volume budget exceeded — would be blocked under \"block\" mode");
        }
      } else if (allWarnings.length > 0) {
        // 80% threshold — warning only, never blocked
        result.flags.push({
          category: "volume_budget_warning",
          severity: 4,
          label: "Data volume budget approaching limit",
          detail: `Agent ${volAgentId} is approaching its volume budget: ${allWarnings.join("; ")}`,
          source: "volume_tracker",
        });
        (result as unknown as Record<string, unknown>).volume_budget_warning = {
          warnings: allWarnings,
          agent_id: volAgentId,
        };
      }
    } catch (volErr) {
      console.error("[volume-tracker] check failed:", (volErr as Error).message);
      // Fail open — don't block screening on volume check failure
    }
  }

  // ── Action Approval Matrix (Task 8.5) ──
  // When request metadata includes action_type and data_classification,
  // evaluate the pair against the configured approval matrix.
  //   require_approval → add approval_request flag (existing approval flow handles routing)
  //   block            → add approval_matrix_block flag, enforce through dial
  //   allow            → no action
  const matrixActionType = body.metadata?.action_type;
  const matrixClassifications = body.metadata?.data_classification;

  if (
    matrixActionType &&
    typeof matrixActionType === "string" &&
    matrixClassifications &&
    Array.isArray(matrixClassifications) &&
    matrixClassifications.length > 0
  ) {
    try {
      // Load the approval matrix from the policy
      const matrixPolicy = await prisma.screeningPolicy.findUnique({
        where: { idx_screening_policy_key_env: { apiKeyId: apiKey.id, environment: "production" } },
        select: { approvalMatrix: true },
      });
      const matrix = normalizeMatrix(matrixPolicy?.approvalMatrix);

      // Evaluate against the highest classification present (most restrictive check)
      for (const cls of matrixClassifications) {
        if (typeof cls !== "string") continue;

        // Skip invalid action types or classifications gracefully
        if (!isValidActionType(matrixActionType) || !isValidClassification(cls)) continue;

        const cellKey = matrixKey(matrixActionType, cls);
        const decision = evaluateMatrix(matrix, matrixActionType, cls);

        if (decision === "require_approval") {
          result.flags.push({
            category: "approval_matrix",
            severity: 6,
            label: `Approval required: ${matrixActionType} × ${cls}`,
            detail: `Action "${matrixActionType}" on "${cls}" data requires approval per the approval matrix (cell: ${cellKey})`,
            source: "approval_matrix",
          });
          if (!result.categories.includes("approval_matrix")) {
            result.categories.push("approval_matrix");
          }
          (result as unknown as Record<string, unknown>).approval_matrix_request = {
            action_type: matrixActionType,
            classification: cls,
            cell: cellKey,
            decision: "require_approval",
            default_action: "deny",
            expires_in_seconds: 900,
          };

          // Route through existing approval flow
          if (!result.approval_request) {
            result.approval_request = {
              type: "approval_matrix" as any,
              sensitivity: cls === "restricted" ? "confidential" : "personal",
              data_requested: [`${matrixActionType} on ${cls} data`],
              requester_trust: "unknown" as any,
              owner_prompt: `Approval required for action "${matrixActionType}" on "${cls}" data. Default is deny if you do not respond within 15 minutes.`,
              default_action: "deny" as const,
              expires_in_seconds: 900,
              allowed_response_modes: ["deny", "share_approved_summary"] as const,
            } as any;
          }

          if (result.suggested_action === "allow") {
            result.suggested_action = "request_owner_approval" as any;
          }
          if (result.recommended_action === "allow" || !result.recommended_action) {
            result.recommended_action = "request_owner_approval" as any;
          }
        } else if (decision === "block") {
          result.flags.push({
            category: "approval_matrix_block",
            severity: 9,
            label: `Blocked by approval matrix: ${matrixActionType} × ${cls}`,
            detail: `Action "${matrixActionType}" on "${cls}" data is blocked per the approval matrix (cell: ${cellKey})`,
            source: "approval_matrix",
          });
          if (!result.categories.includes("approval_matrix_block")) {
            result.categories.push("approval_matrix_block");
          }
          (result as unknown as Record<string, unknown>).approval_matrix_block = {
            action_type: matrixActionType,
            classification: cls,
            cell: cellKey,
            decision: "block",
          };

          // Enforcement: under "block" mode, escalate risk and block
          if (enforcementMode === "block") {
            result.risk_score = Math.max(result.risk_score, 9);
            result.verdict = "critical";
            result.safe = false;
            result.suggested_action = "block";
            result.recommended_action = "block";
            result.wouldBlock = true;
          } else if (enforcementMode === "warn") {
            c.header("X-Approval-Matrix-Block", `Action "${matrixActionType}" on "${cls}" data would be blocked under "block" mode`);
          }
        }
        // decision === "allow" → no action
      }
    } catch (matrixErr) {
      console.error("[approval-matrix] evaluation failed:", (matrixErr as Error).message);
      // Fail open — don't block screening on matrix check failure
    }
  }

  // ── Gate score_components to team+ tier (prevents free-tier scoring oracle) ──
  // Compliance is a paid tier above Team; withholding forensic detail from the
  // customers who buy Parse for audit evidence defeats the purpose.
  if (tier !== "team" && tier !== "compliance" && tier !== "enterprise" && apiKey.id !== "master") {
    delete result.score_components;
  }

  // ── Gate detailed flags to paid tiers (prevent free-tier pattern enumeration) ──
  if (tier === "free" && apiKey.id !== "master" && apiKey.id !== "demo") {
    const flagCount = result.flags.length;
    const topCategory = result.categories[0] ?? "none";
    result.flags = flagCount > 0
      ? [{ category: topCategory, severity: result.risk_score, label: `${flagCount} risk signal(s) detected`, detail: "" }]
      : [];
  }

  // ── Attach suggested_action based on risk score and approval context ──
  result.suggested_action = computeSuggestedAction(result.risk_score, result.approval_request);
  result.recommended_action = result.recommended_action ?? result.suggested_action;

  // ── Resolve effective execution intent ──
  // execute: "auto"  → run for scores 3-6 (standard), 7+ (observe mode — no URL fetching)
  // execute: true    → always run, giving the caller deliberate sandbox inspection
  // execute: false   → never run
  const autoExec = body.execute === "auto" && result.risk_score >= 3 && result.risk_score <= 6;
  const observeExec = body.execute === "auto" && result.risk_score >= 7;
  const explicitExec = body.execute === true;
  const shouldExecute = autoExec || observeExec || explicitExec;

  // ── Attach verified_identity to response metadata (Task 10.1) ──
  if (verifiedIdentity) {
    (result as unknown as Record<string, unknown>).verified_identity = verifiedIdentity;
  }

  // ── If no execution will run, return immediately ──
  if (!shouldExecute) {
    // ── Activation Funnel: first_screen_succeeded (Task 17.1) ──
    const keyGenTs = await getActivationEventTs(apiKey.id, "key_generated").catch(() => null);
    recordActivationEvent(apiKey.id, "first_screen_succeeded", { keyGeneratedTs: keyGenTs ?? undefined }).catch(() => {});
    return c.json(result);
  }

  // ── Fail closed: execution requires Redis for rate limiting and cost caps ──
  if (apiKey.id !== "master" && !isRedisAvailable()) {
    console.warn("[SECURITY] Execution request rejected — Redis unavailable for rate limiting/cost caps");
    return problem(c, {
      status: 503,
      title: "Sandbox unavailable",
      detail: "Sandbox execution temporarily unavailable (rate limit service down)",
      code: ErrorCode.SANDBOX_UNAVAILABLE,
      retryable: true,
    });
  }

  // ── Observe mode: separate, more restrictive rate limit for high-risk prompts ──
  const OBSERVE_LIMITS: Record<string, number> = { free: 2, pro: 10, team: 50, compliance: 100, enterprise: 200 };
  if (observeExec && apiKey.id !== "master" && isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const obsKey = `exec:observe:${apiKey.id}`;
        const obsCount = await redis.incr(obsKey);
        if (obsCount === 1) await redis.expire(obsKey, 3600);
        const maxObs = OBSERVE_LIMITS[tier] ?? 2;
        if (obsCount > maxObs) {
          c.header("Retry-After", "3600");
          return problem(c, {
            status: 429,
            title: "Rate limit exceeded",
            detail: "Observe mode rate limit exceeded",
            code: ErrorCode.RATE_LIMIT,
            retryable: true,
            limit: maxObs,
            window: "1 hour",
          });
        }
      }
    } catch { /* fall through to standard rate limit */ }
  }

  // ── Execution rate limit check (master key is exempt) ──
  if (apiKey.id !== "master" && isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        const execRateKey = `exec:rate:${apiKey.id}`;
        const execCount = await redis.incr(execRateKey);
        if (execCount === 1) await redis.expire(execRateKey, 3600);
        const maxExec = EXEC_LIMITS[tier] ?? 5;
        if (execCount > maxExec) {
          c.header("Retry-After", "3600");
          return problem(c, {
            status: 429,
            title: "Rate limit exceeded",
            detail: "Execution rate limit exceeded",
            code: ErrorCode.RATE_LIMIT,
            retryable: true,
            limit: maxExec,
            window: "1 hour",
          });
        }

        // Daily cost cap check
        const dailyCostKey = `exec:cost:${apiKey.id}:${new Date().toISOString().slice(0, 10)}`;
        const dailyCost = parseFloat(await redis.get(dailyCostKey) || "0");
        const maxCost = DAILY_COST_CAPS[tier] ?? 0.50;
        if (dailyCost >= maxCost) {
          c.header("Retry-After", "3600");
          c.header("X-Upgrade-URL", "/pricing");
          return problem(c, {
            status: 429,
            title: "Usage cap reached",
            detail: "Daily execution cost cap reached",
            code: ErrorCode.USAGE_CAP,
            retryable: false,
            cap_usd: maxCost,
          });
        }
      }
    } catch {
      // Redis connected but operation failed — fail closed
      console.warn("[SECURITY] Execution rate limit check failed — rejecting request");
      return problem(c, {
        status: 503,
        title: "Sandbox unavailable",
        detail: "Sandbox execution temporarily unavailable (rate limit check failed)",
        code: ErrorCode.SANDBOX_UNAVAILABLE,
        retryable: true,
      });
    }
  }

  // ── Queue async execution (store job in Redis, return 202 + poll URL) ──
  const parseId = result.id;
  const baseUrl = getBaseUrl(c);

  if (isRedisAvailable()) {
    try {
      const redis = getRedis();
      const connected = await ensureRedisConnected();
      if (connected) {
        // Store the execution job in Redis
        const execJob = {
          parseId,
          apiKeyId: apiKey.id,  // Track ownership
          prompt: body.prompt,
          test_input: body.test_input,
          agent_config: body.agent_config,
          model: body.model,
          risk_score: result.risk_score,
          status: "pending",
          created_at: new Date().toISOString(),
        };
        await redis.set(`exec:job:${parseId}`, JSON.stringify(execJob), "EX", 600); // 10-min TTL

        // Store the parse result for retrieval (with ownership tag for IDOR protection)
        await redis.set(`exec:parse:${parseId}`, JSON.stringify({ ...result, _apiKeyId: apiKey.id }), "EX", 600);

        // Execute in background (fire-and-forget)
        executeAsync(parseId, body.prompt, body.test_input, body.agent_config, body.model, tier, apiKey.id).catch((err) => {
          console.error(`[exec] Async execution failed for ${parseId}:`, err.message);
        });

        // Return 202 with poll URL
        result.execution_pending = true;
        result.poll_url = `${baseUrl}/v1/parse/${parseId}`;
        // ── Activation Funnel: first_screen_succeeded (Task 17.1) ──
        const keyGenTs = await getActivationEventTs(apiKey.id, "key_generated").catch(() => null);
        recordActivationEvent(apiKey.id, "first_screen_succeeded", { keyGeneratedTs: keyGenTs ?? undefined }).catch(() => {});
        return c.json(result, 202);
      }
    } catch {
      // Redis unavailable — fall through to sync execution
    }
  }

  // ── Fallback: synchronous inline execution (no Redis available) ──
  const execResult = await executeSyncFallback(body.prompt, body.test_input, body.agent_config, body.model);
  result.execution = execResult;

  // Adjust overall risk if output is dangerous
  if (execResult.output_risk_score > result.risk_score) {
    result.risk_score = Math.min(10, execResult.output_risk_score);
    result.safe = result.risk_score <= 3;
    result.verdict = computeVerdict(result.risk_score);
    result.suggested_action = result.risk_score <= 2 ? "allow" : result.risk_score <= 6 ? "sandbox" : "block";
  }

  // ── Activation Funnel: first_screen_succeeded (Task 17.1) ──
  const keyGenTs = await getActivationEventTs(apiKey.id, "key_generated").catch(() => null);
  recordActivationEvent(apiKey.id, "first_screen_succeeded", { keyGeneratedTs: keyGenTs ?? undefined }).catch(() => {});

  return c.json(result);
});

// ─── GET /v1/parse/:id (poll for execution result) ─────────────────────────

parseRoutes.get("/v1/parse/:id", authMiddleware("evaluate"), async (c) => {
  const parseId = c.req.param("id");

  if (!isRedisAvailable()) {
    return c.json({ error: "Polling not available (Redis not configured)" }, 503);
  }

  const redis = getRedis();
  const connected = await ensureRedisConnected();
  if (!connected) {
    return c.json({ error: "Polling not available (Redis not connected)" }, 503);
  }

  // Get the stored parse result
  const parseData = await redis.get(`exec:parse:${parseId}`);
  if (!parseData) {
    return c.json({ error: "Parse result not found or expired" }, 404);
  }

  const parseResult = JSON.parse(parseData);

  // Ownership check on parse result itself (prevents IDOR before job data is checked)
  const pollApiKey = c.get("apiKey") as any;
  if (parseResult._apiKeyId && pollApiKey && parseResult._apiKeyId !== pollApiKey.id && pollApiKey.id !== "master") {
    return c.json({ error: "Not authorized to view this result" }, 403);
  }
  delete parseResult._apiKeyId;

  // Check execution status
  const jobData = await redis.get(`exec:job:${parseId}`);
  if (!jobData) {
    return c.json({ ...parseResult, execution: null, status: "expired" });
  }

  const job = JSON.parse(jobData);

  // Ownership check on job data (defense-in-depth alongside parse result check above)
  if (job.apiKeyId && pollApiKey && job.apiKeyId !== pollApiKey.id && pollApiKey.id !== "master") {
    return c.json({ error: "Not authorized to view this result" }, 403);
  }

  if (job.status === "pending" || job.status === "running") {
    // Treat jobs stuck in running/pending for >3 min as failed (e.g. killed by deploy)
    const ageMs = Date.now() - new Date(job.created_at).getTime();
    if (ageMs > 180_000) {
      job.status = "failed";
      job.error = "Execution timed out (process was interrupted)";
      await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);
      // fall through to failed handler below
    } else {
      return c.json({ ...parseResult, execution_pending: true, status: job.status });
    }
  }

  if (job.status === "completed" && job.result) {
    parseResult.execution = job.result;
    parseResult.execution_pending = false;
    delete parseResult.poll_url;

    // Adjust risk if output is dangerous
    if (job.result.output_risk_score > parseResult.risk_score) {
      parseResult.risk_score = Math.min(10, job.result.output_risk_score);
      parseResult.safe = parseResult.risk_score <= 3;
      parseResult.verdict = computeVerdict(parseResult.risk_score);
      parseResult.suggested_action = parseResult.risk_score <= 2 ? "allow" : parseResult.risk_score <= 6 ? "sandbox" : "block";
    }

    return c.json(parseResult);
  }

  if (job.status === "failed") {
    parseResult.execution = {
      output: `[Execution failed: ${job.error || "unknown error"}]`,
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: 0,
      isolated: false,
      sandbox_status: "unavailable",
    };
    parseResult.execution_pending = false;
    delete parseResult.poll_url;
    return c.json(parseResult);
  }

  return c.json({ ...parseResult, execution_pending: true, status: "unknown" });
});

// ─── Async execution helper ────────────────────────────────────────────────

async function executeAsync(
  parseId: string,
  prompt: string,
  testInput: string | undefined,
  agentConfig: ParseRequest["agent_config"],
  model: string | undefined,
  tier: string,
  apiKeyId: string
): Promise<void> {
  const redis = getRedis();

  // Update job status to running
  const jobData = await redis.get(`exec:job:${parseId}`);
  if (!jobData) return;
  const job = JSON.parse(jobData);
  job.status = "running";
  await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);

  try {
    let execResult: ExecutionResult;

    if (canUseSandbox()) {
      try {
        execResult = await processSandboxExecution(prompt, testInput, {
          model: agentConfig?.model || model || "deepseek/deepseek-chat",
          temperature: agentConfig?.temperature,
          max_tokens: agentConfig?.max_tokens,
          agent_role: agentConfig?.agent_role,
        });
      } catch (sandboxErr: any) {
        console.error(`[exec] Sandbox call failed: ${sandboxErr?.message || sandboxErr}`);
        execResult = {
          output: "[Execution skipped: sandbox unavailable]",
          output_risk_score: 0,
          output_flags: [],
          token_usage: { prompt: 0, completion: 0, total: 0 },
          cost_usd: 0,
          latency_ms: 0,
          isolated: false,
          sandbox_status: "unavailable",
        };
      }
    } else {
      execResult = {
        output: "[Execution skipped: sandbox not configured]",
        output_risk_score: 0,
        output_flags: [],
        token_usage: { prompt: 0, completion: 0, total: 0 },
        cost_usd: 0,
        latency_ms: 0,
        isolated: false,
        sandbox_status: "unavailable",
      };
    }

    // Update job with result
    job.status = "completed";
    job.result = execResult;
    await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);

    // Increment daily cost counter
    if (execResult.cost_usd > 0) {
      const dailyCostKey = `exec:cost:${apiKeyId}:${new Date().toISOString().slice(0, 10)}`;
      await redis.incrbyfloat(dailyCostKey, execResult.cost_usd);
      const ttl = await redis.ttl(dailyCostKey);
      if (ttl === -1) await redis.expire(dailyCostKey, 86400);
    }
  } catch (err: any) {
    job.status = "failed";
    job.error = err.message || "Unknown error";
    await redis.set(`exec:job:${parseId}`, JSON.stringify(job), "EX", 600);
  }
}

// ─── Shared sandbox execution helper ──────────────────────────────────────

async function processSandboxExecution(
  prompt: string,
  testInput: string | undefined,
  agentConfig: { model: string; temperature?: number; max_tokens?: number; agent_role?: string }
): Promise<ExecutionResult> {
  const sandboxResult = await executeInSandbox(prompt, testInput, agentConfig);

  const sanitizedOutput = sanitizeOutput(sandboxResult.output);
  const { outputFlags, outputRiskScore } = analyzeOutputRisks(sanitizedOutput, prompt);

  // Merge all output flags
  const allOutputFlags = [...outputFlags];

  // Run LLM-based output injection analysis for deeper semantic detection
  try {
    const llmFlag = await llmOutputInjectionAnalysis(sanitizedOutput, prompt, sandboxResult.fetched_page_context ?? "", sandboxResult.hidden_content);
    if (llmFlag) allOutputFlags.push(llmFlag);
  } catch { /* pattern analysis is sufficient fallback */ }

  // Analyze fetched content for indirect injection indicators
  if (sandboxResult.fetched_page_context) {
    const fetchedFlags = analyzeFetchedContent(sandboxResult.fetched_page_context, sandboxResult.fetched_urls ?? []);
    allOutputFlags.push(...fetchedFlags);
  }

  // Analyze hidden content stripped from DOM (sr-only, display:none, aria-hidden, etc.)
  if (sandboxResult.hidden_content) {
    const hiddenFlags = analyzeHiddenContent(sandboxResult.hidden_content);
    allOutputFlags.push(...hiddenFlags);
  }

  // Run LLM sandbox analysis for holistic behavioral assessment
  let sandboxAnalysis: string | undefined;
  try {
    sandboxAnalysis = await llmSandboxAnalysis(sanitizedOutput, prompt, allOutputFlags, sandboxResult.fetched_page_context ?? null) ?? undefined;
  } catch { /* optional enrichment */ }

  // Take highest severity across all flags as output risk score
  let finalOutputRisk = outputRiskScore;
  for (const flag of allOutputFlags) {
    if (flag.severity > finalOutputRisk) finalOutputRisk = flag.severity;
  }

  return {
    output: sanitizedOutput,
    output_risk_score: finalOutputRisk,
    output_flags: allOutputFlags,
    token_usage: sandboxResult.token_usage,
    cost_usd: 0,
    latency_ms: sandboxResult.execution_ms,
    isolated: true,
    sandbox_status: "executed",
    fetched_urls: sandboxResult.fetched_urls,
    sandbox_analysis: sandboxAnalysis,
  };
}

// ─── Sync fallback (when Redis is not available for async) ──────────────────

async function executeSyncFallback(
  prompt: string,
  testInput: string | undefined,
  agentConfig: ParseRequest["agent_config"],
  model: string | undefined
): Promise<ExecutionResult> {
  if (!canUseSandbox()) {
    return {
      output: "[Execution skipped: sandbox not configured]",
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: 0,
      isolated: false,
      sandbox_status: "unavailable",
    };
  }

  try {
    return await processSandboxExecution(prompt, testInput, {
      model: agentConfig?.model || model || "deepseek/deepseek-chat",
      temperature: agentConfig?.temperature,
      max_tokens: agentConfig?.max_tokens,
      agent_role: agentConfig?.agent_role,
    });
  } catch (err: any) {
    console.error(`[exec] Sandbox call failed: ${err?.message || err}`);
    return {
      output: "[Execution skipped: sandbox unavailable]",
      output_risk_score: 0,
      output_flags: [],
      token_usage: { prompt: 0, completion: 0, total: 0 },
      cost_usd: 0,
      latency_ms: 0,
      isolated: false,
      sandbox_status: "unavailable",
    };
  }
}

// ─── Output sanitization ───────────────────────────────────────────────────

function sanitizeOutput(output: string): string {
  // Strip control chars (U+0000-U+001F) except tab, LF, CR — these leak from fetched page content
  const clean = output.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  return clean.length > 5000
    ? clean.slice(0, 5000) + "\n...[truncated]"
    : clean;
}

function sanitizeErrorMessage(message: string): string {
  // Strip potential OpenRouter internals from error messages
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/sk-or-\S+/gi, "[REDACTED]")
    .slice(0, 200);
}
