import { renderPage } from "../lib/html-template.js";
import { TIER_RATE_LIMITS } from "../lib/rate-limiter.js";
import { DETECTION_FACTS, PRODUCT } from "../lib/product-facts.js";
import { CONTACT_EMAIL } from "../lib/constants.js";

/**
 * Trust page — SSR HTML at /trust
 *
 * Renders the public trust package content for enterprise customers,
 * security teams, and vendor risk assessments. Content mirrors
 * docs/trust-package.md but is formatted as an interactive HTML page
 * with the site chrome (header, nav, footer).
 */
export function renderTrustPage(baseUrl: string): string {
  const content = `
<style>
  .trust-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .trust-hero h1 { margin: 0; }
  .trust-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    background: var(--yellow-dim);
    color: var(--yellow);
    border: 1px solid rgba(183, 121, 31, 0.2);
    white-space: nowrap;
  }
  .trust-section {
    padding: 32px 0;
    border-bottom: 1px solid var(--border);
  }
  .trust-section:last-child { border-bottom: none; }
  .trust-section h2:first-child { margin-top: 0; }
  .trust-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 16px;
    margin: 20px 0;
  }
  .trust-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .trust-card h3 { margin-top: 0; font-size: 1em; }
  .trust-card p, .trust-card li { font-size: 14px; color: var(--text-dim); }
  .trust-diagram {
    background: #10141a;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 24px;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    font-size: 13px;
    color: #c8d6e5;
    overflow-x: auto;
    line-height: 1.5;
    margin: 20px 0;
    white-space: pre;
  }
  .trust-contact-box {
    background: linear-gradient(135deg, var(--accent-dim), transparent);
    border: 1px solid rgba(0, 111, 238, 0.2);
    border-radius: var(--radius);
    padding: 24px;
    margin: 24px 0;
    text-align: center;
  }
  .trust-contact-box h3 { margin-top: 0; }
  .trust-contact-box .btn { margin-top: 12px; }
  .qa-block {
    margin-bottom: 18px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--surface2);
  }
  .qa-block:last-child { border-bottom: none; }
  .qa-block .q {
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
  }
  .qa-block .q .qnum {
    color: var(--accent);
    font-weight: 700;
    margin-right: 6px;
  }
  .qa-block .a {
    color: var(--text-dim);
    font-size: 14px;
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
    padding: 12px 0;
  }
  details[open] summary {
    border-bottom: 1px solid var(--surface2);
    margin-bottom: 12px;
  }
</style>

<div class="trust-hero">
  <h1>Trust &amp; Security</h1>
  <span class="trust-status-badge">SOC 2 Type II — In Progress</span>
</div>

<p class="answer-capsule">${PRODUCT.name} is built for enterprise-grade security from day one. This page provides a transparent overview of our architecture, security controls, compliance posture, and pre-answered vendor questionnaire — everything your security team needs to assess Parse.</p>

<div class="trust-contact-box">
  <h3>Need this for your vendor risk assessment?</h3>
  <p>The full trust package is available as a downloadable document at <code>docs/trust-package.md</code>.</p>
  <p>Programmatic security posture: <code>GET /v1/security/headers</code></p>
  <a href="mailto:security@parsethis.ai" class="btn btn-primary">Contact Security</a>
</div>

<!-- ─── 1. Architecture Overview ────────────────────────────────────────── -->

<div class="trust-section">
<h2 id="architecture">1. Architecture Overview</h2>

<h3>Three-Layer Screening Pipeline</h3>
<p>Parse uses a defense-in-depth screening pipeline. Each layer can block or flag independently — no single bypass defeats all three.</p>

<div class="trust-diagram"> ┌──────────────────┐     ┌───────────────────────┐     ┌─────────────────────┐
 │  Layer 1: Regex  │────▶│  Layer 2: LLM          │────▶│  Layer 3: Sandbox   │
 │  Pattern Match   │     │  Semantic Analysis     │     │  Execution          │
 │  ${DETECTION_FACTS.patternRuleCount} patterns,  │     │  (nonce-tagged         │     │  (isolated eval,    │
 │   ${DETECTION_FACTS.riskCategoryCount} categories,│     │   delimiters, multi-   │     │   SSRF-guarded URL  │
 │   normalization) │     │   window sampling)     │     │   prefetch, DOM     │
 └──────────────────┘     └───────────────────────┘     └─────────────────────┘</div>

<div class="trust-grid">
  <div class="trust-card">
    <h3>Layer 1 — Pattern Matching</h3>
    <p>${DETECTION_FACTS.patternRuleCount} compiled regex patterns across ${DETECTION_FACTS.riskCategoryCount} risk categories. Includes text normalization to catch encoded/obfuscated payloads (Unicode, hex, base64, homoglyphs).</p>
  </div>
  <div class="trust-card">
    <h3>Layer 2 — LLM Semantic Analysis</h3>
    <p>Multi-model semantic risk scoring via OpenRouter. Uses nonce-tagged delimiters to prevent prompt reflection, multi-window sampling for long inputs, and model diversity to reduce blind spots.</p>
  </div>
  <div class="trust-card">
    <h3>Layer 3 — Sandbox Execution</h3>
    <p>Optional isolated execution for suspicious prompts. HMAC-authenticated communication, SSRF-guarded URL prefetch, and DOM-aware hidden content extraction. Disabled by default; enabled per-tier.</p>
  </div>
</div>

<h3>Data Storage: What Parse Stores vs Discards</h3>
<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Data Element</th><th>Stored?</th><th>Retention</th></tr>
    </thead>
    <tbody>
      <tr><td>Screening verdict (risk score, categories, flags)</td><td>✅ Yes</td><td>90 days</td></tr>
      <tr><td>Request metadata (timestamp, key ID, endpoint)</td><td>✅ Yes</td><td>90 days</td></tr>
      <tr><td>Prompt SHA-256 hash (for deduplication)</td><td>✅ Yes</td><td>90 days</td></tr>
      <tr><td><strong>Prompt plaintext (Compliance tier)</strong></td><td><strong>❌ No — SHA-256 hash only</strong></td><td>Never stored</td></tr>
      <tr><td>Prompt plaintext (other tiers)</td><td>⚠️ Transient only</td><td>0 seconds persisted</td></tr>
      <tr><td>Compliance receipts (signed evidence)</td><td>✅ Yes</td><td>1 year</td></tr>
      <tr><td>API keys</td><td>✅ bcrypt-hashed</td><td>Until revocation</td></tr>
    </tbody>
  </table>
</div>

<h3>Retention Defaults</h3>
<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Data Category</th><th>Default Retention</th><th>Configurable</th></tr>
    </thead>
    <tbody>
      <tr><td>Screening events</td><td>90 days</td><td>✅ Compliance tier</td></tr>
      <tr><td>Compliance receipts</td><td>1 year</td><td>❌ Fixed for audit integrity</td></tr>
      <tr><td>SIEM-forwarded logs</td><td>Customer-controlled</td><td>✅</td></tr>
      <tr><td>Rate limit counters</td><td>Auto-expire (TTL)</td><td>❌</td></tr>
    </tbody>
  </table>
</div>
</div>

<!-- ─── 2. Security Controls Summary ─────────────────────────────────────── -->

<div class="trust-section">
<h2 id="controls">2. Security Controls Summary</h2>

<div class="trust-grid">
  <div class="trust-card">
    <h3>🔒 Rate Limiting</h3>
    <ul>
      <li>Redis sliding-window (atomic Lua) with in-memory fallback</li>
      <li>Tier-based: Free ${TIER_RATE_LIMITS.free}/min → Enterprise ${TIER_RATE_LIMITS.enterprise}/min</li>
      <li>API keys SHA-256 hashed before use as rate-limit keys</li>
      <li>HTTP 429 + <code>Retry-After</code> on breach</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>👥 RBAC</h3>
    <ul>
      <li>Roles: admin, owner, member, viewer</li>
      <li>Route-level middleware enforcement</li>
      <li>Organization-scoped keys; cross-org denied</li>
      <li>Configurable per-org policy packs</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>🔑 SSO</h3>
    <ul>
      <li>OAuth 2.0 / OpenID Connect</li>
      <li>Google, Microsoft, Okta, Auth0, custom OIDC</li>
      <li>Available on Team + Compliance tiers</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>🔐 Encryption</h3>
    <ul>
      <li>Secrets: AES-256-GCM (API keys bcrypt-hashed)</li>
      <li>Transit: TLS 1.2+, HSTS enforced</li>
      <li>Database: TLS connection in production</li>
      <li>Redis: TLS connection in production</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>📋 Audit Logging</h3>
    <ul>
      <li>Events: auth_failure, rate_limit_exceeded, policy_change, prompt_screened, bypass_codeword</li>
      <li>Storage: Postgres + structured console logs</li>
      <li>SIEM forwarding (Compliance tier)</li>
      <li><code>X-Request-ID</code> on every response</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>🛡️ Input Validation</h3>
    <ul>
      <li>Max body: 1 MB</li>
      <li>Max prompt: 100,000 chars</li>
      <li>Strict <code>application/json</code> for POST</li>
      <li>CORS allowlisted origins only</li>
    </ul>
  </div>
</div>

<details>
<summary>Full Security Headers (from <code>GET /v1/security/headers</code>)</summary>
<div class="table-wrapper">
  <table>
    <thead><tr><th>Header</th><th>Value</th></tr></thead>
    <tbody>
      <tr><td>Content-Security-Policy</td><td><code>default-src 'self'</code> (strict)</td></tr>
      <tr><td>X-Frame-Options</td><td><code>DENY</code></td></tr>
      <tr><td>X-Content-Type-Options</td><td><code>nosniff</code></td></tr>
      <tr><td>X-XSS-Protection</td><td><code>0</code> (modern standard)</td></tr>
      <tr><td>Referrer-Policy</td><td><code>strict-origin-when-cross-origin</code></td></tr>
      <tr><td>Permissions-Policy</td><td><code>camera=(), microphone=(), geolocation=()</code></td></tr>
      <tr><td>Strict-Transport-Security</td><td><code>max-age=31536000; includeSubDomains</code></td></tr>
    </tbody>
  </table>
</div>
</details>
</div>

<!-- ─── 3. Subprocessors ─────────────────────────────────────────────────── -->

<div class="trust-section">
<h2 id="subprocessors">3. Subprocessors</h2>

<p>Parse uses minimal third-party services. No customer prompt data is stored by subprocessors beyond the request lifecycle.</p>

<div class="table-wrapper">
  <table>
    <thead><tr><th>Subprocessor</th><th>Purpose</th><th>Data Accessed</th></tr></thead>
    <tbody>
      <tr><td><strong>None for v1 core processing</strong></td><td>—</td><td>—</td></tr>
      <tr><td>OpenRouter</td><td>LLM inference routing (Layer 2)</td><td>Prompt text transiently; not stored</td></tr>
      <tr><td>Stripe</td><td>Subscription billing</td><td>Payment metadata only; no card data</td></tr>
    </tbody>
  </table>
</div>
<p style="font-size: 14px; color: var(--text-dim);">Customers on the Compliance tier can disable LLM analysis entirely, operating on Layers 1 and 3 only. New subprocessors are announced 30 days in advance.</p>
</div>

<!-- ─── 4. Vulnerability Disclosure Policy ───────────────────────────────── -->

<div class="trust-section">
<h2 id="vulnerability-disclosure">4. Vulnerability Disclosure Policy</h2>

<div class="trust-contact-box">
  <h3>Report a Vulnerability</h3>
  <p><strong>Email:</strong> <a href="mailto:security@parsethis.ai">security@parsethis.ai</a></p>
</div>

<div class="table-wrapper">
  <table>
    <thead><tr><th>Milestone</th><th>SLA</th></tr></thead>
    <tbody>
      <tr><td>Acknowledgment</td><td><strong>48 hours</strong></td></tr>
      <tr><td>Initial assessment</td><td>5 business days</td></tr>
      <tr><td>Critical vulnerability remediation</td><td><strong>90 hours</strong> (3.75 days)</td></tr>
      <tr><td>High vulnerability remediation</td><td>15 business days</td></tr>
      <tr><td>Medium vulnerability remediation</td><td>30 business days</td></tr>
      <tr><td>Low vulnerability remediation</td><td>90 business days</td></tr>
    </tbody>
  </table>
</div>

<p><strong>Safe Harbor:</strong> We will not pursue legal action against researchers who respect user privacy, avoid DoS/social engineering, report promptly, and allow reasonable remediation time before disclosure.</p>
</div>

<!-- ─── 5. Compliance Framework Alignment ─────────────────────────────────── -->

<div class="trust-section">
<h2 id="compliance">5. Compliance Framework Alignment</h2>

<h3>SOC 2 Type II — In Progress</h3>
<p>Parse is actively pursuing SOC 2 Type II certification. Expected completion: Q1 2027.</p>

<div class="table-wrapper">
  <table>
    <thead><tr><th>SOC 2 Trust Principle</th><th>Criteria</th><th>Parse Control</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td rowspan="9"><strong>Security (Common)</strong></td><td>CC1: Control Environment</td><td>Security governance; designated security contact</td><td>✅</td></tr>
      <tr><td>CC2: Communication</td><td>Public security endpoint, trust page, docs hub</td><td>✅</td></tr>
      <tr><td>CC3: Risk Assessment</td><td>Threat model for prompt injection taxonomy</td><td>✅</td></tr>
      <tr><td>CC4: Monitoring</td><td>Audit logging, SIEM forwarding</td><td>✅</td></tr>
      <tr><td>CC5: Control Activities</td><td>RBAC, rate limiting, input validation</td><td>✅</td></tr>
      <tr><td>CC6: Logical Access</td><td>Bearer auth, bcrypt, HSTS, TLS, CORS</td><td>✅</td></tr>
      <tr><td>CC7: System Operations</td><td>Structured logging, X-Request-ID, health checks</td><td>✅</td></tr>
      <tr><td>CC8: Change Management</td><td>Versioned CI/CD, TypeScript type safety</td><td>✅</td></tr>
      <tr><td>CC9: Risk Mitigation</td><td>Rate limiting, sandbox isolation, SSRF guards</td><td>✅</td></tr>
      <tr><td><strong>Availability</strong></td><td>A1: Availability</td><td>Multi-instance, Redis HA, health endpoints</td><td>⚠️ Partial</td></tr>
      <tr><td><strong>Processing Integrity</strong></td><td>PI1: Processing Integrity</td><td>Deterministic scoring, nonce-tagged LLM delimiters</td><td>✅</td></tr>
      <tr><td><strong>Confidentiality</strong></td><td>C1: Confidentiality</td><td>TLS, bcrypt/AES-256, SHA-256 prompt hashing</td><td>✅</td></tr>
      <tr><td><strong>Privacy</strong></td><td>P1–P8</td><td>Retention policies, data governance, approval matrix</td><td>✅</td></tr>
    </tbody>
  </table>
</div>

<h3>Additional Frameworks (Roadmap)</h3>
<div class="table-wrapper">
  <table>
    <thead><tr><th>Framework</th><th>Status</th><th>Target</th></tr></thead>
    <tbody>
      <tr><td>ISO 27001</td><td>Planned</td><td>Q3 2027</td></tr>
      <tr><td>HIPAA</td><td>Planned</td><td>On customer request</td></tr>
      <tr><td>FedRAMP</td><td>Planned</td><td>Q4 2027</td></tr>
      <tr><td>GDPR</td><td>Aligned</td><td>Ongoing — retention + erasure</td></tr>
    </tbody>
  </table>
</div>
</div>

<!-- ─── 6. CAQH-lite / SIG-lite Answer Set ────────────────────────────────── -->

<div class="trust-section">
<h2 id="questionnaire">6. Pre-Answered Vendor Security Questionnaire</h2>
<p>Top 30 most common vendor security questionnaire questions, pre-answered for your assessment. Expand each category below.</p>

<details open>
<summary>General Security (Q1–Q5)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">1.</span>Does your organization have an information security policy?</p>
  <p class="a">Yes. Parse maintains a documented information security policy covering access control, data protection, incident response, and vulnerability management. Reviewed annually.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">2.</span>Does your organization have a designated security officer or CISO?</p>
  <p class="a">Yes. Security governance is overseen by a designated security contact reachable at security@parsethis.ai.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">3.</span>Does your organization conduct security awareness training?</p>
  <p class="a">Yes. All team members complete security awareness training covering prompt injection risks, secure coding practices, and incident reporting.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">4.</span>Are background checks performed on personnel?</p>
  <p class="a">Yes, for personnel with access to production systems or customer data, in accordance with applicable local laws.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">5.</span>Does your organization have an incident response plan?</p>
  <p class="a">Yes. Documented incident response plan with defined roles, escalation procedures, and communication protocols. Incidents logged and reviewed post-resolution.</p>
</div>
</details>

<details>
<summary>Access Control (Q6–Q10)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">6.</span>Is access to systems and data based on role (RBAC)?</p>
  <p class="a">Yes. RBAC with defined roles (admin, owner, member, viewer). Access enforced at route level via middleware.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">7.</span>Are access rights reviewed periodically?</p>
  <p class="a">Yes. Quarterly review. Departed personnel access revoked within 24 hours.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">8.</span>Are MFA and SSO supported?</p>
  <p class="a">Yes. OAuth 2.0 / OIDC-based SSO (Team + Compliance tiers). MFA enforced for administrative access.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">9.</span>Are API keys encrypted at rest?</p>
  <p class="a">Yes. bcrypt-hashed with salt. Only the hash and non-reversible prefix are stored.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">10.</span>Is least-privilege access enforced?</p>
  <p class="a">Yes. API keys scoped to organizations and roles. Cross-org access denied at middleware level.</p>
</div>
</details>

<details>
<summary>Data Protection (Q11–Q15)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">11.</span>Is data encrypted in transit?</p>
  <p class="a">Yes. TLS 1.2+. HSTS enforced with max-age=31536000; includeSubDomains.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">12.</span>Is data encrypted at rest?</p>
  <p class="a">Yes. Secrets encrypted using AES-256-GCM. Database connections use TLS. API keys bcrypt-hashed.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">13.</span>Do you store customer prompt data?</p>
  <p class="a">No (Compliance tier): prompts SHA-256 hashed only. Other tiers: prompt text is transient in memory, discarded after response.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">14.</span>What is your data retention policy?</p>
  <p class="a">Screening events: 90 days. Compliance receipts: 1 year. Rate limit counters: auto-expire. API keys: until revocation. Configurable on Compliance tier.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">15.</span>Do you support customer data deletion requests?</p>
  <p class="a">Yes. Via support@parsethis.ai or API. Completed within 30 days.</p>
</div>
</details>

<details>
<summary>Network Security (Q16–Q20)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">16.</span>Is there a firewall or network segmentation?</p>
  <p class="a">Yes. Cloud security groups with least-privilege ingress/egress rules. Internal services segmented from public endpoints.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">17.</span>Is rate limiting implemented?</p>
  <p class="a">Yes. Redis sliding-window with in-memory fallback. Tier-based limits. HTTP 429 with Retry-After.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">18.</span>Are security headers enforced?</p>
  <p class="a">Yes. CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, HSTS on all responses.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">19.</span>Is CORS configured securely?</p>
  <p class="a">Yes. Restricted to allowlisted origins via ALLOWED_ORIGINS env var. Unrecognized origins receive no ACAO header.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">20.</span>Is input validation enforced?</p>
  <p class="a">Yes. Max body: 1 MB. Max prompt: 100K chars. Strict application/json required for POST.</p>
</div>
</details>

<details>
<summary>Vulnerability Management (Q21–Q24)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">21.</span>Are regular vulnerability scans performed?</p>
  <p class="a">Yes. Automated dependency scanning in CI/CD. Critical CVEs tracked with automated remediation.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">22.</span>Is there a vulnerability disclosure program?</p>
  <p class="a">Yes. Reports accepted at security@parsethis.ai. 48h acknowledgment SLA, 90h remediation SLA for critical.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">23.</span>Are penetration tests performed?</p>
  <p class="a">Yes. On a scheduled basis and prior to major releases. Reports available under NDA.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">24.</span>Is there a patch management process?</p>
  <p class="a">Yes. Prioritized by severity. Critical patches within 90 hours. Dependency updates automated.</p>
</div>
</details>

<details>
<summary>Logging &amp; Monitoring (Q25–Q28)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">25.</span>Are security-relevant events logged?</p>
  <p class="a">Yes. Audit events: auth failures, rate limit breaches, policy changes, screening events, bypass codeword usage. Stored in Postgres + structured logs.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">26.</span>Is SIEM integration available?</p>
  <p class="a">Yes. SIEM forwarding via HTTP webhook on Compliance tier. Real-time event forwarding.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">27.</span>Are logs retained and protected?</p>
  <p class="a">Yes. Screening logs: 90 days. Compliance receipts: 1 year. Access-controlled, encrypted storage.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">28.</span>Is request traceability supported?</p>
  <p class="a">Yes. X-Request-ID on every API response for end-to-end correlation.</p>
</div>
</details>

<details>
<summary>Business Continuity (Q29–Q30)</summary>
<div class="qa-block">
  <p class="q"><span class="qnum">29.</span>Is there a BCP/DR plan?</p>
  <p class="a">Yes. Documented BCP/DR procedures. Multi-instance failover. Health check endpoints enable automated recovery.</p>
</div>
<div class="qa-block">
  <p class="q"><span class="qnum">30.</span>What is your uptime commitment?</p>
  <p class="a">Target 99.9% uptime. Monitored via /health endpoint. Formal SLA available on Compliance and Enterprise tiers.</p>
</div>
</details>

</div>

<div class="trust-contact-box">
  <h3>Questions?</h3>
  <p>For security assessments, NDA requests, or custom questionnaire completion, contact us:</p>
  <a href="mailto:security@parsethis.ai" class="btn btn-primary">security@parsethis.ai</a>
  <p style="margin-top:12px;font-size:13px;">General support: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> &middot; Programmatic posture: <a href="/v1/security/headers"><code>GET /v1/security/headers</code></a></p>
</div>
`;

  return renderPage({
    title: "Trust & Security",
    description:
      "Parse trust package: architecture overview, security controls, subprocessors, vulnerability disclosure policy, SOC 2 compliance alignment, and pre-answered vendor security questionnaire.",
    path: "/trust",
    content,
    baseUrl,
    lastUpdated: "2026-08-08",
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Trust & Security", href: "/trust" },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: "Trust & Security — Parse",
        description:
          "Parse trust package with architecture overview, security controls, compliance framework alignment, and pre-answered vendor security questionnaire.",
        url: `${baseUrl}/trust`,
        isPartOf: { "@type": "WebSite", name: PRODUCT.name, url: baseUrl },
      },
    ],
  });
}
