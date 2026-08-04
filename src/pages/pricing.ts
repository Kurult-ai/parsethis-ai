import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { PLAN_LIMITS, PRODUCT, X402_ENDPOINTS, X402_PAYMENT, x402EndpointList } from "../lib/product-facts.js";

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
    background:linear-gradient(145deg, rgba(47, 111, 237, 0.12), rgba(25, 182, 175, 0.09));
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
    background:rgba(255,255,255,0.72);
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
    <p class="answer-capsule">Pay per screening with x402, or use a monthly key when request volume becomes predictable.</p>
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

<!-- Chunk 3: Tier cards -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Plans</h2>

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
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">30-day key expiry</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Self-service</li>
        <li style="padding:6px 0;">${PLAN_LIMITS.free.sandboxExecutionsPerHour} sandbox/hr</li>
      </ul>
      <a href="/v1/keys/generate" class="btn btn-outline" style="width:100%;text-align:center;">Generate Free Key</a>
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
      <a href="mailto:${PRODUCT.contactEmail}?subject=Team%20Plan" class="btn btn-outline" style="width:100%;text-align:center;">Contact Sales</a>
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
        <li style="padding:6px 0;">Dedicated support</li>
      </ul>
      <a href="mailto:${PRODUCT.contactEmail}?subject=Enterprise%20Plan" class="btn btn-outline" style="width:100%;text-align:center;">Contact Sales</a>
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

<!-- Chunk 5: x402 micropayments -->
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

<!-- Chunk 7: Free endpoints -->
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
    title: "Pricing — Free Tier, Pro $49/mo, Team $199/mo",
    description:
      `${PRODUCT.name} pricing: x402 pay-per-call screening at ${parsePrice} for prompts and ${outputPrice} for outputs, paid in ${X402_PAYMENT.currency} on ${X402_PAYMENT.networkName}. Free, Pro, Team, and Enterprise keys available.`,
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
