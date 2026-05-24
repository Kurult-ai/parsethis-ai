import { describe, it } from "node:test";
import assert from "node:assert/strict";

const TEST_MASTER_KEY = "test-master-key-for-exposure-tests";
process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || TEST_MASTER_KEY;

const { app } = await import("../app.js");

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.MASTER_API_KEY || TEST_MASTER_KEY}`,
    "Content-Type": "application/json",
  };
}

const sampleFinding = {
  record_type: "finding",
  schema_version: "0.1.0",
  finding_type: "package_exposure",
  severity: "critical",
  catalog_id: "advisory-2026-0042",
  catalog_name: "example-pkg 1.2.3 compromised release",
  ecosystem: "npm",
  package_name: "example-pkg",
  normalized_name: "example-pkg",
  version: "1.2.3",
  source_type: "pnpm-lockfile",
  source_file: "/Users/alex/code/private-app/pnpm-lock.yaml",
  project_path: "/Users/alex/code/private-app",
  confidence: "high",
  evidence: "exact name+version match",
};

describe("exposure routes", () => {
  it("evaluates sanitized exposure findings", async () => {
    const res = await app.request("/v1/exposure/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        schema_version: "0.1.0",
        source: { scanner_name: "bumblebee", scanner_version: "v0.1.1", profile: "project" },
        findings: [sampleFinding],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.decision, "block");
    assert.equal(body.highest_severity, "critical");
    assert.match(body.receipt_id, /^exp_/);
  });

  it("rejects secret-bearing exposure payloads without echoing the secret", async () => {
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const res = await app.request("/v1/exposure/evaluate", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        schema_version: "0.1.0",
        source: { scanner_name: "bumblebee" },
        findings: [{ ...sampleFinding, evidence: secret }],
      }),
    });

    assert.equal(res.status, 400);
    const bodyText = await res.text();
    assert.equal(bodyText.includes(secret), false);
    assert.ok(bodyText.includes("Invalid exposure payload"));
  });

  it("returns stateless ingest receipts in phase 1", async () => {
    const res = await app.request("/v1/exposure/ingest", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        schema_version: "0.1.0",
        source: { scanner_name: "bumblebee", profile: "project" },
        findings: [],
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.decision, "allow");
    assert.equal(body.stored, false);
    assert.equal(body.storage_mode, "stateless_phase_1");
  });

  it("lists exposure catalog metadata", async () => {
    const res = await app.request("/v1/exposure/catalogs");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.catalogs));
  });

  it("publishes exposure endpoints through OpenAPI", async () => {
    const res = await app.request("/openapi.json");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.paths["/v1/exposure/evaluate"]);
    assert.ok(body.paths["/v1/exposure/ingest"]);
    assert.ok(body.paths["/v1/exposure/catalogs"]);
  });
});
