/**
 * SIEM Forwarder — End-to-End Tests
 *
 * Tests CEF/LEEF/JSON format output, event type filtering, connection testing,
 * retry logic on 5xx, and graceful error handling (missing auth, invalid URLs,
 * timeouts, empty event types).
 */

import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  screeningEventToSIEM,
  auditEventToSIEM,
  toCEF,
  toLEEF,
  toJSON,
  formatEvent,
  forwardToSIEM,
  forwardToAllSIEMs,
  testSIEMConnection,
  type PrismaSIEMConfig,
} from "./siem-forwarder.js";

// ─── Test Helpers ────────────────────────────────────────────────────────

function makeScreeningEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "evt-001",
    apiKeyId: "key-001",
    riskScore: 7,
    verdict: "high_risk",
    categories: ["prompt_injection", "jailbreak"],
    mode: "pattern+llm",
    latencyMs: 42,
    blocked: true,
    metadata: { attack_detected: true, recommended_action: "block" },
    createdAt: new Date("2025-06-01T12:00:00.000Z"),
    apiKey: { orgId: "org-001" },
    ...overrides,
  } as Parameters<typeof screeningEventToSIEM>[0];
}

function makeConfig(overrides: Partial<PrismaSIEMConfig> = {}): PrismaSIEMConfig {
  return {
    id: "cfg-001",
    orgId: "org-001",
    platform: "generic_webhook",
    endpoint: "https://siem.example.com/api/events",
    authHeader: "secret-token",
    format: "json",
    eventTypes: ["screening", "audit"],
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

let originalFetch: typeof globalThis.fetch;

function mockFetch(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(responder(url, init ?? {}));
  }) as typeof globalThis.fetch;
  return { calls };
}

function mockFetchSequence(
  responses: Array<Response | Error>,
): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  originalFetch = globalThis.fetch;
  let idx = 0;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    const resp = responses[idx++] ?? responses[responses.length - 1];
    if (resp instanceof Error) return Promise.reject(resp);
    return Promise.resolve(resp);
  }) as typeof globalThis.fetch;
  return { calls };
}

function restoreFetch() {
  if (originalFetch) globalThis.fetch = originalFetch;
}

function makeResponse(status: number, body: string = "OK"): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

// ─── Format Tests ────────────────────────────────────────────────────────

describe("SIEM Format Adapters", () => {
  const sampleEvent = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

  test("toCEF produces valid CEF format", () => {
    const cef = toCEF(sampleEvent);
    const parts = cef.split("|");

    // CEF:Version|DeviceVendor|DeviceProduct|DeviceVersion|SignatureID|Name|Severity|Extension
    assert.equal(parts[0], "CEF:0", "Should start with CEF:0");
    assert.equal(parts[1], "Parse", "Vendor = Parse");
    assert.equal(parts[2], "Agent Security", "Product = Agent Security");
    assert.equal(parts[3], "1.0", "Version = 1.0");
    assert.equal(parts[4], "screening", "SignatureID = source_type");
    assert.equal(parts[5], sampleEvent.message, "Name = message");
    assert.equal(parts[6].trim(), "8", "Severity = 8 for high-risk");

    // Extension should contain key=value pairs
    const extension = parts.slice(7).join("|"); // in case message had pipes
    assert.ok(extension.includes("risk_score=7"), "Extension includes risk_score");
    assert.ok(extension.includes("verdict=high_risk"), "Extension includes verdict");
    assert.ok(extension.includes("blocked=true"), "Extension includes blocked");
    assert.ok(extension.includes("org_id=org-001"), "Extension includes org_id");
    assert.ok(extension.includes("agent_id=agent-001"), "Extension includes agent_id");
  });

  test("toCEF severity mapping", () => {
    const low = { ...sampleEvent, severity: "low" };
    const med = { ...sampleEvent, severity: "medium" };
    const high = { ...sampleEvent, severity: "high" };

    assert.ok(toCEF(low).includes("|3|"), "Low severity → 3");
    assert.ok(toCEF(med).includes("|6|"), "Medium severity → 6");
    assert.ok(toCEF(high).includes("|8|"), "High severity → 8");
  });

  test("toLEEF produces valid LEEF format", () => {
    const leef = toLEEF(sampleEvent);
    const headerEnd = leef.indexOf("\t");

    // LEEF:Version|Vendor|Product|Version|EventID ...
    const header = headerEnd >= 0 ? leef.slice(0, headerEnd) : leef;
    const headerParts = header.split("|");

    assert.ok(headerParts[0].startsWith("LEEF:"), "Should start with LEEF:");
    assert.equal(headerParts[1], "Parse", "Vendor = Parse");
    assert.equal(headerParts[2], "Agent Security", "Product = Agent Security");
    assert.equal(headerParts[3], "1.0", "Version = 1.0");

    // The attributes section (tab-delimited key=value pairs)
    const attrs = leef.slice(headerEnd >= 0 ? headerEnd : header.length);
    assert.ok(attrs.includes("severity="), "LEEF should include severity as attribute");
    assert.ok(attrs.includes("risk_score=7"), "LEEF includes risk_score");
    assert.ok(attrs.includes("verdict=high_risk"), "LEEF includes verdict");
    assert.ok(attrs.includes("org_id=org-001"), "LEEF includes org_id");

    // Verify tab-delimited format
    assert.ok(/\t\w+=/.test(attrs), "Attributes should be tab-delimited");
  });

  test("toJSON produces valid JSON", () => {
    const json = toJSON(sampleEvent);
    const parsed = JSON.parse(json); // should not throw

    assert.equal(parsed.source, "parse-for-agents");
    assert.equal(parsed.source_type, "screening");
    assert.equal(parsed.severity, "high");
    assert.equal(parsed.risk_score, 7);
    assert.equal(parsed.verdict, "high_risk");
    assert.equal(parsed.org_id, "org-001");
    assert.equal(parsed.agent_id, "agent-001");
  });

  test("formatEvent dispatches to correct adapter", () => {
    assert.equal(formatEvent(sampleEvent, "json"), toJSON(sampleEvent));
    assert.equal(formatEvent(sampleEvent, "cef"), toCEF(sampleEvent));
    assert.equal(formatEvent(sampleEvent, "leef"), toLEEF(sampleEvent));
    assert.equal(formatEvent(sampleEvent, "raw"), sampleEvent.message);
    // Unknown format defaults to JSON
    assert.equal(formatEvent(sampleEvent, "unknown"), toJSON(sampleEvent));
  });

  test("CEF/LEEF omit undefined values instead of serializing 'undefined'", () => {
    const eventWithUndefined = screeningEventToSIEM(makeScreeningEvent(), undefined);
    const cef = toCEF(eventWithUndefined);
    const leef = toLEEF(eventWithUndefined);

    assert.ok(!cef.includes("agent_id=undefined"), "CEF should not contain literal 'undefined'");
    assert.ok(!leef.includes("agent_id=undefined"), "LEEF should not contain literal 'undefined'");
    // The agent_id key itself shouldn't appear since the value is undefined
    assert.ok(!cef.includes("agent_id="), "CEF should omit agent_id entirely when undefined");
  });
});

// ─── Event Transformer Tests ─────────────────────────────────────────────

describe("Event Transformers", () => {
  test("screeningEventToSIEM maps severity correctly", () => {
    assert.equal(screeningEventToSIEM(makeScreeningEvent({ verdict: "critical" })).severity, "high");
    assert.equal(screeningEventToSIEM(makeScreeningEvent({ verdict: "high_risk" })).severity, "high");
    assert.equal(screeningEventToSIEM(makeScreeningEvent({ verdict: "medium_risk" })).severity, "medium");
    assert.equal(screeningEventToSIEM(makeScreeningEvent({ verdict: "low_risk" })).severity, "low");
    assert.equal(screeningEventToSIEM(makeScreeningEvent({ verdict: "safe" })).severity, "low");
  });

  test("screeningEventToSIEM extracts metadata fields", () => {
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-99");
    assert.equal(event.attack_detected, true);
    assert.equal(event.recommended_action, "block");
    assert.equal(event.agent_id, "agent-99");
  });

  test("auditEventToSIEM maps severity for block/revoke actions", () => {
    const blockEvent = auditEventToSIEM(
      { id: "a1", action: "block_api_key", apiKeyId: "k1", detail: "blocked", ip: "1.2.3.4", createdAt: new Date() },
      "org-1",
    );
    assert.equal(blockEvent.severity, "high");

    const infoEvent = auditEventToSIEM(
      { id: "a2", action: "config_updated", apiKeyId: "k1", detail: "updated config", ip: "1.2.3.4", createdAt: new Date() },
      "org-1",
    );
    assert.equal(infoEvent.severity, "info");
  });
});

// ─── Forwarding Tests ────────────────────────────────────────────────────

describe("forwardToSIEM", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => restoreFetch());

  test("successful forward returns success=true with latency", async () => {
    const { calls } = mockFetch(() => makeResponse(200, "accepted"));
    const config = makeConfig();
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const result = await forwardToSIEM(config, event);

    assert.equal(result.success, true);
    assert.equal(result.status_code, 200);
    assert.equal(result.config_id, "cfg-001");
    assert.ok(result.latency_ms >= 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, config.endpoint);
  });

  test("datadog platform wraps body correctly", async () => {
    const { calls } = mockFetch(() => makeResponse(202));
    const config = makeConfig({ platform: "datadog", authHeader: "dd-key-123" });
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    await forwardToSIEM(config, event);

    const body = JSON.parse(calls[0].init.body as string);
    assert.equal(body.ddsource, "parse-for-agents");
    assert.equal(body.service, "parse-agent-security");
    assert.ok(body.ddtags.includes("source_type:screening"));
    assert.ok(body.message); // contains formatted event
  });

  test("splunk platform wraps body and auth correctly", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const config = makeConfig({ platform: "splunk", authHeader: "splunk-token", format: "cef" });
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    await forwardToSIEM(config, event);

    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers["Authorization"]?.includes("Splunk"), "Should have Splunk auth header");
    assert.ok(headers["Authorization"]?.includes("splunk-token"));

    const body = JSON.parse(calls[0].init.body as string);
    assert.ok(body.event, "Splunk body should have 'event' wrapper");
    assert.ok((body.event as string).startsWith("CEF:0"), "Splunk event should be CEF-formatted");
  });

  test("elastic platform uses ApiKey auth", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const config = makeConfig({ platform: "elastic", authHeader: "es-key" });
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    await forwardToSIEM(config, event);

    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers["Authorization"]?.startsWith("ApiKey "), "Should have ApiKey auth");
  });

  test("generic_webhook uses Bearer auth", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const config = makeConfig({ platform: "generic_webhook", authHeader: "bearer-token" });
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    await forwardToSIEM(config, event);

    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers["Authorization"]?.startsWith("Bearer "), "Should have Bearer auth");
  });

  test("missing auth header is handled gracefully", async () => {
    mockFetch(() => makeResponse(200));
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    // Splunk with null auth — should not set "Splunk null"
    const splunkResult = await forwardToSIEM(makeConfig({ platform: "splunk", authHeader: null }), event);
    assert.equal(splunkResult.success, true, "Should still forward without auth for splunk");

    // Elastic with null auth — should not set "ApiKey null"
    const elasticResult = await forwardToSIEM(makeConfig({ platform: "elastic", authHeader: null }), event);
    assert.equal(elasticResult.success, true, "Should still forward without auth for elastic");

    // Generic with null auth — no auth header at all
    const genericResult = await forwardToSIEM(makeConfig({ platform: "generic_webhook", authHeader: null }), event);
    assert.equal(genericResult.success, true, "Should forward without auth for generic webhook");
  });

  test("4xx errors return failure without retry", async () => {
    const { calls } = mockFetch(() => makeResponse(401, "Unauthorized"));
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const result = await forwardToSIEM(makeConfig(), event);

    assert.equal(result.success, false);
    assert.equal(result.status_code, 401);
    assert.equal(calls.length, 1, "Should NOT retry on 4xx");
  });

  test("5xx errors are retried up to maxRetries", async () => {
    let callCount = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      callCount++;
      return Promise.resolve(makeResponse(500, "Internal Server Error"));
    }) as typeof globalThis.fetch;

    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");
    const result = await forwardToSIEM(makeConfig(), event);

    assert.equal(result.success, false);
    assert.equal(result.status_code, 500);
    assert.ok(callCount >= 2, `Should retry on 5xx (got ${callCount} calls, expected >= 2)`);
  });

  test("5xx then success recovers on retry", async () => {
    const { calls } = mockFetchSequence([
      makeResponse(500, "error"),
      makeResponse(200, "OK"),
    ]);
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const result = await forwardToSIEM(makeConfig(), event);

    assert.equal(result.success, true, "Should succeed after retry");
    assert.equal(calls.length, 2);
  });

  test("connection timeout is handled", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as typeof globalThis.fetch;

    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");
    const result = await forwardToSIEM(makeConfig(), event);

    assert.equal(result.success, false);
    assert.ok(result.error, "Should have error message");
    assert.ok(!result.error!.includes("undefined"), "Error message should be descriptive");
  });

  test("network errors are handled gracefully", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof globalThis.fetch;

    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");
    const result = await forwardToSIEM(makeConfig(), event);

    assert.equal(result.success, false);
    assert.ok(result.error?.includes("ECONNREFUSED"));
  });

  test("invalid endpoint URL returns clear error", async () => {
    // fetch() throws on truly invalid URLs before even hitting the network
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("Invalid URL"))) as typeof globalThis.fetch;

    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");
    const result = await forwardToSIEM(makeConfig({ endpoint: "not-a-url" }), event);

    assert.equal(result.success, false);
    assert.ok(result.error, "Should have error for invalid URL");
  });
});

// ─── Multi-Config Forwarding Tests ───────────────────────────────────────

describe("forwardToAllSIEMs", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => restoreFetch());

  test("only forwards to configs subscribed to the event type", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const configs = [
      makeConfig({ id: "cfg-screening", eventTypes: ["screening"] }),
      makeConfig({ id: "cfg-audit", eventTypes: ["audit"] }),
      makeConfig({ id: "cfg-both", eventTypes: ["screening", "audit"] }),
    ];
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const results = await forwardToAllSIEMs(configs, event);

    // Only cfg-screening and cfg-both subscribe to "screening"
    assert.equal(results.length, 2);
    assert.ok(results.every(r => ["cfg-screening", "cfg-both"].includes(r.config_id)));
    assert.equal(calls.length, 2, "Only 2 configs should be called");
  });

  test("skips inactive configs", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const configs = [
      makeConfig({ id: "active", active: true }),
      makeConfig({ id: "inactive", active: false }),
    ];
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const results = await forwardToAllSIEMs(configs, event);

    assert.equal(results.length, 1);
    assert.equal(results[0].config_id, "active");
    assert.equal(calls.length, 1);
  });

  test("empty event types list forwards nothing", async () => {
    const { calls } = mockFetch(() => makeResponse(200));
    const configs = [makeConfig({ eventTypes: [] })];
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");

    const results = await forwardToAllSIEMs(configs, event);

    assert.equal(results.length, 0, "Should forward nothing when eventTypes is empty");
    assert.equal(calls.length, 0);
  });

  test("empty configs array returns empty results", async () => {
    const event = screeningEventToSIEM(makeScreeningEvent(), "agent-001");
    const results = await forwardToAllSIEMs([], event);
    assert.equal(results.length, 0);
  });
});

// ─── Connection Test ─────────────────────────────────────────────────────

describe("testSIEMConnection", () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => restoreFetch());

  test("returns reachable=true and latency on successful connection", async () => {
    mockFetch(() => makeResponse(200, "ok"));
    const result = await testSIEMConnection(makeConfig());

    assert.equal(result.reachable, true);
    assert.ok(result.latency_ms >= 0);
    assert.equal(result.error, undefined);
  });

  test("returns reachable=false on error", async () => {
    mockFetch(() => makeResponse(500, "error"));
    const result = await testSIEMConnection(makeConfig());

    assert.equal(result.reachable, false);
    assert.ok(result.error, "Should have error message");
  });

  test("returns reachable=false on network error", async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("ECONNREFUSED"))) as typeof globalThis.fetch;

    const result = await testSIEMConnection(makeConfig());

    assert.equal(result.reachable, false);
    assert.ok(result.error?.includes("ECONNREFUSED"));
    assert.ok(result.latency_ms >= 0);
  });
});
