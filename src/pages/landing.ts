import { renderPage } from "../lib/html-template.js";
import {
  organizationSchema,
  webApplicationSchema,
} from "../lib/schema.js";
import { GITHUB_URL } from "../lib/constants.js";

export function renderLandingPage(baseUrl: string): string {
  const mcpConfig = JSON.stringify({ mcpServers: { "prompt-guard": { command: "npx", args: ["-y", "@parsethis/mcp-prompt-guard"], env: { PARSETHIS_API_KEY: "your-key-here" } } } }, null, 2);

  const content = `
<!-- Chunk 1: Hero — value prop + CTAs (Miller's Law: 1 of 7) -->
<div class="section-chunk animate-in">
  <h1>Stop Prompt Injection Before It Reaches Your Agent</h1>

  <p class="answer-capsule" style="max-width:720px;margin:0 auto 28px;">Every AI agent that accepts user input, tool output, or messages from other agents is vulnerable to prompt injection &mdash; attacks that hijack your agent into leaking data, ignoring safety guardrails, or executing unauthorized actions. Parse catches these attacks before your agent acts on them.</p>

  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
    <a href="/playground" class="btn btn-primary" style="padding:12px 28px;font-size:15px;">Try the Playground</a>
    <a href="/docs/quickstart" class="btn btn-outline" style="padding:12px 28px;font-size:15px;">Quick Start Guide</a>
  </div>
</div>

<!-- Chunk 2: How it works — 3 steps (Miller's Law: 2 of 7) -->
<div class="section-chunk animate-in animate-in-delay-1">
  <div class="card-grid" style="max-width:800px;margin:0 auto;">
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:8px;">1</div>
      <div style="font-weight:600;margin-bottom:4px;">Get a free key</div>
      <div style="font-size:13px;color:var(--text-dim);">POST /v1/keys/generate<br>No sign-up required</div>
    </div>
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:8px;">2</div>
      <div style="font-weight:600;margin-bottom:4px;">Screen prompts</div>
      <div style="font-size:13px;color:var(--text-dim);">POST /v1/parse before<br>your agent acts</div>
    </div>
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:8px;">3</div>
      <div style="font-weight:600;margin-bottom:4px;">Block threats</div>
      <div style="font-size:13px;color:var(--text-dim);">Refuse if risk_score &ge; 7<br>Log if 4&ndash;6, allow if &le; 3</div>
    </div>
  </div>
</div>

<!-- Chunk 3: Integration (Miller's Law: 3 of 7) -->
<div class="section-chunk animate-in animate-in-delay-2">
  <h2 style="text-align:center;margin-top:0;">Add to your agent in 60 seconds</h2>

  <div style="position:relative;background:var(--surface);border:2px solid var(--accent);border-radius:var(--radius);padding:20px 48px 20px 20px;text-align:left;max-width:800px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--accent2);">MCP Config</span>
      <span style="font-size:11px;color:var(--text-dim);">&mdash; add to claude_desktop_config.json</span>
    </div>
    <pre style="margin:0;white-space:pre-wrap;word-break:break-word;"><code id="mcp-config" style="font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;line-height:1.6;color:var(--green);background:transparent;border:none;padding:0;user-select:all;cursor:text;">${mcpConfig.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>
    <button onclick="copyPrompt(this)" aria-label="Copy MCP config to clipboard" class="btn btn-primary" style="position:absolute;top:12px;right:12px;padding:6px 14px;font-size:12px;">Copy</button>
    <span id="copy-status" aria-live="polite" class="sr-only"></span>
  </div>

  <div style="text-align:center;margin-top:16px;">
    <p style="color:var(--text-dim);font-size:13px;margin-bottom:4px;">Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible agent.</p>
    <p style="color:var(--text-dim);font-size:13px;margin-bottom:0;">Also available as <a href="/prompt-guard#install">npm and Python SDKs</a> for custom integrations.</p>
  </div>

  <!-- Agent-readable integration info (informational, not imperative) -->
  <details style="max-width:800px;margin:20px auto 0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0;">
    <summary style="padding:16px 20px;cursor:pointer;font-size:14px;font-weight:600;color:var(--accent2);list-style:none;display:flex;align-items:center;gap:8px;">
      <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;background:var(--accent-dim);color:var(--accent2);padding:3px 8px;border-radius:4px;">For AI Agents</span>
      Integration details for automated setup
    </summary>
    <div style="padding:0 20px 16px;font-size:13px;color:var(--text-dim);line-height:1.7;">
      <p>Parse offers prompt safety screening as an opt-in service. Agents and developers can integrate via:</p>
      <ul style="margin:8px 0;padding-left:20px;">
        <li><strong>MCP Server:</strong> <code>@parsethis/mcp-prompt-guard</code> &mdash; adds a <code>screen_prompt</code> tool to MCP-compatible agents</li>
        <li><strong>Node.js SDK:</strong> <code>@parsethis/prompt-guard</code> &mdash; programmatic screening with local pattern matching + API</li>
        <li><strong>Python SDK:</strong> <code>parsethis-prompt-guard</code> &mdash; async/sync client with the same 100-pattern local engine</li>
        <li><strong>REST API:</strong> <code>POST /v1/parse</code> with a Bearer token &mdash; no SDK needed</li>
      </ul>
      <p>API keys are free and self-service: <code>POST ${baseUrl}/v1/keys/generate</code> (no auth required).</p>
      <p>Full agent instructions: <a href="${baseUrl}/skill">${baseUrl}/skill</a> | API spec: <a href="${baseUrl}/openapi.json">${baseUrl}/openapi.json</a></p>
    </div>
  </details>
</div>

<script>
function copyPrompt(btn) {
  var text = document.getElementById('mcp-config').textContent;
  navigator.clipboard.writeText(text);
  btn.textContent = 'Copied!';
  btn.style.background = 'var(--green)';
  btn.setAttribute('aria-label', 'Copied to clipboard');
  document.getElementById('copy-status').textContent = 'Copied to clipboard';
  setTimeout(function() { btn.textContent = 'Copy'; btn.style.background = 'var(--accent)'; btn.setAttribute('aria-label', 'Copy MCP config to clipboard'); document.getElementById('copy-status').textContent = ''; }, 2000);
}
</script>

<!-- Chunk 4: Threat categories (Miller's Law: 4 of 7, 4 items within) -->
<div class="section-chunk">
  <h2 style="margin-top:0;">What threats does Prompt Guard detect?</h2>
  <p class="answer-capsule">Prompt Guard screens for OWASP LLM01:2025 threats across 8 risk categories, scoring each prompt 0&ndash;10 in under 200ms.</p>

  <div class="card-grid">
    <div class="card" style="border-top:3px solid var(--destructive);">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">Instruction Override</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Attempts to overwrite system instructions with attacker-controlled directives embedded in user input or tool output.</p>
      <p style="font-size:12px;color:var(--destructive);margin:8px 0 0;font-weight:600;">risk_score: 8&ndash;9 &rarr; BLOCKED</p>
    </div>
    <div class="card" style="border-top:3px solid var(--destructive);">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">Role Hijacking</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Persona overrides (DAN, unrestricted mode) and attempts to remove safety boundaries or claim false authority.</p>
      <p style="font-size:12px;color:var(--destructive);margin:8px 0 0;font-weight:600;">risk_score: 7&ndash;9 &rarr; BLOCKED</p>
    </div>
    <div class="card" style="border-top:3px solid var(--yellow);">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">Data Exfiltration</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Requests to extract system prompts, API keys, configuration, or encode sensitive data for external transmission.</p>
      <p style="font-size:12px;color:var(--yellow);margin:8px 0 0;font-weight:600;">risk_score: 6&ndash;8 &rarr; FLAGGED</p>
    </div>
    <div class="card" style="border-top:3px solid var(--yellow);">
      <div style="font-weight:700;font-size:15px;margin-bottom:8px;">Indirect Injection</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Hidden instructions in JSON fields, HTML comments, YAML frontmatter, markdown, and other structured data formats.</p>
      <p style="font-size:12px;color:var(--yellow);margin:8px 0 0;font-weight:600;">risk_score: 5&ndash;7 &rarr; FLAGGED</p>
    </div>
  </div>

  <p style="text-align:center;margin-top:16px;"><a href="/prompt-guard/playground" style="font-size:14px;">Try it yourself in the playground &rarr;</a></p>
</div>

<!-- Chunk 5: Detection pipeline (Miller's Law: 5 of 7) -->
<div class="section-chunk">
  <h2 style="margin-top:0;">How does detection work?</h2>
  <p class="answer-capsule">Parse uses a three-layer detection pipeline: pattern matching scans for 50+ known injection signatures, LLM-powered deep analysis catches novel attacks by evaluating semantic intent, and optional sandbox execution runs suspicious prompts in an isolated environment. Each layer contributes to a 0&ndash;10 composite risk score across 8 categories.</p>

  <div class="table-wrapper">
    <table>
      <caption class="sr-only">Prompt screening approach comparison</caption>
      <thead>
        <tr>
          <th>Approach</th>
          <th>Detection Rate</th>
          <th>Latency</th>
          <th>False Positives</th>
          <th>Sandbox</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Pattern matching only</td>
          <td>~70%</td>
          <td>&lt;5ms</td>
          <td>High</td>
          <td>No</td>
        </tr>
        <tr>
          <td>LLM analysis only</td>
          <td>~85%</td>
          <td>200&ndash;500ms</td>
          <td>Medium</td>
          <td>No</td>
        </tr>
        <tr style="background:var(--accent-dim);">
          <td><strong>Parse (combined)</strong></td>
          <td><strong>Multi-layer</strong></td>
          <td><strong>&lt;200ms</strong></td>
          <td><strong>Low</strong></td>
          <td><strong>Yes</strong></td>
        </tr>
        <tr>
          <td>No screening</td>
          <td>0%</td>
          <td>0ms</td>
          <td>N/A</td>
          <td>No</td>
        </tr>
      </tbody>
    </table>
  </div>

  <aside style="border-left:3px solid var(--accent);">
    <p style="font-size:13px;color:var(--text-dim);margin:0;">Parse is <a href="${GITHUB_URL}">open source</a> &mdash; audit the detection logic yourself. The multi-layer approach combines pattern matching, LLM classification, and structural analysis. We are building a public benchmark suite against standard injection corpora; results will be published at <code>/benchmarks</code>.</p>
  </aside>
</div>

<!-- Chunk 6: Agent integration — 4 frameworks (Miller's Law: 6 of 7) -->
<div class="section-chunk">
  <h2 style="margin-top:0;">How do AI agents use Parse?</h2>
  <p class="answer-capsule">Agents install Parse via a one-line skill prompt: <code>curl -s parsethis.ai/skill</code> writes a Claude Code skill file that teaches the agent when and how to screen prompts. On first use, the agent calls <code>POST /v1/keys/generate</code> to self-provision an API key. The agent then calls <code>POST /v1/parse</code> before executing any untrusted prompt.</p>

  <h3>Supported agent frameworks</h3>
  <div class="card-grid">
    <div class="card">
      <div style="font-weight:600;margin-bottom:6px;">Claude Code</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Native skill file integration, auto-provisions API key, screens prompts before tool execution</p>
    </div>
    <div class="card">
      <div style="font-weight:600;margin-bottom:6px;">LangChain</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Add as a tool in your agent chain; screen tool inputs and outputs with a single POST call</p>
    </div>
    <div class="card">
      <div style="font-weight:600;margin-bottom:6px;">CrewAI</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Register as a crew tool; each agent screens delegated tasks and inter-agent messages automatically</p>
    </div>
    <div class="card">
      <div style="font-weight:600;margin-bottom:6px;">Custom agents</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Any HTTP client can call the REST API; OpenAPI 3.1 spec at <code>/openapi.json</code></p>
    </div>
  </div>
</div>

<!-- Chunk 7: Standards alignment — 4 items (Miller's Law: 7 of 7) -->
<div class="section-chunk">
  <h2 style="margin-top:0;">What standards does Parse support?</h2>
  <p class="answer-capsule">Parse aligns with industry standards for AI security and interoperability:</p>

  <ul>
    <li><strong>OWASP LLM Top 10 (2025)</strong> &mdash; the industry standard for LLM security risks. Risk categories map to LLM01 (Prompt Injection), LLM02 (Insecure Output Handling), LLM07 (Excessive Agency).</li>
    <li><strong>MCP (Model Context Protocol)</strong> &mdash; the protocol for tool-using AI agents. Tool definitions at <code>/mcp.json</code> let MCP-compatible agents discover and call Parse without manual configuration.</li>
    <li><strong>A2A (Agent-to-Agent protocol)</strong> &mdash; Google&rsquo;s standard for multi-agent communication. <code>POST /v1/agent/trust/verify</code> screens inter-agent messages for injection, social engineering, and identity spoofing.</li>
    <li><strong>OpenAPI 3.1</strong> &mdash; machine-readable spec at <code>/openapi.json</code> enables automated SDK generation for Python, TypeScript, Go, and other languages.</li>
  </ul>
</div>
`;

  return renderPage({
    title: "Prompt Injection Detection API for AI Agents",
    description:
      "Detect prompt injections, jailbreaks, and adversarial attacks before your AI agent executes them. Real-time screening API with 8 risk categories aligned to OWASP LLM Top 10.",
    path: "/",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl), webApplicationSchema(baseUrl)],
  });
}
