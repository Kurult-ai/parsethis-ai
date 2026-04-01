import { renderPage } from "../lib/html-template.js";
import { breadcrumbSchema } from "../lib/schema.js";

export function renderPromptGuardLandingPage(baseUrl: string): string {
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "prompt-guard": {
          command: "npx",
          args: ["-y", "@parsethis/mcp-prompt-guard"],
          env: { PARSETHIS_API_KEY: "your-key-here" },
        },
      },
    },
    null,
    2
  );

  const content = `
<!-- Chunk 1: Hero (Miller's Law: 1 of 5) -->
<div class="section-chunk animate-in">
  <h1>Prompt Guard &mdash; Safety screening for AI agents</h1>

  <p class="answer-capsule" style="max-width:700px;margin:0 auto 32px;">Detect prompt injection, role hijacking, and data exfiltration risks in real-time. Prompt Guard integrates directly into your agent pipeline via MCP, Node.js, or Python &mdash; and blocks threats before your model ever sees them.</p>

  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
    <a href="/prompt-guard/playground" class="btn btn-primary" style="padding:12px 28px;font-size:15px;">Try the Playground</a>
    <a href="/docs/quickstart" class="btn btn-outline" style="padding:12px 28px;font-size:15px;">Quick Start Guide</a>
  </div>
</div>

<!-- Chunk 2: Installation methods (Miller's Law: 2 of 5, 3 tabs) -->
<div class="section-chunk">
  <h2 id="install" style="margin-top:0;">Installation</h2>

  <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;" role="tablist" aria-label="Installation method">
    <button id="tab-mcp" role="tab" aria-selected="true" aria-controls="panel-mcp" onclick="showTab('mcp')" class="btn btn-primary" style="padding:8px 18px;font-size:13px;">MCP</button>
    <button id="tab-npm" role="tab" aria-selected="false" aria-controls="panel-npm" onclick="showTab('npm')" class="btn btn-outline" style="padding:8px 18px;font-size:13px;">npm</button>
    <button id="tab-pip" role="tab" aria-selected="false" aria-controls="panel-pip" onclick="showTab('pip')" class="btn btn-outline" style="padding:8px 18px;font-size:13px;">pip</button>
  </div>

  <div id="panel-mcp" role="tabpanel" aria-labelledby="tab-mcp">
    <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px;">Add to your Claude Desktop or Cursor <code>claude_desktop_config.json</code>:</p>
    <div style="position:relative;">
      <pre role="region" aria-label="MCP configuration JSON" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 48px 16px 16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--green);overflow-x:auto;line-height:1.6;white-space:pre;">${mcpConfig.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
      <button onclick="copyCode(this, 'mcp-code')" aria-label="Copy MCP config to clipboard" class="copy-btn">Copy</button>
      <span id="mcp-code" style="display:none">${mcpConfig.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>
    </div>
    <p style="font-size:13px;color:var(--text-dim);margin-top:8px;">Replace <code>your-key-here</code> with your API key from <a href="/v1/keys/generate">POST /v1/keys/generate</a>.</p>
  </div>

  <div id="panel-npm" role="tabpanel" aria-labelledby="tab-npm" style="display:none;">
    <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px;">Install the Node.js SDK:</p>
    <div style="position:relative;">
      <pre role="region" aria-label="npm install command" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 48px 16px 16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--green);line-height:1.6;">npm i @parsethis/prompt-guard</pre>
      <button onclick="copyText(this, 'npm i @parsethis/prompt-guard')" aria-label="Copy npm install command" class="copy-btn">Copy</button>
    </div>
    <pre role="region" aria-label="npm usage example" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--green);overflow-x:auto;line-height:1.6;margin-top:12px;">import { PromptGuard } from '@parsethis/prompt-guard';

const guard = new PromptGuard({ apiKey: process.env.PARSETHIS_API_KEY });
const result = await guard.screen(userPrompt);
if (result.risk_score &gt;= 7) throw new Error('Blocked: ' + result.verdict);</pre>
  </div>

  <div id="panel-pip" role="tabpanel" aria-labelledby="tab-pip" style="display:none;">
    <p style="font-size:14px;color:var(--text-dim);margin-bottom:12px;">Install the Python SDK:</p>
    <div style="position:relative;">
      <pre role="region" aria-label="pip install command" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 48px 16px 16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--green);line-height:1.6;">pip3 install parsethis-prompt-guard</pre>
      <button onclick="copyText(this, 'pip3 install parsethis-prompt-guard')" aria-label="Copy pip install command" class="copy-btn">Copy</button>
    </div>
    <pre role="region" aria-label="Python usage example" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:var(--green);overflow-x:auto;line-height:1.6;margin-top:12px;">from parsethis import PromptGuard

guard = PromptGuard(api_key=os.environ["PARSETHIS_API_KEY"])
result = guard.screen(user_prompt)
if result.risk_score &gt;= 7:
    raise ValueError(f"Blocked: {result.verdict}")</pre>
  </div>
</div>

<!-- Chunk 3: How it works — 3 steps (Miller's Law: 3 of 5) -->
<div class="section-chunk">
  <h2 id="how-it-works" style="margin-top:0;">How it works</h2>

  <div class="card-grid" style="margin:20px 0 0;">
    <div class="card">
      <div style="font-size:32px;font-weight:800;color:var(--accent2);margin-bottom:12px;line-height:1;">1</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Install</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Add Prompt Guard via MCP, npm, or pip. Configure your API key once. No per-request setup.</p>
    </div>
    <div class="card">
      <div style="font-size:32px;font-weight:800;color:var(--accent2);margin-bottom:12px;line-height:1;">2</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Screen</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Every incoming prompt is scored 0&ndash;10 across 8 threat categories in under 200ms before your agent executes it.</p>
    </div>
    <div class="card">
      <div style="font-size:32px;font-weight:800;color:var(--accent2);margin-bottom:12px;line-height:1;">3</div>
      <div style="font-weight:700;font-size:16px;margin-bottom:8px;">Act</div>
      <p style="font-size:13px;color:var(--text-dim);margin:0;">Block threats automatically (score &ge; 7), flag caution cases (4&ndash;6), or allow safe prompts through (&le; 3).</p>
    </div>
  </div>

  <aside style="border-left:3px solid var(--accent);margin-top:24px;">
    <p style="font-weight:700;font-size:14px;margin-bottom:8px;color:var(--accent2);">Security default: fail-closed</p>
    <p style="font-size:13px;color:var(--text-dim);margin:0;">By default, if the Prompt Guard API is unreachable or returns an error, the request is <strong style="color:var(--text);">blocked</strong> (fail-closed). This is the safe default for production agents. Fail-open mode must be explicitly enabled by setting <code>failOpen: true</code> in your config.</p>
  </aside>
</div>

<!-- Chunk 4: Privacy disclosures — 5 items (Miller's Law: 4 of 5) -->
<div class="section-chunk">
  <h2 id="privacy" style="margin-top:0;">Privacy &amp; data handling</h2>

  <p class="answer-capsule">What happens to your prompt content depends on which execution mode you use. These disclosures are exact &mdash; not approximate.</p>

  <div style="display:grid;gap:12px;">
    <div class="card">
      <div style="margin-bottom:8px;"><span class="badge badge-green">Standard screening</span></div>
      <p style="font-size:14px;margin:0;color:var(--text);">Prompt content is <strong>NOT stored</strong>. It is processed in memory and discarded after analysis. Only the risk score, verdict, prompt length, and flag categories are written to the audit log.</p>
    </div>

    <div class="card">
      <div style="margin-bottom:8px;"><span class="badge badge-yellow">Async execution mode</span></div>
      <p style="font-size:14px;margin:0;color:var(--text);">When using async screening (<code>async: true</code>), the prompt is <strong>stored in Redis for up to 10 minutes</strong> while analysis completes in the background. It is deleted automatically after the result is retrieved or the TTL expires.</p>
    </div>

    <div class="card">
      <div style="margin-bottom:8px;"><span class="badge badge-yellow">Evaluation mode</span></div>
      <p style="font-size:14px;margin:0;color:var(--text);">When using <code>POST /v1/evaluate</code>, the <strong>prompt is stored in Postgres</strong> for the duration of the evaluation job. Results are retained for 30 days by default and may include prompt content for audit purposes.</p>
    </div>

    <div class="card">
      <div style="margin-bottom:8px;"><span class="badge badge-green">Local mode</span></div>
      <p style="font-size:14px;margin:0;color:var(--text);">When running locally via the self-hosted Docker image, prompts <strong>never leave your machine</strong>. All screening runs in-process against local pattern databases.</p>
    </div>

    <div class="card">
      <div style="margin-bottom:8px;"><span class="badge badge-accent">Audit log (all modes)</span></div>
      <p style="font-size:14px;margin:0;color:var(--text);">Every request writes a structured audit record containing: risk score, verdict, prompt length, detected flags, timestamp, and API key ID. <strong>Prompt content is NOT stored</strong> in the audit log.</p>
    </div>
  </div>
</div>

<!-- Chunk 5: CTA (Miller's Law: 5 of 5) -->
<div class="section-chunk" style="text-align:center;">
  <div class="card" style="padding:40px 32px;">
    <h2 style="margin-top:0;margin-bottom:12px;">See it in action</h2>
    <p style="color:var(--text-dim);font-size:15px;margin-bottom:24px;">Paste any prompt and get a real risk score in under 200ms. No sign-up required.</p>
    <a href="/prompt-guard/playground" class="btn btn-primary" style="padding:12px 32px;font-size:15px;">Open Playground &rarr;</a>
  </div>
</div>

<script>
function showTab(id) {
  ['mcp','npm','pip'].forEach(function(t) {
    var panel = document.getElementById('panel-' + t);
    var tab = document.getElementById('tab-' + t);
    var active = (t === id);
    panel.style.display = active ? '' : 'none';
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) {
      tab.className = 'btn btn-primary';
      tab.style.cssText = 'padding:8px 18px;font-size:13px;';
    } else {
      tab.className = 'btn btn-outline';
      tab.style.cssText = 'padding:8px 18px;font-size:13px;';
    }
  });
}
function copyText(btn, text) {
  navigator.clipboard.writeText(text).then(function() {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(function() { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
function copyCode(btn, srcId) {
  var el = document.getElementById(srcId);
  var text = el ? el.textContent : '';
  copyText(btn, text);
}
</script>
`;

  return renderPage({
    title: "Prompt Guard — Safety screening for AI agents",
    description:
      "Detect prompt injection, role hijacking, and data exfiltration risks in real-time. Available via MCP, Node.js, or Python. Fail-closed by default.",
    path: "/prompt-guard",
    content,
    baseUrl,
    jsonLd: [
      breadcrumbSchema([
        { name: "Home", url: `${baseUrl}/` },
        { name: "Prompt Guard", url: `${baseUrl}/prompt-guard` },
      ]),
    ],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Prompt Guard", href: "/prompt-guard" },
    ],
  });
}
