# Parse Exposure

Parse Exposure is an optional endpoint-exposure evidence layer for Parse. It lets agents and AI platform teams evaluate sanitized findings from read-only local scanners before allowing sensitive agent actions.

The first supported payload shape is Bumblebee-compatible findings-only output: package, editor-extension, browser-extension, and MCP exposure findings that have already been matched locally against a catalog.

## What it is

- A policy and receipt API for endpoint exposure evidence.
- A privacy-preserving bridge between local read-only scanners and Parse agent trust decisions.
- A way to return `allow`, `allow_with_note`, `warn`, `block`, or `reject` for agent preflight checks.

## What it is not

- Not an EDR.
- Not proof that an endpoint is uncompromised.
- Not a raw inventory warehouse by default.
- Not a replacement for SBOM, SCA, MDM, or incident response tooling.
- Not a claim of Perplexity endorsement.

## Phase 1 endpoints

- `POST /v1/exposure/evaluate` — evaluate sanitized findings and return a stateless verdict.
- `POST /v1/exposure/ingest` — phase-1 stateless receipt wrapper; persistence comes later.
- `GET /v1/exposure/catalogs` — catalog/privacy metadata.

## Example request

```json
{
  "schema_version": "0.1.0",
  "mode": "findings_only",
  "source": {
    "scanner_name": "bumblebee",
    "scanner_version": "v0.1.1",
    "profile": "project"
  },
  "findings": [
    {
      "record_type": "finding",
      "schema_version": "0.1.0",
      "finding_type": "package_exposure",
      "severity": "critical",
      "catalog_id": "advisory-2026-0042",
      "catalog_name": "example-pkg 1.2.3 compromised release",
      "ecosystem": "npm",
      "package_name": "example-pkg",
      "normalized_name": "example-pkg",
      "version": "1.2.3",
      "source_type": "pnpm-lockfile",
      "confidence": "high",
      "evidence": "exact name+version match"
    }
  ]
}
```

## Example response

```json
{
  "decision": "block",
  "severity": "critical",
  "summary": "1 critical endpoint exposure finding evaluated.",
  "receipt_id": "exp_...",
  "findings_count": 1,
  "highest_severity": "critical",
  "recommended_actions": [
    "Remove or upgrade npm:example-pkg:1.2.3; inspect the referenced lockfile metadata locally and rerun the exposure scan.",
    "Block sensitive autonomous agent actions until remediation is verified by a clean scan."
  ]
}
```

## Default policy

- critical → `block`
- high / medium → `warn`
- low / info → `allow_with_note`
- no findings → `allow`
- privacy-unsafe payload → `reject` through HTTP 400

## Sensitive agent actions

The output is meant to feed agent preflights for actions such as shell execution, package installs, MCP server changes, credential access, deployments, browser automation against authenticated accounts, payment/wallet signing, and data export.
