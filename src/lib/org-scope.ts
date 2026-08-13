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

/**
 * A Prisma `where` fragment selecting the rows a caller is entitled to see.
 *
 * Every compliance query used `{ apiKeyId: apiKey.id }`, which answers "what
 * did I personally screen" — not "what did my organisation screen". Prospect
 * run 11 measured the result: two minutes after a member key screened twenty
 * prompts containing six live injections, the org_admin's compliance summary
 * reported `total_screenings: 0`, the audit trail returned no events, and
 * /dashboard/compliance displayed "0 Total Screenings / 100% Pass Rate".
 *
 * `screening_events` carries no org column, and does not need one: the relation
 * to ApiKey does the work, and `siem-worker.ts` already reads `apiKey.orgId`
 * this way.
 *
 * A key in an organisation sees the organisation. A key in none sees itself —
 * which is the same answer as before for every solo customer, so this widens
 * nothing for them.
 *
 * Role still decides *who may ask*: `requireRole` gates these endpoints, and a
 * `developer` is not admitted to them. This function decides scope, not access.
 */
export function orgScopedWhere(
  orgId: string | null,
  apiKeyId: string,
): { apiKey: { orgId: string } } | { apiKeyId: string } {
  return orgId ? { apiKey: { orgId } } : { apiKeyId };
}

/**
 * The same scope for `AuditEvent`, which has no relation to `ApiKey` — only a
 * nullable `apiKeyId` string, so the relation filter above cannot reach it.
 *
 * Adding the relation would mean a foreign key on a column that may name
 * long-deleted keys, so this resolves the org's key ids instead. Returns a
 * filter, never an unscoped object: an empty org must select nothing rather
 * than everything.
 */
export async function auditScopedWhere(
  orgId: string | null,
  apiKeyId: string,
): Promise<{ apiKeyId: string | { in: string[] } }> {
  if (!orgId) return { apiKeyId };
  const keys = await prisma.apiKey.findMany({ where: { orgId }, select: { id: true } });
  return { apiKeyId: { in: keys.map((k) => k.id) } };
}
