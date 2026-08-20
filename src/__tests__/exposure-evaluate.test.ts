import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateExposurePayload } from "../lib/exposure/evaluate.js";
import { sanitizeExposurePayload } from "../lib/exposure/sanitize.js";

const criticalFinding = {
  record_type: "finding",
  schema_version: "0.1.0",
  finding_type: "package_exposure",
  severity: "critical",
  catalog_id: "advisory-2026-0042",
  catalog_name: "example-pkg 1.2.3 compromised release",
  ecosystem: "npm",
  package_name: "Example-Pkg",
  normalized_name: "Example-Pkg",
  version: "1.2.3",
  source_type: "pnpm-lockfile",
  source_file: "/Users/alex/code/private-app/pnpm-lock.yaml",
  project_path: "/Users/alex/code/private-app",
  confidence: "high",
  evidence: "exact name+version match",
};

describe("exposure payload sanitization", () => {
  it("accepts Bumblebee-compatible findings and minimizes local paths", () => {
    const sanitized = sanitizeExposurePayload({
      schema_version: "0.1.0",
      mode: "findings_only",
      source: { scanner_name: "bumblebee", scanner_version: "v0.1.1", profile: "project" },
      findings: [criticalFinding],
    });

    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) throw new Error("unexpected sanitize failure");
    assert.equal(sanitized.value.findings[0].package_name, "Example-Pkg");
    assert.equal(sanitized.value.findings[0].normalized_name, "example-pkg");
    assert.equal(sanitized.value.findings[0].source_file_basename, "pnpm-lock.yaml");
    assert.match(sanitized.value.findings[0].project_path_hash || "", /^sha256:/);
    assert.equal("source_file" in sanitized.value.findings[0], false);
    assert.equal("project_path" in sanitized.value.findings[0], false);
  });

  it("rejects env blocks and secret-looking strings before evaluation", () => {
    const withEnv = sanitizeExposurePayload({
      schema_version: "0.1.0",
      source: { scanner_name: "bumblebee", env: { API_KEY: "redacted" } },
      findings: [],
    });
    assert.equal(withEnv.ok, false);

    const withSecret = sanitizeExposurePayload({
      schema_version: "0.1.0",
      source: { scanner_name: "bumblebee" },
      findings: [{ ...criticalFinding, evidence: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }],
    });
    assert.equal(withSecret.ok, false);
  });
});

describe("exposure evaluation", () => {
  it("allows clean scans", () => {
    const sanitized = sanitizeExposurePayload({
      schema_version: "0.1.0",
      source: { scanner_name: "bumblebee", profile: "project" },
      findings: [],
    });
    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) throw new Error("unexpected sanitize failure");

    const result = evaluateExposurePayload(sanitized.value);
    assert.equal(result.decision, "allow");
    assert.equal(result.findings_count, 0);
    assert.equal(result.highest_severity, "info");
    assert.match(result.receipt_id, /^exp_/);
  });

  it("blocks critical exposure findings and returns stable receipt digests", () => {
    const payload = {
      schema_version: "0.1.0",
      source: { scanner_name: "bumblebee", scanner_version: "v0.1.1", profile: "project" },
      findings: [criticalFinding],
    };
    const first = sanitizeExposurePayload(payload);
    const second = sanitizeExposurePayload({ findings: [criticalFinding], source: payload.source, schema_version: "0.1.0" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) throw new Error("unexpected sanitize failure");

    const firstResult = evaluateExposurePayload(first.value);
    const secondResult = evaluateExposurePayload(second.value);
    assert.equal(firstResult.decision, "block");
    assert.equal(firstResult.highest_severity, "critical");
    assert.equal(firstResult.findings_count, 1);
    assert.ok(firstResult.recommended_actions.some((action) => action.includes("Example-Pkg") || action.includes("example-pkg")));
    assert.equal(firstResult.findings_digest, secondResult.findings_digest);
  });

  it("supports custom policies that warn instead of block", () => {
    const sanitized = sanitizeExposurePayload({
      schema_version: "0.1.0",
      policy: { block_on: [], warn_on: ["critical", "high"], allow_on_empty: true },
      source: { scanner_name: "bumblebee" },
      findings: [criticalFinding],
    });
    assert.equal(sanitized.ok, true);
    if (!sanitized.ok) throw new Error("unexpected sanitize failure");

    const result = evaluateExposurePayload(sanitized.value);
    assert.equal(result.decision, "warn");
    assert.equal(result.highest_severity, "critical");
  });
});
