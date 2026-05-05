export interface AuditLogEvent {
  action: string;
  apiKeyId?: string;
  riskScore?: number;
  verdict?: string;
  promptLength?: number;
  latencyMs?: number;
  requestId?: string;
  attackDetected?: boolean;
  recommendedAction?: string | null;
  approvalRequired?: boolean;
  categories?: string[];
  ruleIds?: string[];
  sourceKind?: string;
  trustLevel?: string;
  intendedAction?: string;
  policyMode?: string;
  ip?: string;
  detail?: string;
}

export interface PersistedAuditEventData {
  action: string;
  apiKeyId?: string;
  detail?: string;
  ip?: string;
}

export type AuditEventWriter = (data: PersistedAuditEventData) => Promise<unknown>;

export function auditLog(event: AuditLogEvent, writer?: AuditEventWriter): void {
  console.log(JSON.stringify({ ...event, ts: new Date().toISOString(), type: "audit" }));
  void persistAuditEvent(event, writer)
    .catch((err: Error) => console.error("[audit-event] write failed:", err.message));
}

export function shouldPersistAuditEvent(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL && env.AUDIT_LOG_PERSIST !== "0");
}

export async function persistAuditEvent(event: AuditLogEvent, writer?: AuditEventWriter): Promise<void> {
  if (!shouldPersistAuditEvent()) return;

  const data = buildPersistedAuditEventData(event);
  if (writer) {
    await writer(data);
    return;
  }

  const { prisma } = await import("../db.js");
  await prisma.auditEvent.create({ data });
}

export function buildPersistedAuditEventData(event: AuditLogEvent): PersistedAuditEventData {
  return {
    action: event.action,
    apiKeyId: event.apiKeyId,
    detail: buildAuditDetail(event),
    ip: event.ip,
  };
}

export function buildAuditDetail(event: AuditLogEvent): string | undefined {
  const detail = {
    detail: event.detail,
    riskScore: event.riskScore,
    verdict: event.verdict,
    promptLength: event.promptLength,
    latencyMs: event.latencyMs,
    requestId: event.requestId,
    attackDetected: event.attackDetected,
    recommendedAction: event.recommendedAction,
    approvalRequired: event.approvalRequired,
    categories: event.categories,
    ruleIds: event.ruleIds,
    sourceKind: event.sourceKind,
    trustLevel: event.trustLevel,
    intendedAction: event.intendedAction,
    policyMode: event.policyMode,
  };
  const compact = Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined));
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : undefined;
}
