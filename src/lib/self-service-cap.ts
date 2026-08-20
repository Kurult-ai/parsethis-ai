/**
 * The one cap on how many self-service keys may exist at once.
 *
 * It used to be two caps. `POST /v1/keys/generate` (free) read a configurable
 * value defaulting to 1,000; `POST /v1/billing/signup-checkout` (paid) carried
 * a hardcoded `100` a few lines from its own key creation. On 2026-08-17 there
 * were 165 live self-service keys, so the free path answered 201 and the paid
 * path answered `429 Maximum number of self-service keys reached` — to every
 * visitor, for about four days, with nothing alerting.
 *
 * The product was unpurchasable while remaining fully usable for free. That is
 * the same invariant `__tests__/billable-usage.test.ts` pins for usage — no
 * paid tier may be refused what the free tier is served — broken one step
 * earlier, at acquisition. A cap that fails closed on revenue is not a safety
 * valve; it is an outage that looks like a policy.
 *
 * So there is one helper, both routes read it, and
 * `__tests__/checkout-not-refused.test.ts` fails if the paid path ever grows a
 * numeric literal of its own again.
 */

/**
 * Launch-stage capacity ceiling. Deliberately generous: this exists to bound
 * abuse of an unauthenticated endpoint, not to ration customers, and the
 * per-IP limiter (5/min) is what actually stops a flood.
 */
export const DEFAULT_SELF_SERVICE_KEY_CAP = 1_000;

/** Env-overridable so capacity can be raised without a deploy. */
export function getSelfServiceKeyCap(): number {
  const raw = process.env.SELF_SERVICE_KEY_CAP ?? process.env.KEYGEN_SELF_SERVICE_KEY_CAP;
  if (!raw) return DEFAULT_SELF_SERVICE_KEY_CAP;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SELF_SERVICE_KEY_CAP;
  return parsed;
}
