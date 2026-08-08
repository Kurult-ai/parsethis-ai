/**
 * Auto-Registration from Screening Events
 *
 * When a screening request includes an agent_id (in the request body or
 * metadata) that doesn't yet exist in the AgentRegistry for the caller's org,
 * auto-register it with a "discovered" status.
 *
 * This is a fire-and-forget helper — callers should catch any rejection so
 * the screening response is never affected by registration failures.
 */

import { prisma } from "../db.js";
import type { ParseRequest } from "../parse.js";

/**
 * Resolve the orgId for the authenticated API key.
 * Mirrors the logic in agent-registry.ts but kept self-contained to avoid
 * a circular import (that route file imports Hono middleware we don't need here).
 */
async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { orgId: true },
    });
    if (apiKey?.orgId) return apiKey.orgId;
  } catch {
    // Key may not exist in DB (master/demo) — fall through
  }

  const existingOrg = await prisma.organization.findFirst({
    where: { ownerId: apiKeyId },
  });
  if (existingOrg) return existingOrg.id;

  // Auto-provision a default org
  try {
    const org = await prisma.organization.create({
      data: {
        name: "Default Organization",
        slug: `org-${apiKeyId.slice(-12)}`,
        ownerId: apiKeyId,
      },
    });
    return org.id;
  } catch {
    return null;
  }
}

/**
 * Extract the agent_id from a screening request.
 * Checks body.agent_id first, then metadata.agent_id.
 */
function extractAgentId(body: ParseRequest & { agent_id?: string }): string | null {
  if (typeof body.agent_id === "string" && body.agent_id.trim()) {
    return body.agent_id.trim();
  }
  if (body.metadata?.agent_id && typeof body.metadata.agent_id === "string") {
    return body.metadata.agent_id.trim();
  }
  return null;
}

/**
 * Auto-register an agent discovered from a screening event.
 *
 * Uses an upsert on (orgId, agentName) so it is idempotent — if the agent
 * already exists, nothing changes (existing registration is authoritative).
 *
 * This function is designed to be called fire-and-forget. It never throws;
 * errors are logged and swallowed so the screening response is unaffected.
 *
 * @param apiKeyId  - The authenticated API key making the screening request
 * @param body      - The parsed request body (may contain agent_id or metadata.agent_id)
 */
export async function autoRegisterAgentFromScreening(
  apiKeyId: string,
  body: ParseRequest & { agent_id?: string },
): Promise<void> {
  try {
    const agentId = extractAgentId(body);
    if (!agentId) return;

    const orgId = await resolveOrgId(apiKeyId);
    if (!orgId) return;

    const tools = Array.isArray(body.metadata?.tool_permissions)
      ? body.metadata!.tool_permissions!
      : [];
    const dataAccess = Array.isArray(body.metadata?.data_classification)
      ? body.metadata!.data_classification!
      : [];

    // Upsert by (orgId, agentName) — if the agent already exists, leave it as-is.
    // Only create on first discovery.
    await prisma.agentRegistry.upsert({
      where: {
        idx_agent_registry_org_name: {
          orgId,
          agentName: agentId,
        },
      },
      update: {
        // Touch lastSeenAt so we know the agent was recently active,
        // but don't overwrite any admin-set fields.
        lastSeenAt: new Date(),
      },
      create: {
        orgId,
        agentName: agentId,
        status: "discovered",
        riskLevel: "unscored",
        tools,
        dataAccess,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
    });
  } catch (err) {
    // Non-blocking — log and swallow
    console.error("[auto-register] Failed to auto-register agent:", (err as Error).message);
  }
}
