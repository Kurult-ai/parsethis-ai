---
title: "Compliance Guide"
description: "Complete guide to Parse's compliance control panel — framework mapping, SIEM integration, evidence export, agent registry, data governance, and enforcement dials."
date: "2026-08-08"
lastUpdated: "2026-08-08"
author: "Parse"
---

# Parse Compliance Guide

Parse's compliance suite turns your existing screening data into audit-ready evidence. Every screening event, policy change, and agent action is automatically mapped to security framework controls (OWASP, NIST, EU AI Act, ISO 42001, SOC 2) so compliance reports write themselves.

**Dashboard URL:** `https://www.parsethis.ai/dashboard/compliance?key=<your-api-key>`

**Base API URL:** `https://www.parsethis.ai`

---

## Table of Contents

1. [Compliance Quickstart](#1-compliance-quickstart)
2. [Framework Mapping Guide](#2-framework-mapping-guide)
3. [SIEM Integration Guide](#3-siem-integration-guide)
4. [Evidence Export Guide](#4-evidence-export-guide)
5. [Agent Registry Guide](#5-agent-registry-guide)
6. [Data Governance Guide](#6-data-governance-guide)
7. [Enforcement Dial Guide](#7-enforcement-dial-guide)

---

## 1. Compliance Quickstart

### Accessing the Dashboard

Navigate to the compliance dashboard with your API key:

```
https://www.parsethis.ai/dashboard/compliance?key=pfa_live_yourkey
```

The dashboard provides six panels:

| Panel | What it shows |
|-------|---------------|
| **Overview** | KPIs (total screenings, 24h volume, blocked count, pass rate), 7-day trend chart, risk distribution |
| **Audit Trail** | Every screening event with risk score, verdict, categories, and metadata. Filterable by date range, verdict, and blocked-only |
| **Policy Levers** | Toggle screening on input/output/forwarded messages, set auto-block thresholds, configure enforcement mode |
| **Framework Mappings** | OWASP LLM 2025, NIST AI RMF, EU AI Act, ISO 42001, SOC 2 control coverage |
| **Evidence Export** | Generate tamper-evident evidence packs with SHA-256 integrity hash |
| **SIEM Forwarding** | Configure Splunk/Datadog/Elastic/Sentinel/webhook forwarding |

### API Quickstart

```bash
# Get dashboard summary
curl https://www.parsethis.ai/v1/compliance/summary \
  -H "Authorization: Bearer pfa_live_yourkey"

# Query the audit trail (last 100 blocked events)
curl "https://www.parsethis.ai/v1/compliance/audit-trail?blocked=true&limit=100" \
  -H "Authorization: Bearer pfa_live_yourkey"

# Get framework coverage report
curl https://www.parsethis.ai/v1/compliance/coverage \
  -H "Authorization: Bearer pfa_live_yourkey"
```

### RBAC Roles

Compliance endpoints enforce role-based access control:

| Role | Weight | Access |
|------|--------|--------|
| `org_admin` | 100 | Full control: compliance, members, org settings, all operations |
| `security_analyst` | 50 | Audit trail, exports, SIEM config, agents, freeze |
| `auditor` | 40 | Read-only access to all compliance endpoints |
| `developer` | 30 | Manage own agents, view own screening events |

Higher roles inherit lower-role permissions. `org_admin` can do everything.

---

## 2. Framework Mapping Guide

Parse automatically maps its 9 risk categories and detection capabilities to five major compliance frameworks. Every screening event is classified, so your audit trail speaks the language of whichever framework your auditor uses.

### Supported Frameworks

| Framework | Endpoint | Description |
|-----------|----------|-------------|
| **OWASP Top 10 for LLM Applications (2025)** | `/v1/compliance/framework-map/owasp-llm` | Maps to LLM01–LLM10 |
| **NIST AI Risk Management Framework (AI RMF 1.0)** | `/v1/compliance/framework-map/nist-ai-rmf` | Maps Govern/Map/Measure/Manage functions |
| **EU AI Act** | `/v1/compliance/framework-map/eu-ai-act` | Maps to risk-tier obligations (Articles 9–15) |
| **ISO/IEC 42001** | `/v1/compliance/framework-map/iso-42001` | Maps to AI management system clauses |
| **SOC 2 Trust Services Criteria** | `/v1/compliance/framework-map/soc2` | Maps to Security, Availability, Confidentiality TSCs |

### Querying Framework Mappings

```bash
# Get all framework mappings at once
curl https://www.parsethis.ai/v1/compliance/framework-map \
  -H "Authorization: Bearer pfa_live_yourkey"

# Get a single framework
curl https://www.parsethis.ai/v1/compliance/framework-map/owasp-llm \
  -H "Authorization: Bearer pfa_live_yourkey"

# Get a coverage summary (covered / partially_covered / not_covered per framework)
curl https://www.parsethis.ai/v1/compliance/coverage \
  -H "Authorization: Bearer pfa_live_yourkey"
```

### Example: OWASP LLM01 (Prompt Injection) Mapping

```json
{
  "owasp_id": "LLM01",
  "title": "Prompt Injection",
  "parse_categories": ["prompt_injection", "indirect_injection"],
  "parse_capabilities": [
    "3-layer prompt security pipeline",
    "100+ injection patterns",
    "indirect injection detection",
    "nonce-tagged delimiters"
  ],
  "control_description": "Parse screens every input for direct and indirect prompt injection. Blocked prompts are logged with the specific rule IDs that triggered the block."
}
```

### Parse Risk Categories → Framework Controls

| Parse Category | OWASP | NIST AI RMF | EU AI Act | SOC 2 |
|---------------|-------|-------------|-----------|-------|
| `prompt_injection` | LLM01 | MEASURE-2.7 | Art. 9(2)(d) | CC6.1 |
| `jailbreak` | LLM01 | MEASURE-2.7 | Art. 9(2)(d) | CC6.1 |
| `data_exfiltration` | LLM02 | MEASURE-1.3 | Art. 10 | CC6.1, CC6.7 |
| `harmful_content` | LLM05 | MEASURE-2.11 | Art. 9(2)(c) | CC6.1 |
| `system_prompt_leak` | LLM02 | MEASURE-1.3 | Art. 10 | CC6.7 |
| `privilege_escalation` | LLM06 | MAP-2.6 | Art. 9(2)(b) | CC6.3 |
| `social_engineering` | LLM08 | MEASURE-2.7 | Art. 9(2)(d) | CC6.1 |
| `code_execution` | LLM06 | MAP-2.6 | Art. 9(2)(b) | CC6.3 |
| `indirect_injection` | LLM01 | MEASURE-2.7 | Art. 9(2)(d) | CC6.1 |

---

## 3. SIEM Integration Guide

Parse forwards screening events, audit events, policy changes, and approval records to your existing SIEM platform. Events are transformed into platform-appropriate formats (JSON, CEF, LEEF) and sent via HTTP.

### Supported Platforms

| Platform | Format | Auth Header | Body Format |
|----------|--------|-------------|-------------|
| **Splunk** | JSON / CEF / LEEF | `Authorization: Splunk <token>` | `{ "event": "...", "source": "parse-for-agents", "sourcetype": "screening" }` |
| **Datadog** | JSON | `DD-API-KEY: <api-key>` | `{ "ddsource": "parse-for-agents", "message": "...", "service": "parse-agent-security" }` |
| **Elastic** | JSON / CEF | `Authorization: ApiKey <key>` | Raw event body |
| **Sentinel** | JSON | `Authorization: Bearer <token>` | Raw event body |
| **Generic Webhook** | JSON / CEF / LEEF | `Authorization: Bearer <token>` | Raw event body |

### Setup: Splunk (HEC)

1. **Create a Splunk HEC token** in Splunk Settings → Data Inputs → HTTP Event Collector.

2. **Register the SIEM config:**

```bash
curl -X POST https://www.parsethis.ai/v1/compliance/siem \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "splunk",
    "endpoint": "https://your-splunk-instance:8088/services/collector",
    "auth_header": "your-hec-token",
    "format": "json",
    "event_types": ["screening", "audit", "policy_change", "approval"]
  }'
```

3. **Test the connection:**

```bash
curl -X POST https://www.parsethis.ai/v1/compliance/siem/test \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "splunk",
    "endpoint": "https://your-splunk-instance:8088/services/collector",
    "auth_header": "your-hec-token",
    "format": "json"
  }'
```

**Splunk SPL example:**

```spl
index=security source="parse-for-agents" sourcetype=screening verdict=critical
| stats count by agent_id, categories
```

### Setup: Datadog

1. **Get your Datadog API key** from Organization Settings → API Keys.

2. **Register the SIEM config:**

```bash
curl -X POST https://www.parsethis.ai/v1/compliance/siem \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "datadog",
    "endpoint": "https://http-intake.logs.datadoghq.com/api/v2/logs",
    "auth_header": "your-datadog-api-key",
    "format": "json",
    "event_types": ["screening", "audit"]
  }'
```

**Datadog log query example:**

```
source:parse-for-agents @verdict:critical
```

### Event Types

| Event Type | Description |
|------------|-------------|
| `screening` | Every prompt/output screening event with risk score, verdict, categories |
| `audit` | Policy changes, API key events, administrative actions |
| `policy_change` | Screening policy updates (threshold changes, toggles, enforcement mode) |
| `approval` | Owner-approval workflow events (requested, granted, denied) |

### Managing SIEM Configs

```bash
# List all SIEM configs for your org
curl https://www.parsethis.ai/v1/compliance/siem \
  -H "Authorization: Bearer pfa_live_yourkey"

# Delete a SIEM config
curl -X DELETE https://www.parsethis.ai/v1/compliance/siem/<config-id> \
  -H "Authorization: Bearer pfa_live_yourkey"
```

---

## 4. Evidence Export Guide

Evidence packs are structured, framework-mapped compliance artifacts with a SHA-256 integrity hash. They are designed for auditors who need verifiable proof of your screening controls.

### Generating an Evidence Pack

```bash
# Generate a 30-day evidence pack mapped to all frameworks
curl -X POST https://www.parsethis.ai/v1/compliance/export \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "framework": "all",
    "format": "json"
  }'
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `framework` | `"all"` | One of: `owasp-llm`, `nist-ai-rmf`, `eu-ai-act`, `iso-42001`, `soc2`, `all` |
| `date_from` | 30 days ago | ISO 8601 start date |
| `date_to` | now | ISO 8601 end date |
| `format` | `"json"` | Output format (`json`) |
| `download` | `false` | Set to `true` to get a `Content-Disposition: attachment` header for file download |

### Response Structure

```json
{
  "generatedAt": "2026-08-08T12:00:00.000Z",
  "period": { "from": "2026-07-09T00:00:00.000Z", "to": "2026-08-08T12:00:00.000Z" },
  "framework": "all",
  "summary": {
    "totalEvents": 15234,
    "blockedCount": 892,
    "topRiskCategories": [
      { "category": "prompt_injection", "count": 412 },
      { "category": "data_exfiltration", "count": 231 }
    ],
    "policyChanges": 7,
    "agentCount": 12
  },
  "controlMappings": [
    {
      "controlId": "LLM01",
      "controlName": "Prompt Injection",
      "evidence": "412 screening events detected prompt_injection; 412 blocked...",
      "status": "covered"
    }
  ],
  "integrityHash": "sha256:a1b2c3d4..."
}
```

### Integrity Verification

Each evidence pack includes a SHA-256 integrity hash. Auditors can verify tamper-evidence by recomputing the hash:

```bash
# Download with integrity hash in response headers
curl -X POST "https://www.parsethis.ai/v1/compliance/export?download=true" \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"framework": "soc2"}' \
  -D headers.txt \
  -o evidence-pack.json

# The X-Evidence-Pack-Hash header contains the SHA-256 hash
cat headers.txt | grep X-Evidence-Pack-Hash

# Verify
sha256sum evidence-pack.json
```

### Downloading for External Auditors

```bash
curl -X POST "https://www.parsethis.ai/v1/compliance/export?download=true" \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "framework": "owasp-llm",
    "date_from": "2026-01-01",
    "date_to": "2026-06-30"
  }' \
  -o evidence-owasp-h1-2026.json
```

The response will include `Content-Disposition: attachment; filename="evidence-pack-owasp-llm-..."` for direct download.

---

## 5. Agent Registry Guide

The agent registry is your inventory of AI agents in production. Registering agents enables per-agent screening attribution, risk profiling, and data governance.

### Registering an Agent

```bash
curl -X POST https://www.parsethis.ai/v1/agents \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "customer-support-bot",
    "description": "Handles tier-1 customer support queries",
    "framework": "langchain",
    "risk_level": "medium",
    "tools": ["search", "email", "refund_api"],
    "metadata": {
      "owner": "support-team",
      "environment": "production"
    }
  }'
```

### Agent Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable agent name (max 200 chars) |
| `description` | No | What the agent does |
| `framework` | No | `langchain`, `crewai`, `autogen`, `openai-assistants`, `custom` |
| `risk_level` | No | `low`, `medium`, `high`, `critical` |
| `tools` | No | Array of tool names the agent can call |
| `metadata` | No | Free-form JSON metadata |

### Managing Agents

```bash
# List all agents
curl https://www.parsethis.ai/v1/agents \
  -H "Authorization: Bearer pfa_live_yourkey"

# Get agent detail (includes last 10 screening events)
curl https://www.parsethis.ai/v1/agents/<agent-id> \
  -H "Authorization: Bearer pfa_live_yourkey"

# Update agent metadata
curl -X PUT https://www.parsethis.ai/v1/agents/<agent-id> \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{"risk_level": "high"}'

# Decommission (soft delete)
curl -X DELETE https://www.parsethis.ai/v1/agents/<agent-id> \
  -H "Authorization: Bearer pfa_live_yourkey"

# Send a heartbeat
curl -X POST https://www.parsethis.ai/v1/agents/<agent-id>/heartbeat \
  -H "Authorization: Bearer pfa_live_yourkey"
```

### Agent Risk Profiling

The compliance dashboard shows a "Top Agents by Risk" table that ranks agents by average risk score across their screening events. This helps identify which agents face the most adversarial traffic and may need tighter enforcement.

---

## 6. Data Governance Guide

Data governance provides four complementary controls that let you enforce least-privilege data access for your agents:

1. **Data Source Registry** — register databases, APIs, vector stores, and document collections with data classification labels
2. **Agent Data Grants** — grant agents scoped access (read/write) to specific data sources with optional expiry
3. **Egress Rules** — control where classified data can be sent, with approval-gating for sensitive destinations
4. **Volume Budgets** — cap how much data agents can move per-request and per-day

### Data Classification Levels

| Level | Rank | Description |
|-------|------|-------------|
| `public` | 0 | Publicly available data |
| `internal` | 1 | Internal company data |
| `confidential` | 2 | Sensitive business data |
| `restricted` | 3 | Highly regulated data (PII, credentials, financial) |

### Registering Data Sources

```bash
curl -X POST https://www.parsethis.ai/v1/data-sources \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Database (Postgres)",
    "kind": "database",
    "classification": "restricted"
  }'
```

**Valid kinds:** `filesystem`, `database`, `api`, `vector_store`, `document_collection`

### Granting Agent Access

```bash
# Grant read access to a data source
curl -X POST https://www.parsethis.ai/v1/agents/<agent-id>/grants \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "data_source_id": "<data-source-id>",
    "access": "read",
    "expires_at": "2026-12-31T23:59:59Z"
  }'

# List grants for an agent
curl https://www.parsethis.ai/v1/agents/<agent-id>/grants \
  -H "Authorization: Bearer pfa_live_yourkey"

# Revoke a grant
curl -X DELETE https://www.parsethis.ai/v1/agents/<agent-id>/grants/<grant-id> \
  -H "Authorization: Bearer pfa_live_yourkey"
```

### Egress Rules

Egress rules control where data can be sent based on classification level. Rules are evaluated by priority (highest first); the first matching rule wins. If no rule matches, the default is `allow`.

```bash
# Create an egress rule: block restricted data from going to external webhooks
curl -X POST https://www.parsethis.ai/v1/egress-rules \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_pattern": "*.external.com",
    "max_classification": "confidential",
    "action": "block",
    "scope": "org",
    "priority": 100
  }'

# Require approval for confidential data sent to Slack
curl -X POST https://www.parsethis.ai/v1/egress-rules \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "destination_pattern": "hooks.slack.com",
    "max_classification": "confidential",
    "action": "require_approval",
    "scope": "org",
    "priority": 50
  }'

# Test a destination
curl -X POST https://www.parsethis.ai/v1/egress-rules/test \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "https://api.external.com/webhook",
    "classification": "restricted"
  }'

# Apply default egress templates
curl -X POST https://www.parsethis.ai/v1/egress-rules/templates \
  -H "Authorization: Bearer pfa_live_yourkey"
```

**Egress actions:** `allow`, `require_approval`, `block`

**Rule matching:** A rule triggers when the destination matches the `destination_pattern` AND the data classification exceeds the rule's `max_classification`. The rule's action then applies.

### Volume Budgets

Budgets cap how much data agents can move, preventing data exfiltration via bulk extraction.

```bash
# Set a budget: max 1000 records/day, 10MB/day for an agent on a specific data source
curl -X POST https://www.parsethis.ai/v1/agents/<agent-id>/budgets \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "data_source_id": "<data-source-id>",
    "max_records_per_request": 100,
    "max_records_per_day": 1000,
    "max_bytes_per_day": 10485760
  }'
```

| Budget Field | Description |
|-------------|-------------|
| `max_records_per_request` | Maximum records returned in a single API/tool call |
| `max_records_per_day` | Maximum records accessed per calendar day |
| `max_bytes_per_day` | Maximum data volume in bytes per calendar day |
| `data_source_id` | Optional — scope to a specific data source (omit for agent-wide budget) |

### Approval Matrix

The combination of data governance controls creates an implicit approval matrix:

| Data Classification | Internal Destinations | Approved External Destinations | Unapproved External Destinations |
|---------------------|-----------------------|-------------------------------|----------------------------------|
| `public` | ✅ Allow | ✅ Allow | ✅ Allow |
| `internal` | ✅ Allow | ✅ Allow (if rule permits) | ⚠️ Approval or Block (by rule) |
| `confidential` | ✅ Allow (if rule permits) | ⚠️ Approval required (by rule) | ❌ Block (by rule) |
| `restricted` | ⚠️ Approval required | ❌ Block (by rule) | ❌ Block (by rule) |

---

## 7. Enforcement Dial Guide

Parse's enforcement mode is a three-position dial that controls how aggressively screening decisions are enforced. This lets you safely roll out protection in stages.

### The Three Modes

| Mode | Behavior | Use When |
|------|----------|----------|
| **`monitor`** | Screen everything, log the verdict, but **never block** — all requests pass through regardless of risk | Initial deployment, baseline measurement, understanding your threat landscape |
| **`warn`** | Screen everything, log the verdict. High-risk requests are flagged but still passed through. The verdict and suggested action are returned to the caller | Graduated rollout — agents receive warnings but can still operate |
| **`block`** | Screen everything. Requests above the `autoBlockThreshold` are **blocked** and the agent receives a block response with the risk analysis | Full production enforcement |

### Setting Enforcement Mode

Enforcement mode is part of the screening policy, configured per API key per environment:

```bash
# View current policy
curl https://www.parsethis.ai/v1/policy \
  -H "Authorization: Bearer pfa_live_yourkey"

# Set enforcement mode to "block" (full production)
curl -X PUT https://www.parsethis.ai/v1/policy \
  -H "Authorization: Bearer pfa_live_yourkey" \
  -H "Content-Type: application/json" \
  -d '{
    "enforcementMode": "block",
    "autoBlockThreshold": 70,
    "screenUserInput": true,
    "screenToolOutputs": true,
    "screenForwardedMessages": true,
    "executeInSandbox": true
  }'
```

### Recommended Rollout Path

1. **Week 1: Monitor mode** — Deploy Parse with `enforcementMode: "monitor"`. Let agents operate normally while you collect baseline screening data. Review the dashboard to understand your risk distribution.

2. **Week 2: Warn mode** — Switch to `enforcementMode: "warn"`. Agents now receive risk verdicts but are not blocked. Tune thresholds and verify that legitimate traffic is not flagged.

3. **Week 3+: Block mode** — Switch to `enforcementMode: "block"`. Now agents are blocked when risk exceeds the `autoBlockThreshold`. Continue monitoring the audit trail for false positives.

### Screening Toggles

Independent of enforcement mode, you can toggle which text channels are screened:

| Toggle | What it screens |
|--------|----------------|
| `screenUserInput` | Untrusted prompts from users before they reach the LLM |
| `screenToolOutputs` | Tool results, browser output, API responses before they reach the LLM |
| `screenForwardedMessages` | Messages forwarded from other agents or plugins |
| `executeInSandbox` | Whether suspicious prompts are executed in isolated sandbox for deeper analysis |

### Enforcement Holes Detection

The compliance dashboard's summary endpoint (`/v1/compliance/summary`) includes an `enforcement_holes` count. This counts active security gaps:

- Bypass codeword is active (screening can be bypassed)
- Enforcement mode is `monitor` (no blocking)
- Any screening toggle is disabled

**Target for production: zero enforcement holes.**

### Policy History

Every policy change is recorded for audit:

```bash
curl https://www.parsethis.ai/v1/compliance/policy-history \
  -H "Authorization: Bearer pfa_live_yourkey"
```

Returns the last 50 policy revisions with version, snapshot, changed_by, change_reason, and diff.
