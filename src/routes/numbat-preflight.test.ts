import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TEST_MASTER_KEY = "test-master-key-for-numbat-preflight";
process.env.MASTER_API_KEY = TEST_MASTER_KEY;
const { app } = await import("../app.js");

const authHeaders = {
  Authorization: `Bearer ${TEST_MASTER_KEY}`,
  "Content-Type": "application/json",
};

function finding(overrides: Record<string, unknown> = {}) {
  return {
    rule_id: "exfil.secret_read_then_egress",
    rule_version: "1.2.0",
    severity: "high",
    confidence: "high",
    source_agent: "claude-code",
    source_type: "hook",
    observed_event_type: "command.exec",
    local_minimization_confirmation: true,
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    adapter_schema_version: "v1",
    producer: "numbat",
    numbat_version: "0.1.1",
    numbat_record_schema_version: "0.2.0",
    batch_id: "batch_demo_001",
    endpoint_pseudonym: "install_A7b9C2d4",
    findings: [finding()],
    preflight_context: {
      intended_action_class: "command_execution",
      impact_level: "medium",
      requested_agent_privilege_mode: "standard",
    },
    ...overrides,
  };
}

async function preflight(payload: unknown, headers: Record<string, string> = authHeaders) {
  return app.request("/v1/exposure/numbat-preflight", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

async function expectReviewRequired(payload: unknown, forbidden = "") {
  const res = await preflight(payload);
  assert.equal(res.status, 400);
  const text = await res.text();
  if (forbidden) assert.equal(text.includes(forbidden), false);
  const body = JSON.parse(text);
  assert.equal(body.decision, "review_required");
  assert.equal(body.recommended_action, "correct_payload_and_recheck");
  assert.equal(body.stored, false);
  assert.equal(body.enforcement_state, "recommendation_only");
  assert.deepEqual(body.matched_rules, []);
  return body;
}

const realShapeNumbatFinding = {
  schema_version: "0.2.0",
  record_type: "finding",
  run_id: "run-local-1",
  endpoint: { hostname: "workstation.local", os: "darwin", arch: "arm64", username: "operator", uid: "501", device_id: "device-stable-1" },
  finding_id: "finding-local-1",
  detected_at: "2026-07-30T12:00:00Z",
  rule_id: "exfil.secret_read_then_egress",
  rule_version: "1.2.0",
  severity: "high",
  source_agent: "claude-code",
  source_type: "hook",
  title: "Synthetic secret egress sequence",
  observed_event_type: "command.exec",
  observed_command: "synthetic-command-that-must-not-leave-host",
  observed_file_path: "/synthetic/private/file",
  observed_url: "https://example.invalid/collect",
  observed_content_preview: "synthetic-preview-that-must-not-leave-host",
  project_path_hash: `sha256:${"a".repeat(64)}`,
  session_id: "session-private-1",
  model: "model-private-1",
  sub_agent: "subagent-private-1",
  evidence_refs: [{ artifact_type: "hook", local_path: "/synthetic/private/evidence", json_pointer: "/event/1", sha256: "b".repeat(64) }],
  cited_event_ids: ["event-private-1"],
  redacted: false,
  confidence: "high",
};

const realShapeNumbatEnforcement = {
  schema_version: "0.2.0",
  record_type: "enforcement",
  run_id: "run-local-1",
  endpoint: { hostname: "workstation.local", os: "darwin", arch: "arm64", username: "operator", uid: "501", device_id: "device-stable-1" },
  decision_id: `enf-${"a".repeat(24)}`,
  timestamp: "2026-07-30T12:00:00Z",
  decision: "no_override",
  mode: "monitor",
  reason: "monitor_mode",
  source_agent: "claude-code",
  source_type: "hook",
  session_id: "session-private-1",
  tool_name: "Bash",
  tool_call_id: "tool-private-1",
  action_event_ids: ["event-private-1"],
  finding_ids: ["finding-local-1"],
  rule_ids: ["exfil.secret_read_then_egress"],
};

function runAdapter(input: string, extraArgs: string[] = [], numbatVersion = "0.1.1") {
  return spawnSync(process.execPath, [
    "scripts/numbat-findings-adapter.mjs",
    "--batch-id", "batch_demo_001",
    "--numbat-version", numbatVersion,
    "--action-class", "command_execution",
    "--impact-level", "high",
    "--privilege-mode", "unattended",
    ...extraArgs,
  ], { cwd: process.cwd(), input, encoding: "utf8" });
}

function stringSchemaAccepts(schema: Record<string, unknown>, value: string): boolean {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return false;
  const exclusions = (schema.not as { anyOf?: Array<{ pattern?: string }> } | undefined)?.anyOf ?? [];
  return !exclusions.some(({ pattern }) => typeof pattern === "string" && new RegExp(pattern).test(value));
}

describe("Numbat endpoint preflight", () => {
  it("requires bearer authentication without broadening the free Bumblebee surface", async () => {
    const res = await preflight(batch(), { "Content-Type": "application/json" });
    assert.equal(res.status, 401);
  });

  it("accepts the closed v1 adapter profile and returns a recommendation-only decision", async () => {
    const res = await preflight(batch());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.decision, "warn");
    assert.equal(body.severity, "high");
    assert.equal(body.recommended_action, "require_human_review");
    assert.deepEqual(body.matched_rules, [{ rule_id: "exfil.secret_read_then_egress", rule_version: "1.2.0" }]);
    assert.match(body.findings_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(body.policy_digest, /^sha256:[a-f0-9]{64}$/);
    assert.match(body.receipt_id, /^nep_[a-f0-9]{32}$/);
    assert.equal(body.policy_version, "numbat-endpoint-preflight-v1");
    assert.equal(body.stored, false);
    assert.equal(body.enforcement_state, "recommendation_only");
    assert.equal(body.source_schema, "numbat/minimized-adapter-v1@record-0.2.0");
    assert.equal(body.numbat_deny_selection, "not_evaluated_by_parse");
    assert.equal(body.host_enforcement_state, "not_observed_by_parse");
    assert.equal(body.recheck_guidance, "recheck_before_action_or_after_local_rescan");
    assert.equal(body.recommendation_max_age_seconds, 300);
    assert.equal("expires_in_seconds" in body, false);
  });

  it("maps deterministic policy cases conservatively", async () => {
    const cases = [
      [finding({ severity: "critical", rule_id: "impact.disk_wipe" }), {}, "block", "do_not_proceed"],
      [finding({ severity: "high", rule_id: "general.suspicious" }), {}, "warn", "require_human_review"],
      [finding({ severity: "high", rule_id: "privilege.elevated_shell" }), { impact_level: "high" }, "block", "do_not_proceed"],
      [finding({ severity: "high", rule_id: "persistence.scheduler_install" }), { requested_agent_privilege_mode: "unattended" }, "block", "do_not_proceed"],
      [finding({ severity: "medium" }), {}, "warn", "require_human_review"],
      [finding({ severity: "low" }), {}, "allow", "proceed_with_note"],
      [finding({ severity: "info" }), {}, "allow", "proceed_with_note"],
    ] as const;
    for (const [inputFinding, contextOverride, decision, action] of cases) {
      const payload = batch({
        findings: [inputFinding],
        preflight_context: { ...batch().preflight_context as object, ...contextOverride },
      });
      const res = await preflight(payload);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.decision, decision);
      assert.equal(body.recommended_action, action);
    }
  });

  it("uses order-independent finding digests and deterministic replay receipts", async () => {
    const a = finding({ rule_id: "general.alpha", severity: "medium" });
    const b = finding({ rule_id: "general.beta", severity: "low" });
    const firstRes = await preflight(batch({ findings: [a, b] }));
    const reorderedRes = await preflight(batch({ findings: [b, a] }));
    const replayRes = await preflight(batch({ findings: [a, b] }));
    assert.equal(firstRes.status, 200);
    assert.equal(reorderedRes.status, 200);
    assert.equal(replayRes.status, 200);
    const first = await firstRes.json();
    const reordered = await reorderedRes.json();
    const replay = await replayRes.json();
    assert.equal(first.findings_digest, reordered.findings_digest);
    assert.equal(first.receipt_id, reordered.receipt_id);
    assert.deepEqual(first, replay);
  });

  it("rejects unknown versions, unknown fields, malformed fields, invalid severity, and empty batches", async () => {
    await expectReviewRequired(batch({ adapter_schema_version: "v2" }));
    const unsupportedBinary = await expectReviewRequired(batch({ numbat_version: "999.999.999" }));
    assert.equal(unsupportedBinary.validation_error_code, "unsupported_numbat_version");
    await expectReviewRequired(batch({ numbat_record_schema_version: "0.3.0" }));
    await expectReviewRequired({ ...batch(), metadata: { arbitrary: "text" } });
    await expectReviewRequired(batch({ findings: [{ ...finding(), evidence_path: "/private/evidence" }] }));
    await expectReviewRequired(batch({ preflight_context: { ...batch().preflight_context as object, arbitrary: true } }));
    await expectReviewRequired(batch({ findings: [finding({ rule_id: "" })] }));
    await expectReviewRequired(batch({ findings: [finding({ rule_version: `1.${"1".repeat(127)}` })] }));
    await expectReviewRequired(batch({ findings: [finding({ severity: "severe" })] }));
    await expectReviewRequired(batch({ findings: [] }));
  });

  it("rejects privacy fields and secret-like content without echo", async () => {
    for (const [field, value] of [
      ["hostname", "private-host"], ["username", "private-user"], ["uid", "501"],
      ["device_id", "stable-device"], ["command", "rm-private"], ["url", "https://private.invalid"],
      ["file_path", "/private/file"], ["content_preview", "private-preview"], ["session_id", "private-session"],
      ["source", "private-source"], ["credentials", "private-credential"],
    ]) {
      await expectReviewRequired(batch({ findings: [{ ...finding(), [field]: value }] }), String(value));
    }
    const secret = "ghp_synthetic_not_a_real_secret_123456789";
    await expectReviewRequired(batch({ findings: [finding({ rule_id: secret })] }), secret);
    await expectReviewRequired(batch({ batch_id: "batch_session_private_123" }), "batch_session_private_123");
    await expectReviewRequired(batch({ endpoint_pseudonym: "install_devicePrivate123" }), "install_devicePrivate123");
    await expectReviewRequired(batch({ batch_id: `batch_${"a".repeat(64)}` }), "a".repeat(64));
    const pathHash = `sha256:${"a".repeat(64)}`;
    await expectReviewRequired(batch({ findings: [finding({ rule_id: pathHash })] }), pathHash);
    await expectReviewRequired(batch({ findings: [finding({ rule_version: "model_private_123" })] }), "model_private_123");
  });

  it("rejects grammar-valid identity and secret shapes across every identifier", async () => {
    for (const [payload, marker] of [
      [batch({ batch_id: "batch_sessionABC123" }), "batch_sessionABC123"],
      [batch({ batch_id: "batch_ghp_synthetic" }), "batch_ghp_synthetic"],
      [batch({ batch_id: "batch_AKIAabc123" }), "batch_AKIAabc123"],
      [batch({ endpoint_pseudonym: "install_DevicePrivate123" }), "install_DevicePrivate123"],
      [batch({ endpoint_pseudonym: "install_AKIA1234567890ABCDEF" }), "install_AKIA1234567890ABCDEF"],
      [batch({ endpoint_pseudonym: "install_AKIAabc123" }), "install_AKIAabc123"],
      [batch({ findings: [finding({ rule_id: "general.sessionABC123" })] }), "general.sessionABC123"],
      [batch({ findings: [finding({ rule_id: "general.ghp_synthetic" })] }), "general.ghp_synthetic"],
      [batch({ findings: [finding({ rule_id: "general.AKIAabc123" })] }), "general.AKIAabc123"],
      [batch({ findings: [finding({ rule_version: "1.2-sessionABC123" })] }), "1.2-sessionABC123"],
      [batch({ findings: [finding({ rule_version: "1.2-ghp_synthetic" })] }), "1.2-ghp_synthetic"],
      [batch({ findings: [finding({ rule_version: "1.2-AKIAabc123" })] }), "1.2-AKIAabc123"],
    ] as const) {
      const body = await expectReviewRequired(payload, marker);
      assert.equal(body.validation_error_code, "privacy_rejected");
    }
  });

  it("rejects oversized finding batches and malformed JSON with stable fail-closed bodies", async () => {
    await expectReviewRequired(batch({ findings: Array.from({ length: 101 }, (_, i) => finding({ rule_id: `general.rule_${i}` })) }));
    const oversizedText = JSON.stringify({ ...batch(), padding: "x".repeat(1024 * 1024) });
    const globallyOversized = await app.request("/v1/exposure/numbat-preflight", {
      method: "POST",
      headers: { ...authHeaders, "Content-Length": String(Buffer.byteLength(oversizedText)) },
      body: oversizedText,
    });
    assert.equal(globallyOversized.status, 400);
    const globallyOversizedBody = await globallyOversized.json();
    assert.equal(globallyOversizedBody.decision, "review_required");
    assert.equal(globallyOversizedBody.validation_error_code, "body_too_large");
    const routeOversized = await app.request("/v1/exposure/numbat-preflight", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ ...batch(), padding: "x".repeat(256 * 1024) }),
    });
    assert.equal(routeOversized.status, 400);
    assert.equal((await routeOversized.json()).validation_error_code, "body_too_large");
    const res = await app.request("/v1/exposure/numbat-preflight", { method: "POST", headers: authHeaders, body: "{" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.decision, "review_required");
    assert.equal(body.validation_error_code, "malformed_json");
  });

  it("publishes the authenticated endpoint and closed schemas in OpenAPI and service discovery", async () => {
    const openapi = await (await app.request("/openapi.json")).json();
    const operation = openapi.paths["/v1/exposure/numbat-preflight"].post;
    assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
    assert.ok(operation.requestBody.content["application/json"].schema.$ref.endsWith("/NumbatFindingBatchV1"));
    assert.ok(operation.responses["200"].content["application/json"].schema.$ref.endsWith("/EndpointPreflightDecisionV1"));
    assert.equal(openapi.components.schemas.NumbatFindingBatchV1.additionalProperties, false);
    assert.equal(openapi.components.schemas.NumbatFindingV1.additionalProperties, false);
    assert.equal(openapi.components.schemas.NumbatPreflightContextV1.additionalProperties, false);
    assert.deepEqual(openapi.components.schemas.NumbatFindingBatchV1.properties.numbat_version.enum, ["0.1.1"]);
    const schemas = openapi.components.schemas;
    for (const [schema, value] of [
      [schemas.NumbatFindingBatchV1.properties.batch_id, "batch_sessionABC123"],
      [schemas.NumbatFindingBatchV1.properties.batch_id, "batch_ghp_synthetic"],
      [schemas.NumbatFindingBatchV1.properties.batch_id, "batch_AKIAabc123"],
      [schemas.NumbatFindingBatchV1.properties.endpoint_pseudonym, "install_DevicePrivate123"],
      [schemas.NumbatFindingBatchV1.properties.endpoint_pseudonym, "install_AKIA1234567890ABCDEF"],
      [schemas.NumbatFindingBatchV1.properties.endpoint_pseudonym, "install_AKIAabc123"],
      [schemas.NumbatFindingV1.properties.rule_id, "general.sessionABC123"],
      [schemas.NumbatFindingV1.properties.rule_id, "general.ghp_synthetic"],
      [schemas.NumbatFindingV1.properties.rule_id, "general.AKIAabc123"],
      [schemas.NumbatFindingV1.properties.rule_version, "1.2-sessionABC123"],
      [schemas.NumbatFindingV1.properties.rule_version, "1.2-ghp_synthetic"],
      [schemas.NumbatFindingV1.properties.rule_version, "1.2-AKIAabc123"],
    ] as const) {
      assert.equal(stringSchemaAccepts(schema, value), false, `OpenAPI accepted privacy-unsafe identifier: ${value}`);
    }
    assert.ok(operation.responses["503"]);
    const discovery = await (await app.request("/.well-known/ai-plugin.json")).json();
    assert.ok(discovery.capabilities.includes("numbat_endpoint_preflight"));
    assert.deepEqual(discovery.capability_details.numbat_endpoint_preflight, {
      route: "/v1/exposure/numbat-preflight",
      authentication: "bearer",
      required_scope: "evaluate",
      enforcement_state: "recommendation_only",
    });
    const llms = await (await app.request("/llms.txt")).text();
    assert.match(llms, /POST .*\/v1\/exposure\/numbat-preflight/);
    assert.match(llms, /recommendation only/i);
    const agentCard = await (await app.request("/.well-known/agent-card.json")).json();
    const agentSkill = agentCard.skills.find((skill: { id: string }) => skill.id === "numbat_endpoint_preflight");
    assert.deepEqual({
      route: agentSkill.route,
      authentication: agentSkill.authentication,
      required_scope: agentSkill.required_scope,
      enforcement_state: agentSkill.enforcement_state,
    }, {
      route: "/v1/exposure/numbat-preflight",
      authentication: "bearer",
      required_scope: "evaluate",
      enforcement_state: "recommendation_only",
    });
  });

  it("serializes matched rules identically across contrasting process locales", () => {
    const script = `
      import { evaluateNumbatPreflight } from "./src/lib/exposure/numbat-preflight.ts";
      const finding = (rule_id) => ({ rule_id, rule_version: "1.2.0", severity: "low", confidence: "high", source_agent: "hermes", source_type: "hook", observed_event_type: "command.exec", local_minimization_confirmation: true });
      const result = evaluateNumbatPreflight({ adapter_schema_version: "v1", producer: "numbat", numbat_version: "0.1.1", numbat_record_schema_version: "0.2.0", batch_id: "batch_locale_001", findings: [finding("general.I"), finding("general.i")], preflight_context: { intended_action_class: "read_only", impact_level: "low", requested_agent_privilege_mode: "standard" } });
      process.stdout.write(JSON.stringify(result));
    `;
    const outputs = ["en_US.UTF-8", "tr_TR.UTF-8"].map((locale) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, LANG: locale, LC_ALL: locale },
      encoding: "utf8",
    }));
    for (const output of outputs) assert.equal(output.status, 0, output.stderr);
    assert.equal(outputs[0].stdout, outputs[1].stdout);
  });

  it("documents the Bearer header as a closed inline-code span", () => {
    const docs = readFileSync("docs/numbat-endpoint-preflight.md", "utf8");
    assert.match(docs, /`Authorization: Bearer <api-key>` with the existing `evaluate` scope/);
  });

  it("preserves existing unauthenticated Bumblebee exposure behavior", async () => {
    const res = await app.request("/v1/exposure/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema_version: "0.1.0", source: { scanner_name: "bumblebee" }, findings: [] }),
    });
    assert.equal(res.status, 200);
  });
});

describe("local Numbat NDJSON adapter", () => {
  it("accepts synthetic upstream v0.2.0 findings and strips every sensitive upstream field", () => {
    const result = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n`);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.findings, [finding()]);
    const serialized = JSON.stringify(body);
    for (const forbidden of ["workstation.local", "operator", "device-stable-1", "run-local-1", "finding-local-1", "synthetic-command", "/synthetic", "example.invalid", "synthetic-preview", "session-private", "model-private", "subagent-private", "event-private", "sha256:"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it("accepts the standard findings stream with an enforcement receipt and adapts only findings", () => {
    const result = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n${JSON.stringify(realShapeNumbatEnforcement)}\n`);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.findings, [finding()]);
    assert.equal(JSON.stringify(body).includes(realShapeNumbatEnforcement.decision_id), false);
  });

  it("validates the complete pinned finding schema before minimization", () => {
    const { local_minimization_confirmation: _omitted, ...projectedFinding } = finding();
    const projectedOnly = { schema_version: "0.2.0", record_type: "finding", ...projectedFinding };
    for (const record of [
      projectedOnly,
      { ...realShapeNumbatFinding, detected_at: "not-a-date" },
      { ...realShapeNumbatFinding, detected_at: "2026-02-31T12:00:00Z" },
      { ...realShapeNumbatFinding, endpoint: { ...realShapeNumbatFinding.endpoint, unexpected: true } },
      { ...realShapeNumbatFinding, evidence_refs: [] },
      { ...realShapeNumbatFinding, unexpected: true },
    ]) {
      const result = runAdapter(`${JSON.stringify(record)}\n`);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /adapter_error:invalid_upstream_finding/);
    }
  });

  it("validates discarded enforcement receipts and fails closed on version drift", () => {
    for (const enforcement of [
      { ...realShapeNumbatEnforcement, schema_version: "999.0.0" },
      { ...realShapeNumbatEnforcement, decision_id: "synthetic-enforcement-1" },
      { ...realShapeNumbatEnforcement, reason: "fail_open" },
      { ...realShapeNumbatEnforcement, unexpected: true },
    ]) {
      const result = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n${JSON.stringify(enforcement)}\n`);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /adapter_error:invalid_upstream_enforcement/);
    }
  });

  it("pins the reviewed binary version and rejects privacy-shaped identifiers", () => {
    const unsupported = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n`, [], "999.999.999");
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /adapter_error:unsupported_numbat_version/);

    const badPseudonym = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n`, ["--endpoint-pseudonym", "install_devicePrivate123"]);
    assert.notEqual(badPseudonym.status, 0);
    assert.equal(badPseudonym.stdout, "");

    const hashRule = runAdapter(`${JSON.stringify({ ...realShapeNumbatFinding, rule_id: `general.${"a".repeat(64)}` })}\n`);
    assert.notEqual(hashRule.status, 0);
    assert.equal(hashRule.stdout, "");
    assert.match(hashRule.stderr, /adapter_error:invalid_finding_identifier/);

    for (const record of [
      { ...realShapeNumbatFinding, rule_id: "general.sessionABC123" },
      { ...realShapeNumbatFinding, rule_version: "1.2-sessionABC123" },
    ]) {
      const identitySuffix = runAdapter(`${JSON.stringify(record)}\n`);
      assert.notEqual(identitySuffix.status, 0);
      assert.equal(identitySuffix.stdout, "");
      assert.match(identitySuffix.stderr, /adapter_error:invalid_finding_identifier/);
    }

    const batchIdentitySuffix = runAdapter(`${JSON.stringify(realShapeNumbatFinding)}\n`, ["--batch-id", "batch_sessionABC123"]);
    assert.notEqual(batchIdentitySuffix.status, 0);
    assert.equal(batchIdentitySuffix.stdout, "");
  });

  it("rejects oversized local input before parsing or echoing it", () => {
    const marker = "synthetic-private-marker";
    const result = runAdapter(`${"x".repeat(4 * 1024 * 1024)}${marker}`);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /adapter_error:input_too_large/);
    assert.equal(result.stderr.includes(marker), false);
  });

  it("rejects malformed NDJSON, unrelated non-finding records, unknown schema versions, and missing required adapter fields", () => {
    for (const input of [
      "{\n",
      `${JSON.stringify({ ...realShapeNumbatFinding, record_type: "event" })}\n`,
      `${JSON.stringify({ ...realShapeNumbatFinding, schema_version: "0.3.0" })}\n`,
      `${JSON.stringify({ ...realShapeNumbatFinding, rule_id: undefined })}\n`,
    ]) {
      const result = runAdapter(input);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /adapter_error/);
    }
  });

  it("reads a sanitized sample batch fixture matching the closed adapter contract", () => {
    const fixture = JSON.parse(readFileSync("examples/exposure/numbat-sanitized-batch-v1.json", "utf8"));
    assert.deepEqual(fixture, batch());
  });
});
