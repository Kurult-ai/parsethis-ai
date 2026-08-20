/**
 * Task 18.5 — Value Ladder Rung: $47 Self-Serve Audit Product
 *
 * Routes:
 *   GET  /audit          — SSR landing page explaining the audit product + CTA
 *   POST /audit/purchase — Creates a Stripe Payment checkout session for $47
 *   POST /audit/run      — Runs screening on submitted prompts, generates branded HTML report
 */

import { Hono } from "hono";
import type Stripe from "stripe";
import { getStripe, isStripeEnabled, isStripeMockMode } from "../stripe.js";
import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { PRODUCT } from "../lib/product-facts.js";
import { parsePrompt } from "../parse.js";
import type { ParseResponse } from "../parse.js";
import { generateAuditReport } from "../lib/compliance/audit-report.js";
import type { AppEnv } from "../types.js";

export const auditProductRoutes = new Hono<AppEnv>();

// ── Stripe price config for the one-time $47 audit product ──────────────────

export const AUDIT_PRODUCT_CONFIG = {
  /** Product name shown in Stripe checkout and marketing */
  name: "Parse Security Audit",
  /** Price in USD cents */
  priceUSD: 47,
  priceCents: 4700,
  /** Stripe Price ID (set via env var in production) */
  priceEnvVar: "STRIPE_AUDIT_PRICE_ID",
  /** Maximum prompts allowed in a single audit run */
  maxPromptsPerAudit: 25,
  /** Maximum characters per prompt in an audit */
  maxPromptLength: 8000,
} as const;

/**
 * Create a Stripe Payment Mode checkout session for the one-time $47 audit.
 * Unlike subscription tiers (Pro/Team/Compliance), this uses mode=payment.
 */
export async function createAuditCheckoutSession(
  baseUrl: string,
  metadata?: Record<string, string>,
): Promise<string> {
  if (isStripeMockMode()) {
    const url = new URL("https://stripe.mock/checkout/session");
    url.searchParams.set("mode", "payment");
    url.searchParams.set("product", "audit");
    url.searchParams.set("success_url", `${baseUrl}/audit?paid=1`);
    url.searchParams.set("cancel_url", `${baseUrl}/audit`);
    return url.toString();
  }

  const stripe = getStripe();
  const priceId = process.env[AUDIT_PRODUCT_CONFIG.priceEnvVar];

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    branding_settings: { display_name: "Parse" },
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: "usd",
              unit_amount: AUDIT_PRODUCT_CONFIG.priceCents,
              product_data: {
                name: AUDIT_PRODUCT_CONFIG.name,
                description: "One-time AI agent security audit with branded report",
              },
            },
            quantity: 1,
          },
        ],
    metadata: { product: "audit", ...metadata },
    success_url: `${baseUrl}/audit?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/audit`,
  });
  return session.url!;
}

// ── GET /audit — SSR landing page ───────────────────────────────────────────

auditProductRoutes.get("/audit", (c) => {
  const baseUrl =
    c.req.header("x-forwarded-proto")
      ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
      : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";

  const paid = c.req.query("paid") === "1";

  const content = `
<style>
  .audit-hero {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 28px;
    align-items: center;
    min-height: 340px;
  }
  .audit-hero-copy { display: flex; flex-direction: column; justify-content: center; }
  .audit-hero-copy h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 12px; }
  .audit-hero-copy .answer-capsule { font-size: 17px; margin-bottom: 20px; }
  .audit-features { list-style: none; padding: 0; margin: 0 0 24px; }
  .audit-features li {
    padding: 8px 0;
    font-size: 15px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .audit-features li::before { content: "✓"; color: var(--accent2); font-weight: 700; }
  .audit-card {
    background: linear-gradient(145deg, rgba(47, 111, 237, 0.10), rgba(25, 182, 175, 0.07));
    border: 1px solid rgba(47, 111, 237, 0.30);
    border-radius: 10px;
    padding: 28px;
    box-shadow: 0 18px 55px rgba(10, 22, 45, 0.10);
  }
  .audit-card .price {
    font-size: 48px;
    font-weight: 800;
    letter-spacing: -0.03em;
  }
  .audit-card .price-sub {
    font-size: 14px;
    color: var(--text-dim);
    margin-bottom: 20px;
  }
  .audit-card .btn-primary {
    width: 100%;
    text-align: center;
    font-size: 17px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .audit-card .btn-outline {
    width: 100%;
    text-align: center;
  }
  .audit-paid-banner {
    background: rgba(22, 163, 74, 0.12);
    border: 1px solid rgba(22, 163, 74, 0.35);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 24px;
    font-size: 15px;
    color: #15803d;
  }
  .audit-runner {
    margin-top: 36px;
  }
  .audit-runner textarea {
    width: 100%;
    min-height: 120px;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
    font-family: monospace;
    font-size: 13px;
    resize: vertical;
    background: var(--surface);
    color: var(--text);
  }
  .audit-runner .prompt-row { margin-bottom: 12px; }
  .audit-runner .prompt-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .audit-runner .btn-row {
    display: flex;
    gap: 10px;
    margin-top: 16px;
    flex-wrap: wrap;
  }
  .audit-runner .btn-secondary {
    font-size: 14px;
  }
  .audit-result {
    margin-top: 28px;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .audit-result iframe {
    width: 100%;
    min-height: 600px;
    border: none;
  }
  .audit-how-it-works {
    margin-top: 36px;
  }
  .audit-how-it-works .step-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 16px;
  }
  .audit-how-it-works .step {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
  }
  .audit-how-it-works .step-num {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }
  .audit-how-it-works .step h3 { margin: 8px 0 6px; font-size: 17px; }
  .audit-how-it-works .step p { font-size: 14px; color: var(--text-dim); margin: 0; }
  @media (max-width: 820px) {
    .audit-hero { grid-template-columns: 1fr; }
    .audit-how-it-works .step-grid { grid-template-columns: 1fr; }
  }
</style>

<div class="section-chunk animate-in audit-hero">
  <div class="audit-hero-copy">
    <h1>AI Agent Security Audit</h1>
    <p class="answer-capsule">
      Submit your agent prompts and get a full security audit report with risk scores,
      vulnerability breakdown, remediation checklist, and compliance mapping — in minutes.
    </p>
    <ul class="audit-features">
      <li>Risk score (0–100) across all submitted prompts</li>
      <li>Vulnerability breakdown by attack category</li>
      <li>Actionable remediation checklist with priority levels</li>
      <li>OWASP LLM Top 10, NIST AI RMF, and SOC 2 compliance mapping</li>
      <li>Branded PDF-ready HTML report — yours to keep</li>
    </ul>
  </div>
  <div class="audit-card">
    <div class="price">$${AUDIT_PRODUCT_CONFIG.priceUSD}</div>
    <div class="price-sub">one-time payment · up to ${AUDIT_PRODUCT_CONFIG.maxPromptsPerAudit} prompts</div>
    ${paid ? `
      <div class="audit-paid-banner">✅ Payment received! Submit your prompts below to generate your audit report.</div>
      <button type="button" class="btn btn-primary" id="scroll-to-runner">Run Your Audit ↓</button>
    ` : `
      <button type="button" class="btn btn-primary" id="audit-purchase-btn">Get Audit Report — $${AUDIT_PRODUCT_CONFIG.priceUSD}</button>
    `}
    <a href="/pricing" class="btn btn-outline" style="display:block;">Compare All Plans</a>
  </div>
</div>

<div class="section-chunk audit-how-it-works">
  <h2 style="margin-top:0;">How it works</h2>
  <div class="step-grid">
    <div class="step">
      <div class="step-num">Step 1</div>
      <h3>Pay $${AUDIT_PRODUCT_CONFIG.priceUSD}</h3>
      <p>Secure one-time checkout via Stripe. No subscription needed.</p>
    </div>
    <div class="step">
      <div class="step-num">Step 2</div>
      <h3>Submit prompts</h3>
      <p>Paste up to ${AUDIT_PRODUCT_CONFIG.maxPromptsPerAudit} agent prompts you want audited.</p>
    </div>
    <div class="step">
      <div class="step-num">Step 3</div>
      <h3>Get your report</h3>
      <p>Download a branded security audit report with scores and remediation steps.</p>
    </div>
  </div>
</div>

${paid ? `
<div class="section-chunk audit-runner" id="audit-runner-section">
  <h2 style="margin-top:0;">Run Your Audit</h2>
  <p class="answer-capsule">Paste your agent prompts below (one per field). Each will be screened through Parse's full pattern + LLM analysis pipeline.</p>
  <form id="audit-form">
    <div id="prompt-fields">
      <div class="prompt-row">
        <div class="prompt-label">Prompt 1</div>
        <textarea class="audit-prompt-input" placeholder="Paste an agent prompt here..." maxlength="${AUDIT_PRODUCT_CONFIG.maxPromptLength}"></textarea>
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="btn btn-secondary" id="add-prompt-btn">+ Add Prompt</button>
      <button type="submit" class="btn btn-primary" id="run-audit-btn">Run Audit & Generate Report</button>
    </div>
    <p id="audit-error" style="color:#dc2626;font-size:14px;margin-top:8px;display:none;"></p>
  </form>
  <div id="audit-result-container"></div>
</div>
` : ""}

<script>
(function() {
  // Purchase button
  var purchaseBtn = document.getElementById('audit-purchase-btn');
  if (purchaseBtn) {
    purchaseBtn.addEventListener('click', async function() {
      purchaseBtn.disabled = true;
      purchaseBtn.textContent = 'Redirecting to checkout...';
      try {
        var resp = await fetch('/audit/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (resp.ok) {
          var data = await resp.json();
          if (data.checkout_url) {
            window.location = data.checkout_url;
            return;
          }
        }
        var err = await resp.json().catch(function() { return {}; });
        purchaseBtn.disabled = false;
        purchaseBtn.textContent = 'Get Audit Report — $${AUDIT_PRODUCT_CONFIG.priceUSD}';
        alert(err.error || 'Failed to start checkout. Please try again.');
      } catch (e) {
        purchaseBtn.disabled = false;
        purchaseBtn.textContent = 'Get Audit Report — $${AUDIT_PRODUCT_CONFIG.priceUSD}';
        alert('Network error. Please try again.');
      }
    });
  }

  // Scroll to runner if paid
  var scrollBtn = document.getElementById('scroll-to-runner');
  if (scrollBtn) {
    scrollBtn.addEventListener('click', function() {
      var runner = document.getElementById('audit-runner-section');
      if (runner) runner.scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Add prompt field
  var addBtn = document.getElementById('add-prompt-btn');
  var promptFields = document.getElementById('prompt-fields');
  var promptCount = 1;
  var maxPrompts = ${AUDIT_PRODUCT_CONFIG.maxPromptsPerAudit};
  if (addBtn && promptFields) {
    addBtn.addEventListener('click', function() {
      if (promptCount >= maxPrompts) {
        alert('Maximum ' + maxPrompts + ' prompts per audit.');
        return;
      }
      promptCount++;
      var row = document.createElement('div');
      row.className = 'prompt-row';
      row.innerHTML = '<div class="prompt-label">Prompt ' + promptCount + '</div>' +
        '<textarea class="audit-prompt-input" placeholder="Paste an agent prompt here..." maxlength="${AUDIT_PRODUCT_CONFIG.maxPromptLength}"></textarea>';
      promptFields.appendChild(row);
    });
  }

  // Run audit
  var form = document.getElementById('audit-form');
  if (form) {
    form.addEventListener('submit', async function(e) {
      e.preventDefault();
      var runBtn = document.getElementById('run-audit-btn');
      var errEl = document.getElementById('audit-error');
      errEl.style.display = 'none';

      var textareas = document.querySelectorAll('.audit-prompt-input');
      var prompts = [];
      textareas.forEach(function(ta) {
        var v = ta.value.trim();
        if (v) prompts.push(v);
      });

      if (prompts.length === 0) {
        errEl.textContent = 'Please enter at least one prompt to audit.';
        errEl.style.display = 'block';
        return;
      }

      runBtn.disabled = true;
      runBtn.textContent = 'Running audit...';

      try {
        var resp = await fetch('/audit/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompts: prompts })
        });
        if (resp.ok) {
          var data = await resp.json();
          var container = document.getElementById('audit-result-container');
          if (data.report_html) {
            container.innerHTML = '<div class="audit-result"><iframe srcdoc="' +
              data.report_html.replace(/"/g, '&quot;') +
              '"></iframe></div>';
            container.scrollIntoView({ behavior: 'smooth' });
          } else if (data.error) {
            errEl.textContent = data.error;
            errEl.style.display = 'block';
          }
        } else {
          var err = await resp.json().catch(function() { return {}; });
          errEl.textContent = err.error || 'Audit failed. Please try again.';
          errEl.style.display = 'block';
        }
      } catch (e2) {
        errEl.textContent = 'Network error. Please try again.';
        errEl.style.display = 'block';
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'Run Audit & Generate Report';
      }
    });
  }
})();
</script>
`;

  return c.html(
    renderPage({
      title: `AI Agent Security Audit — $${AUDIT_PRODUCT_CONFIG.priceUSD} | ${PRODUCT.name}`,
      description:
        `One-time AI agent security audit for $${AUDIT_PRODUCT_CONFIG.priceUSD}. Submit your prompts, get a branded report with risk scores, vulnerability breakdown, remediation checklist, and OWASP/NIST/SOC 2 compliance mapping.`,
      path: "/audit",
      content,
      baseUrl,
      jsonLd: [organizationSchema(baseUrl)],
      breadcrumbs: [
        { name: "Home", href: "/" },
        { name: "Security Audit", href: "/audit" },
      ],
      lastUpdated: "2026-08-08T00:00:00-04:00",
    }),
  );
});

// ── POST /audit/purchase — Create Stripe checkout session ───────────────────

auditProductRoutes.post("/audit/purchase", async (c) => {
  if (!isStripeEnabled()) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  const baseUrl =
    c.req.header("x-forwarded-proto")
      ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
      : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";

  try {
    const checkoutUrl = await createAuditCheckoutSession(baseUrl);
    return c.json({ checkout_url: checkoutUrl });
  } catch (err) {
    console.error("[audit] Checkout session error:", (err as Error).message);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

// ── POST /audit/run — Run screening and generate report ─────────────────────

auditProductRoutes.post("/audit/run", async (c) => {
  let body: { prompts?: string[]; customer_name?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const prompts = body.prompts;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return c.json({ error: "Must provide at least one prompt to audit" }, 400);
  }

  if (prompts.length > AUDIT_PRODUCT_CONFIG.maxPromptsPerAudit) {
    return c.json(
      { error: `Maximum ${AUDIT_PRODUCT_CONFIG.maxPromptsPerAudit} prompts per audit` },
      400,
    );
  }

  // Validate prompt lengths
  for (const p of prompts) {
    if (typeof p !== "string" || p.trim().length === 0) {
      return c.json({ error: "All prompts must be non-empty strings" }, 400);
    }
    if (p.length > AUDIT_PRODUCT_CONFIG.maxPromptLength) {
      return c.json(
        { error: `Each prompt must be under ${AUDIT_PRODUCT_CONFIG.maxPromptLength} characters` },
        400,
      );
    }
  }

  const baseUrl =
    c.req.header("x-forwarded-proto")
      ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
      : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";

  // Run screening on each prompt through the full parse pipeline
  const results: Array<{ text: string; label?: string; parseResponse: ParseResponse }> = [];

  for (let i = 0; i < prompts.length; i++) {
    try {
      const response = await parsePrompt({
        prompt: prompts[i],
        mode: "full",
        policy_mode: "strict",
      });
      results.push({
        text: prompts[i],
        label: `Prompt ${i + 1}`,
        parseResponse: response,
      });
    } catch (err) {
      console.error(`[audit] Screening failed for prompt ${i + 1}:`, (err as Error).message);
      // Continue with remaining prompts rather than failing the whole audit
    }
  }

  if (results.length === 0) {
    return c.json({ error: "All prompt screenings failed. Please try again." }, 500);
  }

  // Generate the branded HTML report
  const reportHtml = generateAuditReport({
    prompts: results,
    customerName: body.customer_name,
    auditedAt: new Date().toISOString(),
    baseUrl,
  });

  return c.json({
    report_html: reportHtml,
    prompts_screened: results.length,
    generated_at: new Date().toISOString(),
  });
});
