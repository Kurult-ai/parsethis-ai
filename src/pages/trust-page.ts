import { renderPage } from "../lib/html-template.js";
import { TIER_RATE_LIMITS } from "../lib/rate-limiter.js";
import { DETECTION_FACTS, PRODUCT, SECURITY_FACTS } from "../lib/product-facts.js";
import { CONTACT_EMAIL } from "../lib/constants.js";
// The subprocessor table is generated for the same reason the roles below are:
// it existed as three hand-typed copies, and the one in docs/trust-package.md
// drifted into saying Parse runs on "standard cloud providers" while the DPA
// said "not AWS/GCP/Azure". See src/lib/subprocessor-facts.ts.
import { SUBPROCESSOR_CONTROL_NOTE, subprocessorTableHtml } from "../lib/subprocessor-facts.js";
// Roles are read from the code that enforces them. This page carried four role
// names for months — admin, owner, member, viewer — and not one of them existed.
// A customer's reviewer reads the questionnaire answer below into their
// assessment, so it cannot be maintained by hand.
import { VALID_ROLES } from "../lib/rbac.js";
import { QUESTIONNAIRE_COUNT, questionnaireHtml } from "../lib/vendor-questionnaire.js";
import { soc2TableHtml } from "../lib/soc2-mapping.js";
import { VALID_PROVIDER_TYPES } from "../lib/sso/sso-provider.js";
import {
  DATA_FLOW_HTML,
  RETENTION,
  RETENTION_TABLE_HTML,
  STORAGE_BY_ENDPOINT_HTML,
} from "../lib/retention-facts.js";

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
    font-family: var(--mono);
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

<p class="answer-capsule">This page is ${PRODUCT.name}'s whole security posture: architecture, controls, sub-processors, retention, and a pre-answered vendor questionnaire. It states the gaps as plainly as the controls — there is <strong>no SOC 2 report yet</strong> (in progress, Q1 2027), <strong>no independent penetration test</strong>, and Parse runs on a <strong>single node</strong> with no failover. Everything here is written to be checked rather than believed. Detection reduces risk; it does not replace least-privilege tools or output validation.</p>

<div class="trust-contact-box">
  <h3>Need this for your vendor risk assessment?</h3>
  <p>The full trust package is available as a <a href="/trust-package">downloadable document</a>. You can also <a href="/docs/trust-package.md" download>download the Markdown source</a>.</p>
  <p>Our <a href="/dpa">Data Processing Agreement (DPA)</a> covers GDPR Article 28, SCCs, sub-processor adequacy, and breach notification.</p>
  <p>Security contact also published at <a href="/.well-known/security.txt">/.well-known/security.txt</a> (RFC 9116).</p>
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

<h3 id="storage">Data Storage: What Parse Stores, Per Endpoint</h3>
${STORAGE_BY_ENDPOINT_HTML}

<h3 id="retention">Retention</h3>
${RETENTION_TABLE_HTML}

<h3 id="data-flow">Where Prompt Text Goes</h3>
${DATA_FLOW_HTML}
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
      <li>Roles: ${VALID_ROLES.join(", ")}</li>
      <li>Route-level middleware enforcement</li>
      <li>Organization-scoped keys; cross-org denied</li>
      <li>Configurable per-org policy packs</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>🔑 SSO</h3>
    <ul>
      <li>OAuth 2.0 / OpenID Connect</li>
      <li>Okta, Microsoft Entra ID, Google Workspace, WorkOS</li>
      <li>Available on Team + Compliance tiers</li>
    </ul>
  </div>
  <div class="trust-card">
    <h3>🔐 Encryption</h3>
    <ul>
      <li>Secrets: AES-256-GCM (API keys: ${SECURITY_FACTS.apiKeyStorageShort})</li>
      <li>Transit: ${SECURITY_FACTS.transitTls}, HSTS enforced</li>
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

<p>Parse uses few third-party services. One of them receives prompt text.</p>

${subprocessorTableHtml("Subprocessor")}
<p style="font-size: 14px; color: var(--text-dim);">${SUBPROCESSOR_CONTROL_NOTE}</p>
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

<p class="muted" style="font-size:13px;">Certification is in progress and on the roadmap; the controls below are aligned today.</p>
${soc2TableHtml()}

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

<!-- ─── 6. CAIQ-lite / SIG-lite Answer Set ────────────────────────────────── -->

<div class="trust-section">
<h2 id="questionnaire">6. Pre-Answered Vendor Security Questionnaire</h2>
<p>The ${QUESTIONNAIRE_COUNT} most common vendor security questionnaire questions, pre-answered for your assessment. Expand each category below.</p>

${questionnaireHtml()}

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
      "Parse trust package: architecture overview, security controls, subprocessors, vulnerability disclosure policy, SOC 2 alignment (certification in progress), and pre-answered vendor security questionnaire.",
    path: "/trust",
    content,
    baseUrl,
    lastUpdated: "2026-08-11",
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
