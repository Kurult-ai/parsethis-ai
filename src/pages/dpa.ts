import { renderPage } from "../lib/html-template.js";
import { LEGAL_ENTITY, PRODUCT, SECURITY_FACTS } from "../lib/product-facts.js";
import { SUBPROCESSOR_CONTROL_NOTE, modelRoutingNote, subprocessorTableHtml } from "../lib/subprocessor-facts.js";

/**
 * Data Processing Agreement page — SSR HTML at /dpa
 *
 * Implements Phase 8 Task 8.1 of the Ines Duarte action plan.
 * Draft for review by Danny + legal counsel before publishing.
 */
export function renderDpaPage(baseUrl: string): string {
  const content = `
<h1>Data Processing Agreement</h1>

<p class="answer-capsule"><strong>Last updated:</strong> August 12, 2026. This Data Processing Agreement ("<strong>DPA</strong>") is incorporated into and forms part of the Parse for Agents Terms of Service. It applies when Parse processes personal data on behalf of a Customer under Article 28 of the EU General Data Protection Regulation (GDPR) and the UK Data Protection Act 2018.</p>

<h2 id="parties">1. Parties</h2>
<p class="answer-capsule">This DPA is between <strong>Kurultai Labs LLC</strong>, a North Carolina limited liability company trading as <strong>${PRODUCT.name}</strong> ("<strong>Processor</strong>" or "<strong>Parse</strong>"), and the entity that has subscribed to the Parse service ("<strong>Customer</strong>" or "<strong>Controller</strong>"). Parse is governed by the laws of ${LEGAL_ENTITY.governingLaw}. Entity details for your vendor register are published on the <a href="/trust#entity">trust page</a>.</p>

<h2 id="processing-activities">2. Processing Activities</h2>
<p class="answer-capsule">Parse processes the following categories of personal data on behalf of the Customer:</p>
<ul>
  <li><strong>Prompt text and content</strong> submitted for security screening and risk analysis</li>
  <li><strong>API keys and metadata</strong> — key identifiers, usage counts, rate-limit data</li>
  <li><strong>IP addresses</strong> — for rate limiting and abuse prevention (hashed)</li>
  <li><strong>Screening results</strong> — risk scores, flags, verdicts returned to the Customer</li>
</ul>
<p class="answer-capsule">The purpose of processing is limited to: (a) screening prompts for prompt injection, jailbreak, and adversarial threats; (b) returning risk assessments; (c) logging for security audit; and (d) aggregate analytics for detection improvement.</p>

<h3>Model training</h3>
<p class="answer-capsule"><strong>Parse does not use Customer content to train, fine-tune or evaluate any model.</strong> This is a property of the storage design rather than a promise: the screening endpoints (<code>/v1/parse</code>, <code>/v1/screen-output</code>, <code>/v1/agent/trust/verify</code>) do not retain prompt text or a hash of it, so no corpus of Customer content exists to train on. "Aggregate analytics for detection improvement" in (d) above means verdict counts, category distributions and rule hit rates — numbers, not text.</p>
<p class="answer-capsule">Two limits on that statement, both stated so the Customer does not have to discover them:</p>
<ul>
  <li><code>POST /v1/evaluate</code> is the exception to the no-retention rule. It holds the prompt while the run is in flight, then overwrites its copy with the first 100 characters plus a SHA-256 of the whole prompt, kept in server memory for the 500 most recent runs. Those records are not used for training either, but they are the one place Customer text persists at all. See the <a href="/trust#storage">per-endpoint storage table</a>.</li>
  <li>What <strong>OpenRouter and the model providers behind it</strong> do with text sent for semantic analysis is governed by their policies, not this DPA. A Customer who needs that transfer not to happen can pass <code>mode: "pattern-only"</code> per request, or set <code>defaultMode: "pattern-only"</code> for the whole organization, and the text is never sent.</li>
</ul>

<h2 id="sub-processors">3. Sub-processors</h2>
<p class="answer-capsule">Parse uses the following sub-processors to deliver the service. Only OpenRouter receives prompt text, and only in <code>full</code> mode:</p>

${subprocessorTableHtml("Sub-processor")}
<p class="answer-capsule" style="font-size: 14px;">${SUBPROCESSOR_CONTROL_NOTE}</p>
<p class="answer-capsule" style="font-size: 14px;">${modelRoutingNote()}</p>

<h2 id="data-transfers">4. International Data Transfers</h2>
<p class="answer-capsule">Personal data may be transferred from the EEA, UK, or Switzerland to the United States under the <strong>European Commission's Standard Contractual Clauses (SCCs)</strong> adopted under Commission Implementing Decision (EU) 2021/914. Parse executes the SCCs as the data importer.</p>

<h3>Transfer Impact Assessment (TIA)</h3>
<p class="answer-capsule">A TIA is available to Customers under NDA. Summary findings:</p>
<ul>
  <li><strong>Surveillance risk:</strong> Parse operates on self-hosted infrastructure (Mac Mini), not AWS/GCP/Azure. No government access beyond what is legally compelled.</li>
  <li><strong>Encryption:</strong> Data in transit uses ${SECURITY_FACTS.transitTls}. Prompt text is processed ephemerally and not persisted for the screening endpoints.</li>
  <li><strong>Access controls:</strong> Single-tenant infrastructure with no third-party administrative access.</li>
  <li><strong>Supplementary measures:</strong> Pattern-only mode prevents onward transfer of prompt text to the semantic-analysis subprocessor (OpenRouter, US) when used. Prompt text is still transferred to Parse for processing in the United States.</li>
</ul>

<h2 id="data-residency">5. Data Residency</h2>
<p class="answer-capsule">Processing currently occurs on infrastructure hosted in the United States (Mac Mini M4, behind Cloudflare's edge network). An EU/UK region is on the roadmap. <strong>Parse cannot offer EU data residency today:</strong> using the hosted API means prompt text is transferred to and processed in the United States, and the transfer is governed by the SCCs in Section 4 rather than avoided. Customers who need to reduce or eliminate that transfer can:</p>
<ul>
  <li>Pass <code>mode: "pattern-only"</code> per request, which runs the deterministic layer only. Prompt text still reaches Parse in the United States, but is not forwarded to the semantic-analysis subprocessor (OpenRouter, US). This narrows the transfer chain; it does not keep prompt text on the customer's own infrastructure.</li>
  <li>Run the open-source <code>prompt-guard</code> pattern library inside their own environment. This is a standalone component, not the Parse platform: it performs local pattern screening only, without the hosted registry, policy engine, receipts, or semantic layer. Prompt text never leaves the customer's infrastructure in this configuration, because Parse is not in the request path at all.</li>
</ul>

<h2 id="security">6. Security Measures</h2>
<p class="answer-capsule">Parse implements the following technical and organizational security measures:</p>
<ul>
  <li><strong>Encryption in transit:</strong> ${SECURITY_FACTS.transitTls}</li>
  <li><strong>API keys:</strong> ${SECURITY_FACTS.apiKeyStorage}</li>
  <li><strong>Sandbox isolation:</strong> Execution environments containerized with no network access</li>
  <li><strong>Access controls:</strong> Single-operator infrastructure, no shared credentials</li>
  <li><strong>Audit logging:</strong> All screening events and admin actions logged</li>
  <li><strong>Retention enforcement:</strong> Automated daily purge job (see <a href="/trust#retention">retention schedule</a>)</li>
</ul>

<h2 id="retention">7. Data Retention</h2>
<p class="answer-capsule">Retention periods are documented on our <a href="/trust#retention">Trust page</a>. Screening endpoints do not persist prompt text. Metadata (usage counts, IP hashes) is retained per the schedule and purged automatically.</p>

<h2 id="data-subject-rights">8. Data Subject Rights</h2>
<p class="answer-capsule">Parse assists Customers in responding to data subject requests as required by GDPR Articles 15-22:</p>
<ul>
  <li><strong>Access (Art. 15):</strong> Customers can export their screening policies and configuration data</li>
  <li><strong>Erasure (Art. 17):</strong> Customers can request deletion of their account and associated data</li>
  <li><strong>Portability (Art. 20):</strong> Configuration data is exportable at any time</li>
  <li><strong>Objection (Art. 21):</strong> Customers can disable any processing tier at will</li>
</ul>
<p class="answer-capsule">To exercise these rights, Customers contact <a href="mailto:privacy@parsethis.ai">privacy@parsethis.ai</a>. Parse responds within 30 days.</p>

<h2 id="breach-notification">9. Breach Notification</h2>
<p class="answer-capsule">Parse will notify the Customer of any personal data breach without undue delay and in any case within <strong>72 hours</strong> of becoming aware of the breach, in accordance with GDPR Article 33. Notification includes:</p>
<ul>
  <li>The nature of the breach and categories of data affected</li>
  <li>The likely consequences and measures taken</li>
  <li>Contact details: <a href="mailto:d@kurult.ai">d@kurult.ai</a></li>
</ul>

<h2 id="audit">10. Audit Rights</h2>
<p class="answer-capsule">Customers have the right to audit Parse's compliance with this DPA, subject to:</p>
<ul>
  <li>30 days' written notice</li>
  <li>Mutually agreed scope and timing</li>
  <li>Confidentiality and non-interference obligations</li>
</ul>
<p class="answer-capsule">SOC 2 Type II certification is planned for Q1 2027. Until then, the <a href="/trust">trust page</a> and <a href="/trust-package">trust package</a> serve as the primary security attestation.</p>

<h2 id="dpo">11. Data Protection Officer</h2>
<p class="answer-capsule">For data protection inquiries, contact:</p>
<ul>
  <li><strong>Email:</strong> <a href="mailto:d@kurult.ai">d@kurult.ai</a></li>
  <li><strong>Privacy:</strong> <a href="mailto:privacy@parsethis.ai">privacy@parsethis.ai</a></li>
</ul>

<h2 id="changes">12. Changes to This DPA</h2>
<p class="answer-capsule">Parse will notify Customers of material changes to this DPA at least 30 days in advance. Sub-processor additions are announced 30 days before activation.</p>
`;

  return renderPage({
    title: "Data Processing Agreement",
    description: "DPA, SCCs, and GDPR compliance documentation for Parse for Agents.",
    path: "/dpa",
    content,
    baseUrl,
    lastUpdated: "2026-08-12",
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Trust", href: "/trust" },
      { name: "DPA", href: "/dpa" },
    ],
  });
}
