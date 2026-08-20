# Parse Trust Package

**Version:** 1.1  
**Last Updated:** 2026-08-11  
**Contact:** security@parsethis.ai

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Security Controls Summary](#2-security-controls-summary)
3. [Subprocessors](#3-subprocessors)
4. [Vulnerability Disclosure Policy](#4-vulnerability-disclosure-policy)
5. [Compliance Framework Alignment](#5-compliance-framework-alignment)
6. [CAIQ-lite / SIG-lite Answer Set](#6-caiq-lite--sig-lite-answer-set)

---

## 1. Architecture Overview

### 1.1 Three-Layer Screening Pipeline

Parse uses a defense-in-depth screening pipeline that evaluates untrusted text through three independent layers before returning a risk verdict. Each layer can block or flag independently — no single bypass defeats all three.

```
 ┌──────────────────┐     ┌───────────────────────┐     ┌─────────────────────┐
 │  Layer 1: Regex  │────▶│  Layer 2: LLM          │────▶│  Layer 3: Sandbox   │
 │  Pattern Match   │     │  Semantic Analysis     │     │  Execution          │
 │  (100+ patterns, │     │  (nonce-tagged         │     │  (isolated eval,    │
 │   9 categories,  │     │   delimiters, multi-   │     │   SSRF-guarded URL  │
 │   normalization) │     │   window sampling)     │     │   prefetch, DOM     │
 │                  │     │                        │     │   stripping)        │
 └──────────────────┘     └───────────────────────┘     └─────────────────────┘
         │                          │                            │
         ▼                          ▼                            ▼
    Flags + Score              Flags + Score              Flags + Score
         │                          │                            │
         └──────────┬───────────────┘────────────────────────────┘
                    ▼
         ┌─────────────────────┐
         │  Aggregated Verdict  │
         │  - risk_score (0-10) │
         │  - safe: true|false  │
         │  - suggested_action  │
         │  - categories[]      │
         │  - flags[]           │
         └─────────────────────┘
```

**Layer 1 — Deterministic Pattern Matching**  
100+ compiled regex patterns across 9 risk categories (prompt injection, jailbreak, data exfiltration, indirect injection, social engineering, code execution, system prompt leak, credential disclosure, unsafe URL). Includes text normalization to catch encoded/obfuscated payloads (Unicode, hex, base64, homoglyphs).

**Layer 2 — LLM Semantic Analysis**  
Semantic risk scoring via OpenRouter multi-model inference. Uses nonce-tagged delimiters to prevent prompt reflection, multi-window sampling for long inputs, and model diversity to reduce single-model blind spots. Configurable per tier; can be disabled by the operator.

**Layer 3 — Isolated Sandbox Execution**  
Optional isolated execution environment (`src/lib/sandbox-client.ts`) for suspicious prompts that warrant deeper inspection. Features HMAC-authenticated communication, SSRF-guarded URL prefetch, and DOM-aware hidden content extraction. Disabled by default; enabled per-tier.

### 1.2 Data Flow Diagram

```
┌──────────┐         ┌───────────┐         ┌──────────────┐
│  Client  │────────▶│  Parse API│────────▶│ Pattern Match│
│ (Agent/  │  POST   │  (Hono    │  Layer 1│  (in-process)│
│  SDK)    │  HTTPS  │  server)  │         └──────┬───────┘
└──────────┘         └─────┬─────┘                │
       ▲                    │                      ▼
       │                    │         ┌──────────────┐
       │                    │         │ LLM Analysis │
       │                    │  Layer 2│ (OpenRouter)  │
       │                    │         └──────┬───────┘
       │                    │                │
       │                    │                ▼
       │                    │         ┌──────────────┐
       │                    │         │ Sandbox Exec │
       │                    │  Layer 3│ (optional)   │
       │                    │         └──────┬───────┘
       │                    │                │
       │             ┌──────▼────────────────▼───────┐
       │             │   Verdict Aggregation + Scoring│
       │             └──────┬────────────────────────┘
       │                    │
       │                    ▼
       │             ┌──────────────┐         ┌───────────┐
       │             │ Screening    │────────▶│ Postgres  │
       │             │ Event Log    │         │ (AuditEvent│
       │             │              │         │  table)    │
       │             └──────────────┘         └───────────┘
       │                                               ▲
       │                    ┌──────────────┐           │
       └────────────────────│ JSON Response│           │
                            │ + Audit Log  │───────────┘
                            └──────────────┘
```

### 1.3 Data Storage, Retention, and Where Prompt Text Goes

<!-- BEGIN GENERATED: retention-facts -->
<!-- Source of truth: src/lib/retention-facts.ts. Run `npm run check:trust-sync -- --write`. -->

Storage does not vary by plan. Free, Pro, Team, and Compliance keys are handled identically — the tier changes rate limits, cost caps, and which fields come back in the response, not what Parse writes down.

| Endpoint | Is the prompt text stored? | What Parse records |
|---|---|---|
| `POST /v1/parse`, `POST /v1/screen-output`, `POST /v1/agent/trust/verify` | **No.** The screening event table has no column for prompt or output text, and none for a hash of it. | Risk score, verdict, categories, screening mode, latency, blocked flag, enforcement mode, request ID, matched rule IDs, caller-supplied metadata labels (`source_kind`, `trust_level`, `intended_action`), API key ID, timestamp. |
| `POST /v1/evaluate` | **Yes, while the run is in flight.** When the run ends, successfully or not, Parse overwrites its copy with the first 100 characters of the prompt plus a SHA-256 of the whole prompt. Those first 100 characters stay readable. | Evaluation results, model name, token counts, cost, and the redacted prompt. |
| Audit log (written by every screened call) | **No.** The prompt's length is recorded as a number; the text is not. | Action, API key ID, risk score, verdict, prompt length, categories, rule IDs, request ID, caller IP address. |
| Compliance receipts | **No.** | Verdict, risk score, matched rule IDs, agent ID, policy version, receipt hash chain. |
| API keys | Not applicable | bcrypt hash plus a lookup prefix. The full key is never written down. |

| Record | Stated retention | How it is enforced today |
|---|---|---|
| Screening events | 90 days | Automatic. A daily job deletes records past the window. |
| Audit events, including the caller IP | 90 days | Automatic, as above. |
| Compliance receipts | 1 year, fixed so the hash chain stays verifiable | Automatic, as above. |
| Redacted `/v1/evaluate` records | The 500 most recent, then dropped | Automatic. Held in server memory, so a restart clears them. |
| Rate-limit counters in Redis | The length of the rate-limit window | Automatic, via Redis key expiry. |
| API keys | Until revoked, or the expiry set at creation (90 days by default for self-service keys) | Automatic on expiry. |

Enforcement is automated. A daily purge job deletes screening events, audit events, and compliance receipts past their stated windows. To request early removal, email privacy@parsethis.ai — deletion requests are completed within 30 days.

### Where prompt text goes

Screening runs on Parse's own infrastructure. Prompt text leaves it in three cases, all listed here.

| Recipient | When it receives the prompt | How to prevent it |
|---|---|---|
| **OpenRouter** — routes the semantic analysis layer | On `POST /v1/parse` and `POST /v1/screen-output`, the text is sent for scoring. Parse skips the call when the caller passes `mode: "pattern-only"`, when a pattern already matched at severity 9 or above and settles the verdict, or when the deployment has no OpenRouter key configured. | Pass `"mode": "pattern-only"`. |
| **OpenRouter** — runs the prompt against a model | Only when the caller passes `execute: true`, which asks Parse to run the prompt on purpose and screen the output. | Omit `execute`. It is off by default. `mode: "pattern-only"` does *not* turn it off. |
| **The execution sandbox** — isolated runner, configured per deployment | Only on the same `execute: true` path, which sends the prompt and any `test_input`. | Omit `execute`. |
| **Stripe** | Never. Stripe sees subscription and payment metadata; card details go to Stripe directly and Parse never holds them. | — |

What OpenRouter and the model providers behind it do with text they receive is governed by their policies, not ours. Pattern-only mode keeps the text away from them entirely.

```json
POST /v1/parse
{
  "prompt": "...",
  "mode": "pattern-only"
}
```

Pattern-only screening is a real trade: pattern matching alone under-reports paraphrased and indirect attacks that the semantic layer catches. Every response reports which layers ran, and a pattern-only response carries `layers.llm: "skipped_pattern_only"`.

<!-- END GENERATED: retention-facts -->


---

## 2. Security Controls Summary

### 2.1 Rate Limiting

- **Algorithm:** Redis sliding-window with in-memory fallback
- **Implementation:** Atomic Lua script on Redis ZSET for true sliding window; in-memory fixed-window fallback when Redis unavailable
- **Tier-based limits:**
  | Tier | Requests/Minute |
  |---|---|
  | Free | 10 |
  | Pro | 100 |
  | Team | 500 |
  | Compliance | 500 |
  | Enterprise | 500 (1000 burst) |
- **Response headers:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- **Rate-limited response:** HTTP 429 with `Retry-After` header
- **Key hashing:** API keys are SHA-256 hashed before use as rate-limit keys (privacy)

### 2.2 Role-Based Access Control (RBAC)

- **Roles:** `admin`, `owner`, `member`, `viewer`
- **Enforcement:** Route-level middleware (`src/auth.ts`, `src/lib/rbac.ts`)
- **Organization scoping:** API keys are scoped to organizations; cross-org access is denied
- **Policy packs:** Configurable per-organization screening policy enforcement

### 2.3 Single Sign-On (SSO)

- **Protocol:** OAuth 2.0 / OpenID Connect
- **Implementation:** `src/routes/sso.ts`, `src/lib/sso/sso-provider.ts`
- **Supported providers:** Configurable (Google, Microsoft, Okta, Auth0, custom OIDC)
- **Status:** Shipped — available on Team and Compliance tiers

### 2.4 Encryption

| Layer | Standard | Implementation |
|---|---|---|
| Secrets at rest (API keys, credentials) | AES-256-GCM equivalent (bcrypt) | bcrypt-hashed with salt; application secrets encrypted via AES-256-GCM |
| Data in transit | TLS 1.2+ | HSTS enforced (`max-age=31536000; includeSubDomains`) |
| Database connections | TLS | Postgres connection encrypted via `sslmode=require` in production |
| Redis connections | TLS | Redis connection encrypted in production |

### 2.5 Audit Logging

- **Event types logged:**
  - `auth_failure` — Failed authentication attempts
  - `rate_limit_exceeded` — Rate limit threshold breaches
  - `policy_change` — Screening policy modifications
  - `prompt_screened` — Screening events (verdict, categories, score)
  - `screening_codeword_bypass_used` — Emergency bypass codeword usage
- **Storage:** Postgres `AuditEvent` table + structured console logs (JSON)
- **SIEM forwarding:** Available on Compliance tier; forwards to customer SIEM via HTTP webhook
- **Request traceability:** Every response includes `X-Request-ID` for end-to-end correlation

### 2.6 Additional Security Headers

Parse enforces the following security headers on all responses (see `GET /v1/security/headers`):

| Header | Value |
|---|---|
| `Content-Security-Policy` | Strict CSP with `default-src 'self'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `0` (modern standard — relies on CSP) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

### 2.7 Input Validation

- **Max request body:** 1 MB (1,048,576 bytes)
- **Max prompt length:** 100,000 characters
- **Strict content type:** `application/json` required for POST endpoints
- **CORS:** Restricted to allowlisted origins (configurable via `ALLOWED_ORIGINS`)

---

## 3. Subprocessors

<!-- BEGIN GENERATED: subprocessor-facts -->
<!-- Source of truth: src/lib/subprocessor-facts.ts. Run `npm run check:trust-sync -- --write`. -->

Parse uses few third-party services. One of them receives prompt text.

| Subprocessor | Purpose | Location | Sees prompt text? | GDPR adequacy |
|---|---|---|---|---|
| **OpenRouter** | Routes the semantic analysis layer (Layer 2) to a model provider, and runs the prompt when `execute: true` | US | Only in full mode | SCCs |
| **Cloudflare** | CDN, tunnel, DDoS protection | Global edge | No | SCCs + CISPE |
| **Stripe** | Subscription billing | US / Ireland | No | SCCs + PCI-DSS |
| **PostgreSQL (self-hosted)** | Screening event storage | US (Mac Mini M4) | Metadata only | N/A (self-hosted) |
| **Redis (self-hosted)** | Rate limiting, caching, queues | US (Mac Mini M4) | No | N/A (self-hosted) |

Any caller on any tier can keep prompt text away from OpenRouter by passing `mode: "pattern-only"` per request, which runs Layer 1 only. Organizations can also make this the default for every request by setting `defaultMode` to `pattern-only` on their screening policy (`PUT /v1/policy`), so the control does not have to be repeated per call. Prompt text still reaches Parse in the United States in either case — pattern-only prevents the onward transfer to OpenRouter, not the transfer to Parse.

New subprocessors are announced 30 days in advance at security@parsethis.ai.

**Which model receives prompt text.** When the semantic layer runs, OpenRouter routes the request to `deepseek/deepseek-chat`. OpenRouter can serve a given model from more than one upstream host and Parse does not pin the upstream provider, so the company operating the hardware for a particular request is not fixed — the model is named here because it is the part Parse controls and can state truthfully. What that provider retains or trains on is governed by their policy and OpenRouter's, not by Parse's DPA. Passing `mode: "pattern-only"`, per request or as an organization default, means the semantic layer does not run and no model receives the text at all.

<!-- END GENERATED: subprocessor-facts -->

---

## 4. Vulnerability Disclosure Policy

### 4.1 Reporting a Vulnerability

We welcome responsible disclosure of security vulnerabilities.

- **Email:** security@parsethis.ai
- **PGP Key:** Available on request
- **Response scope:** All vulnerabilities affecting Parse's API, web properties, SDK, MCP server, or infrastructure

### 4.2 Service Level Agreements

| Milestone | SLA |
|---|---|
| **Acknowledgment** | Within 48 hours of report receipt |
| **Initial assessment** | Within 5 business days |
| **Critical vulnerability remediation** | Within 90 hours (3.75 days) |
| **High vulnerability remediation** | Within 15 business days |
| **Medium vulnerability remediation** | Within 30 business days |
| **Low vulnerability remediation** | Within 90 business days |

### 4.3 Scope

**In scope:**
- All `*.parsethis.ai` domains and subdomains
- The Parse API (`/v1/*` endpoints)
- The Parse SDK (`@parsethis/sdk`)
- The Parse MCP server
- Infrastructure misconfigurations affecting customer data

**Out of scope:**
- Social engineering attacks
- Physical security attacks
- Denial-of-service attacks (please report to abuse@parsethis.ai)
- Vulnerabilities in third-party services not operated by Parse

### 4.4 Safe Harbor

We will not pursue legal action against security researchers who:
1. Respect user privacy and do not access or modify customer data
2. Do not attempt brute-force, DoS, or social engineering attacks
3. Report vulnerabilities promptly through the designated channel
4. Provide reasonable time for remediation before public disclosure

---

## 5. Compliance Framework Alignment

### 5.1 SOC 2 Type II — In Progress

Parse is pursuing SOC 2 Type II certification. The audit is **in progress** with an expected completion in Q1 2027. This section maps our current controls to the SOC 2 Trust Services Criteria.

### 5.2 Control Mapping

<!-- BEGIN GENERATED: soc2-mapping -->
<!-- Source of truth: src/lib/soc2-mapping.ts. Run `npm run check:trust-sync -- --write`. -->

| SOC 2 Trust Principle | SOC 2 Criteria | Parse Control | Implemented (self-assessed) |
|---|---|---|---|
| **Security (Common Criteria)** | CC1: Control Environment | Security governance documented; designated security contact. Parse is operated by one person, so that contact is the operator. | ✅ Implemented |
|  | CC2: Communication and Information | Security headers endpoint (`GET /v1/security/headers`), trust page, docs hub, RFC 9116 security.txt | ✅ Implemented |
|  | CC3: Risk Assessment | Threat model documented for the prompt injection taxonomy | ✅ Implemented |
|  | CC4: Monitoring Activities | Audit logging on security-relevant events; SIEM forwarding on the compliance tier | ✅ Implemented |
|  | CC5: Control Activities | RBAC, rate limiting, input validation, policy enforcement | ✅ Implemented |
|  | CC6: Logical and Physical Access | Bearer auth, bcrypt-hashed API keys, HSTS, TLS, CORS allowlisting | ✅ Implemented |
|  | CC7: System Operations | Structured logging, request tracing (`X-Request-ID`), graceful shutdown, health checks | ✅ Implemented |
|  | CC8: Change Management | Versioned deployments, automated CI/CD, dependency audit on every build, type-safe TypeScript codebase | ✅ Implemented |
|  | CC9: Risk Mitigation | Rate limiting, sandbox isolation, SSRF guards, three-layer defence pipeline | ✅ Implemented |
| **Availability** | A1: Availability | Single node, no failover. Database backed up every six hours with a verified restore on every run; ~30 days of snapshots retained. Health check endpoints and published availability history. Recovery is a manual operator task with no committed RTO. | ⚠️ Partial |
| **Processing Integrity** | PI1: Processing Integrity | Deterministic scoring, seeded semantic sampling with a verdict cache, nonce-tagged LLM delimiters | ✅ Implemented |
| **Confidentiality** | C1: Confidentiality | TLS in transit, bcrypt/AES-256 for secrets, no prompt storage on the screening endpoints | ✅ Implemented |
| **Privacy** | P1–P8: Privacy | Documented retention enforced by a daily purge job, data governance module, approval matrix | ✅ Implemented |

No auditor has examined these controls. The column records whether Parse has implemented the control, self-assessed, and is not an audit result — SOC 2 Type II is in progress with an expected completion of Q1 2027, and there is no independent penetration test yet (first test scheduled for Q2 2027, after SOC 2 fieldwork).

<!-- END GENERATED: soc2-mapping -->

### 5.3 Additional Frameworks (Roadmap)

| Framework | Status | Target |
|---|---|---|
| ISO 27001 | Planned | Q3 2027 |
| HIPAA | Planned | On customer request |
| FedRAMP | Planned | Q4 2027 |
| GDPR | Aligned | Ongoing — data retention policies, right to erasure via support |

---

## 6. CAIQ-lite / SIG-lite Answer Set

<!-- BEGIN GENERATED: vendor-questionnaire -->
<!-- Source of truth: src/lib/vendor-questionnaire.ts. Run `npm run check:trust-sync -- --write`. -->

Pre-answered responses to the 31 most common vendor security questionnaire questions. These answers can be pasted directly into CAIQ, SIG, or custom vendor security assessment forms.

### General Security (Q1–Q5)

**1. Does your organization have an information security policy?**

Partly, and it is worth being exact about which parts. Parse maintains a documented **incident response runbook** and a published **vulnerability disclosure policy** with remediation SLAs by severity. There is no separate, formally reviewed information security policy document. Access control and data protection are implemented and documented on this page rather than in a policy artefact.

**2. Does your organization have a designated security officer or CISO?**

There is a designated security contact, reachable at security@parsethis.ai and published in `/.well-known/security.txt`. Parse is operated by one person, so that contact is the operator rather than a separate officer with an independent reporting line.

**3. Does your organization conduct security awareness training?**

Not applicable in the form this question assumes. Parse is operated by one person; there are no other personnel to train. If that changes, this answer changes with it.

**4. Are background checks performed on personnel?**

Not applicable. There are no personnel other than the operator, and therefore no one to screen for production access.

**5. Does your organization have an incident response plan?**

Yes. Documented incident response plan with defined roles, escalation procedures, and communication protocols. Incidents logged and reviewed post-resolution.

### Access Control (Q6–Q10)

**6. Is access to systems and data based on role (RBAC)?**

Yes. RBAC with defined roles (org_admin, security_analyst, auditor, developer). Access is enforced at route level by middleware, and org-scoped routes additionally refuse a caller outside the organization that owns the record.

**7. Are access rights reviewed periodically?**

Not applicable in the form this question assumes. There are no employee accounts with production access, so there are no access rights to review periodically and no departures to revoke. Customer-facing access is per API key: keys are revocable immediately by their owner (`DELETE /v1/keys/self`) and self-service keys expire after 90 idle days.

**8. Are MFA and SSO supported?**

Yes. OAuth 2.0 / OIDC-based SSO (Team + Compliance tiers). MFA enforced for administrative access.

**9. Are API keys encrypted at rest?**

Yes. bcrypt-hashed with salt at rest, plus a non-reversible lookup prefix. The Redis validation cache holds a SHA-256 of the key so the bcrypt comparison does not run on every request. The full key is never written down; it is shown once at generation.

**10. Is least-privilege access enforced?**

Yes. API keys scoped to organizations and roles. Cross-org access denied at middleware level.

### Data Protection (Q11–Q15)

**11. Is data encrypted in transit?**

Yes. TLS 1.2+ (TLS 1.3 negotiated by default). HSTS enforced with max-age=31536000; includeSubDomains.

**12. Is data encrypted at rest?**

Secrets are encrypted at rest using AES-256-GCM, and API keys are bcrypt at rest; SHA-256 for the request-validation cache. The database connection itself uses TLS, which protects data in transit to it rather than on disk — Parse does not claim full-disk or column-level encryption for the Postgres volume.

**13. Do you store customer prompt data?**

The screening endpoints (`/v1/parse`, `/v1/screen-output`, `/v1/agent/trust/verify`) do not: the screening event table has no column for prompt text or a hash of it, on every tier. `/v1/evaluate` does, for the length of the run — on completion the stored copy is overwritten with the first 100 characters plus a SHA-256 of the full prompt, and those characters remain readable. See [Data Storage](#storage) for the per-endpoint breakdown.

**14. What is your data retention policy?**

Stated retention: screening events 90 days, audit events 90 days, compliance receipts 1 year, API keys until revocation or expiry. A daily purge job deletes records past each window. Rate-limit counters and the in-memory `/v1/evaluate` records expire automatically. See [Retention](#retention).

**15. Do you support customer data deletion requests?**

Yes. Via privacy@parsethis.ai or d@kurult.ai. Completed within 30 days.

**15b. Does prompt text leave your infrastructure?**

Yes, for the semantic analysis layer: prompt text is sent to OpenRouter for model scoring unless the caller passes `mode: "pattern-only"`, a pattern already matched at severity 9 or above, or the deployment has no OpenRouter key. Prompt text also reaches OpenRouter and the execution sandbox when the caller opts in with `execute: true`, which is off by default. See [Where Prompt Text Goes](#data-flow).

### Network Security (Q16–Q20)

**16. Is there a firewall or network segmentation?**

Partly, and not by cloud security groups — Parse does not run on a hyperscaler. What is verified: **Postgres and Redis bind to loopback only** and are not routable from outside the host, and the API is published through an **outbound-established Cloudflare tunnel** rather than an inbound port mapping, so reaching Parse does not require an open listener on the host. What Parse does **not** claim: that the host has no other reachable services. It is a general-purpose machine, network exposure depends on the upstream network rather than on Parse, and no host-level firewall policy is asserted here.

**17. Is rate limiting implemented?**

Yes. Redis sliding-window with in-memory fallback. Tier-based limits. HTTP 429 with Retry-After.

**18. Are security headers enforced?**

Yes. CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, HSTS on all responses.

**19. Is CORS configured securely?**

Yes. Restricted to allowlisted origins via ALLOWED_ORIGINS env var. Unrecognized origins receive no ACAO header.

**20. Is input validation enforced?**

Yes. Max body: 1 MB. Max prompt: 100K chars. Strict application/json required for POST.

### Vulnerability Management (Q21–Q24)

**21. Are regular vulnerability scans performed?**

Yes. Automated dependency scanning in CI/CD. Critical CVEs tracked with automated remediation.

**22. Is there a vulnerability disclosure program?**

Yes. Reports accepted at security@parsethis.ai. 48h acknowledgment SLA, 90h remediation SLA for critical.

**23. Are penetration tests performed?**

**No — and the first one is scheduled.** No independent penetration test has been performed against Parse yet; the first is scheduled for Q2 2027, immediately after SOC 2 Type II fieldwork completes, so the remediation of findings feeds the same audit cycle. Saying the current state plainly is more useful to your assessment than a scheduled-basis claim you cannot verify — treat this as an open gap until the report exists, and weigh it against the compensating controls listed on this page. Automated dependency scanning does run on every CI build (`npm audit`, failing at high severity), and the vulnerability disclosure programme in section 4 is live.

**24. Is there a patch management process?**

Yes. Prioritized by severity. Critical patches within 90 hours. Dependency updates automated.

### Logging & Monitoring (Q25–Q28)

**25. Are security-relevant events logged?**

Yes. Audit events: auth failures, rate limit breaches, policy changes, screening events, bypass codeword usage. Stored in Postgres + structured logs.

**26. Is SIEM integration available?**

Yes. SIEM forwarding via HTTP webhook on Compliance tier. Real-time event forwarding.

**27. Are logs retained and protected?**

Yes, in access-controlled, encrypted storage. Stated retention is 90 days for screening logs and 1 year for compliance receipts, enforced by a daily purge job — see [Retention](#retention).

**28. Is request traceability supported?**

Yes. X-Request-ID on every API response for end-to-end correlation.

### Business Continuity (Q29–Q30)

**29. Is there a BCP/DR plan?**

Backups yes; failover no. Parse runs on a **single node** — there is no multi-instance failover, and a hardware failure is an outage rather than a transparent recovery. What does exist: the production database is dumped **every six hours** to external storage, and **every run performs a real restore into a scratch database and compares a row census against the source**, because a backup nobody has restored is a hope rather than a backup. Retention is configured for the 120 most recent snapshots (about 30 days at six-hourly), and the result is checked daily. Retained history is capped by however long the schedule has been running, which is shorter than the policy on a new deployment. That gives a recovery point objective of about six hours. **No recovery time objective is committed**: restoring is a manual operator task. A documented incident response runbook covers the procedure.

**30. What is your uptime commitment?**

Parse targets 99.9% and **does not commit to it contractually except on the Compliance and Enterprise tiers**, where a formal SLA is available. Treat the figure as an operating target rather than a guarantee. Measured availability is published on the [status page](/status); liveness is monitored at `/health`.

<!-- END GENERATED: vendor-questionnaire -->
