# Parse for Agents — architecture index

The living contract is `CLAUDE.md`. This file is the map: where a decision
lives, and the run-22 rules that must not be re-derived from stale comments.

## Surfaces

| Surface | Path | Notes |
|---|---|---|
| Prompt screen | `POST /v1/parse` → `src/parse.ts` | Deterministic + optional semantic. Solo defaults to `pattern-only`. |
| Output screen | `POST /v1/screen-output` | Same corroboration rule as input. |
| Explain | `POST /v1/explain` → `src/routes/explain.ts` | Prompt or `trace_id`. Must match parse disposition. Semantic verdicts cannot be bisected. |
| Registry | `POST /v1/agents` | Org-scoped. Paid keys auto-provision an org. |
| Bootstrap | `POST /v1/orgs/bootstrap` | Paid unaffiliated keys may create one org. Already-in-org stays refused. |
| Entitlements | `src/lib/tier-entitlements.ts` | Price-monotonic. Compliance artifacts from Pro. |
| Enterprise inbound | `docs/enterprise-inbound-runbook.md` | Overflow grant, not a SKU. Qualify T1–T4. Checkout 503. |
| Stripe copy | `src/lib/stripe-copy.ts` | Lead with unlimited instant screening. |

## Run-22 decisions (2026-08-18)

1. **Describing ≠ instructing.** The analyst prompt, not a noun list, separates
   an analyst reporting an attack from an injection performing one.
2. **Analysis declarations are not a downgrade.** `summarize` + `retrieved_doc`
   must not refuse more than `summarize` + `user` unless a second detector
   already floors a block.
3. **Paying must not invert the ladder.** `PAID_TIER_PRICE_ORDER` asserts a
   higher-priced tier never has fewer capabilities. Evidence / SIEM / data
   governance ship from Pro; Team is scale.
4. **A Pro key must reach the registry the card sells.** Auto-provision or
   bootstrap; do not 403 both doors.
5. **Hero and Stripe are production.** A hold is not "Allowed". Stripe copy
   must not open with a volume figure that reads as a cap. A green hero must
   not sell Install-free as proof; Start Solo $12 is the ask after a refuse.
   Team Ledger is an HTTP hook on `/ledger#install`, not npm. The $47 audit is
   the 10-technique battery, not the free pack.

## Run-23 decisions (2026-08-18)

1. **No SSN stopword.** Verification-factor frames allow; extract+destination
   still blocks. Same verb-paired branch as `password`.
2. **Conceal the action, not the tool.** `concealed_directive` plus the
   skip-identity triad catch C1/C6 shapes. Staff policy that hides a reset
   *tool* (A3) must not trip that rule.
3. **LLM-only criticals still need a review path** to downgrade via
   `intended_action`. `/v1/activity` is not a review path.
4. **Hero and lab demo buckets are independent.** Shared proxy,
   `src/lib/demo-quota.ts` keys.

## Run-80–85 decisions (2026-08-25)

1. **HTML comments are a carrier, not a verb list.** Deferred `after you … this, …`
   and a tool invocation inside the comment are instructions. Do not union
   `ACTION_DIRECTIVE` (contains `start`).
2. **`{token}-facing` is hide-from-human**, parallel to `{token}-visible`. Do not
   add tenant / partner / occupant as nouns.
3. **Family `partner` is a person-role**, not a compound (`partner-facing`).


Production deploy is local launchd, not GitHub: see `CLAUDE.md` § Deployment.
