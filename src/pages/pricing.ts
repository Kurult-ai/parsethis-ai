import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { LATENCY_FACTS, PLAN_LIMITS, PRODUCT, X402_ENDPOINTS, X402_PAYMENT, x402EndpointList } from "../lib/product-facts.js";

export function renderPricingPage(baseUrl: string): string {
  const parsePrice = X402_ENDPOINTS.parse.price;
  const outputPrice = X402_ENDPOINTS.screen_output.price;
  const x402SetupPrompt = `Integrate Parse x402 pay-per-call screening.

Goal:
- Use Parse before an autonomous agent lets untrusted text affect tools, memory, private owner data, credentials, payments, code execution, other agents, or user-visible output.
- Prefer Bearer auth when PARSE_API_KEY exists.
- If no account context exists or Parse returns HTTP 402, use x402.
- Make setup frictionless: expose or use status, doctor, test, pricing, and x402-status checks so the operator can see what is configured and what remains missing.

Payment facts:
- Prompt screening: ${X402_ENDPOINTS.parse.method} ${baseUrl}${X402_ENDPOINTS.parse.path} costs ${parsePrice} ${X402_PAYMENT.currency}.
- Output screening: ${X402_ENDPOINTS.screen_output.method} ${baseUrl}${X402_ENDPOINTS.screen_output.path} costs ${outputPrice} ${X402_PAYMENT.currency}.
- Asset: ${X402_PAYMENT.currency} at ${X402_PAYMENT.assetAddress}.
- Network: ${X402_PAYMENT.networkName} (${X402_PAYMENT.network}).
- Pricing manifest: ${baseUrl}/v1/pricing.
- Retry header: ${X402_PAYMENT.header}; legacy clients may send ${X402_PAYMENT.legacyHeader}.

First-use path:
1. Prefer Bearer auth when PARSE_API_KEY exists; use x402 as the no-account/pay-per-call fallback.
2. Read ${baseUrl}/v1/pricing, make the unauthenticated request, then retry the identical request with the advertised x402 payment header only after operator spending approval.
3. Do not print private keys, seed phrases, payment signatures, API keys, or wallet secrets.

Generic implementation steps:
1. Call GET ${baseUrl}/v1/pricing and read the x402 accepts[] payment requirements.
2. Send the intended Parse request without a bearer key when using pay-per-call.
3. On HTTP 402, sign the advertised USDC payment with a scoped funded wallet.
4. Retry the identical request with the ${X402_PAYMENT.header} header.
5. Treat Parse's decision.action, recommended_action, or suggested_action as authoritative for the agent boundary.

Required verification:
- Benign local fixture returns allow.
- Encoded prompt-injection fixture returns block.
- Tool-output/JSON instruction fixture returns block.
- Status/doctor output redacts secrets and gives the next action.`;

  const x402Rows = x402EndpointList().map((endpoint) => `
        <tr>
          <td><code>${endpoint.method} ${endpoint.path}</code></td>
          <td>${endpoint.price}</td>
          <td>${endpoint.description}</td>
        </tr>`).join("");

  const content = `
<style>
  .pricing-hero {
    display:grid;
    grid-template-columns:minmax(0,1.05fr) minmax(320px,0.95fr);
    gap:28px;
    align-items:stretch;
  }
  .pricing-hero-copy {
    display:flex;
    flex-direction:column;
    justify-content:center;
    min-height:360px;
  }
  .pricing-x402-panel {
    background:linear-gradient(145deg, rgba(61, 123, 255, 0.10), rgba(6, 182, 212, 0.06));
    border:1px solid rgba(47, 111, 237, 0.34);
    border-radius:8px;
    padding:24px;
    box-shadow:0 18px 55px rgba(10, 22, 45, 0.11);
  }
  .pricing-x402-head {
    display:flex;
    justify-content:space-between;
    gap:16px;
    align-items:flex-start;
    margin-bottom:18px;
  }
  .pricing-label {
    color:var(--text-dim);
    font-size:12px;
    font-weight:700;
    letter-spacing:0.08em;
    text-transform:uppercase;
  }
  .pricing-price-grid {
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:12px;
    margin:18px 0;
  }
  .pricing-price-tile {
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:8px;
    padding:16px;
  }
  .pricing-price-tile strong {
    display:block;
    font-size:30px;
    line-height:1;
    letter-spacing:0;
    margin:8px 0 6px;
  }
  .pricing-fact-strip {
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:10px;
    margin:18px 0;
  }
  .pricing-fact {
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:8px;
    padding:12px;
    min-width:0;
  }
  .pricing-fact strong,
  .pricing-fact code {
    display:block;
    margin-top:4px;
    overflow-wrap:anywhere;
  }
  .pricing-action-row {
    display:flex;
    align-items:center;
    flex-wrap:wrap;
    gap:10px;
    margin-top:18px;
  }
  .pricing-copy-status {
    color:var(--text-dim);
    font-size:13px;
    min-height:1.3em;
  }
  .pricing-decision-grid {
    display:grid;
    grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
    gap:12px;
    margin-top:16px;
  }
  .pricing-decision {
    border:1px solid var(--border);
    border-radius:8px;
    padding:16px;
    background:var(--surface);
  }
  .pricing-decision h3 {
    margin:6px 0 8px;
    font-size:18px;
  }
  .pricing-choice-rail {
    display:flex;
    flex-wrap:wrap;
    gap:10px;
    margin-top:18px;
  }
  .pricing-choice {
    flex:1 1 190px;
    border:1px solid var(--border);
    border-radius:8px;
    padding:12px 14px;
    background:var(--surface);
  }
  .pricing-choice strong {
    display:block;
    margin-top:4px;
  }
  .pricing-muted {
    color:var(--text-dim);
    font-size:14px;
    margin:0;
  }
  @media (max-width: 820px) {
    .pricing-hero { grid-template-columns:1fr; }
    .pricing-hero-copy { min-height:auto; }
    .pricing-price-grid,
    .pricing-fact-strip { grid-template-columns:1fr; }
    .pricing-choice-rail { display:none; }
  }
</style>
<!-- Chunk 1: Hero -->
<div class="section-chunk animate-in pricing-hero">
  <div class="pricing-hero-copy">
    <h1>Pricing</h1>
    <p class="answer-capsule">Pay per screening with x402, or use a monthly key when request volume becomes predictable. Detection reduces risk; it does not replace least-privilege tools or output validation.</p>
    <div class="pricing-choice-rail" aria-label="Pricing choices">
      <div class="pricing-choice">
        <span class="pricing-label">No account</span>
        <strong>x402 pay-per-call</strong>
      </div>
      <div class="pricing-choice">
        <span class="pricing-label">Steady volume</span>
        <strong>Monthly API key</strong>
      </div>
    </div>
  </div>

  <section class="pricing-x402-panel" aria-labelledby="x402-pricing-title">
    <div class="pricing-x402-head">
      <div>
        <div class="pricing-label">x402 pay-per-call</div>
        <h2 id="x402-pricing-title" style="margin:4px 0 0;">Screen first, pay only for the call.</h2>
      </div>
    </div>
    <div class="pricing-price-grid" aria-label="x402 screening prices">
      <div class="pricing-price-tile">
        <div class="pricing-label">Prompt screening</div>
        <strong>${parsePrice}</strong>
        <p class="pricing-muted"><code>POST /v1/parse</code></p>
      </div>
      <div class="pricing-price-tile">
        <div class="pricing-label">Output screening</div>
        <strong>${outputPrice}</strong>
        <p class="pricing-muted"><code>POST /v1/screen-output</code></p>
      </div>
    </div>
    <div class="pricing-bundle-note" style="margin-top:18px;padding:16px 18px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.02);">
      <p style="margin:0 0 8px;font-size:14px;"><strong>What the call includes.</strong> A screening call is priced above the raw classifier endpoints sold by the hyperscalers, and it should be compared for what it carries, not per invocation alone.</p>
      <p class="pricing-muted" style="margin:0;font-size:13.5px;">Every verdict is recorded against a registered agent, evaluated under your versioned policy, and returned with a receipt — category, score, action and <code>trace_id</code> — that your auditor can read and your SIEM can ingest. That evidence trail, the agent registry, the enforcement dial and the OWASP LLM / NIST AI RMF / EU AI Act / ISO 42001 crosswalk are the product. Screening is the mechanism underneath it. If you need a bare classifier call and nothing around it, a commodity endpoint will be cheaper per request; if you need to show someone what your agents did and under which rule, that is what you are buying here.</p>
    </div>
    <div class="pricing-fact-strip" aria-label="x402 payment rail">
      <div class="pricing-fact">
        <span class="pricing-label">Asset</span>
        <strong>${X402_PAYMENT.currency}</strong>
      </div>
      <div class="pricing-fact">
        <span class="pricing-label">Network</span>
        <strong>${X402_PAYMENT.networkName}</strong>
        <code>${X402_PAYMENT.network}</code>
      </div>
      <div class="pricing-fact">
        <span class="pricing-label">Token</span>
        <code>${X402_PAYMENT.assetAddress}</code>
      </div>
    </div>
    <div class="pricing-action-row">
      <button type="button" class="btn btn-primary" id="copy-x402-prompt">Copy x402 setup prompt</button>
      <a href="/docs/x402" class="btn btn-outline">Read x402 guide</a>
      <span class="pricing-copy-status" id="copy-x402-status" aria-live="polite"></span>
    </div>
  </section>
</div>

<!-- Chunk 2: x402 setup -->
<div class="section-chunk">
  <h2 style="margin-top:0;">x402 setup in four steps</h2>
  <div class="pricing-decision-grid">
    <div class="pricing-decision"><div class="pricing-label">1</div><h3>Read prices</h3><p class="pricing-muted">Call <code>GET /v1/pricing</code> and inspect <code>accepts[]</code>.</p></div>
    <div class="pricing-decision"><div class="pricing-label">2</div><h3>Call endpoint</h3><p class="pricing-muted">Send the screening request without a bearer key when using pay-per-call.</p></div>
    <div class="pricing-decision"><div class="pricing-label">3</div><h3>Sign USDC</h3><p class="pricing-muted">Pay on ${X402_PAYMENT.networkName} with a scoped funded wallet.</p></div>
    <div class="pricing-decision"><div class="pricing-label">4</div><h3>Retry request</h3><p class="pricing-muted">Retry with <code>${X402_PAYMENT.header}</code>; legacy clients may send <code>${X402_PAYMENT.legacyHeader}</code>.</p></div>
  </div>
</div>

<script>
(function() {
  var promptText = ${JSON.stringify(x402SetupPrompt)};
  var button = document.getElementById('copy-x402-prompt');
  var status = document.getElementById('copy-x402-status');
  function setStatus(message) {
    if (!status) return;
    status.textContent = message;
    if (message) setTimeout(function(){ status.textContent = ''; }, 2600);
  }
  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      setStatus('Copied setup prompt.');
    } catch (_) {
      setStatus('Copy failed. Open /docs/x402 for setup.');
    }
    document.body.removeChild(area);
  }
  if (button) {
    button.addEventListener('click', function() {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(promptText).then(function() {
          setStatus('Copied setup prompt.');
        }).catch(function() {
          fallbackCopy(promptText);
        });
      } else {
        fallbackCopy(promptText);
      }
    });
  }
})();
</script>

<!-- Chunk 3: Value Ladder -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Value Ladder</h2>
  <p class="answer-capsule">From free exploration to full implementation — find your entry point and climb as your needs grow.</p>

  <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin:16px 0 24px;font-size:13px;">
    <span style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-weight:600;">Free $0</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-weight:600;">Solo $12/mo</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:rgba(47,111,237,0.10);border:1px solid rgba(47,111,237,0.30);border-radius:20px;padding:4px 14px;font-weight:600;">Audit $47</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:var(--surface);border:1px solid var(--accent);border-radius:20px;padding:4px 14px;font-weight:600;">Pro $49/mo</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-weight:600;">Team $199/mo</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:rgba(25,182,175,0.10);border:1px solid var(--accent2);border-radius:20px;padding:4px 14px;font-weight:600;">Compliance $999/mo</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:rgba(47,111,237,0.10);border:1px solid rgba(47,111,237,0.40);border-radius:20px;padding:4px 14px;font-weight:600;">Volume $4,999/mo</span>
    <span style="color:var(--text-dim);">→</span>
    <span style="background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:4px 14px;font-weight:600;">Implementation $3K–$15K</span>
  </div>

  <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));">

    <!-- Free -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Free</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$0</div>
        <div style="font-size:13px;color:var(--text-dim);">forever</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.free.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Keys auto-renew while in use; idle 30 days = expiry (fails closed, 401)</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Self-service</li>
        <li style="padding:6px 0;">${PLAN_LIMITS.free.sandboxExecutionsPerHour} sandbox/hr</li>
      </ul>
      <a href="/v1/keys/generate" class="btn btn-outline" style="width:100%;text-align:center;">Install Parse — free</a>
    </div>

    <!-- Solo -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;position:relative;">
      <span class="badge" style="position:absolute;top:-10px;right:16px;background:var(--surface);border:1px solid var(--border);">For one agent</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Solo</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$12<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">2K requests included</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.solo.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Non-expiring key</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Evidence spans in flags</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$0.005/overage request</li>
        <li style="padding:6px 0;">${PLAN_LIMITS.solo.sandboxExecutionsPerHour} sandbox/hr</li>
      </ul>
      <a href="/v1/billing/checkout" class="btn btn-outline" style="width:100%;text-align:center;" onclick="event.preventDefault();(async()=>{try{const k=localStorage.getItem('pfa_key');if(k){const r=await fetch('/v1/billing/checkout',{method:'POST',headers:{'Authorization':'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({tier:'solo'})});if(r.ok){const d=await r.json();if(d.url){window.location=d.url;return;}}}const r2=await fetch('/v1/billing/signup-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'solo'})});if(!r2.ok){const err=await r2.json().catch(()=>({}));alert(err.error||'Signup failed');return;}const d2=await r2.json();if(d2.key)localStorage.setItem('pfa_key',d2.key);if(d2.checkout_url){window.location=d2.checkout_url;}else{window.location='mailto:${PRODUCT.contactEmail}?subject=Solo%20Plan';}}catch{window.location='mailto:${PRODUCT.contactEmail}?subject=Solo%20Plan';}})();">Start Solo</a>
    </div>

    <!-- $47 Security Audit (one-time) -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;border-color:rgba(47,111,237,0.40);position:relative;background:linear-gradient(145deg,rgba(47,111,237,0.06),rgba(25,182,175,0.04));">
      <span class="badge badge-accent" style="position:absolute;top:-10px;right:16px;">One-Time</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Security Audit</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$47</div>
        <div style="font-size:13px;color:var(--text-dim);">one-time report</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Risk score (0&ndash;100)</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Vulnerability breakdown</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Remediation checklist</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">OWASP/NIST/SOC&nbsp;2 mapping</li>
        <li style="padding:6px 0;">Up to 25 prompts</li>
      </ul>
      <a href="/audit" class="btn btn-primary" style="width:100%;text-align:center;">Get Audit Report</a>
    </div>

    <!-- Pro -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;border-color:var(--accent);position:relative;">
      <span class="badge badge-accent" style="position:absolute;top:-10px;right:16px;">Most Popular</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Pro</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$49<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">10K requests included</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.pro.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$0.003/overage request</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.pro.sandboxExecutionsPerHour} sandbox/hr</li>
        <li style="padding:6px 0;">Self-serve checkout</li>
      </ul>
      <a href="/v1/billing/checkout" class="btn btn-primary" style="width:100%;text-align:center;" onclick="event.preventDefault();(async()=>{try{const k=localStorage.getItem('pfa_key');if(k){const r=await fetch('/v1/billing/checkout',{method:'POST',headers:{'Authorization':'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({tier:'pro'})});if(r.ok){const d=await r.json();if(d.url){window.location=d.url;return;}}}const r2=await fetch('/v1/billing/signup-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'pro'})});if(!r2.ok){const err=await r2.json().catch(()=>({}));alert(err.error||'Signup failed');return;}const d2=await r2.json();if(d2.key)localStorage.setItem('pfa_key',d2.key);if(d2.checkout_url){window.location=d2.checkout_url;}else{window.location='mailto:${PRODUCT.contactEmail}?subject=Pro%20Plan';}}catch{window.location='mailto:${PRODUCT.contactEmail}?subject=Pro%20Plan';}})();">Start Pro</a>
    </div>

    <!-- Team -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Team</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$199<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">50K requests included</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.team.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$0.002/overage request</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.team.sandboxExecutionsPerHour} sandbox/hr</li>
        <li style="padding:6px 0;">Priority support</li>
      </ul>
      <a href="/v1/billing/checkout" class="btn btn-primary" style="width:100%;text-align:center;" onclick="event.preventDefault();(async()=>{try{const k=localStorage.getItem('pfa_key');if(k){const r=await fetch('/v1/billing/checkout',{method:'POST',headers:{'Authorization':'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({tier:'team'})});if(r.ok){const d=await r.json();if(d.url){window.location=d.url;return;}}}const r2=await fetch('/v1/billing/signup-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'team'})});if(!r2.ok){const err=await r2.json().catch(()=>({}));alert(err.error||'Signup failed');return;}const d2=await r2.json();if(d2.key)localStorage.setItem('pfa_key',d2.key);if(d2.checkout_url){window.location=d2.checkout_url;}else{window.location='mailto:${PRODUCT.contactEmail}?subject=Team%20Plan';}}catch{window.location='mailto:${PRODUCT.contactEmail}?subject=Team%20Plan';}})();">Start Team</a>
    </div>

    <!-- Compliance -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;border-color:var(--accent2);position:relative;">
      <span class="badge badge-accent" style="position:absolute;top:-10px;right:16px;">Compliance</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Compliance</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$999<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">SIEM, evidence packs, data governance</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.compliance.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">SIEM forwarding (Splunk/Datadog)</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Custom rules &amp; framework mapping</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Evidence packs (OWASP/NIST/SOC&nbsp;2)</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Org model &amp; RBAC</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Data governance (grants, egress, budgets)</li>
        <li style="padding:6px 0;">${PLAN_LIMITS.compliance.sandboxExecutionsPerHour} sandbox/hr</li>
      </ul>
      <a href="mailto:${PRODUCT.contactEmail}?subject=Compliance%20Plan" class="btn btn-primary" style="width:100%;text-align:center;">Talk to sales</a>
    </div>

    <!-- Volume -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;border-color:rgba(47,111,237,0.40);position:relative;background:linear-gradient(145deg,rgba(47,111,237,0.06),rgba(6,182,212,0.03));">
      <span class="badge badge-accent" style="position:absolute;top:-10px;right:16px;">1M+ req/mo</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Volume</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$4,999<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">1M requests included, then $4K/million</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.volume.requestsPerMinute} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.volume.requestsPerMonth?.toLocaleString()} requests/mo included</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$${PLAN_LIMITS.volume.perMillionRate?.toLocaleString()} per additional million</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Org-level pattern-only enforcement</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.volume.sandboxExecutionsPerHour} sandbox/hr</li>
        <li style="padding:6px 0;">Priority support + DPA/SCCs</li>
      </ul>
      <a href="mailto:${PRODUCT.contactEmail}?subject=Volume%20Plan" class="btn btn-primary" style="width:100%;text-align:center;">Get Started</a>
    </div>

    <!-- Enterprise -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Enterprise</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">Custom</div>
        <div style="font-size:13px;color:var(--text-dim);">volume pricing</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.enterprise.requestsPerMinute.toLocaleString()} req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Custom SLAs</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">${PLAN_LIMITS.enterprise.sandboxExecutionsPerHour.toLocaleString()} sandbox/hr</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);"><a href="/dpa">DPA + SCCs</a></li>
        <li style="padding:6px 0;">Dedicated support</li>
      </ul>
      <a href="mailto:${PRODUCT.contactEmail}?subject=Enterprise%20Plan" class="btn btn-outline" style="width:100%;text-align:center;">Contact Sales</a>
    </div>

    <!-- Implementation (custom) -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;border-color:var(--accent2);position:relative;">
      <span class="badge badge-accent" style="position:absolute;top:-10px;right:16px;">Custom</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Implementation</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$3K&ndash;$15K</div>
        <div style="font-size:13px;color:var(--text-dim);">one-time project</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Agent architecture review</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Custom screening rules</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Integration &amp; deployment</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Training &amp; handoff</li>
        <li style="padding:6px 0;">Dedicated engineer</li>
      </ul>
      <a href="mailto:${PRODUCT.contactEmail}?subject=Implementation%20Project" class="btn btn-primary" style="width:100%;text-align:center;">Book Consultation</a>
    </div>

  </div>
</div>

<!-- Chunk 4: Cost calculator -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Cost Calculator</h2>
  <p class="answer-capsule">Estimate your monthly cost across plans. Drag the slider to set your expected request volume.</p>

  <div class="card" style="padding:24px;">
    <label for="calc-slider" style="font-size:14px;font-weight:600;display:block;margin-bottom:8px;">
      Monthly requests: <span id="calc-value" style="color:var(--accent2);">10,000</span>
    </label>
    <input type="range" id="calc-slider" min="0" max="200000" step="1000" value="10000"
      style="width:100%;accent-color:var(--accent);cursor:pointer;" aria-label="Monthly request volume">

    <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-top:20px;gap:12px;" id="calc-results">
      <div class="card" style="text-align:center;padding:16px;">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Free</div>
        <div id="calc-free" style="font-size:20px;font-weight:700;">$0</div>
      </div>
      <div class="card" style="text-align:center;padding:16px;border-color:var(--accent);">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Pro</div>
        <div id="calc-pro" style="font-size:20px;font-weight:700;">$49</div>
      </div>
      <div class="card" style="text-align:center;padding:16px;">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Team</div>
        <div id="calc-team" style="font-size:20px;font-weight:700;">$199</div>
      </div>
      <div class="card" style="text-align:center;padding:16px;">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">x402</div>
        <div id="calc-x402" style="font-size:20px;font-weight:700;">$50</div>
      </div>
    </div>
  </div>

  <script>
  (function() {
    var slider = document.getElementById('calc-slider');
    var valDisplay = document.getElementById('calc-value');
    var elFree = document.getElementById('calc-free');
    var elPro = document.getElementById('calc-pro');
    var elTeam = document.getElementById('calc-team');
    var elX402 = document.getElementById('calc-x402');

    function fmt(n) {
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function update() {
      var reqs = parseInt(slider.value, 10);
      valDisplay.textContent = reqs.toLocaleString();
      elFree.textContent = '$0';
      elPro.textContent = fmt(49 + Math.max(0, reqs - 10000) * 0.003);
      elTeam.textContent = fmt(199 + Math.max(0, reqs - 50000) * 0.002);
      elX402.textContent = fmt(reqs * ${Number(X402_ENDPOINTS.parse.price.replace("$", ""))});
    }

    slider.addEventListener('input', update);
    update();
  })();
  </script>
</div>

<!-- Chunk 5: Volume estimation -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Volume estimation</h2>
  <p class="answer-capsule">For per-hop screening at scale — estimate your monthly cost on the Volume tier. The first million is included at $4,999/mo; each additional million is $4,000.</p>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Monthly requests</th>
          <th>Estimated cost</th>
          <th>Plan</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>1M</strong></td>
          <td>$4,999/mo</td>
          <td>Volume (included)</td>
        </tr>
        <tr>
          <td><strong>5M</strong></td>
          <td>$20,999/mo</td>
          <td>Volume + 4M overage</td>
        </tr>
        <tr>
          <td><strong>10M</strong></td>
          <td>$40,999/mo</td>
          <td>Volume + 9M overage</td>
        </tr>
        <tr>
          <td><strong>50M+</strong></td>
          <td><a href="mailto:${PRODUCT.contactEmail}?subject=Enterprise%20Volume">Contact us</a></td>
          <td>Enterprise / custom</td>
        </tr>
      </tbody>
    </table>
  </div>

  <p class="pricing-muted" style="margin-top:16px;">Volume tier includes org-level pattern-only enforcement, SIEM forwarding, evidence packs, and DPA/SCCs. Overage billed at $4,000 per additional million requests. For 50M+ or dedicated infrastructure, contact us about an Enterprise agreement.</p>
</div>

<!-- Chunk 6: x402 micropayments -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Complete x402 endpoint prices</h2>

  <p class="answer-capsule">All x402 payments use ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName}. The screening calls most agents need first are ${parsePrice} for <code>/v1/parse</code> and ${outputPrice} for <code>/v1/screen-output</code>.</p>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Endpoint</th>
          <th>Price (USDC)</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
${x402Rows}
      </tbody>
    </table>
  </div>

  <h3>TypeScript</h3>
  <p class="answer-capsule">Use the current TypeScript x402 recipe at <a href="/skill#x402-node">/skill#x402-node</a>. It registers the required scheme before wrapping fetch.</p>

  <h3>Python</h3>
  <pre><code># pip install x402
from x402 import wrap_requests
session = wrap_requests(requests.Session(), wallet)
res = session.post("https://www.parsethis.ai/v1/parse", json={"prompt": "..."})</code></pre>

  <h3>CLI</h3>
  <pre><code>npx @x402/purl POST https://www.parsethis.ai/v1/parse -d '{"prompt":"..."}'</code></pre>
</div>

<!-- Chunk 6: Decision guide -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Should I use x402 or an API key?</h2>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Use Case</th>
          <th>Recommended</th>
          <th>Why</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Autonomous first call or marketplace agent</td>
          <td><strong>x402</strong></td>
          <td>No signup, pay per use</td>
        </tr>
        <tr>
          <td>Development/testing</td>
          <td><strong>Free API key</strong></td>
          <td>No cost, instant setup</td>
        </tr>
        <tr>
          <td>Production volume</td>
          <td><strong>Pro/Team key</strong></td>
          <td>Predictable rate limits and lower operational friction</td>
        </tr>
        <tr>
          <td>Enterprise</td>
          <td><strong>Enterprise key</strong></td>
          <td>SLAs, custom limits</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<!-- Chunk 7: Deployment Modes -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Deployment Modes</h2>
  <p class="answer-capsule">Choose how deeply each screening call inspects a prompt. Pattern-only mode keeps prompt text away from any third-party model provider — a privacy guarantee you can set as an org-level default so one engineer forgetting a flag can't leak customer text.</p>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th>Mode</th>
          <th>Latency</th>
          <th>Prompt text leaves Parse?</th>
          <th>Detection coverage</th>
          <th>Org-enforceable?</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Full</strong> (pattern + semantic)</td>
          <td>~${(LATENCY_FACTS.endToEnd.full.priorRangeMs[0] / 1000).toLocaleString("en-US")}&ndash;${(LATENCY_FACTS.endToEnd.full.priorRangeMs[1] / 1000).toLocaleString("en-US")}s<sup>*</sup></td>
          <td>Yes &mdash; routed to OpenRouter for semantic analysis</td>
          <td>Maximum &mdash; catches paraphrased and indirect injection</td>
          <td>✅ Set as org default</td>
        </tr>
        <tr>
          <td><strong>Pattern-only</strong></td>
          <td>~${LATENCY_FACTS.endToEnd.patternOnly.priorP50Ms}ms<sup>*</sup></td>
          <td><strong>No</strong> &mdash; text never reaches a third party</td>
          <td>High &mdash; catches direct injection, boundary manipulation, on-chain planted instructions</td>
          <td>✅ Set as org default</td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="pricing-muted"><sup>*</sup> Latency figures are caller-measured end to end against production, and provisional &mdash; a small sample rather than a fitted distribution. Most of that time is not detection: every response carries a <code>latency_ms</code> field with the in-process detection time, which is a small fraction of it. Measure your own path before committing to a budget. See <a href="/technology">Technology</a>.</p>

  <h3>How to enforce pattern-only at the org level</h3>
  <pre><code>PUT /v1/policy
Authorization: Bearer &lt;your-api-key&gt;
Content-Type: application/json

{ "defaultMode": "pattern-only" }</code></pre>
  <p class="pricing-muted">Once set, every screening request for that key is forced into pattern-only mode regardless of the per-request <code>mode</code> field. Individual engineers cannot opt out.</p>

  <h3>Can we self-host or run this on-premises?</h3>
  <p class="pricing-muted">Not the platform, and it is worth saying plainly rather than leaving you to find out. Parse is a hosted control plane &mdash; the agent registry, versioned policy and audit receipts exist because verdicts are recorded centrally, and a self-hosted copy would not produce the evidence trail the product is for. There is no on-premises or air-gapped distribution today.</p>
  <p class="pricing-muted">If data movement is the concern: <code>mode: "pattern-only"</code> (per request, or as your org default above) runs the deterministic layer only, so prompt text is never forwarded to the semantic-analysis provider &mdash; though it does still reach Parse in the United States. If prompt text must never leave your infrastructure at all, run the open-source <code>prompt-guard</code> library in your own environment: that is a standalone pattern-screening component, not Parse, with no registry, policy engine, receipts or semantic layer. See the <a href="/faq">FAQ</a> and <a href="/trust">Trust</a> for the full data-flow picture.</p>
</div>

<!-- Chunk 8: Free endpoints -->
<div class="section-chunk">
  <h2 style="margin-top:0;">What endpoints are free?</h2>

  <ul>
    <li><code>GET /v1/models</code> &mdash; list available LLM models</li>
    <li><code>GET /v1/pricing</code> &mdash; view x402 pricing info</li>
    <li><code>POST /v1/keys/generate</code> &mdash; generate a free API key</li>
    <li><code>GET /skill</code> &mdash; download the agent skill prompt</li>
    <li><code>GET /llms.txt</code> &mdash; LLM-readable documentation index</li>
    <li><code>GET /health</code> &mdash; service health check</li>
  </ul>
</div>
`;

  return renderPage({
    title: "Pricing — Free → $12 Solo → $47 Audit → $49 Pro → $199 Team → $999 Compliance → $4,999 Volume → Implementation",
    description:
      `${PRODUCT.name} value ladder: Free tier, Solo $12/mo (one agent, 2K requests, non-expiring key), $47 one-time Security Audit, Pro $49/mo, Team $199/mo, Compliance $999/mo, Volume $4,999/mo (1M requests included, $4K per additional million), and custom Implementation ($3K–$15K). ${PRODUCT.name} also offers x402 pay-per-call screening at ${parsePrice} for prompts and ${outputPrice} for outputs, paid in ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName}.`,
    path: "/pricing",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Pricing", href: "/pricing" },
    ],
    lastUpdated: "2026-05-05T12:00:00-04:00",
  });
}
