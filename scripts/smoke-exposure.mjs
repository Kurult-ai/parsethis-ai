#!/usr/bin/env node

const baseUrl = process.env.PARSE_SMOKE_BASE_URL || process.argv.find((arg) => arg.startsWith("--base-url="))?.split("=")[1] || "http://127.0.0.1:3000";

const samplePayload = {
  schema_version: "0.1.0",
  mode: "findings_only",
  source: { scanner_name: "bumblebee", scanner_version: "v0.1.1", profile: "project" },
  findings: [
    {
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
      confidence: "high",
      evidence: "exact name+version match"
    }
  ]
};

async function request(path, options = {}) {
  const res = await fetch(new URL(path, baseUrl), options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { res, body, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalogs = await request("/v1/exposure/catalogs");
assert(catalogs.res.status === 200, `catalogs expected 200, got ${catalogs.res.status}`);
assert(Array.isArray(catalogs.body.catalogs), "catalogs response must include array");

const openapi = await request("/openapi.json");
assert(openapi.res.status === 200, `openapi expected 200, got ${openapi.res.status}`);
assert(openapi.body.paths["/v1/exposure/evaluate"], "openapi must include exposure evaluate path");

const evaluate = await request("/v1/exposure/evaluate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(samplePayload),
});
assert(evaluate.res.status === 200, `evaluate expected 200, got ${evaluate.res.status}: ${evaluate.text.slice(0, 200)}`);
assert(evaluate.body.decision === "block", `evaluate expected block, got ${evaluate.body.decision}`);
assert(/^exp_/.test(evaluate.body.receipt_id), "evaluate must return exp_ receipt id");

const unsafe = await request("/v1/exposure/evaluate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...samplePayload, findings: [{ ...samplePayload.findings[0], evidence: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" }] }),
});
assert(unsafe.res.status === 400, `unsafe payload expected 400, got ${unsafe.res.status}`);
assert(!unsafe.text.includes("ghp_abcdefghijklmnopqrstuvwxyz1234567890"), "unsafe response must not echo secret-like value");

console.log("Parse Exposure smoke passed");
