/**
 * Apply org file-in-prompt + tool-policy to a screening result.
 * Shared by /v1/parse, MCP JSON-RPC, and /v1/mcp/tools/call.
 */

import { prisma } from "../db.js";
import {
  evaluateAttachmentPromptPolicy,
  extractDeclaredFilePaths,
  extractPromptAttachments,
} from "./image-prompt-policy.js";
import { loadImagePromptContext } from "./image-prompt-policy-store.js";
import { getOrgToolPolicy } from "./tool-policy-store.js";
import { resolveToolList } from "./tool-policy.js";
import type { ParseResponse } from "../parse.js";

type MutableResult = ParseResponse & {
  wouldBlock?: boolean;
  suggested_action?: string;
  recommended_action?: string;
  disposition?: string;
};

export async function applyOrgPromptPolicies(
  result: MutableResult,
  opts: {
    prompt: string;
    metadata?: unknown;
    tools?: string[];
    apiKeyId: string;
    role?: string;
    agentId?: string;
    enforcementMode?: string;
  },
): Promise<void> {
  const enforcementMode = opts.enforcementMode ?? "block";
  const key = await prisma.apiKey.findUnique({
    where: { id: opts.apiKeyId },
    select: { orgId: true },
  });
  if (!key?.orgId) return;

  try {
    const ctx = await loadImagePromptContext(key.orgId);
    if (ctx.mode !== "allow") {
      const declared = extractDeclaredFilePaths(opts.metadata);
      const attachments = extractPromptAttachments(
        { prompt: opts.prompt, metadata: opts.metadata },
        declared,
      );
      const decision = evaluateAttachmentPromptPolicy(attachments, ctx.rules, ctx.mode);
      if (!decision.allowed) {
        result.flags.push({
          category: "file_policy_violation",
          severity: 7,
          label: "File not from an authorized directory",
          detail: decision.reason,
          id: "org.file_policy_violation",
          source: "image_prompt_policy",
        });
        if (!result.categories.includes("file_policy_violation")) {
          result.categories.push("file_policy_violation");
        }
        if (!result.categories.includes("image_policy_violation")) {
          result.categories.push("image_policy_violation");
        }
        escalate(result, enforcementMode);
      }
    }
  } catch (err) {
    console.error("[org-policy] file check failed:", (err as Error).message);
  }

  const requested =
    opts.tools ??
    (Array.isArray((opts.metadata as { tool_permissions?: unknown } | undefined)?.tool_permissions)
      ? ((opts.metadata as { tool_permissions: string[] }).tool_permissions)
      : []);

  if (requested.length === 0) return;

  try {
    const { mode, rules } = await getOrgToolPolicy(key.orgId);
    const { blocked } = resolveToolList(requested, rules, mode, {
      agentId: opts.agentId,
      apiKeyId: opts.apiKeyId,
      role: opts.role,
    });
    if (blocked.length === 0) return;
    for (const d of blocked) {
      result.flags.push({
        category: "tool_policy_violation",
        severity: 7,
        label: `Org policy blocks tool: ${d.tool}`,
        detail: d.reason,
        id: "org.tool_policy_violation",
        source: "org_tool_policy",
      });
    }
    if (!result.categories.includes("tool_policy_violation")) {
      result.categories.push("tool_policy_violation");
    }
    escalate(result, enforcementMode);
  } catch (err) {
    console.error("[org-policy] tool check failed:", (err as Error).message);
  }
}

export function applyBlockEnforcement(result: MutableResult, minScore = 7): void {
  result.risk_score = Math.max(result.risk_score, minScore);
  result.verdict = "critical";
  result.safe = false;
  result.suggested_action = "block";
  result.recommended_action = "block";
  result.wouldBlock = true;
  result.disposition = "block";
}

function escalate(result: MutableResult, enforcementMode: string): void {
  if (enforcementMode !== "block") return;
  applyBlockEnforcement(result);
}
