# Enterprise inbound — the second a prospect needs it

Operator runbook. Open this file and execute. Do not staff Guyuk. Do not
invent a SKU. Do not mint `STRIPE_ENTERPRISE_PRICE_ID`.

Enterprise is a **named overflow grant** (1000 instant/min on a key), not a
public plan. Checkout stays 503. Public ceiling is Team (500/min). Deep stays
metered. Not an SLA. Code: `src/lib/tier-rpm.ts`, grant:
`admin.entitlement.grant` with `tier=enterprise`.

Contact mailbox: `d@kurult.ai`. Live: `https://www.parsethis.ai`.

---

## 0. Hard stops (first 15 minutes)

Do none of these until the qualify table is filled.

- [ ] **Do not** create a Stripe Enterprise product or price
- [ ] **Do not** promise uptime, two-region, 99.x%, SOC 2 Type II, or a pen-test letter
- [ ] **Do not** staff outbound GTM / Guyuk / a “Contact Sales” page
- [ ] **Do not** gate Team features (Ledger, unlimited agents, Chrome 403, ceiling lock)
- [ ] **Do not** change public copy to sell Enterprise
- [ ] **Do not** put `MASTER_API_KEY` in chat, Intercom, or the reply
- [ ] **Do not** label leftover prospect keys (Elina Vos `prospect:run:current` stays open)
- [ ] **Do** tell Danny: Intercom profile `kublai`, one paragraph: who, ask, which track below
- [ ] **Do** file a support ticket category `dpa` or `security` if they wrote in via `/support`

Notify:

```bash
~/.kublai/bin/intercom --profile kublai --title "Parse Enterprise inbound" --body "<who, company, ask, track T1–T4>"
```

---

## 1. Qualify (15–30 min) — they said “enterprise”; most of them didn’t mean it

Fill this before any grant.

| # | Question | How to get it | Writes to |
|---|---|---|---|
| 1 | Company, name, email, existing key prefix (`pfa_live_…` first 12) | email / `/support` ticket | resolve |
| 2 | Are they already on Solo / Pro / Team / Compliance? | `admin.customer.resolve` | track |
| 3 | Is the blocker **rpm** (burst past 500 instant/min) or **vendor paper**? | their words | T2 vs T3/T4 |
| 4 | Instant vs deep volume (screens/day, peak/min) | they measure; `X-RateLimit-*` if they have a key | T2 only if instant peak > 500 |
| 5 | DPA / SCCs / vendor questionnaire? | ask | T3 = Compliance $199 |
| 6 | Type II, pen test, HA, contractual SLA, two-region? | ask; `/trust` Q23 / Type II / single-node | T4 if any is a hard gate |
| 7 | Card vs MSA vs vendor register | ask | T1/T3 card; T4 if MSA-only |
| 8 | Timeline | “this week” vs “Q next” | trial grant vs refer-out |

### Decision

```
Need Type II / pen-test letter / HA / SLA / two-region as a hard gate
  → T4. Do not sell. Honest packet. “Come back after.”
Need a DPA / named vendor-review contact, Team-scale is enough
  → T3. Compliance self-serve $199. No overflow unless they also fail (4).
Peak instant > 500/min, rest of Team is enough, no HA/SLA gate
  → T2. They pay Team (or already have it). Then grant overflow.
They said “enterprise” and mean fleet / unlimited agents / Ledger / Chrome 403
  → T1. That is Team $199. Checkout works. Stop.
```

Maya-at-fleet is T1. Maya hitting 500 rpm is T2. Legal/reviewer is T3.
CISO bake-off is T4.

---

## 2. Tracks

### T1 — They meant Team

Sell Team. Do not mention Enterprise.

- Pricing: `https://www.parsethis.ai/pricing#team` ($199)
- Ledger install: `/ledger#install` (HTTP hook, not npm)
- They already have Pro? Upgrade via `POST /v1/billing/checkout` `{ "tier": "team" }` with their Bearer key
- Cold? `POST /v1/billing/signup-checkout` `{ "tier": "team" }` — 201 + Stripe URL
- Done. No grant.

### T2 — Overflow rpm (the only technical yes)

Software they buy: **Team $199** (or Compliance $199 if T3 also).
Thing we grant: **1000 instant/min** on that key. Not a SKU. Not an SLA.
Deep stays on the Team/Compliance meter (50k deep/mo).

1. Confirm they can pay Team (or already do). Overflow does not replace the sub.
2. Resolve the key (section 3). Prefer the paying key, not a new one.
3. Dry-run grant (section 4). Danny approves. Then live.
4. Verify `X-RateLimit-Limit: 1000` on `POST /v1/parse` with **their** key.
5. Say in the reply: grant, not SLA; public ceiling remains Team; checkout for “enterprise” stays 503; if they cancel Team the webhook drops the key to free and overflow dies with it.

**Paying Team, standing overflow:** no `period`, do not `expire_key_at_period_end`.
Lasts with the subscription.

**Unpaid trial:** dedicated key, `period: "30 days"`, `expire_key_at_period_end: true`,
`create_key_if_missing: true`. Never trial-expire their only production key.

**Time-boxed overflow on a live Team sub:** `period` for the receipt, **leave**
`expire_key_at_period_end` false (that would kill the Team key). Calendar a
revert: `admin.api_key.update` `tier=team` on `ends_at`. Grant end does **not**
auto-restore 500 rpm by itself.

### T3 — DPA / questionnaire

- They start Compliance: `/pricing#compliance` → `signup-checkout` `{ "tier": "compliance" }`
- DPA: `https://www.parsethis.ai/dpa`
- Questionnaire: `https://www.parsethis.ai/trust` (generated from `src/lib/vendor-questionnaire.ts`)
- Named contact: business-day read of `d@kurult.ai`. Attention, not an uptime SLA
- If they also need >500 rpm → T2 on the Compliance key after it exists
- Do not pretend Compliance is Type II

### T4 — Refer-out / come back

Hard gates we do not have (say so, quote `/trust`):

| They asked | Honest answer | Where it lives |
|---|---|---|
| SOC 2 Type II | No. Marked Q1 2027 | `/trust`, pricing Compliance card |
| Pen test letter | No independent pen test | `/trust` Q23 |
| Uptime SLA / 99.x% | No, until HA ships | pricing DPA card |
| Two-region / failover | Single Mini behind Cloudflare tunnel | `/trust` Q16 |
| Enterprise self-serve price | None. Checkout 503 | `POST /v1/billing/signup-checkout` |

Reply: Team + Compliance are what we sell; overflow rpm is a grant after HA is
not required; come back when Type II / HA exist. Optional: they can still buy
Team today for the control, knowing the vendor-register rows stay no.

Do not invent Langfuse/Lakera as a referral unless they asked for a vendor
comparison and you are quoting `/compare`.

---

## 3. Resolve the customer

Admin key from the operator env only. Never paste it.

```bash
# Discover the action surface
curl -sS https://www.parsethis.ai/.well-known/parse-admin.json | jq .

curl -sS https://www.parsethis.ai/v1/admin/actions \
  -H "authorization: Bearer $PARSE_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -H 'X-Parse-Probe: 1' \
  -d '{
    "action": "admin.customer.resolve",
    "params": { "email": "THEIR@COMPANY" }
  }'
```

Also works: `api_key_id`, `key_prefix` (first 12 of `pfa_live_…`),
`stripe_customer_id`, `ticket_id`.

Record: `api_key.id`, current `tier`, `rate_limit`, Stripe status, existing grants.

---

## 4. Grant overflow (T2 only, after Danny yes)

Dry-run is the default. Enterprise overflow **requires approval**.

```bash
# 1) Dry-run — must show overflow_rpm true, rate_limit 1000, public_sku false
curl -sS https://www.parsethis.ai/v1/admin/actions \
  -H "authorization: Bearer $PARSE_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -H 'X-Parse-Probe: 1' \
  -d '{
    "action": "admin.entitlement.grant",
    "params": {
      "api_key_id": "KEY_ID",
      "tier": "enterprise",
      "reason": "Named overflow rpm for COMPANY; not an SLA",
      "dry_run": true
    }
  }'
```

Danny replies yes in this chat or Intercom. Then live:

```bash
# 2) Live — dry_run false. 201. Copy the receipt id.
curl -sS https://www.parsethis.ai/v1/admin/actions \
  -H "authorization: Bearer $PARSE_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -H 'X-Parse-Probe: 1' \
  -d '{
    "action": "admin.entitlement.grant",
    "params": {
      "api_key_id": "KEY_ID",
      "tier": "enterprise",
      "reason": "Named overflow rpm for COMPANY; not an SLA",
      "dry_run": false,
      "live": true
    }
  }'
```

Unpaid trial variant: add `"period": "30 days"`, `"create_key_if_missing": true`,
`"expire_key_at_period_end": true`, and `email` / `user_id` if there is no key.

### Verify (their key, not master)

```bash
curl -sS -D - -o /tmp/ov.json https://www.parsethis.ai/v1/parse \
  -H "authorization: Bearer $THEIR_KEY" \
  -H 'content-type: application/json' \
  -H 'X-Parse-Probe: 1' \
  -d '{"prompt":"hello overflow check","mode":"pattern-only"}'
# Expect: HTTP 200 and X-RateLimit-Limit: 1000
```

Revoke / revert to Team 500:

```bash
curl -sS https://www.parsethis.ai/v1/admin/actions \
  -H "authorization: Bearer $PARSE_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -H 'X-Parse-Probe: 1' \
  -d '{
    "action": "admin.api_key.update",
    "params": { "id": "KEY_ID", "tier": "team", "reason": "Overflow ended" }
  }'
```

---

## 5. Honesty packet (paste into the first reply)

Always include, even on T1:

- Trust: https://www.parsethis.ai/trust
- DPA: https://www.parsethis.ai/dpa
- Posture JSON: `GET https://www.parsethis.ai/v1/security/headers` — Team `public_ceiling`, enterprise `public_sku: false`
- Type II: not yet (Q1 2027)
- Pen test: none (Q23)
- SLA: none until HA
- Overflow: 1000 instant/min on a granted key; not a public price; deep still metered

### Reply stubs

**T1**

> Team is the plan for unlimited agents, Ledger, and the Chrome-tool 403. $199/mo, self-serve at /pricing#team. There isn’t a separate Enterprise SKU.

**T2**

> Team’s public ceiling is 500 instant screens/min. We can grant 1000 instant/min on your Team key as a named overflow. That is a grant, not an SLA and not a checkout SKU. Deep screening stays on the Team meter. If you cancel Team, overflow ends with it.

**T3**

> DPA + SCCs and a named vendor-review contact are Compliance at $199/mo (self-serve). That is not SOC 2 Type II and not an uptime SLA. /trust is the questionnaire; /dpa is the contract. We read d@kurult.ai within a business day.

**T4**

> We should not be in your data path if Type II / a pen-test letter / a contractual SLA is a hard gate. Those rows on /trust are no. Team and Compliance are what we sell today. Come back after HA and Type II.

---

## 6. Aftercare (same day if you granted)

- [ ] Receipt id from the grant stored in the ticket / Intercom thread
- [ ] Reason names the company; no secrets in the reason
- [ ] They confirmed 1000 on `X-RateLimit-Limit`
- [ ] Calendar revert if time-boxed
- [ ] One line on `~/brain/projects/parsethis-ai.md` (no PII beyond company)
- [ ] If they paid: do **not** `prospect-run.mts label` that key
- [ ] Do not open Guyuk on this thread

---

## 7. What still has to exist before Enterprise is a product

Not this runbook’s job. Triggers to rewrite this file:

| Missing | Blocks |
|---|---|
| Two-region HA | SLA, T4 “come back” |
| SOC 2 Type II | Vendor register / CISO bake-off |
| Independent pen test | `/trust` Q23 |
| Stripe Enterprise price | Self-serve SKU (do not add until the three above) |

Until then: Team is the top public plan, Compliance is the DPA overlay,
overflow is a grant, checkout stays 503.
