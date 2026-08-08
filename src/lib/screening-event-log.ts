import type { ParseRequest, ParseResponse } from "../parse.js";
import type { Prisma } from "../generated/prisma/client.js";
import { computeSuggestedAction, type SuggestedAction } from "./privacy-approval.js";

type Metadata = NonNullable<ParseRequest["metadata"]>;

export interface ScreeningEventMetadata {
  [key: string]: unknown;
  request_id: string;
  attack_detected: boolean;
  recommended_action: SuggestedAction;
  approval_required: boolean;
  source_kind?: Metadata["source_kind"];
  trust_level?: Metadata["trust_level"];
  intended_action?: Metadata["intended_action"];
  action_type?: string;
  data_classification?: string[];
  policy_mode: NonNullable<ParseRequest["policy_mode"]>;
  rule_ids: string[];
  approval_matrix_decision?: string;
  approval_matrix_cell?: string;
}

export interface ScreeningEventData {
  apiKeyId: string;
  riskScore: number;
  verdict: ParseResponse["verdict"];
  categories: string[];
  mode: NonNullable<ParseRequest["mode"]>;
  latencyMs: number;
  blocked: boolean;
  wouldBlock?: boolean;
  enforcementMode?: string;
  metadata: ScreeningEventMetadata;
}

export type ScreeningEventWriter = (data: ScreeningEventData) => Promise<unknown>;

export function shouldPersistScreeningEventForApiKey(apiKeyId?: string): apiKeyId is string {
  return Boolean(apiKeyId && apiKeyId !== "master" && apiKeyId !== "demo" && !apiKeyId.startsWith("x402:"));
}

export function screeningRuleIds(result: Pick<ParseResponse, "score_components" | "flags">): string[] {
  return (result.score_components?.rule_ids ?? result.flags.map((flag) => flag.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export function screeningDecisionAction(result: Pick<ParseResponse, "recommended_action" | "suggested_action" | "risk_score" | "approval_request">): SuggestedAction {
  return result.recommended_action
    ?? result.suggested_action
    ?? computeSuggestedAction(result.risk_score, result.approval_request);
}

function compactMetadata(metadata: ScreeningEventMetadata): ScreeningEventMetadata {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as ScreeningEventMetadata;
}

/**
 * Extract approval matrix decision from a ParseResponse result.
 * The parse route sets `approval_matrix_block` or `approval_matrix_request`
 * as dynamic properties on the result.
 */
function getMatrixDecisionFromResult(result: ParseResponse): string | undefined {
  const r = result as unknown as Record<string, unknown>;
  if (r.approval_matrix_block) return "block";
  if (r.approval_matrix_request) return "require_approval";
  return undefined;
}

/**
 * Extract approval matrix cell coordinate from a ParseResponse result.
 * Returns the cell key (e.g. "delete_data_confidential") if a matrix
 * decision was made.
 */
function getMatrixCellFromResult(result: ParseResponse): string | undefined {
  const r = result as unknown as Record<string, { cell?: string } | undefined>;
  if (r.approval_matrix_block?.cell) return r.approval_matrix_block.cell;
  if (r.approval_matrix_request?.cell) return r.approval_matrix_request.cell;
  return undefined;
}

export function buildScreeningEventData(input: {
  apiKeyId: string;
  request: ParseRequest;
  result: ParseResponse;
  latencyMs: number;
  autoBlockThreshold?: number;
  enforcementMode?: string;
}): ScreeningEventData {
  const ruleIds = screeningRuleIds(input.result);
  const recommendedAction = screeningDecisionAction(input.result);
  const threshold = input.autoBlockThreshold ?? 7;
  const mode = input.enforcementMode ?? "block";

  // The raw verdict: would this have been blocked if mode were "block"?
  const wouldBlock = input.result.risk_score >= threshold;

  // What actually gets blocked depends on the enforcement mode:
  // - "block": blocks as normal
  // - "monitor"/"warn": never actually block (counterfactual only)
  const blocked = mode === "block" ? wouldBlock : false;

  return {
    apiKeyId: input.apiKeyId,
    riskScore: input.result.risk_score,
    verdict: input.result.verdict,
    categories: input.result.categories,
    mode: input.request.mode ?? "full",
    latencyMs: input.latencyMs,
    blocked,
    wouldBlock,
    enforcementMode: mode,
    metadata: compactMetadata({
      request_id: input.result.id,
      attack_detected: input.result.attack_detected ?? false,
      recommended_action: recommendedAction,
      approval_required: Boolean(input.result.approval_request),
      source_kind: input.request.metadata?.source_kind,
      trust_level: input.request.metadata?.trust_level,
      intended_action: input.request.metadata?.intended_action,
      action_type: input.request.metadata?.action_type,
      data_classification: input.request.metadata?.data_classification,
      policy_mode: input.request.policy_mode ?? "balanced",
      rule_ids: ruleIds,
      approval_matrix_decision: getMatrixDecisionFromResult(input.result),
      approval_matrix_cell: getMatrixCellFromResult(input.result),
    }),
  };
}

export function isCompleteScreeningEventData(data: ScreeningEventData): boolean {
  return Boolean(
    data.apiKeyId &&
      Number.isFinite(data.riskScore) &&
      data.verdict &&
      Array.isArray(data.categories) &&
      data.mode &&
      Number.isFinite(data.latencyMs) &&
      typeof data.blocked === "boolean" &&
      data.metadata.request_id &&
      typeof data.metadata.attack_detected === "boolean" &&
      data.metadata.recommended_action &&
      typeof data.metadata.approval_required === "boolean" &&
      data.metadata.policy_mode &&
      Array.isArray(data.metadata.rule_ids),
  );
}

export async function persistScreeningEventData(data: ScreeningEventData, writer?: ScreeningEventWriter): Promise<void> {
  if (writer) {
    await writer(data);
    return;
  }

  const { prisma } = await import("../db.js");
  await prisma.screeningEvent.create({
    data: {
      ...data,
      metadata: data.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistScreeningEventForApiKey(input: {
  apiKeyId?: string;
  request: ParseRequest;
  result: ParseResponse;
  latencyMs: number;
  autoBlockThreshold?: number;
  enforcementMode?: string;
  writer?: ScreeningEventWriter;
}): Promise<void> {
  if (!shouldPersistScreeningEventForApiKey(input.apiKeyId)) return;

  await persistScreeningEventData(
    buildScreeningEventData({
      apiKeyId: input.apiKeyId,
      request: input.request,
      result: input.result,
      latencyMs: input.latencyMs,
      autoBlockThreshold: input.autoBlockThreshold,
      enforcementMode: input.enforcementMode,
    }),
    input.writer,
  );
}
