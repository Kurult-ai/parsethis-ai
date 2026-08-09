import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { DETECTION_FACTS } from "../lib/product-facts.js";

/**
 * Competitive Comparison / SEO Pages (Task 17.3)
 *
 * GET /compare/parse-vs-{lakera,laso-security,calypsoai,pangea,pillar-security}
 *
 * Each page is SEO-optimized with:
 *   - H1 title targeting the comparison search query
 *   - Structured comparison table (features, pricing model, deployment, target user)
 *   - JSON-LD schema for rich results
 *   - "Install Parse" CTA
 *
 * Competitive intelligence sourced from docs/positioning-brief.md.
 * Comparisons are factual and fair — no false claims about competitors.
 */

interface CompetitorProfile {
  slug: string;
  name: string;
  url: string;
  hq: string;
  founded: string;
  funding: string;
  coreProduct: string;
  pricingModel: string;
  deployment: string;
  targetUser: string;
  keyStrengths: string[];
  gapsParseAddresses: string[];
  metaDescription: string;
  introParagraph: string;
}

const COMPETITORS: Record<string, CompetitorProfile> = {
  lakera: {
    slug: "lakera",
    name: "Lakera",
    url: "https://lakera.ai",
    hq: "Zurich, Switzerland",
    founded: "2021",
    funding: "~$32M+ (Series A led by Atomico)",
    coreProduct:
      "Lakera Guard — real-time LLM/agent security API with prompt injection detection, jailbreak prevention, and data leakage protection. Also offers Workforce AI Security and Lakera Red (AI red teaming).",
    pricingModel:
      "Free community tier (10K requests/month, 8K token max). Enterprise: custom pricing via sales contact. No published per-request pricing.",
    deployment: "SaaS API. Enterprise self-hosted option available.",
    targetUser: "Fortune 500 platform teams and CISO offices. Enterprise-first.",
    keyStrengths: [
      "Gartner TRiSM vendor recognition",
      "Ultra-low latency real-time detection",
      "Strong research roots (ETH Zurich / aerospace security)",
      "EU data residency and GDPR compliance",
      "Notable enterprise clients (Dropbox, AWS, Asana)",
    ],
    gapsParseAddresses: [
      "Developer self-serve with published pricing ladder (Free to $999/mo) — no sales call required",
      "Agency/channel partner model for AI consultancies",
      "Compliance evidence packs with SHA-256 integrity hashes",
      "Implementation services ($3K–$15K done-for-you deployments)",
      "Agent registry with signed identity",
    ],
    metaDescription:
      "Parse vs Lakera: detailed comparison of prompt injection defense and agent security platforms. Compare pricing, deployment, compliance features, and target users.",
    introParagraph:
      "Lakera is a well-established enterprise LLM security company with strong research credentials and notable Fortune 500 clients. This comparison helps you decide which platform fits your needs based on pricing transparency, deployment model, compliance features, and target audience.",
  },
  "laso-security": {
    slug: "laso-security",
    name: "Lasso Security",
    url: "https://lasso.security",
    hq: "Tel Aviv, Israel / US",
    founded: "2023",
    funding: "~$12M+ (Gartner Cool Vendor 2024)",
    coreProduct:
      "Lasso Platform — enterprise AI agent security across four pillars: Discovery & AI-BOM, AI Security Posture Management, Automated AI Red Teaming (3,000+ attack library), and Runtime Enforcement.",
    pricingModel:
      "Not publicly listed. Sales-led enterprise pricing. Demo required for all tiers.",
    deployment: "Enterprise platform. Proxy/API/gateway layer integration.",
    targetUser: "Enterprise CISOs and security teams.",
    keyStrengths: [
      "Gartner Cool Vendor 2024 recognition",
      "Comprehensive 3,000+ attack library for red teaming",
      "AI-BOM (AI Bill of Materials) discovery",
      "Full lifecycle coverage (discover, assess, protect)",
      "NIST alignment and strong enterprise logo list",
    ],
    gapsParseAddresses: [
      "Developer self-serve with transparent pricing — no demo required",
      "Published pricing ladder from Free to $999/mo",
      "Agency/channel partner model",
      "Compliance evidence packs with signed receipts",
      "Implementation services for fast deployment",
      "Focused API-first screening (lighter-weight than a full platform)",
    ],
    metaDescription:
      "Parse vs Lasso Security: compare AI agent security platforms on pricing, features, deployment, and compliance. See which fits your team.",
    introParagraph:
      "Lasso Security is a venture-backed enterprise AI security platform with a strong Gartner Cool Vendor pedigree. This comparison helps you evaluate whether Lasso's comprehensive enterprise platform or Parse's developer-first, compliance-focused API is the right fit for your use case.",
  },
  calypsoai: {
    slug: "calypsoai",
    name: "CalypsoAI (F5 AI Guardrails)",
    url: "https://calypsoai.com",
    hq: "Tel Aviv / US (acquired by F5)",
    founded: "2020",
    funding: "Acquired by F5 (~2025-2026)",
    coreProduct:
      "Now part of F5 as 'F5 AI Guardrails.' Originally offered AI security testing, model validation, and red teaming. Now integrated into F5's enterprise networking and security stack.",
    pricingModel:
      "Enterprise custom pricing via F5. Not publicly listed as a standalone product.",
    deployment: "Integrated into F5's enterprise infrastructure stack.",
    targetUser: "F5's existing enterprise networking and security customers.",
    keyStrengths: [
      "Deep AI security testing and model validation heritage",
      "F5 enterprise distribution and support",
      "Integration with F5's existing security infrastructure",
      "Enterprise-grade reliability through F5's platform",
    ],
    gapsParseAddresses: [
      "Independent vendor — not tied to a networking infrastructure vendor",
      "Developer self-serve with published pricing",
      "Model-agnostic screening across all LLM providers",
      "Agency/channel partner model",
      "Compliance evidence packs and framework mapping",
      "Implementation services",
    ],
    metaDescription:
      "Parse vs CalypsoAI / F5 AI Guardrails: compare AI security platforms. Evaluate independence, pricing transparency, developer self-serve, and compliance features.",
    introParagraph:
      "CalypsoAI was acquired by F5 and rebranded as F5 AI Guardrails, integrating its capabilities into F5's enterprise networking stack. This comparison helps you weigh an infrastructure-vendor-bundled solution against an independent, developer-first API.",
  },
  pangea: {
    slug: "pangea",
    name: "Pangea",
    url: "https://pangea.cloud",
    hq: "Palo Alto, CA",
    founded: "2021",
    funding: "~$70M+ (Series B led by GV/Google Ventures with CrowdStrike strategic)",
    coreProduct:
      "Pangea AI Security Platform — AI Detection & Response (AIDR), AI Application Guardrails (Prompt Guard, Redact, Domain Intel, File Scan, Embargo, IP/URL Intel, Audit), and AI Red Teaming. Modular SDK approach.",
    pricingModel:
      "Developer SDK/API pricing with free tier. Per-call pricing for individual services. Enterprise custom for AIDR.",
    deployment: "SDK, gateway, browser plugin, or API integration.",
    targetUser: "Developers and enterprise security teams. Broad modular approach.",
    keyStrengths: [
      "Broadest modular guardrail SDK (pick and choose services)",
      "SOC 2 Type II and ISO 27001/27701 (targeted for Parse — in development)",
      "CrowdStrike strategic partnership for distribution",
      "Deep security research output (prompt injection taxonomy)",
      "Free tier with developer-friendly SDK",
    ],
    gapsParseAddresses: [
      "Compliance framework mapping with evidence packs (OWASP, NIST AI RMF, EU AI Act, ISO 42001)",
      "Agency/channel partner model for AI consultancies",
      "Implementation services ($3K–$15K done-for-you)",
      "Signed agent identity and delegation chains",
      "Focused agent-governance positioning vs platform sprawl (8+ services)",
      "Published pricing ladder for the full compliance stack",
    ],
    metaDescription:
      "Parse vs Pangea: compare AI security and prompt protection platforms. Evaluate compliance evidence, agency model, implementation services, and developer experience.",
    introParagraph:
      "Pangea (now rebranding as CrowdStrike + Pangea AIDR) is a well-funded, modular AI security SDK platform with strong certifications. This comparison helps you decide between Pangea's broad modular approach and Parse's focused, compliance-first agent governance API.",
  },
  "pillar-security": {
    slug: "pillar-security",
    name: "Pillar Security",
    url: "https://pillar.security",
    hq: "Tel Aviv, Israel / US",
    founded: "2023",
    funding: "~$10M+ (2026 Gartner Cool Vendor in AI Software Security)",
    coreProduct:
      "Pillar Platform — end-to-end AI agent lifecycle security: AI Discovery & Posture, Red Teaming & Attack Surface Exposure, Runtime Guardrails, Governance & Compliance. Publishes the SAIL 2.0 Framework for securing AI agents.",
    pricingModel:
      "Not publicly listed. Sales-led. Demo required for all access.",
    deployment: "Enterprise platform.",
    targetUser: "Enterprise CISOs, AppSec, SecOps/IR, GRC & compliance teams.",
    keyStrengths: [
      "2026 Gartner Cool Vendor in AI Software Security",
      "SAIL 2.0 Framework — public-facing security methodology",
      "MCP & tool security coverage (growing attack surface)",
      "Comprehensive ecosystem mapping (agents, endpoints, MCPs, gateways)",
      "Process-driven, methodology-backed approach",
    ],
    gapsParseAddresses: [
      "Developer self-serve — no demo or sales call required",
      "Published pricing ladder (Free to $999/mo)",
      "Agency/channel partner model",
      "Implementation services for fast deployment",
      "Compliance evidence packs with signed receipts and integrity hashes",
      "API-first focused screening (lighter-weight for agencies)",
    ],
    metaDescription:
      "Parse vs Pillar Security: compare AI agent security platforms on pricing, developer self-serve, compliance evidence, and implementation services.",
    introParagraph:
      "Pillar Security is a recognized enterprise AI security platform with a strong methodology (SAIL 2.0) and Gartner Cool Vendor status. This comparison helps you evaluate whether Pillar's comprehensive enterprise platform or Parse's developer-first, compliance-focused API better fits your needs.",
  },
};

function comparisonTable(competitor: CompetitorProfile): string {
  return `
<div class="table-wrapper">
  <table>
    <thead>
      <tr>
        <th>Dimension</th>
        <th>Parse</th>
        <th>${competitor.name}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Pricing Model</strong></td>
        <td>Published ladder: Free → $49 → $199 → $999/mo. No sales call at any tier.</td>
        <td>${competitor.pricingModel}</td>
      </tr>
      <tr>
        <td><strong>Deployment</strong></td>
        <td>REST API, hosted MCP endpoint, SDK. No infrastructure changes required.</td>
        <td>${competitor.deployment}</td>
      </tr>
      <tr>
        <td><strong>Target User</strong></td>
        <td>AI agencies, consultancies, mid-market CTOs, and developers building agents.</td>
        <td>${competitor.targetUser}</td>
      </tr>
      <tr>
        <td><strong>Developer Self-Serve</strong></td>
        <td><span class="badge badge-green">Yes — instant key generation</span></td>
        <td>Depends on tier — see competitor's pricing model above.</td>
      </tr>
      <tr>
        <td><strong>Compliance Evidence Packs</strong></td>
        <td><span class="badge badge-green">Yes — SHA-256 integrity hashes, signed receipts</span></td>
        <td>Not publicly documented as a core feature.</td>
      </tr>
      <tr>
        <td><strong>Agency / Partner Channel</strong></td>
        <td><span class="badge badge-green">Yes — implementation services &amp; multi-client management</span></td>
        <td>Not publicly offered.</td>
      </tr>
      <tr>
        <td><strong>Implementation Services</strong></td>
        <td><span class="badge badge-green">Yes — $3K–$15K done-for-you deployments</span></td>
        <td>Not publicly offered.</td>
      </tr>
      <tr>
        <td><strong>Agent Registry</strong></td>
        <td><span class="badge badge-green">Yes — signed identity, delegation chains</span></td>
        <td>Varies — check competitor's current feature set.</td>
      </tr>
      <tr>
        <td><strong>Model-Agnostic</strong></td>
        <td><span class="badge badge-green">Yes — any LLM provider</span></td>
        <td>Yes.</td>
      </tr>
      <tr>
        <td><strong>Detection Pipeline</strong></td>
        <td>Pattern matching (${DETECTION_FACTS.patternRuleCount}+ rules), LLM semantic analysis, sandbox execution, ${DETECTION_FACTS.riskCategoryCount} risk categories.</td>
        <td>${competitor.coreProduct}</td>
      </tr>
      <tr>
        <td><strong>MCP / x402 Native</strong></td>
        <td><span class="badge badge-green">Yes — hosted MCP endpoint + x402 micropayments</span></td>
        <td>Not publicly documented.</td>
      </tr>
      <tr>
        <td><strong>SIEM Forwarding</strong></td>
        <td><span class="badge badge-green">Yes — Splunk, Datadog, Elastic, Sentinel</span></td>
        <td>Yes.</td>
      </tr>
    </tbody>
  </table>
</div>`;
}

function renderComparePageHtml(competitor: CompetitorProfile, baseUrl: string): string {
  const parseStrengths = [
    "Published pricing ladder (Free → $49 → $199 → $999/mo) with no sales call at any tier",
    "Compliance evidence packs with SHA-256 integrity hashes and signed receipts",
    "Agency/channel partner model with implementation services ($3K–$15K)",
    "Developer self-serve with instant API key generation — no email required for free tier",
    "API-first screening with hosted MCP endpoint and x402 micropayment support",
    "Agent registry with signed identity and delegation chains",
    "Model-agnostic — works across all LLM providers (OpenAI, Anthropic, Google, open-source)",
  ];

  const strengthsList = competitor.keyStrengths.map((s) => `<li>${s}</li>`).join("");
  const gapsList = competitor.gapsParseAddresses.map((g) => `<li>${g}</li>`).join("");
  const parseStrengthsList = parseStrengths.map((s) => `<li>${s}</li>`).join("");

  const jsonLd = [
    organizationSchema(baseUrl),
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `What is the difference between Parse and ${competitor.name}?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Parse is a developer-first, compliance-focused agent governance API with published pricing (Free to $999/mo). ${competitor.name} is ${competitor.coreProduct.toLowerCase().split(".")[0]}. Parse differentiates through transparent pricing, compliance evidence packs, agency/channel model, and implementation services.`,
          },
        },
        {
          "@type": "Question",
          name: `Is Parse cheaper than ${competitor.name}?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Parse publishes all pricing: Free tier, Pro ($49/mo), Team ($199/mo), and Compliance ($999/mo). ${competitor.name}'s pricing is ${competitor.pricingModel.toLowerCase()}. Parse's free tier requires no credit card and no email.`,
          },
        },
        {
          "@type": "Question",
          name: `Does Parse have features that ${competitor.name} doesn't?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `Parse offers compliance evidence packs with SHA-256 integrity hashes, agency/channel partner model, implementation services ($3K-$15K), and published pricing across all tiers. These are not commonly found in competitor platforms.`,
          },
        },
      ],
    },
  ];

  const content = `
<p class="answer-capsule">${competitor.introParagraph}</p>

<h2>Quick Comparison</h2>
${comparisonTable(competitor)}

<h2>${competitor.name} Strengths</h2>
<p class="answer-capsule">${competitor.name} is a strong product with notable capabilities:</p>
<ul>
${strengthsList}
</ul>

<h2>Where Parse Differs</h2>
<p class="answer-capsule">Parse occupies a unique position in the AI agent security market. Here's what Parse offers that complements or goes beyond what ${competitor.name} provides:</p>
<ul>
${gapsList}
</ul>

<h2>Parse's Core Differentiators</h2>
<ul>
${parseStrengthsList}
</ul>

<h2>When to Choose Parse vs ${competitor.name}</h2>

<h3>Choose ${competitor.name} if you:</h3>
<ul>
${competitor.keyStrengths.map((s) => `<li>${s}</li>`).join("")}
</ul>

<h3>Choose Parse if you:</h3>
<ul>
  <li>Want to start screening prompts in under 5 minutes with no sales calls</li>
  <li>Need compliance evidence packs mapped to OWASP, NIST AI RMF, EU AI Act, and ISO 42001</li>
  <li>Are an AI agency or consultancy that needs a partner channel and implementation services</li>
  <li>Prefer transparent, published pricing at every tier</li>
  <li>Want a focused API-first screening layer rather than a full enterprise platform</li>
  <li>Need agent registry with signed identity and delegation chains</li>
</ul>

<div style="margin:32px 0;text-align:center;padding:28px;border:2px solid var(--accent);border-radius:12px;background:linear-gradient(135deg,var(--accent-dim),var(--surface));">
  <h2 style="margin-top:0;color:var(--text);">Start screening in 60 seconds</h2>
  <p style="color:var(--text-dim);margin-bottom:20px;">Get a free API key — no credit card, no email required. Copy a code snippet and make your first call.</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
    <a href="/get-started" class="btn btn-primary">Install Parse</a>
    <a href="/demo" class="btn btn-outline">Try the Live Demo</a>
    <a href="/pricing" class="btn btn-ghost">See Pricing</a>
  </div>
</div>

<h2>Competitor Details</h2>
<div class="table-wrapper">
  <table>
    <tbody>
      <tr><td><strong>Company</strong></td><td>${competitor.name}</td></tr>
      <tr><td><strong>Website</strong></td><td><a href="${competitor.url}" rel="nofollow noopener">${competitor.url}</a></td></tr>
      <tr><td><strong>Headquarters</strong></td><td>${competitor.hq}</td></tr>
      <tr><td><strong>Founded</strong></td><td>${competitor.founded}</td></tr>
      <tr><td><strong>Funding</strong></td><td>${competitor.funding}</td></tr>
      <tr><td><strong>Core Product</strong></td><td>${competitor.coreProduct}</td></tr>
    </tbody>
  </table>
</div>

<p class="answer-capsule" style="margin-top:24px;font-size:13px;color:var(--text-soft);">
  Competitor information is based on publicly available data as of August 2026 and may change.
  This comparison is provided for informational purposes. We recommend evaluating both platforms directly.
  ${competitor.name} is a trademark of its respective owner; Parse is an independent product and is not affiliated with ${competitor.name}.
</p>

<h2>Other Comparisons</h2>
<ul>
  <li><a href="/compare/parse-vs-lakera">Parse vs Lakera</a></li>
  <li><a href="/compare/parse-vs-laso-security">Parse vs Lasso Security</a></li>
  <li><a href="/compare/parse-vs-calypsoai">Parse vs CalypsoAI (F5 AI Guardrails)</a></li>
  <li><a href="/compare/parse-vs-pangea">Parse vs Pangea</a></li>
  <li><a href="/compare/parse-vs-pillar-security">Parse vs Pillar Security</a></li>
</ul>
`;

  return renderPage({
    title: `Parse vs ${competitor.name}`,
    description: competitor.metaDescription,
    path: `/compare/parse-vs-${competitor.slug}`,
    content,
    baseUrl,
    jsonLd,
    breadcrumbs: [
      { name: "Parse", href: "/" },
      { name: "Compare", href: "/compare/prompt-injection-tools" },
      { name: `Parse vs ${competitor.name}`, href: `/compare/parse-vs-${competitor.slug}` },
    ],
  });
}

/**
 * Render a comparison page by competitor slug.
 * Returns null if the slug doesn't match a known competitor.
 */
export function renderCompetitorComparePage(
  slug: string,
  baseUrl: string,
): string | null {
  const competitor = COMPETITORS[slug];
  if (!competitor) return null;
  return renderComparePageHtml(competitor, baseUrl);
}

/**
 * Get the list of valid comparison slugs.
 */
export function getComparisonSlugs(): string[] {
  return Object.keys(COMPETITORS);
}
