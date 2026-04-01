import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";

export function renderPricingPage(baseUrl: string): string {
  const content = `
<h1>Pricing</h1>

<p class="answer-capsule">ParseThis.ai offers two payment models: x402 USDC micropayments for per-request access with no API key needed, and free-tier API keys with rate limits. x402 is the recommended method for AI agents &mdash; attach a signed USDC transfer to any request and pay only for what you use on Base L2.</p>

<h2 style="display:flex;align-items:center;gap:12px;">How does x402 payment work? <span style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:var(--accent);color:white;padding:3px 10px;border-radius:4px;">Recommended</span></h2>

<p class="answer-capsule">x402 uses the HTTP 402 Payment Required standard. Send USDC on Base L2 &mdash; no API key, no account, no credit card. Include an <code>X-PAYMENT</code> header with a signed USDC transfer on every request. A facilitator verifies the payment on-chain before the request is processed. If the payment is valid, you get the response; if not, you get a 402 status with pricing details.</p>

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
        <td><code>POST /v1/analyze</code> (quick)</td>
        <td>$0.01</td>
        <td>Quick media credibility analysis</td>
      </tr>
      <tr>
        <td><code>POST /v1/analyze</code> (standard)</td>
        <td>$0.05</td>
        <td>Standard depth analysis</td>
      </tr>
      <tr>
        <td><code>POST /v1/analyze</code> (deep)</td>
        <td>$0.15</td>
        <td>Deep analysis with full agent panel</td>
      </tr>
      <tr>
        <td><code>POST /v1/evaluate</code></td>
        <td>$0.01</td>
        <td>Evaluate prompt quality + safety</td>
      </tr>
      <tr>
        <td><code>POST /v1/chat</code></td>
        <td>$0.005</td>
        <td>Chat with Parse AI</td>
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

<h2>Is there a free tier?</h2>

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
        <td><strong>Max auto-block threshold</strong></td>
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
        <td>Contact</td>
        <td>Contact</td>
        <td>Contact</td>
      </tr>
    </tbody>
  </table>
</div>

<h2>Should I use x402 or an API key?</h2>

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

<h2>What endpoints are free?</h2>

<ul>
  <li><code>GET /v1/models</code> &mdash; list available LLM models</li>
  <li><code>GET /v1/pricing</code> &mdash; view x402 pricing info</li>
  <li><code>POST /v1/keys/generate</code> &mdash; generate a free API key</li>
  <li><code>GET /skill</code> &mdash; download the agent skill prompt</li>
  <li><code>GET /llms.txt</code> &mdash; LLM-readable documentation index</li>
  <li><code>GET /health</code> &mdash; service health check</li>
</ul>
`;

  return renderPage({
    title: "Pricing — x402 USDC Payments & API Key Tiers",
    description:
      "ParseThis.ai pricing: x402 USDC micropayments from $0.005/request on Base L2, plus free-tier API keys. No credit card required.",
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
