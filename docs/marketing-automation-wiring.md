---
title: "Parse Marketing Automation Wiring"
description: "ESP + CRM handoff, lead scoring model, and marketing automation architecture connecting Resend email, Stripe billing, and the funnel."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse"
status: "Active"
---

# Parse Marketing Automation Wiring

> **Task 13.4 — Marketing Automation (ESP + CRM Handoff)**

This document defines the automation architecture that connects email (Resend), billing (Stripe), the funnel tracker, and lead scoring into a single system. The implementation is code-native — no third-party marketing automation tool required.

---

## Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │     VISITOR ARRIVES             │
                    │     (organic, referral, UTM)    │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     UTM CAPTURED                │
                    │     (attribution.ts)            │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     FUNNEL EVENT: discovery_hit │
                    │     (funnel.ts → Redis)         │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────────┐  ┌──────▼───────┐  ┌─────────▼──────────┐
    │  EMAIL CAPTURE     │  │  API KEY     │  │  PRICING VIEW      │
    │  (if provided)     │  │  GENERATED   │  │  funnel event      │
    └─────────┬──────────┘  └──────┬───────┘  └────────────────────┘
              │                    │
    ┌─────────▼──────────┐  ┌──────▼───────┐
    │  NURTURE STARTS    │  │  LEAD SCORE  │
    │  (5-email seq)     │  │  CALCULATED  │
    └─────────┬──────────┘  └──────┬───────┘
              │                    │
              │              ┌─────▼────────────────┐
              │              │  SCORE > THRESHOLD?  │
              │              └───┬──────────┬───────┘
              │                  │          │
              │          YES     │          │  NO
              │                  │          │
    ┌─────────▼──────────┐  ┌────▼────┐  ┌──▼───────────────┐
    │  EMAIL 5: UPGRADE  │  │  CRM    │  │  STAY IN NURTURE │
    │  CTA → /pricing    │  │  ALERT  │  │  (weekly touches) │
    └─────────┬──────────┘  └────┬────┘  └──────────────────┘
              │                   │
    ┌─────────▼──────────┐  ┌────▼───────────────────┐
    │  CHECKOUT STARTED  │  │  MANUAL FOLLOW-UP      │
    │  funnel event      │  │  (for high-value leads)│
    └─────────┬──────────┘  └────────────────────────┘
              │
    ┌─────────▼──────────┐
    │  CHECKOUT COMPLETE │
    │  Stripe webhook    │
    └─────────┬──────────┘
              │
    ┌─────────▼──────────┐
    │  BILLING EMAIL     │
    │  WELCOME TO PAID   │
    │  NURTURE STOPS     │
    └────────────────────┘
```

---

## 1. Lead Scoring Model

### Scoring Rules

| Signal | Points | Source |
|--------|--------|--------|
| Visited landing page | 5 | Funnel: discovery_hit |
| Viewed pricing page | 10 | Funnel: pricing_view |
| Generated API key | 20 | Activation tracker |
| Made first API call | 25 | Activation tracker |
| Hit free tier rate limit | 15 | Usage tracker |
| Started checkout (didn't complete) | 30 | Stripe: checkout.session.started |
| Completed checkout | 100 | Stripe: checkout.session.completed |
| Visited /demo | 10 | Page view tracking |
| Visited /compare/* | 15 | Page view tracking |
| Visited /docs/compliance-guide | 20 | Page view tracking |
| Referred by Dream 100 | 25 | UTM: utm_source |
| Referred by affiliate | 15 | UTM: utm_medium=affiliate |
| Opened nurture email 3+ | 10 | Resend webhook |
| Clicked nurture email link | 15 | Resend webhook |

### Score Thresholds

| Score | Label | Action |
|-------|-------|--------|
| 0–20 | Cold | Stay in nurture sequence |
| 21–50 | Warm | Continue nurture + add to weekly digest |
| 51–79 | Hot | Trigger sales alert + personalized email |
| 80+ | Qualified | Manual outreach from Danny |

### Implementation

```typescript
// src/lib/lead-scoring.ts

interface LeadScore {
  identifier: string;   // API key ID or email
  score: number;
  signals: { signal: string; points: number; timestamp: number }[];
  label: "cold" | "warm" | "hot" | "qualified";
}

// Score stored in Redis: lead:score:{identifier}
// Signals stored in Redis list: lead:signals:{identifier}

export async function addLeadSignal(
  identifier: string,
  signal: string,
  points: number
): Promise<LeadScore> {
  // Add signal to Redis list
  // Recalculate total score
  // Update score in Redis
  // If score crosses threshold → trigger action
  //   - 51: send alert to hello@parsethis.ai
  //   - 80: send high-priority alert
}

export async function getLeadScore(identifier: string): Promise<LeadScore> {
  // Read from Redis
}

export async function getHotLeads(): Promise<LeadScore[]> {
  // Scan for scores > 50
}
```

---

## 2. Email Automation Flows

### Flow 1: Nurture Sequence (5 emails, automated)

| Trigger | Email | Delay | Content |
|---------|-------|-------|---------|
| API key created | Welcome (Day 0) | Immediate | Key confirmation + quickstart |
| API key created | Value deep-dive (Day 1) | +24h | "Why prompt security matters" |
| API key created | Social proof (Day 3) | +72h | Detection stats + compliance features |
| API key created | Use case (Day 5) | +120h | Real agent scenarios |
| API key created | Conversion (Day 7) | +168h | "Upgrade to Pro" CTA |

**Stop conditions:**
- User upgrades to any paid tier → stop sequence, send billing email
- User unsubscribes → stop immediately
- Email bounces → stop, mark as inactive

### Flow 2: Checkout Abandonment

| Trigger | Email | Delay | Content |
|---------|-------|-------|---------|
| checkout.session.started (no completion in 24h) | "Did you need help?" | +24h | Offer help, answer questions |
| Still no completion after 3 days | "Questions about Parse?" | +72h | Address common objections |

### Flow 3: Usage-Based Upsell

| Trigger | Email | Content |
|---------|-------|---------|
| Free tier hits 80% of rate limit | "You're almost at your free limit" | Upgrade to Pro |
| Free tier hits 100% rate limit | "You've hit your limit" | Upgrade to Pro/Team |
| Pro tier hits 80% of request limit | "Time to upgrade?" | Upgrade to Team |
| Team tier uses compliance features | "You're using compliance features" | Upgrade to Compliance tier |

### Flow 4: Re-engagement

| Trigger | Email | Content |
|---------|-------|---------|
| No API calls for 14 days | "Is everything okay?" | Offer help |
| No API calls for 30 days | "Last chance" | Feature reminder + discount |

---

## 3. CRM Pipeline Integration

### Pipeline Stages

```
New Lead → Engaged → Qualified → Demo → Proposal → Closed Won
                                                    → Closed Lost
```

### Automated Stage Transitions

| From | To | Trigger |
|------|----|---------| 
| — | New Lead | API key created (free tier) |
| New Lead | Engaged | Made 1+ API calls |
| Engaged | Qualified | Lead score > 80 OR viewed compliance guide |
| Qualified | Demo | Booked scoping call (manual) |
| Demo | Proposal | Scoping call completed (manual) |
| Proposal | Closed Won | Stripe checkout completed |
| Proposal | Closed Lost | No activity for 30 days (manual) |

### CRM Record (stored in Prisma + Redis)

```typescript
// Extends existing Organization model
// Pipeline state stored in Redis: crm:lead:{orgId}

interface CRMLead {
  orgId: string;
  stage: "new" | "engaged" | "qualified" | "demo" | "proposal" | "won" | "lost";
  leadScore: number;
  firstSeenAt: number;
  lastActivityAt: number;
  source: string;       // utm_source
  medium: string;       // utm_medium
  notes: string[];      // manual notes from Danny
  nextAction: string;   // what Danny should do next
  nextActionAt: number; // when
}
```

### Admin Dashboard (/dashboard/crm)

Shows:
- Pipeline overview (count per stage)
- Hot leads (score > 50)
- Next actions for Danny
- Source breakdown (where leads come from)
- Conversion rate per stage

---

## 4. Marketing Automation Cron Jobs

| Cron | Schedule | Action |
|------|----------|--------|
| `nurture-email-sender` | Every hour | Process due nurture emails |
| `lead-score-update` | Every 15 min | Recalculate scores from new signals |
| `checkout-abandonment` | Every 6 hours | Send abandonment emails |
| `usage-upsell-check` | Every hour | Check rate limits, trigger upsell emails |
| `re-engagement-check` | Daily | Check for inactive users, send re-engagement |
| `crm-dashboard-refresh` | Every 5 min | Update CRM dashboard data |

### Hermes Cron Integration

These map to Hermes cron jobs:

```json
[
  {
    "name": "parse-nurture-emails",
    "schedule": "every 1h",
    "prompt": "Call POST https://www.parsethis.ai/v1/nurture/process to send any due nurture emails. Report how many were sent.",
    "deliver": "local"
  },
  {
    "name": "parse-lead-scoring",
    "schedule": "every 15m",
    "prompt": "Call POST https://www.parsethis.ai/v1/leads/score to recalculate lead scores. Report any new hot leads.",
    "deliver": "origin"
  },
  {
    "name": "parse-usage-upsell",
    "schedule": "every 1h",
    "prompt": "Call POST https://www.parsethis.ai/v1/automation/upsell-check to check for users hitting rate limits and trigger upsell emails.",
    "deliver": "local"
  }
]
```

---

## 5. Wire-up Points in Existing Code

### API Key Creation (src/routes/public.ts or src/routes/keys.ts)

```typescript
// After API key is created:
// 1. Fire funnel event: signup
await recordFunnelEvent("signup", apiKeyId);

// 2. Capture attribution
await saveAttribution(apiKeyId, utmParams);

// 3. Start nurture sequence
await startNurtureSequence(email, apiKeyId);

// 4. Add lead signal
await addLeadSignal(apiKeyId, "api_key_created", 20);

// 5. Send welcome email
await sendEmail(welcomeEmail(apiKeyName));
```

### Pricing Page View (src/routes/public.ts)

```typescript
// When /pricing is loaded:
await recordFunnelEvent("pricing_view", requestId);
await addLeadSignal(visitorId, "pricing_view", 10);
```

### Checkout Start (src/routes/billing.ts)

```typescript
// When Stripe checkout session is created:
await recordFunnelEvent("checkout_started", apiKeyId);
await addLeadSignal(apiKeyId, "checkout_started", 30);
```

### Checkout Complete (src/routes/billing.ts webhook)

```typescript
// When Stripe webhook confirms payment:
await recordFunnelEvent("checkout_completed", apiKeyId);
await addLeadSignal(apiKeyId, "checkout_completed", 100);
await stopNurtureSequence(email);  // Stop nurture, they converted
await sendEmail(billingEmail(tier, amount));
```

### First API Call (src/lib/billable-usage-middleware.ts)

```typescript
// On first API call from a new key:
if (usageCount === 1) {
  await recordFunnelEvent("first_call", apiKeyId);
  await addLeadSignal(apiKeyId, "first_api_call", 25);
  // Update CRM stage: new_lead → engaged
}
```

---

## 6. Implementation Status

| Component | Status |
|-----------|--------|
| Funnel tracker (funnel.ts) | ✅ Exists |
| Email service (email.ts) | ✅ Exists |
| Nurture sequence | 🔄 Subagent building (Task 13.3) |
| Lead scoring model | 📐 This document (spec ready) |
| CRM pipeline tracking | 📐 This document (spec ready) |
| Checkout abandonment | 📐 This document (spec ready) |
| Usage upsell automation | 📐 This document (spec ready) |
| Re-engagement flow | 📐 This document (spec ready) |
| Attribution capture | 🔄 Subagent building (Task 17.4) |
| Analytics dashboard | 🔄 Subagent building (Task 14.3) |
| Hermes cron jobs | 📐 Ready to create when code is merged |

> **Next step:** After subagents complete 13.3 (nurture) and 17.4 (attribution), implement lead-scoring.ts and wire the automation triggers into the existing route handlers.
