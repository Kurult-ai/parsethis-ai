import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";

export function renderPricingPage(baseUrl: string): string {
  const content = `
<!-- Chunk 1: Overview (Miller's Law: 1 of 5) -->
<div class="section-chunk animate-in">
  <h1>Pricing</h1>
  <p class="answer-capsule">Parse is free to start. Generate an API key instantly via POST /v1/keys/generate &mdash; no credit card, no sign-up, 60 requests per minute included. For higher volume or anonymous access, use x402 USDC micropayments on Base L2.</p>
</div>

<!-- Chunk 2: x402 payment (Miller's Law: 2 of 5) -->
<div class="section-chunk">
  <h2 style="margin-top:0;display:flex;align-items:center;gap:12px;">How does x402 payment work? <span class="badge badge-accent">Recommended</span></h2>

  <p class="answer-capsule">x402 uses the HTTP 402 Payment Required standard. Send USDC on Base L2 &mdash; no API key, no account, no credit card. Include an <code>X-PAYMENT</code> header with a signed USDC transfer on every request. A facilitator verifies the payment on-chain before the request is processed.</p>

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

<!-- Chunk 3: Tier comparison (Miller's Law: 3 of 5) -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Is there a free tier?</h2>

  <p class="answer-capsule">Yes. Generate a free API key instantly via <code>POST /v1/keys/generate</code> &mdash; no credit card, no sign-up. Free keys include rate limits and a daily cost cap. Upgrade to Pro, Team, or Enterprise for higher limits and SLAs.</p>

  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th></th>
          <th>Free</th>
          <th>Pro</th>
          <th>Team</th>
          <th>Enterprise</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Rate limit</strong></td>
          <td>60/min</td>
          <td>60/min</td>
          <td>200/min</td>
          <td>1,000/min</td>
        </tr>
        <tr>
          <td><strong>Sandbox executions</strong></td>
          <td>5/hour</td>
          <td>50/hour</td>
          <td>200/hour</td>
          <td>1,000/hour</td>
        </tr>
        <tr>
          <td><strong>Daily cost cap</strong></td>
          <td>$0.50</td>
          <td>$10</td>
          <td>$50</td>
          <td>$500</td>
        </tr>
        <tr>
          <td><strong>Max auto-block threshold<sup><a href="#fn-threshold">*</a></sup></strong></td>
          <td>5</td>
          <td>7</td>
          <td>9</td>
          <td>10</td>
        </tr>
        <tr>
          <td><strong>Key expiry</strong></td>
          <td>30 days</td>
          <td>30 days</td>
          <td>30 days</td>
          <td>Custom</td>
        </tr>
        <tr>
          <td><strong>API key generation</strong></td>
          <td>Self-service</td>
          <td><a href="mailto:hello@parsethis.ai">Contact</a></td>
          <td><a href="mailto:hello@parsethis.ai">Contact</a></td>
          <td><a href="mailto:hello@parsethis.ai">Contact</a></td>
        </tr>
      </tbody>
    </table>
  </div>

  <p id="fn-threshold" style="font-size:13px;color:var(--text-dim);margin-top:8px;">* <strong>Auto-block threshold</strong> is the maximum risk score you can set via <code>PUT /v1/policy</code>. Higher tiers allow finer-grained blocking. Free tier caps at 5, meaning prompts scored 5+ are auto-blocked.</p>

  <p style="font-size:13px;color:var(--text-dim);">For Pro, Team, or Enterprise plans, contact <a href="mailto:hello@parsethis.ai">hello@parsethis.ai</a>.</p>

</div>

<!-- Chunk 4: Decision guide (Miller's Law: 4 of 5) -->
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

<!-- Chunk 5: Free endpoints (Miller's Law: 5 of 5) -->
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
    title: "Pricing — Free Tier & Pay-per-Request",
    description:
      "Parse pricing: free tier with 60 req/min, no credit card needed. Optional pay-per-request with x402 USDC micropayments.",
    path: "/pricing",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Pricing", href: "/pricing" },
    ],
    lastUpdated: "2026-03-22",
  });
}
