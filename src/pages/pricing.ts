import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";

export function renderPricingPage(baseUrl: string): string {
  const content = `
<!-- Chunk 1: Hero -->
<div class="section-chunk animate-in">
  <h1>Pricing</h1>
  <p class="answer-capsule">Free to start. Scale with Pro, Team, or Enterprise.</p>
</div>

<!-- Chunk 2: Tier cards -->
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
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">10 req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">30-day key expiry</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Self-service</li>
        <li style="padding:6px 0;">5 sandbox/hr</li>
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
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">60 req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$0.003/overage request</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">50 sandbox/hr</li>
        <li style="padding:6px 0;">Self-serve checkout</li>
      </ul>
      <a href="/v1/billing/checkout" class="btn btn-primary" style="width:100%;text-align:center;" onclick="event.preventDefault();(async()=>{try{const k=localStorage.getItem('pfa_key');if(k){const r=await fetch('/v1/billing/checkout',{method:'POST',headers:{'Authorization':'Bearer '+k,'Content-Type':'application/json'},body:JSON.stringify({tier:'pro'})});if(r.ok){const d=await r.json();if(d.url){window.location=d.url;return;}}}const r2=await fetch('/v1/billing/signup-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'pro'})});if(!r2.ok){const err=await r2.json().catch(()=>({}));alert(err.error||'Signup failed');return;}const d2=await r2.json();if(d2.key)localStorage.setItem('pfa_key',d2.key);if(d2.checkout_url){window.location=d2.checkout_url;}else{window.location='mailto:hello@parsethis.ai?subject=Pro%20Plan';}}catch{window.location='mailto:hello@parsethis.ai?subject=Pro%20Plan';}})();">Start Pro</a>
    </div>

    <!-- Team -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Team</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">$199<span style="font-size:14px;font-weight:400;color:var(--text-dim);">/mo</span></div>
        <div style="font-size:13px;color:var(--text-dim);">50K requests included</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">200 req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">$0.002/overage request</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">200 sandbox/hr</li>
        <li style="padding:6px 0;">Priority support</li>
      </ul>
      <a href="mailto:hello@parsethis.ai?subject=Team%20Plan" class="btn btn-outline" style="width:100%;text-align:center;">Contact Sales</a>
    </div>

    <!-- Enterprise -->
    <div class="card" style="display:flex;flex-direction:column;gap:12px;">
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.04em;">Enterprise</div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.03em;margin:4px 0;">Custom</div>
        <div style="font-size:13px;color:var(--text-dim);">volume pricing</div>
      </div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;flex:1;">
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">1,000 req/min</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">Custom SLAs</li>
        <li style="padding:6px 0;border-bottom:1px solid var(--border);">1,000 sandbox/hr</li>
        <li style="padding:6px 0;">Dedicated support</li>
      </ul>
      <a href="mailto:hello@parsethis.ai?subject=Enterprise%20Plan" class="btn btn-outline" style="width:100%;text-align:center;">Contact Sales</a>
    </div>

  </div>
</div>

<!-- Chunk 3: Cost calculator -->
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
      elX402.textContent = fmt(reqs * 0.005);
    }

    slider.addEventListener('input', update);
    update();
  })();
  </script>
</div>

<!-- Chunk 4: x402 micropayments -->
<div class="section-chunk">
  <h2 style="margin-top:0;">How does x402 payment work?</h2>

  <p class="answer-capsule">x402 uses the HTTP 402 Payment Required standard. Send USDC on Base L2 &mdash; no API key, no account, no credit card. Include a <code>payment-signature</code> (legacy: <code>x-payment</code>) header with a signed USDC transfer on every request. A facilitator verifies the payment on-chain before the request is processed.</p>

  <h3>Per-request pricing</h3>

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
        <tr>
          <td><code>POST /v1/parse</code></td>
          <td>$0.005</td>
          <td>Screen a prompt for injection risks</td>
        </tr>
        <tr>
          <td><code>POST /v1/evaluate</code></td>
          <td>$0.01</td>
          <td>Evaluate prompt quality + safety</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h3>TypeScript</h3>
  <pre><code>// npm install @x402/fetch
import { wrapFetch } from "@x402/fetch";
const x402Fetch = wrapFetch(fetch, walletClient);
const res = await x402Fetch("https://parsethis.ai/v1/parse", {
  method: "POST",
  body: JSON.stringify({ prompt: "..." }),
});</code></pre>

  <h3>Python</h3>
  <pre><code># pip install x402
from x402 import wrap_requests
session = wrap_requests(requests.Session(), wallet)
res = session.post("https://parsethis.ai/v1/parse", json={"prompt": "..."})</code></pre>

  <h3>CLI</h3>
  <pre><code>npx @x402/purl POST https://parsethis.ai/v1/parse -d '{"prompt":"..."}'</code></pre>
</div>

<!-- Chunk 5: Decision guide -->
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
          <td>AI agent (automated)</td>
          <td><strong>x402</strong></td>
          <td>No key management, pay per use</td>
        </tr>
        <tr>
          <td>Development/testing</td>
          <td><strong>Free API key</strong></td>
          <td>No cost, instant setup</td>
        </tr>
        <tr>
          <td>Production volume</td>
          <td><strong>Pro/Team key</strong></td>
          <td>Predictable rate limits</td>
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

<!-- Chunk 6: Free endpoints -->
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
      "Parse pricing: free tier with 10 req/min. Pro $49/mo with 10K requests included. Team $199/mo with 50K included. x402 USDC micropayments available.",
    path: "/pricing",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Pricing", href: "/pricing" },
    ],
    lastUpdated: "2026-04-06",
  });
}
