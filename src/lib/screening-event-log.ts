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
  policy_mode: NonNullable<ParseRequest["policy_mode"]>;
  rule_ids: string[];
}

export interface ScreeningEventData {
  apiKeyId: string;
  riskScore: number;
  verdict: ParseResponse["verdict"];
  categories: string[];
  mode: NonNullable<ParseRequest["mode"]>;
  latencyMs: number;
  blocked: boolean;
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

export function buildScreeningEventData(input: {
  apiKeyId: string;
  request: ParseRequest;
  result: ParseResponse;
  latencyMs: number;
  autoBlockThreshold?: number;
}): ScreeningEventData {
  const ruleIds = screeningRuleIds(input.result);
  const recommendedAction = screeningDecisionAction(input.result);
  const threshold = input.autoBlockThreshold ?? 7;

  return {
    apiKeyId: input.apiKeyId,
    riskScore: input.result.risk_score,
    verdict: input.result.verdict,
    categories: input.result.categories,
    mode: input.request.mode ?? "full",
    latencyMs: input.latencyMs,
    blocked: input.result.risk_score >= threshold,
    metadata: compactMetadata({
      request_id: input.result.id,
      attack_detected: input.result.attack_detected ?? false,
      recommended_action: recommendedAction,
      approval_required: Boolean(input.result.approval_request),
      source_kind: input.request.metadata?.source_kind,
      trust_level: input.request.metadata?.trust_level,
      intended_action: input.request.metadata?.intended_action,
      policy_mode: input.request.policy_mode ?? "balanced",
      rule_ids: ruleIds,
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
    }),
    input.writer,
  );
}
