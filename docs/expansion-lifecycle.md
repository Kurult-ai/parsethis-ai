---
title: "Parse Post-Implementation Expansion Lifecycle"
description: "How to manage customer expansion after initial implementation — upsell paths, feature adoption tracking, and renewal processes."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse"
---

# Post-Implementation Expansion Lifecycle

> **Task 17.7**

Defines the lifecycle for managing customer expansion after the initial Parse implementation is complete. Every customer should be on a growth trajectory: more agents, more screening volume, higher tier.

---

## Expansion Paths

### Path 1: Tier Upgrade (Vertical)

```
Free → Pro ($49) → Team ($199) → Compliance ($999) → Enterprise (custom)
```

**Triggers:**
- Free → Pro: Hit rate limit, need more requests
- Pro → Team: Adding multiple agents, need output screening + policy enforcement
- Team → Compliance: Preparing for audit, need SIEM + evidence packs + agent registry
- Compliance → Enterprise: Need SSO, RBAC, dedicated support, custom SLAs

### Path 2: Volume Expansion (Horizontal)

More agents registered → more screening volume → higher value to the customer.

**Key metric:** Agents registered per org. Target: +1 agent/month after implementation.

### Path 3: Feature Adoption (Depth)

```
Basic screening → Output screening → Agent trust → Compliance dashboard → SIEM → Evidence packs
```

Each feature adopted increases stickiness and switching cost.

---

## Adoption Tracking

| Feature | Metric | Target | Tool |
|---------|--------|--------|------|
| Input screening | Daily parse calls | Increasing | Usage tracker |
| Output screening | Daily screen-output calls | > 0 within 30d | Usage tracker |
| Agent trust | Trust verify calls | > 0 within 60d | Usage tracker |
| Agent registry | Agents registered | +1/month | Agent registry |
| Compliance dashboard | Dashboard logins/month | > 2 | Admin analytics |
| SIEM forwarding | SIEM events/day | > 0 | SIEM config |
| Evidence packs | Packs generated/quarter | > 0 | Compliance exports |

---

## Expansion Plays

### Play 1: "Security Audit" (Month 2)
- **Who:** Pro/Team tier customers
- **Action:** Offer $47 audit (Task 18.5) as a check-up
- **Goal:** Reveal gaps → upsell to Compliance tier

### Play 2: "Agent Inventory Review" (Month 3)
- **Who:** All customers with > 3 agents
- **Action:** Quarterly review of agent registry, risk profiles
- **Goal:** Identify unregistered agents → expand coverage

### Play 3: "Compliance Readiness Check" (Month 6)
- **Who:** Team tier customers
- **Action:** Show compliance gap analysis vs OWASP/NIST/ISO
- **Goal:** Upsell to Compliance tier

### Play 4: "Annual Security Review" (Month 12)
- **Who:** All customers
- **Action:** Generate annual evidence pack, review enforcement policy
- **Goal:** Renewal + tier upgrade

---

## Renewal Process

### 30 Days Before Renewal
1. Send renewal reminder email with usage summary
2. Generate quarterly evidence pack (Compliance tier)
3. Review lead score — if hot, schedule expansion call

### 14 Days Before Renewal
1. Send second reminder
2. Offer tier upgrade with proration

### At Renewal
1. Stripe automatically charges (recurring subscription)
2. Send "thank you for renewing" email
3. If upgraded, send billing confirmation email

### Churn Recovery
If customer cancels:
1. Exit survey (why did you leave?)
2. Offer 50% discount for 3 months to return
3. Add to re-engagement email list
4. Check back at 30/60/90 days

---

## Expansion Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Net Revenue Retention | > 110% | Monthly revenue / prior month |
| Tier upgrade rate | 15% per quarter | Orgs upgrading / total orgs |
| Feature adoption (depth) | +1 feature/quarter | New endpoints used per org |
| Agent growth (breadth) | +1 agent/month | Agents registered per org |
| Churn rate | < 5% monthly | Cancellations / total |
| Expansion revenue | > 30% of new revenue | Upgrades vs new signups |
