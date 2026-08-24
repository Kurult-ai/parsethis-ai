import { renderPage } from "../lib/html-template.js";
import { CONTACT_EMAIL } from "../lib/constants.js";
import { PLAN_LIMITS } from "../lib/product-facts.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type CheckoutOutcome =
  | { state: "paid"; tier: string }
  | { state: "processing" }
  | { state: "unknown" }
  | { state: "failed_grant"; tier: string };

export type CheckoutKeySnapshot = {
  id: string;
  tier: string;
} | null;

export function isRedisFallbackKeyId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("redis_");
}

/**
 * Congratulate from the key's tier, not from Stripe having taken the card.
 * A Redis-fallback id has no subscriptions row; a still-free key is webhook lag.
 */
export function resolveCheckoutOutcome(args: {
  paymentStatus?: string | null;
  sessionStatus?: string | null;
  metadataTier?: string | null;
  metadataApiKeyId?: string | null;
  key: CheckoutKeySnapshot;
}): CheckoutOutcome {
  const tier = args.metadataTier || undefined;
  const paidAtStripe = args.paymentStatus === "paid" && !!tier;
  if (paidAtStripe) {
    if (!args.metadataApiKeyId || isRedisFallbackKeyId(args.metadataApiKeyId) || !args.key) {
      return { state: "failed_grant", tier };
    }
    if (args.key.tier === tier) {
      return { state: "paid", tier };
    }
    return { state: "processing" };
  }
  if (args.sessionStatus === "complete" || args.paymentStatus === "no_payment_required") {
    return { state: "processing" };
  }
  return { state: "unknown" };
}

/**
 * What a customer sees in the second after paying.
 *
 * Stripe used to return them to /dashboard/billing, which is behind
 * authMiddleware — a browser arriving from Stripe carries no key, so the reward
 * for paying was a raw JSON 401 telling them to supply a Bearer token. This page
 * is public, states plainly that the plan is live, and then gets them into the
 * dashboard using the key the pricing page already put in localStorage: it posts
 * that key to /admin/login, which sets the same httpOnly cookie the login form
 * does. No key or token ever goes in a URL.
 *
 * Paid copy is painted only when the API key already carries the purchased
 * tier. The Stripe session being paid is not enough — a Redis-fallback key
 * cannot be upgraded, and a still-free key means the webhook has not landed.
 */
export function renderCheckoutSuccessPage(baseUrl: string, outcome: CheckoutOutcome): string {
  const limits = outcome.state === "paid"
    ? PLAN_LIMITS[outcome.tier as keyof typeof PLAN_LIMITS]
    : undefined;
  const planLabel = limits?.label ?? (outcome.state === "paid" || outcome.state === "failed_grant"
    ? escapeHtml(outcome.tier)
    : "");

  const headline = outcome.state === "paid"
    ? `${planLabel} is live on your key`
    : outcome.state === "processing"
      ? "Payment received — activating your plan"
      : outcome.state === "failed_grant"
        ? "We could not attach the plan to your key"
        : "We could not find that checkout";

  const lead = outcome.state === "paid"
    ? "Your existing key keeps working. It carries the new limits from the next request, and it no longer expires."
    : outcome.state === "processing"
      ? "Stripe has taken the payment and we are waiting on its confirmation. This usually takes a few seconds. Your key keeps working throughout."
      : outcome.state === "failed_grant"
        ? `Stripe has the payment. The plan is not on the key yet because this account cannot be upgraded automatically. Email ${CONTACT_EMAIL} with the receipt and we will put the plan on your key.`
      : `That checkout session could not be read. If you were charged, nothing is lost — email ${CONTACT_EMAIL} with the receipt and we will put the plan on your key.`;

  const scaleLine =
    outcome.state === "paid" && outcome.tier === "team"
      ? `<li><strong>Unlimited agents, environments and keys</strong> — the 11th agent is 201; named environments persist</li>
  <li><strong>Undeclared Chrome tools 403 on the gateway</strong> — the wire path does not trust metadata</li>
  <li><strong>Forbid per-request downgrades org-wide</strong>, with the change on the audit trail</li>
  <li>Leave later via <code>GET /billing/cancel</code></li>`
      : outcome.state === "paid" && outcome.tier === "pro"
        ? `<li><strong>${PLAN_LIMITS.pro.agents} agents, ${PLAN_LIMITS.pro.environments} environments</strong></li>
  <li><strong>Forbid per-request downgrades org-wide</strong>, with the change on the audit trail</li>`
        : "";

  const whatChanged = outcome.state === "paid" && limits
    ? `
<ul class="checkout-facts">
  <li><strong>${limits.requestsPerMinute} requests/minute</strong>, up from ${PLAN_LIMITS.free.requestsPerMinute} on free</li>
  <li><strong>Unlimited instant screening</strong>, on every plan</li>
  ${"deepScreeningsPerMonth" in limits ? `<li><strong>${limits.deepScreeningsPerMonth.toLocaleString("en-US")} deep screenings</strong> included each month &mdash; going over never stops your screening</li>` : ""}
  ${scaleLine}
  <li><strong>Evidence spans on flags</strong> — the exact text that tripped each one</li>
  <li><strong>No expiry</strong> on the key</li>
</ul>`
    : "";

  const content = `
<section class="hero">
  <p class="eyebrow">Checkout</p>
  <h1>${headline}</h1>
  <p class="lead">${lead}</p>
</section>

${whatChanged}

<div class="checkout-next" id="checkout-next">
  <p id="checkout-status">Opening your billing dashboard…</p>
  <p class="checkout-manual" hidden id="checkout-manual">
    <a class="btn btn-primary" href="/login">Sign in with your API key</a>
    to see billing, usage and invoices.
  </p>
</div>

<script>
(function () {
  var status = document.getElementById('checkout-status');
  var manual = document.getElementById('checkout-manual');
  function fallback(message) {
    if (status) status.textContent = message;
    if (manual) manual.hidden = false;
  }
  var key = null;
  try { key = localStorage.getItem('pfa_key'); } catch (e) { /* storage blocked */ }
  if (!key) {
    fallback('Sign in to see billing, usage and invoices.');
    return;
  }
  fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key })
  }).then(function (r) {
    if (!r.ok) throw new Error('login rejected');
    window.location = '/dashboard/billing';
  }).catch(function () {
    fallback('Sign in to see billing, usage and invoices.');
  });
})();
</script>`;

  return renderPage({
    title: outcome.state === "paid" ? `${planLabel} activated — Parse` : "Checkout — Parse",
    description: outcome.state === "paid"
      ? "Confirmation that your Parse plan is active on your API key."
      : "Checkout status for your Parse plan.",
    path: "/checkout/success",
    content,
    baseUrl,
  });
}
