/**
 * SIEM Forwarding Library
 *
 * Forwards screening events, audit events, policy changes, and approvals
 * to external SIEM platforms (Splunk HEC, Datadog Logs, Elastic, Sentinel,
 * or any generic webhook).
 *
 * Used by the compliance control panel to pipe Parse events into existing
 * security operations infrastructure.
 */

// Types from the Prisma generated client — using inline types for portability
interface PrismaScreeningEvent {
  id: string;
  apiKeyId: string;
  riskScore: number;
  verdict: string;
  categories: string[];
  mode: string;
  latencyMs: number;
  blocked: boolean;
  metadata: unknown;
  createdAt: Date;
  apiKey?: { orgId?: string | null } | null;
}

interface PrismaAuditEvent {
  id: string;
  action: string;
  apiKeyId: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: Date;
}

export interface PrismaSIEMConfig {
  id: string;
  orgId: string;
  platform: string;
  endpoint: string;
  authHeader: string | null;
  format: string;
  eventTypes: string[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Event Transformers ─────────────────────────────────────────────────

export type SIEMPlatform = "splunk" | "datadog" | "elastic" | "sentinel" | "generic_webhook";

interface BaseSIEMEvent {
  timestamp: string;
  source: string;
  source_type: string;
  severity: string;
  message: string;
  org_id?: string;
  agent_id?: string;
  api_key_id?: string;
  [key: string]: unknown;
}

export function screeningEventToSIEM(
  event: PrismaScreeningEvent,
  agentId?: string,
): BaseSIEMEvent {
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  return {
    timestamp: event.createdAt.toISOString(),
    source: "parse-for-agents",
    source_type: "screening",
    severity: event.verdict === "critical" || event.verdict === "high_risk" ? "high"
      : event.verdict === "medium_risk" ? "medium" : "low",
    message: `Agent ${agentId ?? "unknown"} screened: ${event.verdict} (score: ${event.riskScore})`,
    org_id: event.apiKey?.orgId ?? undefined,
    agent_id: agentId,
    api_key_id: event.apiKeyId,
    risk_score: event.riskScore,
    verdict: event.verdict,
    categories: event.categories,
    blocked: event.blocked,
    mode: event.mode,
    latency_ms: event.latencyMs,
    attack_detected: meta.attack_detected,
    recommended_action: meta.recommended_action,
    rule_ids: meta.rule_ids,
    source_kind: meta.source_kind,
    intended_action: meta.intended_action,
  };
}

export function auditEventToSIEM(event: PrismaAuditEvent, orgId?: string): BaseSIEMEvent {
  return {
    timestamp: event.createdAt.toISOString(),
    source: "parse-for-agents",
    source_type: "audit",
    severity: event.action.includes("block") || event.action.includes("revoke") ? "high" : "info",
    message: event.action,
    org_id: orgId,
    api_key_id: event.apiKeyId ?? undefined,
    detail: event.detail,
    ip: event.ip,
  };
}

// ─── Format Adapters ────────────────────────────────────────────────────

export function toCEF(event: BaseSIEMEvent): string {
  // Common Event Format (Splunk/QRadar compatible)
  const severityMap: Record<string, number> = { low: 3, medium: 6, high: 8 };
  const sev = severityMap[event.severity] ?? 3;
  const extension = Object.entries(event)
    .filter(([k]) => !["timestamp", "source", "source_type", "severity", "message"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  return `CEF:0|Parse|Agent Security|1.0|${event.source_type}|${event.message}|${sev}|${extension}`;
}

export function toJSON(event: BaseSIEMEvent): string {
  return JSON.stringify(event);
}

export function toLEEF(event: BaseSIEMEvent): string {
  // Log Event Extended Format (IBM QRadar)
  const severityMap: Record<string, string> = { low: "1", medium: "2", high: "3" };
  const sev = severityMap[event.severity] ?? "1";
  const attrs = Object.entries(event)
    .filter(([k]) => !["timestamp", "source", "source_type", "severity", "message"].includes(k))
    .map(([k, v]) => `\t${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("");
  return `LEEF:1.0|Parse|Agent Security|1.0|${event.message}|${sev}${attrs}`;
}

export function formatEvent(event: BaseSIEMEvent, format: string): string {
  switch (format) {
    case "cef": return toCEF(event);
    case "leef": return toLEEF(event);
    case "json": return toJSON(event);
    case "raw": return event.message;
    default: return toJSON(event);
  }
}

// ─── Forwarding ─────────────────────────────────────────────────────────

export interface ForwardResult {
  config_id: string;
  platform: string;
  success: boolean;
  status_code?: number;
  error?: string;
  latency_ms: number;
}

export async function forwardToSIEM(
  config: PrismaSIEMConfig,
  event: BaseSIEMEvent,
): Promise<ForwardResult> {
  const start = Date.now();
  const formatted = formatEvent(event, config.format);

  const headers: Record<string, string> = {
    "Content-Type": config.format === "json" ? "application/json" : "text/plain",
  };

  // Platform-specific auth
  switch (config.platform) {
    case "splunk":
      headers["Authorization"] = `Splunk ${config.authHeader}`;
      break;
    case "datadog":
      headers["DD-API-KEY"] = config.authHeader ?? "";
      break;
    case "elastic":
      headers["Authorization"] = `ApiKey ${config.authHeader}`;
      break;
    default:
      if (config.authHeader) headers["Authorization"] = `Bearer ${config.authHeader}`;
  }

  // Platform-specific body
  let body: string;
  switch (config.platform) {
    case "datadog":
      body = JSON.stringify({
        ddsource: "parse-for-agents",
        ddtags: `source_type:${event.source_type},severity:${event.severity}`,
        message: formatted,
        hostname: event.org_id ?? "unknown",
        service: "parse-agent-security",
      });
      break;
    case "splunk":
      body = JSON.stringify({ event: formatted, source: "parse-for-agents", sourcetype: event.source_type });
      break;
    default:
      body = formatted;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const resp = await fetch(config.endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const latency = Date.now() - start;

    if (!resp.ok) {
      return {
        config_id: config.id,
        platform: config.platform,
        success: false,
        status_code: resp.status,
        error: `HTTP ${resp.status}: ${await resp.text().catch(() => "unknown")}`,
        latency_ms: latency,
      };
    }

    return {
      config_id: config.id,
      platform: config.platform,
      success: true,
      status_code: resp.status,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      config_id: config.id,
      platform: config.platform,
      success: false,
      error: (err as Error).message,
      latency_ms: Date.now() - start,
    };
  }
}

export async function forwardToAllSIEMs(
  configs: PrismaSIEMConfig[],
  event: BaseSIEMEvent,
): Promise<ForwardResult[]> {
  const active = configs.filter(c => c.active && c.eventTypes.includes(event.source_type));
  return Promise.all(active.map(c => forwardToSIEM(c, event)));
}

// ─── Connection Test ────────────────────────────────────────────────────

export async function testSIEMConnection(config: PrismaSIEMConfig): Promise<{
  reachable: boolean;
  latency_ms: number;
  error?: string;
}> {
  const testEvent: BaseSIEMEvent = {
    timestamp: new Date().toISOString(),
    source: "parse-for-agents",
    source_type: "test",
    severity: "info",
    message: "Parse SIEM connection test",
  };

  const result = await forwardToSIEM(config, testEvent);
  return {
    reachable: result.success,
    latency_ms: result.latency_ms,
    error: result.error,
  };
}
