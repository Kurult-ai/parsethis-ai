# Parse for Agents — GTM One-Pager
## Screening → Governance Evidence

*Companion to `2026-08-21-metadata-moat-plan-v2-amended.md` (Phase 4 item 4). Every claim below maps to a shipped capability, not a roadmap item.*

---

## The pitch (one sentence)

Every prompt your agents touch becomes **auditable governance evidence** — screened in real time, receipted, joined to human decisions, and exportable to the frameworks your customers already answer to.

## The wedge → the moat

**Wedge (free):** the screening floor. `/v1/parse` on every inbound instruction — pattern + semantic + disposition, reproducible verdicts, honest FPs. No card, no call.

**Paid (the connected layer):** the same traffic, connected:
- **Screening events** — every screen, numbers-only, 90-day retention (enforced by a daily purge, published on `/trust`)
- **Compliance receipts** — tamper-evident record per decision
- **Join keys** — `agent_id` / `org_id` / `policy_version` columns so governance views group by *their* structure (caller-asserted, labeled as such)
- **Outcome labels** — `POST /v1/outcome`: the caller tells us what actually happened (FP? attack? override?) — **paid feature, feeds the loop**
- **Evidence packs** — `POST /v1/compliance/export`: OWASP LLM, NIST AI RMF, EU AI Act, ISO 42001, SOC 2 control mappings; every decision carries its chain: screen → receipt → human decision → outcome
- **12-month views** — `GET /v1/screening/metrics/range`: rollup-backed history that outlives raw-event retention
- **Peer benchmarks** — `GET /v1/benchmarks/peer`: cohort-level (tier × source-kind), k≥5-anonymized, **no thresholds, no "you're worse" verdicts — descriptive percentiles only**

## Why this is defensible (say it exactly this way)

1. **Retention is short and enforced; rollups are numbers-only.** We publish the retention table and the purge is automated. A prospect's security review can verify it.
2. **The moat is the connected history, not the data.** A competitor can copy the schema in a quarter; they can't copy twelve months of a customer's linked governance record. Switching means losing the audit story.
3. **The improvement loop is consent-first.** Free-tier aggregate use is disclosed, opt-out-able, and CI-enforced (metadata allowlist + evidence-span tests). We do not claim "your traffic improves detection for everyone" until the loop demonstrably consumes it *(claim-gate policy — currently unpublished by design)*.
4. **Honest metrics.** Synthetic keys (test/demo traffic) are excluded from every improvement aggregate; outcome precision is measured on labeled traces only and reported with its coverage. What we say in diligence survives diligence.

## Objection → answer

| Objection | Answer |
|---|---|
| "Cloudflare will ship this free" | The screening floor, maybe. The connected layer — receipts, outcomes, evidence packs, 12-month history — is a governance product, not a feature. Their incentive is to route traffic; ours is to be the record of it. |
| "You're selling our data?" | No raw data, no customer-level data, ever. Numbers-only rollups, k≥5, opt-out honored, retention published. The moat is the connection, not the data. |
| "Is this SOC 2?" | No — and we don't pretend. Evidence packs map to SOC 2 *controls* (CC6/CC7) and we're on the readiness path. Trust posture first. |
| "Free users are the product" | Free users get the same screening, the same retention, and a working opt-out that excludes their traffic from improvement aggregates (abuse prevention unaffected). Disclosed at key creation. |

## Pricing story

- **Free** — screening floor + own metrics. No outcome labels, no evidence packs, no benchmarks.
- **Solo $12 / Pro $49** — outcome labels + 12-month range views + evidence packs (Pro: peer benchmarks).
- **Team $199 / Compliance $199** — org join keys, SIEM forwarding with the full decision chain, auditor role.

*Upgrade moments are structural, not artificial: the first auditor ask, the first board question, the first "prove what your agents did."*

## What NOT to say (sales discipline)

- No network-effect claims. It's compounding precision + governance lock-in.
- No "improves detection for everyone" until the claim-gate opens (Phase 3 loop must demonstrably consume aggregates first).
- No raw-data or customer-level aggregation language — ever.
- Don't oversell benchmarks: descriptive percentiles, k-anonymized, no verdicts.

---

*Status: all capabilities above are shipped in the repo. The public aggregate report generator exists (`GET /v1/reports/aggregate`, operator-scoped) and is deliberately unpublished pending the claim-gate.*
