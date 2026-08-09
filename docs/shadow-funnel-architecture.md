---
title: "Parse Shadow Funnel Capture Architecture"
description: "SEO-driven content system that captures demand from search queries about agent security, prompt injection, and compliance — feeding the Parse funnel autonomously."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse"
status: "Active"
---

# Parse Shadow Funnel Capture Architecture

> **Task 18.3 — Shadow Funnel Capture**

The "shadow funnel" (per Russell Brunson's *Traffic Secrets*) is the demand that exists outside your owned channels — on Google, X, GitHub, Reddit, Stack Overflow, AI directories. This architecture captures that demand and routes it into the Parse funnel with zero manual touchpoints.

---

## 1. The Shadow Funnel Concept

Most of your potential customers don't know Parse exists. But they ARE searching for:
- "How to protect AI agent from prompt injection"
- "Prompt injection defense API"
- "Agent security compliance"
- "Lakera alternative"
- "OWASP LLM Top 10 controls"

The shadow funnel intercepts these searches with content, tools, and listings, then funnels them to parsethis.ai.

```
Search Query → [Shadow Funnel Content] → parsethis.ai → /get-started → API key → Paid tier
```

---

## 2. Capture Layers

### Layer 1: SEO Content Pages (Owned)

**Already deployed:**
- `/prompt-injection-protection-api` — GEO page
- `/prompt-firewall-api` — GEO page
- `/llm-output-screening-api` — GEO page
- `/agent-trust-verification-api` — GEO page
- `/compare/lakera` — comparison page
- `/compare/azure-prompt-shield` — comparison page
- `/docs/risk-categories` — educational content

**New pages needed (Task 17.3 — assigned to subagent):**
- `/compare/parse-vs-laso-security`
- `/compare/parse-vs-calypsoai`
- `/compare/parse-vs-pangea`
- `/compare/parse-vs-pillar-security`

**Target keywords (from Dream 100 research):**

| Keyword | Search Intent | Target Page | Monthly Volume (est) |
|---------|--------------|-------------|---------------------|
| prompt injection protection | Commercial | /prompt-injection-protection-api | 500-1K |
| prompt injection defense | Informational | Blog post | 300-500 |
| AI agent security | Commercial | Landing page | 1K-2K |
| LLM output screening | Commercial | /llm-output-screening-api | 100-300 |
| agent governance | Informational | Landing page | 200-500 |
| OWASP LLM Top 10 | Informational | Blog post | 2K-5K |
| Lakera alternative | Commercial | /compare/lakera | 50-100 |
| prompt injection API | Commercial | /prompt-firewall-api | 100-300 |
| agent compliance | Commercial | Landing page | 100-300 |
| MCP security | Informational | /mcp-prompt-protection-server | 100-300 |

### Layer 2: Programmatic SEO (Automated)

Use the existing GEO (Generative Engine Optimization) infrastructure:

**Pages auto-generated from `GEO_TASK_PHRASES` (in product-facts.ts):**
```
/prompt-protection-api-for-ai-agents
/prompt-injection-protection-api
/prompt-firewall-api
/prompt-risk-scoring-api
/llm-output-screening-api
/agent-trust-verification-api
/sandboxed-prompt-analysis
/x402-prompt-protection-api
/mcp-prompt-protection-server
```

**Technical implementation:**
- Each phrase generates a dedicated page with:
  - H1 matching the search query
  - Structured content explaining the concept
  - Parse API documentation for that specific capability
  - "Install Parse" CTA
  - JSON-LD schema for rich snippets
  - Internal linking to related GEO pages

### Layer 3: External Listings (Earned)

**AI/LLM directories and registries:**

| Platform | Listing Type | Status |
|----------|-------------|--------|
| MCP registry (modelcontextprotocol.io) | MCP server | ✅ Live |
| mcp.so | MCP server directory | Needs submission |
| smithery.ai | MCP server directory | Needs submission |
| glama.ai | MCP server directory | Needs submission |
| OpenRouter tools | Tool integration | Evaluate |
| Product Hunt | Launch | Planned |
| Hacker News (Show HN) | Community post | Planned |
| Awesome LLM Security (GitHub) | Awesome list | Needs PR |
| OWASP LLM Top 10 resources | Reference | Needs submission |

**Automated by discovery monitor (Task 17.5 ✅):**
The `discovery_monitor.py` cron already checks that Parse is listed on mcp.so, smithery.ai, and glama.ai every 6 hours. When a new registry appears, it flags for manual submission.

### Layer 4: Community Presence (Social)

**X/Twitter (primary platform — per Traffic Secrets one-platform rule):**
- Daily posts: injection examples, detection demos, compliance tips
- Thread format: Hook → Story → Offer
- Engage with Dream 100 accounts (reply with value, don't pitch)
- Share GitHub issues/fixes as content

**GitHub:**
- Open-source Parse MCP server and prompt-guard packages
- Documentation issues welcome
- Code examples in README
- Link from awesome-lists

**Reddit (supplementary):**
- r/LocalLLaMA — agent security discussions
- r/MachineLearning — research-level content
- r/cybersecurity — compliance angle
- No direct promotion — value-first engagement

### Layer 5: Developer Documentation (Inbound)

**Already live:**
- `/docs/quickstart` — 6 agent runtime install prompts
- `/docs/overview` — full API overview
- `/docs/compliance-guide` — compliance setup
- `/docs/risk-categories` — detection taxonomy
- `/docs/guides/screen-tool-results` — tutorial
- `/docs/guides/rag-prompt-injection-screening` — tutorial

**Content gaps to fill:**
- "How to protect your agent from indirect prompt injection" (blog)
- "OWASP LLM Top 10: A practical guide for agent developers" (blog)
- "Setting up SIEM forwarding for AI agents" (guide)
- "Evidence packs: How to prepare for your AI compliance audit" (guide)

---

## 3. Capture → Conversion Flow

```
                    SHADOW FUNNEL CAPTURE
                    ════════════════════
                    
Google Search ──→ GEO Page ──→ parsethis.ai ──→ /get-started
    │                                          
    ├──→ /demo (try without signup)
    │
    ├──→ /pricing (see tiers)
    │
    └──→ /docs/quickstart (self-serve install)

                    CONVERSION TRACKING
                    ══════════════════
    
Every entry point tracked via:
- Funnel events (funnel.ts): discovery_hit → pricing_view → signup → first_call
- UTM capture (attribution.ts): source, medium, campaign
- Activation tracker: key generation, first API call
- Analytics dashboard: conversion rates per stage
```

### Attribution Chain

1. Visitor arrives via Google → GEO page (UTM captured if present, organic if not)
2. Visitor explores → landing, demo, pricing (funnel events fire)
3. Visitor generates API key → signup funnel event + attribution recorded
4. Visitor makes first API call → first_call funnel event
5. Visitor upgrades → checkout_started → checkout_completed

---

## 4. Content Production Pipeline

### Automated Content

| Content Type | Source | Frequency | Distribution |
|-------------|--------|-----------|-------------|
| Detection stats | Screening metrics DB | Weekly | X thread, blog |
| New pattern discoveries | Screening event log | As discovered | X post, docs update |
| Registry growth | Agent registry | Monthly | Dashboard, blog |
| Compliance mapping updates | Policy engine | Quarterly | Docs, blog |

### Semi-Automated Content (LLM-Assisted)

| Content Type | Trigger | Production | Distribution |
|-------------|---------|-----------|-------------|
| Dream 100 engagement | Trending topic in Dream 100 | LLM drafts reply/thread → human review → post | X |
| Competitor comparison | Competitor releases feature | LLM researches → updates comparison page | SEO pages |
| Injection research | New attack vector discovered | LLM analyzes → creates test case + blog post | Blog, X, docs |
| Nurture email content | Funnel drop-off detected | LLM drafts targeted email → human review → send | Email |

### Manual Content (High-Value)

| Content Type | Frequency | Owner |
|-------------|-----------|-------|
| Deep-dive blog post | Bi-weekly | Content + engineering |
| Conference talk | Quarterly | Founder |
| Customer case study | Per customer win | Marketing |
| Whitepaper / framework | Quarterly | Founder + compliance |

---

## 5. Dream 100 Engagement Protocol

From the Dream 100 list (docs/dream-100.md), engagement follows this protocol:

### Tier 1: Core 20 (Weekly Engagement)

| Activity | Frequency | Example |
|----------|-----------|---------|
| Reply to their posts with technical value | 3-5x/week per person | "Great point on indirect injection. We see the same pattern in our screening logs — here's the detection breakdown" |
| Share their content with added insight | 1-2x/week | Quote tweet their thread + add Parse's perspective |
| Build something useful for them | Monthly | Create an integration, share a tool, write analysis they'd value |
| DM when you have something genuinely useful | Rarely (1x/month max) | "Built this MCP server that catches the injection pattern you posted about. Thought you'd find it interesting." |

### Tier 2: Extended 80 (Bi-Weekly Engagement)
- Reply to posts 1x/week
- Share content 2x/month
- Build value before asking for anything

### Rules
1. **Never pitch in cold replies.** Add value or move on.
2. **Technical credibility > marketing.** Show, don't tell.
3. **One platform: X/Twitter.** Don't spread thin.
4. **Track engagement in a spreadsheet** — who you've engaged with, what they responded to, what value you've provided.

---

## 6. Technical Infrastructure

### SEO Pages
- Server-side rendered (SSR) for crawlability
- JSON-LD schema on every page
- Sitemap.xml auto-generated (existing)
- robots.txt allows all crawlers (existing)
- Canonical URLs set on all pages (existing)

### Content Management
- Blog: Markdown in `content/blog/` (existing)
- GEO pages: Code-generated in `src/pages/` (existing)
- Docs: Markdown in `docs/` (existing)

### Analytics
- GA4: Traffic source, landing page, conversion (Task 15.5 ✅)
- Funnel tracker: Stage-by-stage conversion (Task 14.3 — in progress)
- Attribution: UTM + referral tracking (Task 17.4 — in progress)
- Discovery monitor: Registry health (Task 17.5 ✅)

---

## 7. Implementation Status

| Component | Status |
|-----------|--------|
| GEO pages (9) | ✅ Live |
| Comparison pages (existing 5) | ✅ Live |
| Comparison pages (new 5) | 🔄 Subagent building (Task 17.3) |
| Blog infrastructure | ✅ Live |
| Discovery monitor cron | ✅ Live |
| Dream 100 list | ✅ Complete |
| GA4 analytics | ✅ Live |
| Funnel tracker | ✅ Code exists, dashboard in progress |
| Attribution / UTM | 🔄 Subagent building |
| MCP registry listing | ✅ Live |
| mcp.so / smithery.ai / glama.ai | ⏳ Needs submission |
| Product Hunt launch | ⏳ Planned |
| Content production pipeline | 🔄 This document defines the framework |
| Developer self-serve (/get-started) | 🔄 Subagent building (Task 17.1) |
| Public demo (/demo) | 🔄 Subagent building (Task 17.2) |

---

## 8. Success Metrics

| Metric | Month 1 | Month 3 | Month 6 |
|--------|---------|---------|---------|
| Organic search traffic | 100 visits/mo | 500 visits/mo | 2K visits/mo |
| GEO page rankings | Top 50 | Top 20 | Top 10 |
| Demo page conversion | 5% | 10% | 15% |
| Dream 100 engagement rate | 10% | 25% | 40% |
| API keys from organic search | 5 | 25 | 100 |
| Paid conversions from organic | 1 | 5 | 20 |
| MCP directory referrals | 10 | 50 | 200 |
