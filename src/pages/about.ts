import { renderPage } from "../lib/html-template.js";
import {
  organizationSchema,
  breadcrumbSchema,
} from "../lib/schema.js";
import { DETECTION_FACTS, PRODUCT } from "../lib/product-facts.js";

/**
 * About page — SSR HTML at /about
 *
 * Company story, mission, and links to trust/demo pages.
 */
export function renderAboutPage(baseUrl: string): string {
  const content = `
<style>
  .about-hero {
    padding: 48px 0 32px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 32px;
  }
  .about-hero h1 {
    font-size: clamp(32px, 5vw, 52px);
    line-height: 1.05;
    letter-spacing: -0.04em;
    margin: 0 0 16px;
    max-width: 720px;
  }
  .about-hero p {
    font-size: 18px;
    line-height: 1.6;
    color: var(--text-dim);
    max-width: 620px;
    margin: 0;
  }
  .about-section {
    padding: 32px 0;
    border-bottom: 1px solid var(--border);
  }
  .about-section:last-child {
    border-bottom: none;
  }
  .about-section h2 {
    font-size: 28px;
    line-height: 1.15;
    letter-spacing: -0.03em;
    margin: 0 0 16px;
  }
  .about-section p, .about-section li {
    font-size: 16px;
    line-height: 1.7;
    color: var(--text-dim);
  }
  .about-section p + p {
    margin-top: 14px;
  }
  .about-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin: 24px 0;
  }
  .about-stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
    text-align: center;
  }
  .about-stat strong {
    display: block;
    font-size: 32px;
    letter-spacing: -0.03em;
    line-height: 1;
    margin-bottom: 6px;
    color: var(--text);
  }
  .about-stat span {
    font-size: 13px;
    color: var(--text-soft);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
  }
  .about-principles {
    display: grid;
    gap: 16px;
    margin: 24px 0;
  }
  .about-principle {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .about-principle h3 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .about-principle p {
    margin: 0;
    font-size: 14px;
  }
  .about-cta {
    background: linear-gradient(135deg, var(--accent-dim), transparent);
    border: 1px solid rgba(0, 111, 238, 0.2);
    border-radius: var(--radius);
    padding: 32px;
    margin-top: 32px;
    text-align: center;
  }
  .about-cta h2 {
    margin-top: 0;
  }
  .about-cta-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 20px;
  }
  @media (max-width: 640px) {
    .about-hero { padding: 28px 0 24px; }
    .about-stats { grid-template-columns: 1fr 1fr; }
  }
</style>

<div class="about-hero">
  <h1>We built Parse because agents that touch the world need a security boundary.</h1>
  <p>${PRODUCT.name} is an independent prompt protection API for AI agents. We screen untrusted input, tool output, and agent handoffs before text gets authority over tools, memory, credentials, payments, or code execution.</p>
</div>

<section class="about-section">
  <h2>The problem we saw</h2>
  <p>AI agents are moving from demos to production. They read files, execute code, make API calls, query databases, and interact with users. Every one of those interactions is a trust boundary — a point where untrusted text can steer the agent toward actions its developers never intended.</p>
  <p>Prompt injection is the structural vulnerability that makes this dangerous. An LLM cannot reliably distinguish between its developer's instructions and data it processes. When an attacker hides instructions in a webpage, an email, or a tool response, the model treats them as commands. For an agent with tool access, that means credential exfiltration, unauthorized code execution, or data theft.</p>
  <p>We looked at the existing solutions and saw a gap: tools built for enterprise SOC teams, not for the developers and agencies actually building and deploying agents. No transparent pricing. No compliance mapping. No self-serve path. No implementation support.</p>
</section>

<section class="about-section">
  <h2>What we built</h2>
  <p>Parse is an API-first prompt protection service designed for the people building AI agents. Three endpoints cover the three trust boundaries in any agent system:</p>
  <ul>
    <li><strong>Input screening</strong> — <code>POST /v1/parse</code> screens untrusted text before it reaches the agent's LLM</li>
    <li><strong>Output screening</strong> — <code>POST /v1/screen-output</code> checks generated output before it reaches users, tools, or memory</li>
    <li><strong>Agent trust verification</strong> — <code>POST /v1/agent/trust/verify</code> validates identity and intent before accepting delegation from another agent</li>
  </ul>
  <p>Each endpoint runs a multi-layer detection pipeline: deterministic pattern matching with text normalization, structural risk analysis for encoded and hidden payloads, LLM semantic analysis, and optional sandbox execution. Every decision produces a structured result with risk categories, a score, and a recommended action.</p>

  <div class="about-stats">
    <div class="about-stat">
      <strong>${DETECTION_FACTS.riskCategoryCount}</strong>
      <span>Risk Categories</span>
    </div>
    <div class="about-stat">
      <strong>${DETECTION_FACTS.patternRuleCount}+</strong>
      <span>Pattern Rules</span>
    </div>
    <div class="about-stat">
      <strong>4</strong>
      <span>Detection Layers</span>
    </div>
    <div class="about-stat">
      <strong>3</strong>
      <span>Trust Boundaries</span>
    </div>
  </div>
</section>

<section class="about-section">
  <h2>How we think about security</h2>
  <p>We believe security tools should be honest about what they do and do not prevent. Parse reduces prompt injection risk. It does not eliminate it. We publish our limitations publicly because false confidence is more dangerous than documented gaps.</p>

  <div class="about-principles">
    <div class="about-principle">
      <h3>Screen before authority</h3>
      <p>The core principle: when untrusted text crosses a trust boundary, screen it before that text gets authority over tools, memory, credentials, payments, or user-visible output. Simple to state, hard to implement everywhere.</p>
    </div>
    <div class="about-principle">
      <h3>Behavioral detection beats pattern matching alone</h3>
      <p>Pattern libraries are finite; the space of attacks is not. Behavioral sandbox execution — testing what a prompt does, not just what it says — catches novel attacks that signature-based systems miss.</p>
    </div>
    <div class="about-principle">
      <h3>Compliance is a feature, not theater</h3>
      <p>Enterprise procurement blocks agent deployments when security and legal cannot approve them. Compliance evidence — audit logs, framework mapping, policy documentation — is what unblocks the deal. We built for that reality.</p>
    </div>
    <div class="about-principle">
      <h3>Independent and transparent</h3>
      <p>We are not a feature inside a larger platform. We are an independent API with published pricing, public documentation, and honest limitations. Developers can evaluate and integrate without a sales conversation.</p>
    </div>
    <div class="about-principle">
      <h3>Agent-native, not retrofitted</h3>
      <p>Parse was designed for agent boundaries from day one — input, output, and handoff. MCP server support, x402 pay-per-call access, and the three-endpoint API surface reflect agent-native thinking, not a chatbot moderation tool repurposed for agents.</p>
    </div>
  </div>
</section>

<section class="about-section">
  <h2>Who we serve</h2>
  <p>Parse is built for the people doing the work:</p>
  <ul>
    <li><strong>AI agencies and consultancies</strong> deploying custom agents for enterprise clients and needing compliance evidence to pass security review</li>
    <li><strong>Engineering teams</strong> building autonomous agents that process untrusted data from the web, documents, email, or tool APIs</li>
    <li><strong>Independent developers</strong> who want prompt protection without enterprise sales friction or vendor lock-in</li>
    <li><strong>Security teams</strong> evaluating agent deployments and needing audit evidence, policy enforcement, and risk visibility</li>
  </ul>
</section>

<div class="about-cta">
  <h2>See for yourself</h2>
  <p>Start with the free tier, explore the trust package, or request a demo.</p>
  <div class="about-cta-actions">
    <a href="/playground" class="btn btn-primary">Get started for free</a>
    <a href="/trust" class="btn btn-outline">Trust &amp; Security</a>
    <a href="/docs/quickstart" class="btn btn-outline">Install Parse</a>
  </div>
</div>
`;

  return renderPage({
    title: "About",
    description: `${PRODUCT.name} is an independent prompt protection API for AI agents. We screen untrusted input, tool output, and agent handoffs before text gets authority over tools, memory, or credentials.`,
    path: "/about",
    content,
    baseUrl,
    jsonLd: [
      organizationSchema(baseUrl),
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "About", url: `${baseUrl}/about` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "About", href: "/about" },
    ],
  });
}
