/**
 * Which organization a key belongs to, or null.
 *
 * There is exactly one honest answer to "which org is this key in", and for
 * most keys it is "none". This module exists because the codebase had two
 * other answers in circulation:
 *
 *  - `GET /v1/compliance/policy-history` used the API key id as the org id,
 *    so every organization's audit trail read empty.
 *  - `resolveOrgIdForCoverage` falls back to returning the API key id when the
 *    key has no org, which is a defensible scope for a coverage *report* about
 *    one key, and a wrong answer to a *membership* question. Reusing it to fix
 *    the first bug reproduced it one layer down.
 *
 * Membership questions — can this key read the org panel, whose policy history
 * is this, which org do these rules belong to — must use this function, and
 * must handle null rather than inventing a scope.
 */

import { prisma } from "../db.js";

export async function resolveOrgId(apiKeyId: string): Promise<string | null> {
  const key = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { orgId: true },
  });
  return key?.orgId ?? null;
}
