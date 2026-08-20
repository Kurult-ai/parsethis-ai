---
title: "Parse $47 Self-Serve Security Audit — Product Spec"
description: "Value ladder entry product: automated AI agent security audit for $47 one-time."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse"
status: "Active"
---

# $47 Self-Serve Agent Security Audit

> **Task 18.5 — Value Ladder Rung**

The $47 audit is the bottom-of-funnel self-serve product that qualifies serious buyers before they talk to sales. It's not a revenue play — it's a lead qualification and trust-building tool.

---

## Product Definition

### What It Is
An automated, one-time security audit of a customer's AI agent setup. The customer provides:
1. Their agent's system prompt (sanitized)
2. A sample of inputs the agent processes (URLs, text samples, tool descriptions)
3. Their LLM provider (OpenAI, Anthropic, Google, etc.)

Parse returns a detailed security report with:
- **Risk profile** — What attack vectors their agent is exposed to
- **Input screening test** — Parse runs 20 standard attack prompts against their setup and reports results
- **Compliance gap analysis** — Which OWASP LLM Top 10, NIST AI RMF, and ISO 42001 controls are missing
- **Remediation checklist** — Specific, prioritized actions to close gaps
- **Trial API key** — 7-day Pro tier key to test fixes

### What It Is Not
- Not a manual audit (fully automated)
- Not a penetration test (no live agent testing)
- Not a compliance certification (educational gap analysis)
- Not a substitute for the Compliance tier (it's a lead-in)

### Pricing
- **$47 one-time** (Stripe checkout)
- Delivered as a PDF report + interactive dashboard view
- 7-day Pro trial key included

---

## Technical Implementation

### New Prisma Model

```prisma
model SecurityAudit {
  id           String   @id @default(cuid())
  email        String
  agentName    String
  llmProvider  String
  systemPrompt String   // sanitized, stored encrypted
  sampleInputs String   // JSON array of test inputs
  status       String   @default("pending") // pending, running, completed, failed
  reportUrl    String?  // generated PDF URL
  trialKeyId   String?  // associated trial API key
  riskScore    Int?     // overall risk score 0-100
  gapsFound    Int?     // number of compliance gaps
  createdAt    DateTime @default(now())
  completedAt  DateTime?
}
```

### API Endpoints

```
POST /v1/audit/purchase
  → Creates Stripe checkout session for $47
  → On success: creates SecurityAudit record, sends email

GET  /v1/audit/:id/status
  → Returns audit status

GET  /v1/audit/:id/report
  → Returns the full audit report (HTML + PDF download)

POST /v1/audit/:id/run
  → Triggers the audit pipeline (called by Stripe webhook)
```

### Audit Pipeline

1. **Input validation** — Sanitize the system prompt, validate sample inputs
2. **Pattern injection test** — Run 20 standard attack prompts through the agent's logic using Parse's pattern engine
3. **Exposure analysis** — Check for sensitive data patterns in the system prompt
4. **Compliance mapping** — Map findings to OWASP LLM Top 10, NIST AI RMF, ISO 42001
5. **Risk scoring** — Aggregate findings into a 0-100 risk score
6. **Report generation** — Generate PDF + HTML report
7. **Trial key provisioning** — Create 7-day Pro tier API key
8. **Email delivery** — Send report link + trial key to customer

### Stripe Product Configuration

```bash
# Create the audit product in Stripe
stripe products create --name="Agent Security Audit" --description="One-time automated security audit of your AI agent setup"
# Expected: prod_...

# Create one-time price
stripe prices create \
  --product=prod_... \
  --amount=4700 \
  --currency=usd \
  --type=one_time
# Expected: price_...
```

Add to `.env`:
```
STRIPE_AUDIT_PRODUCT_ID=prod_...
STRIPE_AUDIT_PRICE_ID=price_...
```

### Funnel Position

```
Free Tier ($0)
    ↓ user discovers need for deeper analysis
$47 Audit (one-time)
    ↓ audit reveals gaps, trial key shows the fix
Pro Tier ($49/mo) or Compliance Tier ($999/mo)
    ↓ customer sees value of continuous governance
```

### Conversion Logic

The audit report includes:
- **Risk score** — If > 60, recommend Compliance tier
- **Gap count** — If > 5 gaps, recommend Compliance tier
- **Trial key** — 7-day Pro key with in-dashboard upsell to Compliance
- **Personalized CTA** — Based on their specific gaps (e.g., "Your agent has no output screening. Team tier includes output screening → Upgrade")

---

## Landing Page Copy (/audit)

**Hero:** "Is your AI agent secure? Get a full security audit for $47."

**Subhead:** "Automated analysis of your agent's attack surface. 20 injection tests, compliance gap analysis, and a prioritized remediation checklist. Delivered in 10 minutes."

**How it works:**
1. Paste your agent's system prompt and sample inputs
2. Pay $47 (Stripe checkout)
3. Get your audit report + 7-day Pro trial key in 10 minutes

**What you get:**
- ✅ Risk score (0–100)
- ✅ 20 injection test results
- ✅ OWASP / NIST / ISO 42001 gap analysis
- ✅ Prioritized remediation checklist
- ✅ 7-day Pro API key to test fixes
- ✅ PDF report for your security team

---

## Revenue Model

| Metric | Target |
|--------|--------|
| Audit price | $47 |
| Cost to deliver | ~$0.50 (LLM calls + compute) |
| Gross margin | ~98% |
| Trial → Pro conversion | 15–20% |
| Trial → Compliance conversion | 3–5% |
| Break-even volume | 10 audits/month covers infra costs |

---

## Implementation Status

- [x] Product spec (this document)
- [ ] Prisma model + migration
- [ ] Stripe product + price creation
- [ ] Audit pipeline (pattern injection test runner)
- [ ] Report generator (PDF + HTML)
- [ ] Landing page (/audit)
- [ ] Email delivery (audit complete notification)
- [ ] Funnel integration (trial key → upsell)

> **Note:** The Stripe product needs to be created. The pipeline can be built using existing Parse pattern engine and screening infrastructure. Report generation requires a PDF library (puppeteer or pdfkit).
