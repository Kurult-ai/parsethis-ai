---
title: "Parse Incident Response Runbook"
description: "Step-by-step procedures for security incidents, outages, and operational emergencies."
date: "2026-08-09"
lastUpdated: "2026-08-09"
author: "Parse Operations"
status: "Active"
---

# Parse Incident Response Runbook

This runbook covers the procedures for responding to security incidents, service outages, and operational emergencies affecting Parse for Agents (parsethis.ai).

---

## Severity Classification

| Severity | Definition | Response Time | Examples |
|----------|-----------|---------------|----------|
| **SEV-1** | Total service outage or active security breach | Immediate (< 5 min) | Site down, API returning 500s, credential leak detected |
| **SEV-2** | Major feature degraded or high-risk security event | < 15 min | Screening API latency > 10s, enforcement bypass detected, Stripe webhook failures |
| **SEV-3** | Minor feature degraded or isolated customer issue | < 1 hour | Analytics dashboard down, individual tenant data issue, non-critical endpoint error |
| **SEV-4** | Cosmetic issue or non-urgent improvement | Next business day | UI glitch, documentation error, low-impact bug |

---

## 1. Service Outage (SEV-1)

### Symptoms
- parsethis.ai returning 5xx errors or not loading
- API calls timing out
- Cloudflare tunnel down

### Immediate Actions

1. **Verify the outage:**
```bash
# Check if server is running
launchctl list | grep parse
# Check if port is listening
lsof -i :3001
# Check Cloudflare tunnel
cloudflared tunnel info dece3379-b569-49f1-b4d6-a3be767f992a
# Quick health check
curl -s https://www.parsethis.ai/v1/discovery | jq .status
```

2. **Check infrastructure layers:**
```bash
# PostgreSQL
pg_isready
# Redis
redis-cli ping
# Disk space
df -h
# Memory
vm_stat | head -5
```

3. **Restart the service if needed:**
```bash
# Parse runs via launchd
launchctl kickstart -k gui/$(id -u)/com.parsethis.server
# Wait 5 seconds, verify
sleep 5 && curl -s http://localhost:3001/v1/discovery | jq .status
```

4. **If Cloudflare tunnel is down:**
```bash
# Restart cloudflared
launchctl kickstart -k gui/$(id -u)/com.cloudflare.cloudflared
# Verify tunnel
cloudflared tunnel list
```

5. **Communicate:**
   - Post incident status to status.parsethis.ai (if set up)
   - Email affected customers via `hello@parsethis.ai`
   - Update GitHub status if it's a prolonged outage

### Recovery Verification
```bash
# Full smoke test
curl -s https://www.parsethis.ai/ | head -5
curl -s -X POST https://www.parsethis.ai/v1/parse \
  -H "Authorization: Bearer $MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"hello"}' | jq .risk_score
```

---

## 2. Security Incident — Prompt Injection Bypass (SEV-1/SEV-2)

### Symptoms
- A screening bypass is reported (malicious prompt got risk score < 3)
- An agent performed an unauthorized action
- SIEM forwarding detected anomalous patterns

### Immediate Actions

1. **Verify the bypass:**
```bash
# Check the screening event log for the specific event
# Replace EVENT_ID with the reported event
curl -s https://www.parsethis.ai/v1/screening-metrics \
  -H "Authorization: Bearer $MASTER_API_KEY" | jq '.events[-5:]'
```

2. **If confirmed — activate kill switch on the affected agent:**
```bash
# Freeze the agent that was compromised
curl -s -X POST https://www.parsethis.ai/v1/agents/$AGENT_ID/freeze \
  -H "Authorization: Bearer $MASTER_API_KEY"
```

3. **Switch enforcement dial to BLOCK for all environments:**
```bash
curl -s -X POST https://www.parsethis.ai/v1/policy \
  -H "Authorization: Bearer $MASTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"environment":"production","enforcement":"block"}'
```

4. **Pull the evidence pack for forensic analysis:**
```bash
curl -s https://www.parsethis.ai/v1/compliance/evidence-pack \
  -H "Authorization: Bearer $MASTER_API_KEY" | jq
```

5. **Add the malicious pattern to the blocklist:**
   - Add the pattern to `src/lib/patterns/index.ts`
   - Deploy with `npm run build && npm run start`

6. **Post-incident:**
   - Document the bypass vector in `docs/incidents/`
   - Add a test case to the screening fixtures
   - Review whether the enforcement level was too permissive

---

## 3. Data Exposure Event (SEV-1)

### Symptoms
- Sensitive data detected in screening logs
- API key leak reported
- Customer data exposed through agent output

### Immediate Actions

1. **Rotate the compromised credential immediately:**
```bash
# If an API key was leaked, revoke it
curl -s -X DELETE https://www.parsethis.ai/v1/keys/$KEY_ID \
  -H "Authorization: Bearer $MASTER_API_KEY"
```

2. **Check exposure logs:**
```bash
curl -s https://www.parsethis.ai/v1/exposure/catalogs \
  -H "Authorization: Bearer $MASTER_API_KEY" | jq
```

3. **Freeze affected agents:**
```bash
curl -s -X POST https://www.parsethis.ai/v1/agents/$AGENT_ID/freeze \
  -H "Authorization: Bearer $MASTER_API_KEY"
```

4. **Notify the affected customer** via the security alert email template.

5. **Document the exposure scope** — what data, which agent, what time window.

---

## 4. Stripe Billing Failure (SEV-2)

### Symptoms
- Checkout sessions failing
- Webhook events failing to process
- Customers reporting payment issues

### Immediate Actions

1. **Check Stripe webhook health:**
```bash
# Check if webhooks are being received
curl -s https://www.parsethis.ai/v1/billing/health \
  -H "Authorization: Bearer $MASTER_API_KEY"
```

2. **Check Stripe dashboard:**
   - Go to developers.stripe.com → Webhooks
   - Look for failed deliveries
   - Check if webhook secret matches `.env` STRIPE_WEBHOOK_SECRET

3. **If webhook secret is wrong:**
   - Get new signing secret from Stripe dashboard
   - Update `.env` STRIPE_WEBHOOK_SECRET
   - Restart server

4. **If in test mode and need to go live:**
   - Replace `sk_test_` with `sk_live_` key in `.env`
   - Update STRIPE_PUBLISHABLE_KEY with live key
   - Update webhook endpoint URL in Stripe dashboard

---

## 5. Database Issues (SEV-1/SEV-2)

### Symptoms
- Prisma connection errors
- Migration failures
- Data inconsistency

### Immediate Actions

1. **Check PostgreSQL status:**
```bash
pg_isready
brew services list | grep postgresql
```

2. **If PostgreSQL is down:**
```bash
brew services restart postgresql
sleep 3 && pg_isready
```

3. **If migration is needed:**
```bash
cd /Users/kublai/parse-for-agents-live
npx prisma migrate deploy
npx prisma generate
```

4. **If Redis is down:**
```bash
brew services list | grep redis
brew services restart redis
sleep 2 && redis-cli ping
```

---

## 6. On-Call Contact List

| Role | Name | Contact |
|------|------|---------|
| Primary on-call | Danny (Kublai) | Telegram / Signal |
| Engineering lead | (assigned) | Telegram |
| Security review | (assigned) | Signal |

---

## 7. Post-Incident Review Template

After every SEV-1 or SEV-2 incident, complete this within 48 hours:

```
## Incident: [Title]
Date: [YYYY-MM-DD]
Severity: SEV-[1-4]
Duration: [X minutes/hours]
Detected by: [monitoring/customer/on-call]

### Timeline
- [time] — Incident detected
- [time] — Response began
- [time] — Root cause identified
- [time] — Mitigation applied
- [time] — Full recovery

### Root Cause
[Description]

### Impact
- [X] customers affected
- [X] requests failed
- [X] minutes of downtime

### Actions Taken
1. [action]
2. [action]

### Prevention
1. [preventive measure]
2. [preventive measure]

### Lessons Learned
[What to do differently next time]
```

---

## 8. Monitoring Endpoints

| Check | URL | Expected |
|-------|-----|----------|
| Health check | `GET /v1/discovery` | 200 + JSON |
| Database | `GET /v1/screening-metrics` | 200 (needs auth) |
| Stripe | `GET /v1/billing/health` | 200 (needs auth) |
| Landing page | `GET /` | 200 HTML |
| Pricing | `GET /pricing` | 200 HTML |

---

## 9. Backup Procedures

### Database backup
```bash
pg_dump parsethis > backups/parsethis_$(date +%Y%m%d).sql
```

### Environment file backup
```bash
cp .env backups/.env.$(date +%Y%m%d)
```

### Configuration backup
The entire repo is in git. Ensure all changes are committed:
```bash
cd /Users/kublai/parse-for-agents-live
git add -A && git status
```
