---
title: "Parse Affiliate / Referral Program Architecture"
description: "Technical and business architecture for the Parse affiliate and referral program."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse"
status: "Active"
---

# Parse Affiliate / Referral Program Architecture

> **Task 18.6 — Affiliate / Referral Program**

Build a referral engine that turns every customer and partner into a distribution channel. Self-serve, transparent, and automated.

---

## Program Structure

### Two Programs

| Program | Who | Commission | Cookie Duration | Payout |
|---------|-----|-----------|-----------------|--------|
| **Partner Program** | AI agencies, consultancies, integrators | 20% recurring (12 months) | 90 days | Monthly (PayPal/Stripe) |
| **Customer Referral** | Existing Parse customers | 1 month free per referral that converts | 30 days | Applied to subscription |

### Why This Structure

- **20% recurring for 12 months** — High enough to motivate, short enough to not cannibalize revenue long-term
- **Agencies get more** because they bring volume and their clients stay longer
- **Customer referral is simple** — no money changes hands, just subscription credits
- **Self-serve** — no manual tracking, no spreadsheets, no approval bottleneck

---

## Technical Architecture

### Prisma Model

```prisma
model AffiliateAccount {
  id              String   @id @default(cuid())
  userId          String?  // linked Parse user (if customer)
  email           String
  name            String
  type            String   @default("partner") // partner, customer
  referralCode    String   @unique
  stripeAccountId String?  // Stripe Connect account for payouts
  status          String   @default("active") // active, paused, suspended
  totalReferrals  Int      @default(0)
  activeReferrals Int      @default(0)
  totalEarnings   Decimal  @default(0) @db.Decimal(10, 2)
  createdAt       DateTime @default(now())
  referrals       AffiliateReferral[]
}

model AffiliateReferral {
  id              String   @id @default(cuid())
  affiliateId     String
  affiliate       AffiliateAccount @relation(fields: [affiliateId], references: [id])
  referredEmail   String
  referredKeyId   String?  // linked API key when they convert
  status          String   @default("pending") // pending, signed_up, converted, churned
  commissionEarned Decimal @default(0) @db.Decimal(10, 2)
  commissionMonths Int     @default(0) // tracks how many months of 12 have been paid
  firstSeenAt     DateTime @default(now())
  convertedAt     DateTime?
  createdAt       DateTime @default(now())
}
```

### API Endpoints

```
POST /v1/affiliate/register
  → Create affiliate account, get referral code
  → Body: { name, email, type: "partner" | "customer" }

GET  /v1/affiliate/:code/landing
  → Public landing page for referral link (e.g., parsethis.ai/?ref=ALEX20)
  → Sets tracking cookie

GET  /v1/affiliate/dashboard
  → Affiliate dashboard: clicks, signups, conversions, earnings
  → Needs auth

POST /v1/affiliate/webhook
  → Internal: called when a referred customer converts (paid subscription)
  → Creates commission record, triggers payout calculation

GET  /v1/affiliate/stats
  → Admin: program-wide stats
```

### Tracking Flow

```
1. Affiliate shares link: parsethis.ai/?ref=ALEX20
2. Visitor clicks → ref code stored in cookie (30/90 day expiry)
3. Visitor signs up (free tier) → ref code attached to their API key record
4. Visitor upgrades to paid → webhook fires
5. System checks for ref code on the API key
6. If found → create AffiliateReferral record with status "converted"
7. Monthly cron: calculate commissions, initiate Stripe Connect payout
```

### Cookie + Attribution Logic

```typescript
// On any page load with ?ref= parameter
// 1. Validate referral code exists
// 2. Set cookie: parse_ref={code}; Max-Age={30d|90d}; SameSite=Lax; Secure
// 3. On API key creation, check for cookie
// 4. If cookie present, attach referral code to ApiKey record

// Attribution model: first-touch wins
// (first referral cookie takes precedence over later ones)
```

### Commission Calculation

```typescript
// Monthly cron job (1st of each month)
// For each converted referral with commissionMonths < 12:
//   1. Check if the referred customer's subscription is still active
//   2. If active: commission = customer_monthly_rate * 0.20
//   3. Increment commissionMonths
//   4. Add to affiliate's totalEarnings
//   5. If commissionMonths >= 12: mark referral as "completed"
//   6. If customer churned: mark referral as "churned"
//
// Payout threshold: $50 minimum (Stripe Connect transfer fee optimization)
```

---

## Stripe Integration

### Stripe Connect (for partner payouts)

```bash
# Create Stripe Connect Express account for each affiliate
# On registration:
stripe accounts create --type=express

# On payout:
stripe transfers create \
  --amount={commission_in_cents} \
  --currency=usd \
  --destination={affiliate_stripe_account_id} \
  --description="Parse affiliate commission for {month}"
```

### Referral Discount (for customer referrals)

When a customer referral converts:
- Apply 100% discount on their next month's subscription
- Also give the referrer 1 month free
- Both sides benefit → drives viral coefficient

---

## Affiliate Landing Page

### Partner Program Page (/affiliates)

**Hero:** "Earn 20% recurring commission referring Parse to your network."

**Subhead:** "Join the Parse Partner Program. Get a unique referral link, real-time dashboard, and monthly payouts via Stripe. 90-day cookie window."

**How it works:**
1. Register → get your referral link (instant)
2. Share with your network (X, LinkedIn, blog, newsletter)
3. Earn 20% recurring for 12 months on every conversion
4. Track everything in your affiliate dashboard

**Why promote Parse:**
- Transparent pricing ($49–$999/mo) → easy to sell
- Self-serve signup → no friction
- Developer-first → your audience trusts it
- Compliance angle → enterprise budgets
- 20% recurring → not one-time, builds monthly income

**Commission calculator:**
```
10 Pro referrals = 10 × $49 × 20% = $98/month
10 Team referrals = 10 × $199 × 20% = $398/month  
5 Compliance referrals = 5 × $999 × 20% = $999/month
Total potential: $1,495/month passive income
```

---

## Anti-Fraud Measures

1. **Self-referral blocked** — affiliate email ≠ referred email
2. **IP deduplication** — same IP within 24h only counts once
3. **Conversion threshold** — commission only on paid subscriptions, not free signups
4. **Chargeback clawback** — if a referred customer chargebacks, commission is reversed
5. **Manual review for > $500/month** — large affiliate earnings get a human eyeball

---

## Launch Sequence

### Phase 1: Internal (Week 1)
- [ ] Prisma models + migration
- [ ] API endpoints (register, tracking, dashboard, webhook)
- [ ] Cookie logic + attribution wiring
- [ ] Affiliate dashboard page
- [ ] Partner program landing page (/affiliates)

### Phase 2: Stripe Connect (Week 2)
- [ ] Stripe Connect Express account creation
- [ ] Automated payout script (monthly cron)
- [ ] Payout threshold logic ($50 min)

### Phase 3: Launch (Week 3)
- [ ] Invite first 5 partners manually (from Dream 100 list)
- [ ] Enable customer referral in billing dashboard
- [ ] Add "Refer a friend, get a month free" to nurture email #5

### Phase 4: Scale (Ongoing)
- [ ] Promote in X content
- [ ] Add to delivery kit (agencies can earn from client referrals)
- [ ] Quarterly partner performance review

---

## Success Metrics

| Metric | Month 1 Target | Month 3 Target | Month 6 Target |
|--------|---------------|---------------|---------------|
| Registered affiliates | 10 | 50 | 200 |
| Active referral links | 10 | 40 | 150 |
| Click-through rate | 5% | 8% | 10% |
| Conversion rate (click → paid) | 2% | 5% | 8% |
| Revenue from affiliate channel | $0 | $500 | $5,000 |
| Affiliate-sourced customers | 1 | 10 | 50 |

---

## Implementation Status

- [x] Architecture document (this file)
- [ ] Prisma models + migration
- [ ] API endpoints
- [ ] Tracking + attribution logic
- [ ] Affiliate dashboard UI
- [ ] Stripe Connect integration
- [ ] Monthly payout cron
- [ ] Landing page (/affiliates)
- [ ] Anti-fraud rules
- [ ] First partner onboarding

> **Note:** This is the architecture spec. Implementation can begin immediately — no external dependencies. The Prisma models and API endpoints are self-contained and don't require changes to the compliance or screening code.
