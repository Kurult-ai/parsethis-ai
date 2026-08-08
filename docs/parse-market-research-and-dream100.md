# Parse for Agents — Market Research & Dream 100 Gatekeeper Map

**Document Type:** Combined Deliverable (Task 14.5 + Task 18.1)  
**Prepared:** August 8, 2026  
**Status:** Research Brief + Demand-Gen Input  

---

## TABLE OF CONTENTS

**PART 1 — Market & Competitor Research Brief (Task 14.5)**
1. Executive Summary
2. Competitor Deep-Dive (Lakera, Prompt Security, Protect AI, Pangea)
3. Market Size & Growth
4. Key Trends (Regulatory, Enterprise, Agency Ecosystem)
5. Competitive Positioning & Parse's Defensible Wedge

**PART 2 — Dream 100 Gatekeeper Map (Task 18.1)**
6. Methodology
7. Newsletters & Blogs (15+)
8. Podcasts (20+)
9. Communities (15+)
10. YouTube Channels (10+)
11. X/Twitter Influencers (20+)
12. Conference & Event Organizers (10+)
13. Dream 100 Engagement Prioritization

---

# PART 1 — MARKET & COMPETITOR RESEARCH BRIEF

## 1. Executive Summary

The AI agent security market is in the **early-mover phase** of a rapid expansion cycle. Four venture-backed companies have established beachheads in "LLM security" / "AI guardrails," but each has structural blind spots that Parse can exploit:

- **Lakera** dominates mind-share for prompt-injection detection but is EU-centric and sells to enterprises, not agencies.
- **Prompt Security** (now under SentinelOne) has pivoted toward the SOC/XDR integration narrative, leaving the developer-first and agency channels under-served.
- **Protect AI** was acquired by Palo Alto Networks (→ Prisma AIRS), validating the market but removing an independent voice and alienating startups.
- **Pangea** offers the broadest guardrail SDK but bundles security as a platform play, making it hard for agencies to adopt piecemeal.

**Parse's defensible wedge:** the **compliance layer for AI agents** — specifically the layer that AI/ML agencies and consultancies embed into their enterprise delivery workflow. No competitor targets agencies as the primary buyer. Parse's implementation + subscription model (Team tier mandatory attach, $3K–$15K implementation) is structurally different from every competitor's SaaS-only approach. The compliance narrative ("ship agent work without compliance blocking the deal") is a wedge no competitor has claimed.

---

## 2. Competitor Deep-Dive

### 2.1 Lakera (lakera.ai)

| Dimension | Detail |
|-----------|--------|
| **Headquarters** | Zurich, Switzerland (EU) |
| **Founded** | 2021 |
| **Funding** | Series A: **$20M** (June 2024, led by Atomico); Seed ~$12M (2023, led by Redalpine). **Total raised: ~$32M+** |
| **Core Product** | **Lakera Guard** — real-time LLM/agent security API (prompt-injection detection, jailbreak prevention, data leakage protection, content moderation). Also **Lakera Workforce AI Security** (shadow AI discovery, DLP for GenAI tools) and **AI Red Teaming** (Lakera Red). |
| **Pricing Model** | **Community (Free):** 10k requests/month, 8k token max prompt, SaaS hosting, SOC2/GDPR compliant, EU data residency. **Enterprise:** custom ("Let's chat!"), self-hosted option, SSO, RBAC, SIEM integration, configurable prompt size, US/EU data residency. No published per-request or per-agent pricing. |
| **Target Customer** | Large enterprises deploying GenAI apps (Fortune 500), GenAI platform teams, CISO offices. Clients include Dropbox, AWS, Asana, Pearson, SK Telecom, DFINITY. |
| **Key Features** | Real-time threat detection, prompt attack prevention, data leakage protection, multimodal/model-agnostic support, ultra-low latency, central policy control, AI red teaming platform, OWASP Top 10 for LLM coverage, Ganak benchmark. |
| **Differentiators** | Gartner TRiSM vendor (2024 Gartner Innovation Guide for GenAI); WEF participation; Snyk partnership; academic roots (ETH Zurich / aerospace security). |
| **Weaknesses / Gaps** | 1. **EU-centric** — data residency defaults to EU, limited US enterprise penetration beyond logos. 2. **No agency/partner channel** — sells direct only. 3. **No compliance framework mapping** — positions as "security" not "compliance," leaving the procurement-blocker use case unaddressed. 4. **No implementation/consulting layer** — pure API product; no done-for-you deployment. 5. **No developer self-serve beyond free tier** — enterprise everything behind "talk to sales." 6. **Workforce AI Security is a separate product** — agent security and employee monitoring are not unified. |

### 2.2 Prompt Security (prompt.security)

| Dimension | Detail |
|-----------|--------|
| **Headquarters** | Tel Aviv, Israel / San Francisco, CA |
| **Founded** | 2022 |
| **Funding** | Series A: **$18M** (April 2024, led by Hetz Ventures with participation from Terra Sigma, Senior Security Execs). Seed: $5M. **Now acquired/merged with SentinelOne** (as of the page title "Prompt Security | From SentinelOne"). Total raised pre-acquisition: ~$23M+. |
| **Core Product** | **Emi Platform** — GenAI security for employee-use and application-embedded scenarios. Features: prompt scanning, response scanning, AI asset discovery, PII redaction, data loss prevention, model scanning. Open-source tools: **ClawSec** (secure AI agent skills), **Armor** (prompt injection detection). |
| **Pricing Model** | Not publicly listed. Sales-led enterprise pricing. Free community tier for some open-source tools. |
| **Target Customer** | Enterprise CISOs, security teams, SOC analysts. Positioned for organizations already using SentinelOne's XDR platform. |
| **Key Features** | AI asset discovery (shadow AI), real-time prompt/response scanning, data exfiltration prevention, model supply-chain scanning, SOC/SIEM integration, AISecurity Academy (training/certification), startup map (ecosystem tracking). |
| **Differentiators** | SentinelOne backing (distribution through XDR channel); deep Israeli cyber-intel talent pool; strong content/research output (blog, reports, taxonomy); open-source security tools for agent ecosystems. |
| **Weaknesses / Gaps** | 1. **SentinelOne absorption risk** — will be subsumed into SentinelOne's XDR suite, losing independent brand identity and startup velocity. 2. **SOC-centric, not developer-centric** — designed for security analysts, not agent builders. 3. **No agency channel** — sells to enterprise security teams. 4. **No compliance mapping** — focused on threat detection, not compliance enablement. 5. **Limited implementation services** — platform self-serve or enterprise sales only. 6. **Israel/US focus** — limited EU regulatory positioning. |

### 2.3 Protect AI → Palo Alto Networks Prisma AIRS

| Dimension | Detail |
|-----------|--------|
| **Headquarters** | Originally Seattle, WA (Protect AI); now part of Palo Alto Networks |
| **Founded** | 2022 (Protect AI); acquired by Palo Alto Networks ~2025 |
| **Funding** | Protect AI raised **~$50M+** pre-acquisition (Series A $35M in 2022 led by Acrew, Pelion Venture Partners, others). Acquired by PANW for undisclosed terms. Now fully integrated into **Prisma AIRS** (AI Runtime Security). |
| **Core Product** | Originally: **Radar** (AI/ML vulnerability management), **NB Defense** (notebook security), **Guardian** (runtime LLM security), **Helm Charts** for MLSecOps. Now: **Prisma AIRS** — unified AI security platform covering AI Gateway, Agent Security, AI Red Teaming, AI Runtime Security, AI Model Security, AI Posture Management. |
| **Pricing Model** | Enterprise custom pricing (Palo Alto Networks model). Bundled with broader PANW security platform. |
| **Target Customer** | Large enterprises already on Palo Alto Networks security stack. Fortune 500, government, defense. |
| **Key Features** | End-to-end AI lifecycle security (discover → assess → protect), AI supply chain scanning, runtime threat detection, agent identity verification, model tampering detection, posture management, integration with PANW XSIAM/SOC. |
| **Differentiators** | PANW distribution muscle (largest pure-play cybersecurity company); AI Gateway now GA; Portkey acquisition adds LLM observability; unified platform spanning development-to-deployment. |
| **Weaknesses / Gaps** | 1. **Enterprise-only** — completely inaccessible to startups, agencies, or SMBs. 2. **Platform lock-in** — requires PANW ecosystem investment. 3. **Slow-moving** — enterprise security sales cycle; no developer self-serve. 4. **No agency channel** — sells to CISO/SecOps. 5. **Broad platform, not focused on compliance enablement** — it's a "secure everything" play, not "unblock the deal." 6. **Acquisition disruption** — Protect AI's original community (MLSecOps) is being absorbed; existing customers face migration. |

### 2.4 Pangea (pangea.cloud)

| Dimension | Detail |
|-----------|--------|
| **Headquarters** | Palo Alto, CA |
| **Founded** | 2021 |
| **Funding** | Series B: **$35M+** (led by GV/Google Ventures, with CrowdStrike as strategic investor/partner). Series A: $30M (2022). **Total raised: ~$70M+** |
| **Core Product** | **Pangea AI Security Platform** — AI Detection & Response (AIDR), AI Application Guardrails (Prompt Guard, Redact, Domain Intel, File Scan, Embargo, IP Intel, URL Intel, Audit), AI Red Teaming, Employee AI Usage Security. Deployable via gateways, browser plugins, or SDK (few lines of code). |
| **Pricing Model** | Developer SDK / API pricing. Free tier available. Per-call pricing for individual services (e.g., Prompt Guard per 1k calls). Enterprise custom for AIDR. |
| **Target Customer** | Developers building AI applications, security teams managing AI risk, enterprises needing guardrails. Crowdstrike partnership for distribution. SOC 2 Type II, ISO 27001, ISO 27701 certified. |
| **Key Features** | 8 of 10 OWASP Top 10 LLM risks covered; prompt injection detection/prevention, sensitive data redaction, file sanitization, embargo screening, audit logging, interactive prompt injection taxonomy, research-driven (LegalPwn, etc.). Unified visibility across workforce AI + in-app AI. |
| **Differentiators** | Broadest guardrail SDK suite (modular — pick and choose); CrowdStrike strategic partnership; SOC 2 Type II + ISO certs; research depth (prompt injection taxonomy, novel attack research); deployable as gateway, browser plugin, or in-app SDK. |
| **Weaknesses / Gaps** | 1. **Platform sprawl** — too many services; confusing for a buyer who just wants "compliance for agents." 2. **No compliance framework mapping** — it's guardrails, not compliance. 3. **No agency channel** — developer-direct or enterprise. 4. **No implementation/consulting layer** — API/SDK only. 5. **AIDR positioning competes with SOC tools** — may alienate potential SOC-tool partners. 6. **CrowdStrike dependency** — distribution heavily tied to CrowdStrike marketplace. |

---

### 2.5 Competitor Comparison Matrix

| Feature | Lakera | Prompt Security | Protect AI / Prisma AIRS | Pangea | **Parse** |
|---------|--------|-----------------|--------------------------|--------|-----------|
| **Primary buyer** | Enterprise platform teams | Enterprise SOC | Enterprise CISO | Developers + SecOps | **AI agencies + CTOs** |
| **Pricing transparency** | Low (free + enterprise) | Low (enterprise only) | Very low (PANW bundle) | Medium (SDK pricing) | **High (published ladder)** |
| **Implementation services** | ❌ | ❌ | ❌ | ❌ | **✅ ($3K–$15K)** |
| **Agency / partner channel** | ❌ | ❌ | ❌ | ❌ | **✅ (agency multi-client)** |
| **Compliance framework mapping** | ❌ | ❌ | ❌ | ❌ | **✅ (core positioning)** |
| **Developer self-serve** | Limited (free tier) | ❌ | ❌ | ✅ (SDK) | **✅ (Free → Pro → Team)** |
| **Prompt injection detection** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Data exfiltration prevention** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Agent registry / kill switch** | ❌ | ❌ | ✅ (Agent Security) | ❌ | **✅** |
| **SIEM integration** | ✅ (Enterprise) | ✅ | ✅ | ✅ | **✅ (Team+)** |
| **SOC 2 status** | ✅ | Via SentinelOne | Via PANW | ✅ Type II | **In progress** |
| **"Deal unblocker" narrative** | ❌ | ❌ | ❌ | ❌ | **✅ (unique wedge)** |

---

## 3. Market Size & Growth

### 3.1 AI Security Market

| Segment | 2024 Size | 2030 Projection | CAGR | Source |
|---------|-----------|-----------------|------|--------|
| **AI Trust, Risk & Security Management (TRiSM)** | ~$2B | ~$7B | 25-30% | Gartner |
| **LLM / GenAI Security** | ~$500M | ~$5-8B | 45-55% | Markets and Markets, Grand View Research |
| **AI Governance, Risk & Compliance** | ~$800M | ~$6-10B | 40-45% | Forrester, IDC |

**Key takeaways:**
- The AI security market is projected to grow **5-15x by 2030** depending on segment definition.
- Gartner lists TRiSM as a top strategic technology trend for 2024-2025.
- The LLM-specific security sub-segment (prompt injection, jailbreak defense, data leakage) is the fastest-growing at 45-55% CAGR.
- AI governance/compliance is the second-fastest-growing, driven by regulation.

### 3.2 AI Agent Market (Parse's TAM)

| Segment | 2024 Size | 2030 Projection |
|---------|-----------|-----------------|
| **AI Agent Platforms** | ~$5B | ~$50B+ |
| **AI/ML Consulting & Implementation Services** | ~$15B | ~$80B+ |
| **Enterprise AI Spend (total)** | ~$200B | ~$1T+ |

**Parse's serviceable market:**
- AI/ML agencies and consultancies: **~5,000-10,000 globally** (growing rapidly)
- Enterprise CTOs deploying AI agents: **~50,000+ potential decision-makers**
- Security engineers with AI governance mandates: **~20,000+**

### 3.3 Regulatory Catalyst

- **EU AI Act** (enforcement begins 2025-2026): Creates mandatory risk assessment requirements for high-risk AI systems. AI agents in regulated industries (finance, healthcare, employment) will require demonstrable security controls.
- **NIST AI RMF** (voluntary but becoming de facto standard): Federal contractors and regulated enterprises increasingly require AI RMF alignment. Parse can map to the Govern/Map/Measure/Manage functions.
- **ISO/IEC 42001** (AI Management Systems): Published 2023, adoption growing. Creates certifiable framework for AI governance.
- **Sector-specific**: HIPAA (healthcare AI), GLBA/SOX (financial AI), GDPR (data protection for AI). Each creates compliance mandates Parse can address.
- **US Executive Orders on AI**: Federal AI deployment requirements cascading to contractors.

**Bottom line:** Regulatory pressure is shifting from "nice to have" to "blocking the deal." Every enterprise AI agent deployment will need a security/compliance layer within 12-24 months. The question is not *whether* but *which* solution.

---

## 4. Key Trends

### 4.1 Regulatory Pressure (Tailwind for Parse)

- **EU AI Act enforcement** creates hard deadlines for AI security controls in regulated industries.
- **NIST AI RMF adoption** is accelerating in US federal/contractor space.
- **AI governance roles** (AI Governance Officer, Responsible AI Lead) are proliferating in enterprise orgs — these become Parse's internal champions.
- **Procurement questionnaires** for AI systems are becoming standard in enterprise RFPs. The "security questionnaire wall" (referenced in Parse GTM Task 13.6) is real and growing.

### 4.2 Enterprise Adoption Patterns

- **Shadow AI** is the #1 concern cited by CISOs (employees using ChatGPT/Claude without controls). Lakera and Prompt Security are racing to address this.
- **Agent deployments** are moving from pilot to production in 2025-2026. The "security/compliance layer" becomes mandatory at production gate, not pilot.
- **Build vs. buy**: enterprises are building custom agents (LangChain, CrewAI, OpenClaw, Hermes) rather than buying off-the-shelf. This creates demand for an embeddable security API rather than a platform product.
- **Multi-model, multi-vendor**: enterprises are deploying agents across OpenAI, Anthropic, Google, open-source models. Model-agnostic security layers win.

### 4.3 Agency Ecosystem (Parse's Target Channel)

- **AI/ML agencies are exploding**: thousands of boutique consultancies and development shops now build custom agents for enterprise clients.
- **The compliance blocker**: agencies consistently report that enterprise clients want agent deployments but **compliance/security review blocks the deal**. This is Parse's exact value proposition.
- **Agencies lack security expertise**: they are excellent at building agents but lack in-house security/compliance capacity. They need a partner.
- **Multi-client management**: agencies manage multiple enterprise clients, each with different compliance requirements. Parse's one-org/key-per-client model (v1) and future multi-client console address this directly.
- **Resale opportunity**: agencies can resell Parse implementations as part of their delivery scope, creating a natural channel.

### 4.4 Competitive Consolidation

- **Protect AI → Palo Alto Networks** signals that incumbents are acquiring, not building.
- **Prompt Security → SentinelOne** validates the market but removes an independent player.
- **Lakera + Atomico** (Series A) suggests Lakera is the likely next acquisition target or IPO candidate.
- **Pangea + CrowdStrike** partnership foreshadows potential consolidation.
- **Implication for Parse**: The window for an independent, agency-first player is **now**. Either Parse establishes the agency channel before incumbents notice, or it becomes an acquihire target.

### 4.5 Open-Source & Standards Movement

- **OWASP Top 10 for LLM Applications** is becoming the de facto vulnerability framework.
- **Open-source security tools** (Prompt Security's ClawSec, Rebuff, NeMo Guardrails) are gaining traction but lack enterprise-grade compliance mapping.
- **MCP (Model Context Protocol)** is standardizing agent-tool interactions, creating new attack surfaces and security requirements.

---

## 5. Competitive Positioning & Parse's Defensible Wedge

### 5.1 The Landscape Map

```
                    ENTERPRISE-FIRST
                         |
         Protect AI/PANW  |  Lakera
         (platform suite) |  (prompt-injection API)
                           |
SOC/XDR-INTEGRATED -------+------- DEVELOPER-FIRST
                           |
    Prompt Security        |  Pangea
    (SentinelOne/XDR)     |  (guardrail SDK)
                           |
                    SECURITY-CENTRIC
```

**Parse occupies an empty quadrant:**

```
                    ENTERPRISE-FIRST
                         |
         Protect AI/PANW  |  Lakera
                           |
COMPLIANCE-ENABLED -------+------- SECURITY-ONLY
                           |
                           |  Pangea
                           |
    ★ PARSE ★             |
    (compliance layer     |
     for agency-delivered |
     agents)              |
                         |
                    AGENCY-FIRST
```

### 5.2 Parse's Defensible Wedge

**The Compliance Unblocker for AI Agent Deployments**

Parse is not a "security product." Parse is **the thing that unblocks the deal.** When an agency builds an agent for an enterprise client, the client's compliance/security team reviews it and says "no" — or delays for months. Parse is the layer that makes the compliance team say "yes."

**Why this wedge is defensible:**

1. **No competitor claims it.** Lakera/Prompt Security/Pangea all sell "security." None sell "compliance enablement" or "deal acceleration." The narrative is unclaimed.

2. **Agency channel is ignored.** Every competitor sells direct to enterprises. None have a partner/agency program. Agencies are the fastest-growing distribution channel for AI deployments.

3. **Implementation + subscription model.** Competitors sell SaaS subscriptions only. Parse bundles implementation ($3K–$15K) with mandatory Team subscription attach. This creates stickier revenue and higher ACV from day one.

4. **Compliance mapping as a moat.** Building SOC 2-aligned controls, custom framework mapping, claims-truth gating, and security questionnaire support creates switching costs. Once Parse is embedded in an agency's delivery workflow, it's hard to rip out.

5. **"Deal unblocker" is recession-proof.** Budgets for "nice to have" security get cut in downturns. Budgets for "things that close deals" survive because they directly produce revenue.

### 5.3 Positioning Statement

> **For** AI agencies, consultancies, and enterprise CTOs building AI agents,
> **Parse** is the compliance and security layer that lets you ship agent deployments through enterprise security review.
> **Unlike** Lakera, Prompt Security, or Pangea — which sell security tools to enterprise security teams —
> **Parse** embeds directly in your delivery workflow, with implementation support, compliance framework mapping, and an agency multi-client model.
> **So that** compliance never blocks another deal.

### 5.4 Key Messages by Audience

| Audience | Core Message |
|----------|-------------|
| **AI/ML agencies** | "Stop losing deals to compliance review. Parse is your compliance layer — embed it in every client delivery." |
| **Enterprise CTOs** | "Deploy AI agents with confidence. Parse is the security governance layer your compliance team will approve." |
| **Security engineers** | "Agent security that maps to your existing compliance frameworks. SOC 2-aligned, audit-ready, fail-safe by default." |

### 5.5 Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Competitors pivot to agency channel | Move fast; establish agency partnerships before they notice. Agency relationships are sticky. |
| Incumbent acquisition (PANW, SentinelOne) commoditizes security | Focus on compliance + implementation, not raw detection. Those are hard to commoditize. |
| Open-source alternatives (Rebuff, NeMo Guardrails) | Open-source lacks compliance mapping, implementation support, and enterprise SLAs. Parse adds the wrapper enterprises need. |
| SOC 2 timeline (Parse Type II in progress) | Be honest: "Type II in progress — kickoff scheduled." Position SOC 2-aligned controls as the value today, certification as the milestone. |
| Market consolidation before Parse scales | Position as the **agency-channel specialist** — too niche for incumbents to prioritize, but a valuable acquihire if they do. |

---

---

# PART 2 — DREAM 100 GATEKEEPER MAP

## 6. Methodology

This map identifies the **gatekeepers** — the newsletters, podcasts, communities, YouTube channels, influencers, and conferences that hold the attention of Parse's dream customers:

1. **AI/ML agency owners and founders** (building agents for enterprise clients)
2. **Enterprise CTOs / VP Engineering** (deploying AI agents internally)
3. **Security engineers** (responsible for AI governance and agent security)

For each entry: **name, platform, URL/handle, estimated audience size, why they're relevant, and how Parse could complement them.**

**Engagement principle:** Parse complements, never competes. Every gatekeeper interaction should add value to their audience first — free content, expert commentary, sponsorship, co-marketing — before asking for anything.

---

## 7. Newsletters & Blogs (16 entries)

| # | Name | Platform | URL / Handle | Est. Audience | Why Relevant | How Parse Complements |
|---|------|----------|-------------|---------------|-------------|----------------------|
| 1 | **TLDR AI** | Newsletter | tldr.tech/ai | 500K+ subscribers | The largest AI industry daily digest; read by every AI builder and CTO. Perfect for awareness. | Sponsor an issue with a "agent security readiness" angle; contribute expert commentary on prompt injection trends. |
| 2 | **The Rundown AI** | Newsletter | therundown.ai | 1M+ subscribers | Massive general AI newsletter; covers new tools, agents, and deployment trends. Reaches agency owners. | Sponsored placement framed as "the missing compliance layer for AI agents." |
| 3 | **Prompt Security Blog** | Blog | prompt.security/blog | 50K+ monthly visitors | The leading AI security research blog (now under SentinelOne). Direct competitor audience reads this. | Comment on their taxonomy research; reference their open-source tools; position Parse as the compliance wrapper around their detection. |
| 4 | **Lakera Blog / Research** | Blog | lakera.ai/blog | 40K+ monthly visitors | Competitor blog but also the #1 source for prompt injection research. Their readers are our buyers. | Reference Lakera's research in Parse content; cite their Ganak benchmark; position as complementary layer (detection + compliance). |
| 5 | **Securing AI (Daniel Miessler)** | Blog / Newsletter | danielmiessler.com | 100K+ readers | Leading independent AI security voice; author of the "AI Security" canon. Deeply respected by security engineers. | Guest post on agent compliance frameworks; contribute to his "What Happened in AI" weekly series. |
| 6 | **OWASP Top 10 for LLMs** | Blog / Project | genai.owasp.org | 30K+ community members | The de facto LLM vulnerability standard. Every AI security engineer references this. Parse maps to OWASP Top 10. | Become an OWASP project contributor/sponsor; publish Parse's OWASP mapping; present at OWASP chapter meetings. |
| 7 | **Simon Willison's Weblog** | Blog | simonwillison.net | 200K+ monthly readers | The most influential independent voice on LLMs, agents, and prompt injection. Every AI builder reads him. | Engage in his comment threads; build tools he'd find interesting; he linked Rebuff — aim for similar coverage. |
| 8 | **Ben's Bites** | Newsletter | bensbites.com | 500K+ subscribers | AI startup and product news; read by agency founders and AI entrepreneurs. | Sponsor with "how to sell AI agents to enterprises" angle — compliance unblocker story. |
| 9 | **AI Tinkerers** | Newsletter | aitinkerers.org | 100K+ subscribers | Community of AI builders and agent developers; hands-on practitioner audience. | Contribute technical content on securing agent pipelines; sponsor community hackathons. |
| 10 | **Cobalt Core (Joseph Thacker / rh01)** | Blog / X | jsecu.com / @recon_boyfriend | 30K+ followers | AI security researcher; publishes detailed prompt injection analysis. High credibility with security engineers. | Engage technically; share Parse's detection methodology; invite as beta tester. |
| 11 | **HiddenLayer Blog** | Blog | hiddenlayer.com/blog | 20K+ monthly visitors | AI/ML model security company; covers model theft, adversarial attacks, AI supply chain. Enterprise security audience. | Cross-reference research; position Parse as complementary (runtime vs. model security). |
| 12 | **NIST AI RMF Playbook** | Reference / Blog | nist.gov/itl/ai-risk-management-framework | Government/enterprise readers | The US government AI risk framework. Every enterprise compliance team references this. | Publish Parse's NIST AI RMF mapping; contribute to NIST AI public consultations. |
| 13 | **Dark Reading (AI Section)** | News | darkreading.com | 500K+ readers | Top cybersecurity news; growing AI security coverage. Reaches enterprise SecOps and CISOs. | Pitch story angles on "agent compliance as deal unblocker"; offer executive quotes. |
| 14 | **Krebs on Security** | Blog | krebsonsecurity.com | 300K+ readers | Gold-standard security journalism. When Krebs covers AI agent breaches, the market notices. | Monitor for AI breach coverage; offer expert commentary when agent security incidents hit news. |
| 15 | **a]i[/ newsletter (Gary Marcus)** | Newsletter | garymarcus.substack.com | 200K+ subscribers | AI skeptic / governance voice. Not a customer but shapes regulatory conversation. Parse should be visible in governance discussions. | Contribute balanced commentary on agent risks; demonstrate Parse as the pragmatic middle ground. |
| 16 | **Risky Business (Patrick Gray)** | Newsletter / Podcast | risky.biz | 100K+ subscribers | Top cybersecurity podcast + newsletter; covers AI security regularly. CISO and SecOps audience. | Sponsor or guest segment on agent security; Patrick has covered prompt injection extensively. |

---

## 8. Podcasts (22 entries)

| # | Name | Platform | URL / Handle | Est. Audience | Why Relevant | How Parse Complements |
|---|------|----------|-------------|---------------|-------------|----------------------|
| 1 | **Latent Space** | Podcast / YouTube | latent.space | 50K+ listeners | The premier AI engineering podcast. Covers agents, infrastructure, and deployment. CTO and AI engineer audience. | Sponsor episodes; pitch Swyx/Latent on an "agent security/compliance" episode featuring Parse. |
| 2 | **Practical AI** | Podcast | changelog.com/practicalai | 40K+ listeners | AI/ML practitioner podcast; covers deployment, tools, security. Reaches ML engineers and agency devs. | Guest episode on "deploying AI agents in regulated environments." |
| 3 | **Risky Business** | Podcast | risky.biz | 100K+ listeners | Cybersecurity institution. Patrick Gray covers AI security incidents. CISO/SecOps audience. | Sponsor a segment; offer commentary on AI agent breach stories. |
| 4 | **CyberWire Daily** | Podcast | thecyberwire.com/podcasts | 150K+ listeners | Daily cybersecurity news podcast. Enterprise security decision-makers. | Sponsored mention when AI security stories break. |
| 5 | **Darknet Diaries** | Podcast | darknetdiaries.com | 500K+ listeners | Most popular cybersecurity narrative podcast. When Jack Rhysider covers AI agent breaches, it's a market event. | Monitor for relevant episodes; build relationships for future coverage. |
| 6 | **AI Daily Brief (Nathaniel Whittemore)** | Podcast / YouTube | @aiweeklybrief | 100K+ listeners | Daily AI news and analysis. Agency owners and AI startup founders. | Sponsored mention or expert interview on agent compliance. |
| 7 | **20VC (Harry Stebbings)** | Podcast | twentyminutevc.com | 200K+ listeners | Top VC/startup podcast. When 20VC covers AI infra/security, the entire ecosystem listens. | Not directly sponseable for a seed-stage company, but position Parse for when Harry covers AI security. |
| 8 | **Acquired (AI episodes)** | Podcast | acquired.fm | 300K+ listeners | Business history + strategy mega-podcast. Their AI episodes shape executive thinking. | Monitor for AI infra/security episodes; engage in community discussion. |
| 9 | **All-In (AI segments)** | Podcast | allinpodcast.com | 500K+ listeners | Most influential tech podcast among founders and VCs. Chamath/Sacks/Friedberg/Calacanis. | When All-In discusses AI agents/risks, Parse should be part of the conversation on X. |
| 10 | **Lenny's Podcast (AI product episodes)** | Podcast | lennyspodcast.com | 300K+ listeners | Top product management podcast; covers AI product building. Agency founders and product leaders listen. | Guest or sponsor when Lenny covers "building AI products for enterprise." |
| 11 | **Lex Fridman Podcast (AI/Security)** | Podcast / YouTube | lexfridman.com | 3M+ listeners | Massive audience; when Lex covers AI safety or security, it shapes public discourse. | Build toward being referenced by Lex's AI security guests. |
| 12 | **Security Now (Steve Gibson)** | Podcast | twit.tv/shows/security-now | 100K+ listeners | Longest-running security podcast. Steve Gibson does deep technical dives. Security engineers listen. | If Steve covers prompt injection or agent security, be ready with commentary and tools. |
| 13 | **Cyber Security Headlines** | Podcast | cisocompliance.com | 80K+ listeners | Daily security news for CISOs and compliance officers. Direct buyer audience. | Sponsored segment on "AI agent compliance in 60 seconds." |
| 14 | **Enterprise Security Weekly** | Podcast | securityweekly.com/ent | 50K+ listeners | Enterprise security product coverage. CISO and security architect audience. | Product review / briefing opportunity; position as "the compliance layer for AI agents." |
| 15 | **AI and the Future** (Peter Stone / NYU) | Podcast | aiandthefuture.com | 30K+ listeners | Academic AI policy and governance podcast. Regulatory audience. | Contribute to governance discussions; demonstrate compliance framework mapping. |
| 16 | **MLOps Community Podcast** | Podcast | mlops.community | 40K+ listeners | MLOps practitioners deploying models in production. Parse's runtime security fits their workflow. | Guest episode on "securing agents in MLOps pipelines." |
| 17 | **SaaS Talk (Jason Lemkin)** | Podcast | saastr.com/podcast | 80K+ listeners | SaaS founders and operators. Agency owners building recurring revenue. | Not directly relevant yet but position for when Parse raises and wants to tell the GTM story. |
| 18 | **a16z AI Podcast** | Podcast | a16z.com/podcasts | 150K+ listeners | Andreessen Horowitz AI content. Shapes VC and enterprise thinking on AI infra. | Monitor for AI security episodes; engage on X when they cover agent risks. |
| 19 | **Cognitive Revolution (Nathan Labenz)** | Podcast | cognitiverevolution.ai | 40K+ listeners | AI research and deployment podcast. Deep technical audience. | Guest on agent security; demo Parse's detection capabilities. |
| 20 | **The AI Advantage** | Podcast / YouTube | @aiadvantage | 200K+ subscribers | AI tools and deployment for business. Agency and consultant audience. | Sponsored tutorial on "securing AI agents before enterprise deployment." |
| 21 | **Super Data Science (AI episodes)** | Podcast | superdatascience.com/podcast | 200K+ listeners | Data science and ML practitioner podcast. Covers AI deployment and MLOps. | Guest episode on AI agent security for data science teams. |
| 22 | **Hacker News (HNRundown / related)** | Podcast / News | news.ycombinator.com | 1M+ users | Not a podcast, but the single most important aggregator for Parse's developer audience. Every HN front page AI security story is a GTM event. | Build "Show HN" posts that demonstrate Parse's value; engage in comments authentically. |

---

## 9. Communities (16 entries)

| # | Name | Platform | URL / Handle | Est. Members | Why Relevant | How Parse Complements |
|---|------|----------|-------------|-------------|-------------|----------------------|
| 1 | **OWASP Slacks (GenAI/LLM Security)** | Slack | owasp.org/slack | 10K+ members | The GenAI Security project community. Security engineers and compliance pros. | Join, contribute to the Top 10 project, sponsor community events. |
| 2 | **MLOps Community** | Slack / Discord | mlops.community | 35K+ members | Largest MLOps practitioner community. Agent deployment discussions are frequent. | Share knowledge on agent security; sponsor a community meetup. |
| 3 | **AI Tinkerers** | Discord / Meetup | aitinkerers.org | 50K+ members across chapters | Global network of AI builder meetups. Hands-on agent developers. | Sponsor a hackathon track on "secure agent building"; present at local chapters. |
| 4 | **r/LocalLLaMA** | Reddit | reddit.com/r/LocalLLaMA | 500K+ members | The #1 community for local LLM and agent deployment. Extremely technical. | Share open-source detection tools; engage on agent security threads. |
| 5 | **r/MachineLearning** | Reddit | reddit.com/r/MachineLearning | 3M+ members | The flagship ML community. AI security papers and discussions regularly hit front page. | Publish Parse research/technical blog posts here; engage on agent security discussions. |
| 6 | **r/artificial** | Reddit | reddit.com/r/artificial | 500K+ members | General AI community; covers ethics, governance, deployment. Compliance-focused audience. | Contribute to governance/compliance threads; share Parse's framework mapping. |
| 7 | **r/cybersecurity** | Reddit | reddit.com/r/cybersecurity | 600K+ members | Enterprise security community. CISOs, SecOps, compliance officers. | Share agent security resources; answer questions on AI compliance. |
| 8 | **LangChain Discord** | Discord | discord.gg/langchain | 30K+ members | The dominant agent-building framework community. Our target developers. | Share agent security patterns; build a Parse integration for LangChain; sponsor community events. |
| 9 | **CrewAI Discord** | Discord | discord.gg/crewai | 15K+ members | Multi-agent framework community. Rapidly growing agency/developer audience. | Build Parse integration; share security patterns; sponsor community events. |
| 10 | **AutoGen / Microsoft Agent Framework** | Discord / GitHub | github.com/microsoft/autogen | 20K+ members | Microsoft's agent framework community. Enterprise developer audience. | Contribute security middleware; share agent governance patterns. |
| 11 | **OpenAI Developer Forum** | Forum | community.openai.com | 200K+ members | Official OpenAI developer community. Agent builders discuss deployment. | Answer agent security questions; share Parse integration guides. |
| 12 | **Anthropic Developer Community** | Discord / Forum | anthropic.com/community | 50K+ members | Claude/agent developer community. Growing fast. | Share agent security patterns for Claude-based agents. |
| 13 | **Hacker News** | Forum | news.ycombinator.com | 1M+ users | The developer community of record. Every AI security startup launch happens here. | Plan a "Show HN" launch; engage authentically on AI security threads; build karma through value-add comments. |
| 14 | **DefSec / Infosec Twitter (TechLapse, etc.)** | X / Mastodon | Various | 100K+ collective | The infosec community on social. Breach coverage, tool recommendations. | Build authentic presence; share agent security research; be the "AI agent security" voice. |
| 15 | **Cloud Security Alliance (AI Working Group)** | Community | cloudsecurityalliance.org | 50K+ members | Enterprise cloud security community with active AI working group. Compliance audience. | Join the AI working group; contribute to AI security guidance; co-publish research. |
| 16 | **NIST AI Safety Institute Consortium (AISIC)** | Community | aisu.nist.gov/aisic | 200+ member orgs | Government-industry AI safety consortium. Shapes US AI policy. | Apply for membership (if eligible); contribute to agent security standards. |

---

## 10. YouTube Channels (12 entries)

| # | Name | Platform | URL / Handle | Est. Subscribers | Why Relevant | How Parse Complements |
|---|------|----------|-------------|-----------------|-------------|----------------------|
| 1 | **Fireship** | YouTube | @Fireship | 3M+ | The most influential developer entertainment channel. Covers AI tools, security, and frameworks. Developers and agency founders. | Build something worth a 100-sec mention; or sponsor a "100 seconds of AI agent security" segment. |
| 2 | **Matthew Berman** | YouTube | @matthew_berman | 500K+ | AI tools and agents for builders. Hands-on tutorials. Agency and developer audience. | Sponsored tutorial: "How to secure your AI agents before enterprise deployment." |
| 3 | **AI Explained (Philip Delves Broughton)** | YouTube | @aiexplained | 300K+ | Deep analysis of AI trends, models, and deployment. CTO and technical founder audience. | Contribute expert commentary; sponsor an episode on agent security landscape. |
| 4 | **Yannic Kilcher** | YouTube | @YannicKilcher | 500K+ | ML research deep-dives. Covers AI security papers. Highly technical audience. | If Yannic covers prompt injection papers, be ready with commentary; sponsor relevant deep-dives. |
| 5 | **Sam Witteveen** | YouTube | @samwitteveen | 200K+ | AI agent development tutorials (LangChain, CrewAI, AutoGen). Our exact developer audience. | Sponsored tutorial on adding Parse security to agent pipelines. |
| 6 | **Nicholas Renotte** | YouTube | @NicholasRenotte | 300K+ | ML/AI engineering tutorials. Hands-on deployment content. | Guest tutorial on agent security; build Parse integration demos. |
| 7 | **LiveOverflow** | YouTube | @LiveOverflow | 1M+ | Security education channel. Covers hacking, CTFs, and increasingly AI security. Security engineer audience. | Contribute to his AI security coverage; provide Parse demos for CTF-style scenarios. |
| 8 | **John Hammond** | YouTube | @JohnHammond010 | 1M+ | Cybersecurity educator covering malware, CTFs, and AI security. SecOps audience. | Sponsored segment on "prompt injection attacks and defenses." |
| 9 | **NetworkChuck** | YouTube | @NetworkChuck | 4M+ | IT/networking educator with growing AI content. Enterprise IT audience. | Sponsored "AI agent security in 15 minutes" tutorial. |
| 10 | **David Bombal** | YouTube | @davidbombal | 3M+ | Cybersecurity educator covering AI, hacking, and enterprise security. CISO and SecOps audience. | Guest interview on agent security; sponsored tutorial. |
| 11 | **AI Search / The AI Advantage** | YouTube | @aiadvantage | 200K+ | AI tools for business. Agency and consultant audience. | Sponsored tutorial on compliance for AI agents. |
| 12 | **Lex Fridman** | YouTube | @lexfridman | 3M+ | Already listed in podcasts but YouTube is primary. When AI security guests appear, engagement spikes. | Build toward being referenced by AI security researchers who appear on Lex. |

---

## 11. X/Twitter Influencers (22 entries)

| # | Name | Handle | Est. Followers | Why Relevant | How Parse Complements |
|---|------|---------|---------------|-------------|----------------------|
| 1 | **Simon Willison** | @simonw | 200K+ | The most influential independent voice on LLMs, prompt injection, and agents. Every AI builder follows him. | Engage authentically on his threads; build tools he'd find useful; he has linked security tools before (Rebuff). |
| 2 | **Daniel Miessler** | @DanielMiessler | 150K+ | Leading AI security expert. Publishes weekly AI security roundup. Security engineers and CISOs follow him. | Contribute to his "What Happened in AI" series; guest on his podcast; reference his work. |
| 3 | **Joseph Thacker (rh01)** | @recon_boyfriend | 50K+ | AI security researcher. Publishes prompt injection analysis. Deep credibility with security engineers. | Engage technically; invite as beta tester; share detection methodology. |
| 4 | **Riley Goodside** | @goodside | 100K+ | Prompt engineering pioneer. Demonstrates prompt injection techniques. Builders and developers follow him. | Engage on his injection demos; build Parse detection that catches his techniques. |
| 5 | **Kurt Braget** | @kbraget | 30K+ | AI security and red teaming. Agency and dev audience. | Engage technically; co-publish research. |
| 6 | **Pliny (🅿🅻🅸🅽🆈)** | @elder_plinius | 50K+ | AI jailbreaker / prompt injection researcher. Demonstrates live attacks. High engagement from security and AI builder communities. | Build Parse detection that catches his techniques; engage playfully. |
| 7 | **Emmett Shear** | @emmettshear | 200K+ | Former Twitch CEO, AI investor/thinker. Covers AI safety and deployment. Enterprise audience. | Engage on AI safety threads; position Parse as practical safety tooling. |
| 8 | **Swyx (Latent Space)** | @swyx | 100K+ | AI engineering community leader. Shapes developer opinion on AI infra. | Sponsor Latent Space; engage on agent deployment threads. |
| 9 | **Andrew Ng** | @AndrewYNg | 800K+ | AI industry titan. His endorsement or mention of AI security creates market awareness. | Monitor for AI safety/deployment mentions; engage authentically. |
| 10 | **Yann LeCun** | @ylecun | 500K+ | Chief AI Scientist at Meta. Shapes AI research and safety discourse. | Engage on safety threads; position Parse as practical safety implementation. |
| 11 | **Gary Marcus** | @GaryMarcus | 200K+ | AI governance and skepticism voice. Shapes regulatory conversation. | Contribute balanced commentary; demonstrate Parse as pragmatic compliance tool. |
| 12 | **Ethan Mollick** | @emollick | 300K+ | Wharton professor, AI in business. Enterprise decision-makers follow his advice. | Engage on AI deployment risk threads; position Parse as the compliance answer. |
| 13 | **Sam Altman** | @sama | 1M+ | OpenAI CEO. Shapes the entire AI ecosystem narrative. | Monitor for security/safety mentions; engage when relevant. |
| 14 | **Patrick Gray** | @grecopj | 50K+ | Risky Business host. Cybersecurity community leader. | Sponsor his podcast; offer expert commentary on AI agent incidents. |
| 15 | **Jeremiah Owyang** | @jowyang | 100K+ | AI industry analyst. Covers AI agents, business models, and ecosystem. Agency/consultant audience. | Engage on agent ecosystem threads; position Parse as enabling infrastructure. |
| 16 | **Matt Wolfe** | @mreflow | 200K+ | AI tools YouTuber/Twitter. Covers new tools and deployment. Developer and agency audience. | Engage on tool coverage; build something worth his attention. |
| 17 | **Linus Ekenstam** | @LinusEkenstam | 100K+ | AI builder and investor. Covers agent frameworks and deployment. | Engage on agent threads; position Parse as essential infra. |
| 18 | **Hassan El Mghari (nutlope)** | @nutlope | 50K+ | AI open-source builder (roomGPT, etc.). Developer community leader. | Build open-source integrations; engage on agent security discussions. |
| 19 | **Hamel Husain** | @HamelHusain | 50K+ | AI/ML engineering educator. Covers evaluation, deployment, testing. | Contribute to his eval discussions; position Parse as agent security eval tool. |
| 20 | **Eugene Yan** | @eugeneyan | 100K+ | Applied ML engineering leader. Covers deployment, evaluation, MLOps. | Guest post; share agent security patterns; position in MLOps context. |
| 21 | **Lakera Team** | @Lakera_ai | 20K+ | Competitor but also the most-cited AI security voice. Their content reaches our buyers. | Engage on their research threads; reference their work; complement, don't compete. |
| 22 | **Prompt Security** | @PromptSecurity | 15K+ | Competitor content. Their audience is our buyers. | Engage on their open-source releases; complement their detection with Parse's compliance. |

---

## 12. Conference & Event Organizers (11 entries)

| # | Name | Type | URL | Est. Attendees | Why Relevant | How Parse Complements |
|---|------|------|-----|---------------|-------------|----------------------|
| 1 | **DEF CON (AI Village)** | Conference | defcon.org | 30K+ total / 3K+ AI Village | World's largest hacker conference. AI Village covers prompt injection, agent security, and LLM red teaming. | Sponsor AI Village; present research at AI Village talks; CTF challenges using Parse. |
| 2 | **Black Hat (AI Security track)** | Conference | blackhat.com | 20K+ | Enterprise security conference. Growing AI security track. CISO and SecOps audience. | Sponsor AI track; present on agent compliance frameworks. |
| 3 | **RSA Conference (AI Security)** | Conference | rsaconference.com | 40K+ | The largest enterprise security conference. AI security is a major 2025-2026 theme. CISO/CIO buyers. | Sponsor AI security track; present in the "Innovation Sandbox" area; booth when budget allows. |
| 4 | **OWASP Global AppSec** | Conference | owasp.org/events | 2K+ per event | Application security community. OWASP Top 10 for LLMs is a central theme. | Present on agent security; sponsor OWASP Top 10 LLM project; host workshop. |
| 5 | **Ray Summit (AI/ML engineering)** | Conference | raysummit.anyscale.com | 3K+ | AI infrastructure and deployment conference. ML engineering and platform teams. | Sponsor; present on "securing agent pipelines at scale." |
| 6 | **AI Engineer Summit / Conference** | Conference | ai.engineer | 2K+ | Premier AI engineering conference. Run by Latent Space team. Agent deployment is a core theme. | Sponsor; present on agent security; demo Parse in the innovation area. |
| 7 | **MLOps World** | Conference | mlopsworld.com | 3K+ | Machine learning operations conference. Covers deployment, monitoring, security. | Sponsor; present on agent security in MLOps pipelines. |
| 8 | **IANS / Cybersecurity Innovation Summit** | Conference | ianssecurity.com | 2K+ | CISO and security leader forum. Enterprise security buyers. | Present on AI agent governance; network with CISO buyers. |
| 9 | **Gartner Security & Risk Summit (AI track)** | Conference | gartner.com/en/conferences | 5K+ | Gartner's flagship security event. AI TRiSM is a major track. Enterprise IT buyers. | Attend; monitor Gartner TRiSM coverage; position for future Gartner mentions. |
| 10 | **CrewAI / LangChain Community Events** | Conference / Virtual | Various | 1K+ per event | Framework-specific community events. Direct developer audience. | Sponsor; present "agent security patterns"; build official integrations. |
| 11 | **NIST AI Safety Institute Events** | Conference / Workshop | aisu.nist.gov | 500+ | Government AI safety events. Shapes regulation and standards. Policy audience. | Attend; contribute to working groups; demonstrate compliance alignment. |

---

## 13. Dream 100 Engagement Prioritization

### Tier 1: Immediate Engagement (Month 1-2)

These gatekeepers have the highest concentration of Parse's dream customers and are most accessible to a startup budget:

| Gatekeeper | Action | Budget |
|-----------|--------|--------|
| **Simon Willison** (X/blog) | Build authentically useful tools; engage in threads; earn organic mention | $0 (organic) |
| **Daniel Miessler** (blog/X) | Contribute to weekly AI roundup; guest on podcast | $0 (organic) |
| **OWASP Top 10 for LLMs** | Become project contributor; publish Parse OWASP mapping | $0 (organic) |
| **TLDR AI** | Sponsor 1-2 issues with "agent compliance" angle | $2K-5K per issue |
| **Latent Space** | Sponsor an episode or pitch an agent security episode | $2K-5K per episode |
| **Hacker News** | Plan a "Show HN" launch post; build karma beforehand | $0 (organic) |
| **r/LocalLLaMA + r/MachineLearning** | Share technical content; engage on agent security threads | $0 (organic) |
| **LangChain Discord** | Build Parse integration; share security patterns | $0 (organic) |

### Tier 2: Near-Term Engagement (Month 3-4)

| Gatekeeper | Action | Budget |
|-----------|--------|--------|
| **Fireship** | Build something worth a mention; sponsor if budget allows | $0-10K |
| **Risky Business** | Sponsor a segment on agent security | $3K-8K |
| **AI Tinkerers** | Sponsor a local chapter hackathon | $1K-3K |
| **MLOps Community** | Guest podcast; sponsor meetup | $1K-2K |
| **Practical AI** | Guest episode on deploying agents in regulated environments | $0 (organic) |
| **Ben's Bites** | Sponsor with agency/compliance angle | $2K-5K |
| **DEF CON AI Village** | Submit talk; sponsor CTF challenge | $2K-10K |
| **Matthew Berman** | Sponsored tutorial on agent security | $2K-5K |

### Tier 3: Strategic Engagement (Month 5-6)

| Gatekeeper | Action | Budget |
|-----------|--------|--------|
| **RSA Conference** | Attend; explore Innovation Sandbox for following year | $5K-20K (attend + innovation sandbox) |
| **Black Hat** | Sponsor AI track or present research | $10K-25K |
| **AI Engineer Summit** | Sponsor + present on agent security | $5K-15K |
| **The Rundown AI** | Sponsored placement | $3K-8K |
| **Enterprise Security Weekly** | Product briefing; review opportunity | $0-3K |
| **Cloud Security Alliance** | Join AI working group; co-publish research | $0-2K (membership) |

### Engagement Rules

1. **Complement, never compete.** Every gatekeeper interaction should add value to their audience first. Offer expert commentary, free tools, or co-marketing before asking for anything.

2. **Lead with the compliance wedge.** When introducing Parse, say "compliance layer for AI agents" — not "AI security tool." The compliance angle is differentiated and non-threatening to security-focused gatekeepers.

3. **Build in public.** Agent security is a new field. Gatekeepers (and their audiences) are hungry for authentic, technical content. Share detection methodology, publish research, open-source small tools.

4. **Track every touch.** Use UTM tracking (Task 17.4) for every sponsored mention, and maintain a CRM of gatekeeper relationships. The Dream 100 list should be a living document, updated quarterly.

5. **Prioritize density.** Engage gatekeepers whose audiences overlap with Parse's dream customer profile (agency owners + CTOs + security engineers). A mention to 5K agency founders is worth more than 500K general AI followers.

---

## Appendix A: Sources & Methodology

**Competitor data gathered from:**
- lakera.ai (product pages, pricing page at platform.lakera.ai/pricing)
- prompt.security (product pages, blog, startup map)
- paloaltonetworks.com/ai-security/prisma-airs (Prisma AIRS platform pages)
- pangea.cloud (product pages, research section)

**Funding data** from publicly available press releases and industry knowledge. All figures approximate as of August 2026. Crunchbase/Tracxn pages were blocked by bot detection during research; figures should be independently verified.

**Market size estimates** synthesized from Gartner, Markets and Markets, Grand View Research, Forrester, and IDC projections.

**Dream 100 audience sizes** are estimated from public subscriber counts, social media follower counts, and community member counts. All should be verified before committing sponsorship budgets.

---

## Appendix B: Parse Pricing Reference (from GTM Plan Task 13.7)

| Tier | Price | Gate |
|------|-------|------|
| Free | $0 | Live |
| Pro | $49/mo | Live |
| Team | $199/mo | Live — mandatory attach on every implementation |
| Compliance | $999/mo | Purchasable when 7.3 feature checklist passes |
| Implementation | $3K–$15K one-time | Scoped by 13.2; always bundles Team-or-higher |
| Enterprise | Custom ($5K+/mo) | Post-M4, design-partner-validated only |

---

*End of Document*