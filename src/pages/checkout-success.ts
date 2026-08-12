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
  | { state: "unknown" };

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
 * The tier shown comes from the Stripe session read server-side, not from a
 * query parameter, so the page cannot be made to congratulate someone on a plan
 * they did not buy.
 */
export function renderCheckoutSuccessPage(baseUrl: string, outcome: CheckoutOutcome): string {
  const limits = outcome.state === "paid"
    ? PLAN_LIMITS[outcome.tier as keyof typeof PLAN_LIMITS]
    : undefined;
  const planLabel = limits?.label ?? (outcome.state === "paid" ? escapeHtml(outcome.tier) : "");

  const headline = outcome.state === "paid"
    ? `${planLabel} is live on your key`
    : outcome.state === "processing"
      ? "Payment received — activating your plan"
      : "We could not find that checkout";

  const lead = outcome.state === "paid"
    ? "Your existing key keeps working. It carries the new limits from the next request, and it no longer expires."
    : outcome.state === "processing"
      ? "Stripe has taken the payment and we are waiting on its confirmation. This usually takes a few seconds. Your key keeps working throughout."
      : `That checkout session could not be read. If you were charged, nothing is lost — email ${CONTACT_EMAIL} with the receipt and we will put the plan on your key.`;

  const whatChanged = outcome.state === "paid" && limits
    ? `
<ul class="checkout-facts">
  <li><strong>${limits.requestsPerMinute} requests/minute</strong>, up from ${PLAN_LIMITS.free.requestsPerMinute} on free</li>
  ${"requestsPerMonth" in limits ? `<li><strong>${limits.requestsPerMonth.toLocaleString("en-US")} screenings</strong> included each month</li>` : ""}
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
    description: "Confirmation that your Parse plan is active on your API key.",
    path: "/checkout/success",
    content,
    baseUrl,
  });
}
