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
6. [CAQH-lite / SIG-lite Answer Set](#6-caqh-lite--sig-lite-answer-set)

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
<!-- Source of truth: src/lib/retention-facts.ts. Run `npm run check:retention-sync -- --write`. -->

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
| Screening events | 90 days | By hand. No scheduled purge job is implemented; records are deleted on request. |
| Audit events, including the caller IP | 90 days | By hand, as above. |
| Compliance receipts | 1 year, fixed so the hash chain stays verifiable | By hand, as above. |
| Redacted `/v1/evaluate` records | The 500 most recent, then dropped | Automatic. Held in server memory, so a restart clears them. |
| Rate-limit counters in Redis | The length of the rate-limit window | Automatic, via Redis key expiry. |
| API keys | Until revoked, or the expiry set at creation (30 days by default for self-service keys) | Automatic on expiry. |

Read the third column literally. The retention periods are policy, not a job on a timer. Nothing in the codebase deletes screening events, audit events, or receipts on a schedule today. To have data removed, email privacy@parsethis.ai — deletion requests are completed within 30 days.

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

### Subprocessor List (as of August 2026)

Parse uses the following third-party services to deliver the platform:

| Subprocessor | Purpose | Data Accessed |
|---|---|---|
| **OpenRouter** | Routes the semantic analysis layer (Layer 2) to a model provider, and runs the prompt when `execute: true` | Prompt text |
| **Stripe** | Subscription billing | Payment metadata only; no card data |
| **Cloud infrastructure** (compute, Postgres, Redis) | Hosting and storage | Whatever Parse stores, listed in section 1.3 — prompt text is not among it for the screening endpoints |

**Notes:**

- OpenRouter is the only subprocessor that receives prompt text. What it and the model providers behind it retain is governed by their policies, not ours. Any caller on any tier can keep prompt text away from OpenRouter by passing `mode: "pattern-only"` per request, which runs Layer 1 only. There is no account-level or tier-level switch for this today — the control is per request.
- **Stripe** processes payment card data directly; Parse never sees or stores raw card numbers.
- **Cloud infrastructure** is hosted on standard cloud providers. No prompt text is shared with infrastructure providers beyond what section 1.3 lists as stored.

If additional subprocessors are added in the future, customers will be notified at least 30 days in advance via security@parsethis.ai.

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

| SOC 2 Trust Principle | SOC 2 Criteria | Parse Control | Status |
|---|---|---|---|
| **Security (Common Criteria)** | CC1: Control Environment | Security governance documented; CISO-designated security contact | ✅ Implemented |
| | CC2: Communication and Information | Security headers endpoint (`GET /v1/security/headers`), trust page, docs hub | ✅ Implemented |
| | CC3: Risk Assessment | Threat model documented for prompt injection taxonomy; quarterly review | ✅ Implemented |
| | CC4: Monitoring Activities | Audit logging on all security-relevant events; SIEM forwarding on compliance tier | ✅ Implemented |
| | CC5: Control Activities | RBAC, rate limiting, input validation, policy enforcement | ✅ Implemented |
| | CC6: Logical and Physical Access | Bearer auth, bcrypt-hashed API keys, HSTS, TLS, CORS allowlisting | ✅ Implemented |
| | CC7: System Operations | Structured logging, request tracing (`X-Request-ID`), graceful shutdown, health checks | ✅ Implemented |
| | CC8: Change Management | Versioned deployments, automated CI/CD, type-safe TypeScript codebase | ✅ Implemented |
| | CC9: Risk Mitigation | Rate limiting, sandbox isolation, SSRF guards, 3-layer defense pipeline | ✅ Implemented |
| **Availability** | A1: Availability | Multi-instance deployment, Redis HA fallback, health check endpoints | ⚠️ Partial |
| **Processing Integrity** | PI1: Processing Integrity | Deterministic scoring, nonce-tagged LLM delimiters, verdict aggregation | ✅ Implemented |
| **Confidentiality** | C1: Confidentiality | TLS in transit, bcrypt/AES-256 for secrets, no prompt storage on the screening endpoints | ✅ Implemented |
| **Privacy** | P1–P8: Privacy | Documented retention (section 1.3), data governance module, approval matrix. Retention is enforced by hand today; a scheduled purge job is not implemented | ⚠️ Partial |

### 5.3 Additional Frameworks (Roadmap)

| Framework | Status | Target |
|---|---|---|
| ISO 27001 | Planned | Q3 2027 |
| HIPAA | Planned | On customer request |
| FedRAMP | Planned | Q4 2027 |
| GDPR | Aligned | Ongoing — data retention policies, right to erasure via support |

---

## 6. CAQH-lite / SIG-lite Answer Set

Pre-answered responses to the top 30 most common vendor security questionnaire questions. These answers can be pasted directly into CAQH, SIG, or custom vendor security assessment forms.

### General Security

**1. Does your organization have an information security policy?**  
Yes. Parse maintains a documented information security policy covering access control, data protection, incident response, and vulnerability management. The policy is reviewed annually.

**2. Does your organization have a designated security officer or CISO?**  
Yes. Security governance is overseen by a designated security contact reachable at security@parsethis.ai.

**3. Does your organization conduct security awareness training?**  
Yes. All team members complete security awareness training covering prompt injection risks, secure coding practices, and incident reporting procedures.

**4. Are background checks performed on personnel?**  
Yes. Background checks are performed on personnel with access to production systems or customer data, in accordance with applicable local laws.

**5. Does your organization have an incident response plan?**  
Yes. Parse maintains a documented incident response plan with defined roles, escalation procedures, and communication protocols. Incidents are logged and reviewed post-resolution.

### Access Control

**6. Is access to systems and data based on role (RBAC)?**  
Yes. Parse implements role-based access control with defined roles (admin, owner, member, viewer). Access is enforced at the route level via middleware.

**7. Are access rights reviewed periodically?**  
Yes. Access rights are reviewed quarterly. Departed personnel access is revoked within 24 hours of termination.

**8. Are multi-factor authentication (MFA) and SSO supported?**  
Yes. Parse supports OAuth 2.0 / OIDC-based SSO (available on Team and Compliance tiers). MFA is enforced for administrative access.

**9. Are API keys encrypted at rest?**  
Yes. API keys are bcrypt-hashed with salt. Only the hash and a non-reversible prefix are stored; the full key is never persisted.

**10. Is least-privilege access enforced?**  
Yes. API keys are scoped to organizations and roles. Cross-organization access is denied at the middleware level.

### Data Protection

**11. Is data encrypted in transit?**  
Yes. All connections use TLS 1.2+. HSTS is enforced with `max-age=31536000; includeSubDomains`.

**12. Is data encrypted at rest?**  
Yes. Secrets are encrypted using AES-256-GCM. Database connections use TLS. API keys are bcrypt-hashed.

**13. Do you store customer prompt data?**  
The screening endpoints (`/v1/parse`, `/v1/screen-output`, `/v1/agent/trust/verify`) do not: the screening event table has no column for prompt text or a hash of it, on every tier. `/v1/evaluate` does, for the length of the run — on completion the stored copy is overwritten with the first 100 characters plus a SHA-256 of the full prompt, and those characters remain readable. See section 1.3 for the per-endpoint breakdown.

**14. What is your data retention policy?**  
Stated retention: screening events 90 days, audit events 90 days, compliance receipts 1 year, API keys until revocation or expiry. Enforcement is manual — no scheduled purge job is implemented yet, so deletion happens on request rather than on a timer. Rate-limit counters and the in-memory `/v1/evaluate` records expire automatically. See section 1.3.

**15. Do you support customer data deletion requests?**  
Yes. Customers can request data deletion via privacy@parsethis.ai or hello@parsethis.ai. Deletion is completed within 30 days.

**15b. Does prompt text leave your infrastructure?**  
Yes, for the semantic analysis layer: prompt text is sent to OpenRouter for model scoring unless the caller passes `mode: "pattern-only"`, a pattern already matched at severity 9 or above, or the deployment has no OpenRouter key. Prompt text also reaches OpenRouter and the execution sandbox when the caller opts in with `execute: true`, which is off by default. See section 1.3.

### Network Security

**16. Is there a firewall or network segmentation?**  
Yes. Production infrastructure uses cloud security groups with least-privilege ingress/egress rules. Internal services are segmented from public-facing endpoints.

**17. Is rate limiting implemented?**  
Yes. Redis-backed sliding-window rate limiting with in-memory fallback. Tier-based limits (Free: 10/min, Pro: 100/min, Team: 500/min, Compliance: 500/min). HTTP 429 with `Retry-After` on threshold breach.

**18. Are security headers enforced?**  
Yes. All responses include: Content-Security-Policy, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, HSTS.

**19. Is CORS configured securely?**  
Yes. CORS is restricted to allowlisted origins via the `ALLOWED_ORIGINS` environment variable. Unrecognized origins receive no Access-Control-Allow-Origin header.

**20. Is input validation enforced?**  
Yes. Maximum request body: 1 MB. Maximum prompt length: 100,000 characters. Strict `Content-Type: application/json` required for POST endpoints.

### Vulnerability Management

**21. Are regular vulnerability scans performed?**  
Yes. Automated dependency scanning is integrated into CI/CD. Critical dependencies are monitored for CVEs with automated remediation tracking.

**22. Is there a vulnerability disclosure program?**  
Yes. Vulnerability reports are accepted at security@parsethis.ai with a 48-hour acknowledgment SLA and 90-hour remediation SLA for critical vulnerabilities.

**23. Are penetration tests performed?**  
Yes. Penetration testing is performed on a scheduled basis and prior to major releases. Reports are available to customers under NDA.

**24. Is there a patch management process?**  
Yes. Security patches are prioritized by severity. Critical patches are deployed within 90 hours. Dependency updates are automated where possible.

### Logging and Monitoring

**25. Are security-relevant events logged?**  
Yes. Audit events include: auth failures, rate limit breaches, policy changes, screening events, and bypass codeword usage. Events are stored in Postgres and structured console logs.

**26. Is SIEM integration available?**  
Yes. SIEM forwarding via HTTP webhook is available on the Compliance tier. Events are forwarded in real-time to customer-configured SIEM endpoints.

**27. Are logs retained and protected?**  
Yes. Screening event logs are retained for 90 days. Compliance receipts for 1 year. Logs are access-controlled and stored in encrypted databases.

**28. Is request traceability supported?**  
Yes. Every API response includes an `X-Request-ID` header for end-to-end request correlation and audit tracing.

### Business Continuity

**29. Is there a business continuity / disaster recovery plan?**  
Yes. Parse maintains documented BCP/DR procedures. Production deployments support multi-instance failover. Health check endpoints (`/health`, `/health/detail`) enable automated recovery.

**30. What is your uptime commitment?**  
Parse targets 99.9% uptime for API availability. Status is monitored via `/health` endpoint. Incidents are communicated to affected customers via security@parsethis.ai. A formal SLA is available on the Compliance and Enterprise tiers.

---

*This trust package is maintained as a living document. For the latest version, visit [https://www.parsethis.ai/trust](https://www.parsethis.ai/trust) or request the machine-readable version at `GET /v1/security/headers`.*
