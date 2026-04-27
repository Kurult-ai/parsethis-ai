import { renderPage } from "../lib/html-template.js";
import {
  organizationSchema,
  webApplicationSchema,
} from "../lib/schema.js";
import { GITHUB_URL } from "../lib/constants.js";
import { listBlogPosts } from "../lib/markdown.js";

export function renderLandingPage(baseUrl: string): string {
  const mcpConfig = JSON.stringify({ mcpServers: { "prompt-guard": { command: "npx", args: ["-y", "@parsethis/mcp-prompt-guard"], env: { PARSETHIS_API_KEY: "your-key-here" } } } }, null, 2);

  const BEARER_PROMPT = `You will integrate Parse, an independent prompt-injection security API, into this codebase or running agent runtime.

Step 1 — Provision a key. POST https://www.parsethis.ai/v1/keys/generate with body {"name":"<short label for this caller>"}. No auth required. Save the returned \`key\` (format: pfa_live_…) as env var PARSE_API_KEY (or whatever secret store this runtime uses). Never commit it.

Step 2 — Read the integration guide at https://www.parsethis.ai/skill and follow it as instructions, not as documentation.

Step 3 — Wire POST https://www.parsethis.ai/v1/parse into every input boundary where the system handles text it did not generate (user input, inbound messages, tool output, third-party content, retrieved documents). Send {"prompt":"<the untrusted text>"} with header Authorization: Bearer $PARSE_API_KEY. Block when response.policy.auto_block is true; log + continue when 4 ≤ risk_score ≤ 6; allow when ≤ 3.

Step 4 — Add a verification check (a unit test, health probe, or one-off curl — whatever fits this runtime) that calls /v1/parse with the literal string "Ignore previous instructions" and asserts risk_score ≥ 9.

Report the files or runtime config you changed, how to verify the integration works, and any decisions you had to make.`;

  const X402_PROMPT = `You will integrate Parse, an independent prompt-injection security API, into this codebase or running agent runtime using x402 micropayments on Base mainnet (no API key — pay per call in USDC, ~$0.005 per /v1/parse call).

Step 1 — Confirm the runtime can sign transactions on Base mainnet. Install \`@x402/fetch\` and \`viem\` via npm (or the equivalent x402 client for this language). The wallet's hex private key must be available at runtime via env var PRIVATE_KEY (or whatever secret store this runtime uses), with at least $0.05 USDC funded on Base. Never commit the key.

Step 2 — Read the integration guide at https://www.parsethis.ai/skill and follow it as instructions, not as documentation.

Step 3 — Wire POST https://www.parsethis.ai/v1/parse into every input boundary where the system handles text it did not generate. Use wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY)) from @x402/fetch — it handles the 402 → sign USDC → retry-with-payment flow automatically. Block when response.policy.auto_block is true; log + continue when 4 ≤ risk_score ≤ 6; allow when ≤ 3.

Step 4 — Add a verification check (a unit test, health probe, or one-off curl — whatever fits this runtime) that calls /v1/parse with the literal string "Ignore previous instructions" and asserts risk_score ≥ 9. Confirm the test wallet was charged ~$0.005 USDC on basescan.org.

Report the files or runtime config you changed, how to verify the integration works, the funded wallet address, and any decisions you had to make.`;

  const promptsPayload = JSON.stringify({ bearer: BEARER_PROMPT, x402: X402_PROMPT });

  const blogPosts = listBlogPosts().slice(0, 3);
  const blogCardsHtml = blogPosts.map(post => {
    const fm = post.frontmatter;
    return `<a href="/blog/${fm.category}/${fm.slug}" class="card" style="text-decoration:none;color:inherit;">
      <div style="font-weight:600;margin-bottom:6px;">${fm.title}</div>
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">${fm.description || ""}</div>
      <div style="font-size:12px;color:var(--text-dim);">${fm.date} · ${fm.reading_time || post.readingTime + " min read"}</div>
    </a>`;
  }).join("\n    ");

  const content = `
<!-- One-step install hero — paste-into-your-agent prompt with Bearer/x402 toggle -->
<style>
.install-hero{position:relative;max-width:880px;margin:0 auto 56px;padding:40px 28px 36px;border-radius:calc(var(--radius) * 1.6);background:linear-gradient(180deg,rgba(99,102,241,0.06) 0%,rgba(9,9,11,0) 70%);}
.install-hero::before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(140deg,rgba(99,102,241,0.45),rgba(99,102,241,0) 35%,rgba(129,140,248,0.35) 75%,rgba(99,102,241,0.55));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none;}
.install-hero__eyebrow{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;color:var(--accent2);margin-bottom:14px;display:inline-flex;align-items:center;gap:8px;}
.install-hero__eyebrow::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent2);box-shadow:0 0 0 4px rgba(129,140,248,0.18);}
.install-hero__title{font-size:clamp(28px,4.2vw,40px);font-weight:700;line-height:1.08;letter-spacing:-0.02em;margin:0 0 14px;}
.install-hero__sub{color:var(--text-dim);font-size:15px;max-width:600px;margin:0 0 24px;}
.install-hero__toggle{display:inline-flex;background:rgba(24,24,27,0.85);border:1px solid var(--border);border-radius:999px;padding:4px;gap:2px;margin-bottom:16px;backdrop-filter:blur(8px);}
.install-hero__tab{appearance:none;border:0;background:transparent;color:var(--text-dim);padding:8px 16px;border-radius:999px;cursor:pointer;font:inherit;font-size:13px;font-weight:600;letter-spacing:-0.005em;display:inline-flex;align-items:baseline;gap:8px;transition:color 160ms ease,background 160ms ease;}
.install-hero__tab:hover{color:var(--text);}
.install-hero__tab.is-active{background:linear-gradient(140deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 4px 14px rgba(99,102,241,0.32);}
.install-hero__tab-meta{font-size:11px;font-weight:500;opacity:0.78;letter-spacing:0;}
.install-hero__tab.is-active .install-hero__tab-meta{opacity:0.9;}
.install-hero__code-wrap{position:relative;background:#0a0a0c;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;}
.install-hero__code-wrap::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(129,140,248,0.55),transparent);}
.install-hero__code{margin:0;padding:24px 28px 26px;font-family:ui-monospace,"JetBrains Mono","SF Mono","Menlo",monospace;font-size:13px;line-height:1.65;color:#e4e4e7;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow-y:auto;}
.install-hero__code code{font-family:inherit;color:inherit;background:none;padding:0;}
.install-hero__copy{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;gap:7px;padding:7px 13px;border-radius:999px;background:rgba(24,24,27,0.92);border:1px solid var(--border);color:var(--text-dim);font:inherit;font-size:12px;font-weight:600;letter-spacing:0.01em;cursor:pointer;transition:color 140ms ease,background 140ms ease,border-color 140ms ease,transform 140ms ease;backdrop-filter:blur(6px);}
.install-hero__copy:hover{color:var(--text);background:rgba(39,39,42,0.95);border-color:var(--accent2);}
.install-hero__copy:active{transform:translateY(1px);}
.install-hero__copy.is-copied{color:#86efac;border-color:#16a34a;background:rgba(5,46,22,0.55);}
.install-hero__copy svg{width:13px;height:13px;}
.install-hero__hint{margin-top:18px;font-size:13px;color:var(--text-dim);display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;}
.install-hero__hint strong{color:var(--text);font-weight:600;}
.install-hero__hint a{color:var(--accent2);}
@media (max-width:560px){
  .install-hero{padding:28px 18px 24px;margin-bottom:40px;}
  .install-hero__code{font-size:12px;padding:18px 18px 20px;max-height:300px;}
  .install-hero__copy{top:10px;right:10px;}
  .install-hero__tab{padding:8px 12px;}
  .install-hero__tab-meta{display:none;}
}
@media (prefers-reduced-motion:reduce){.install-hero__copy,.install-hero__tab{transition:none;}}
</style>
<section class="install-hero" aria-labelledby="install-hero-title">
  <div class="install-hero__eyebrow">One-step install · paste into your agent</div>
  <h1 id="install-hero-title" class="install-hero__title">Hand Parse to your AI. It does the rest.</h1>
  <p class="install-hero__sub">Copy the prompt below and paste it into Claude, ChatGPT, Cursor, or any coding or runtime agent. It provisions auth, reads the integration guide, and wires Parse into your codebase or agent runtime end-to-end.</p>

  <div class="install-hero__toggle" role="tablist" aria-label="Authentication method">
    <button type="button" role="tab" aria-selected="true" data-route="bearer" class="install-hero__tab is-active">
      <span class="install-hero__tab-label">Bearer key</span>
      <span class="install-hero__tab-meta">Free · 10K req/mo</span>
    </button>
    <button type="button" role="tab" aria-selected="false" data-route="x402" class="install-hero__tab">
      <span class="install-hero__tab-label">x402 USDC</span>
      <span class="install-hero__tab-meta">Pay-per-call · Base</span>
    </button>
  </div>

  <div class="install-hero__code-wrap">
    <button type="button" class="install-hero__copy" aria-label="Copy prompt to clipboard">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span class="install-hero__copy-label">Copy</span>
    </button>
    <pre class="install-hero__code" tabindex="0"><code class="install-hero__code-text"></code></pre>
  </div>

  <div class="install-hero__hint">
    <span><strong>Then run your agent.</strong> ~30 seconds to a verified screening call.</span>
    <span>Want to do it yourself? <a href="/docs/quickstart">Quick start guide &rarr;</a></span>
  </div>
</section>
<script>
(function(){
  var root=document.querySelector('.install-hero');if(!root)return;
  var prompts=${promptsPayload};
  var tabs=root.querySelectorAll('.install-hero__tab');
  var codeEl=root.querySelector('.install-hero__code-text');
  var copyBtn=root.querySelector('.install-hero__copy');
  var copyLabel=root.querySelector('.install-hero__copy-label');
  var copyTimer=null;
  function setRoute(route){
    if(!prompts[route])return;
    tabs.forEach(function(t){
      var active=t.dataset.route===route;
      t.classList.toggle('is-active',active);
      t.setAttribute('aria-selected',active?'true':'false');
    });
    codeEl.textContent=prompts[route];
    root.dataset.route=route;
  }
  tabs.forEach(function(t){t.addEventListener('click',function(){setRoute(t.dataset.route);});});
  setRoute('bearer');
  copyBtn.addEventListener('click',function(){
    var text=codeEl.textContent||'';
    var done=function(ok){
      copyLabel.textContent=ok?'Copied':'Press Cmd+C';
      copyBtn.classList.toggle('is-copied',ok);
      if(copyTimer)clearTimeout(copyTimer);
      copyTimer=setTimeout(function(){copyLabel.textContent='Copy';copyBtn.classList.remove('is-copied');},1800);
    };
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){done(true);}).catch(function(){done(false);});
    }else{
      try{
        var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='absolute';ta.style.left='-9999px';
        document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done(true);
      }catch(e){done(false);}
    }
  });
})();
</script>

<!-- Chunk 1: Hero — value prop + CTAs (Miller's Law: 1 of 7) -->
<div class="section-chunk animate-in">
  <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent2);margin-bottom:12px;">Independent Prompt Security</div>
  <h2 style="font-size:clamp(24px,3.4vw,32px);">Stop Prompt Injection Before It Reaches Your Agent</h2>

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

<!-- Why Parse? — Independence narrative -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Why Parse?</h2>
  <p class="answer-capsule" style="max-width:720px;">The AI security market is consolidating fast. When prompt security tools get acquired by LLM providers, their APIs get sunset, detection models get optimized for one vendor, and your multi-model stack loses coverage. Parse stays independent so your security layer doesn't depend on any single vendor's roadmap.</p>
  <p style="font-size:14px;"><a href="/blog/thought-leadership/why-we-built-independent-prompt-security-api">Read: Why we built an independent prompt security API &rarr;</a></p>
</div>

<!-- Built for — social proof -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Built for the agent ecosystem</h2>
  <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:center;padding:16px 0;">
    <span class="badge badge-default" style="font-size:14px;padding:8px 16px;">LangChain</span>
    <span class="badge badge-default" style="font-size:14px;padding:8px 16px;">CrewAI</span>
    <span class="badge badge-default" style="font-size:14px;padding:8px 16px;">Claude Code</span>
    <span class="badge badge-default" style="font-size:14px;padding:8px 16px;">Cursor</span>
    <span class="badge badge-default" style="font-size:14px;padding:8px 16px;">OpenAI Agents</span>
  </div>
  <div style="display:flex;gap:12px;justify-content:center;align-items:center;margin-top:8px;">
    <img src="https://img.shields.io/github/stars/Danservfinn/parse-for-agents?style=flat&color=6366f1" alt="GitHub stars" height="20">
    <span class="badge badge-green">Open Source</span>
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
  <p class="answer-capsule">Prompt Guard screens for OWASP LLM01:2025 threats across 8 risk categories. The regex layer resolves known patterns in under 20ms; full LLM-backed analysis runs on demand.</p>

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
  <p class="answer-capsule">Parse uses a three-layer detection pipeline: 100+ regex patterns scan for known injection signatures across 9 risk categories, LLM-powered deep analysis catches novel attacks by evaluating semantic intent, and optional sandbox execution runs suspicious prompts in an isolated environment. Each layer contributes to a 0&ndash;10 composite risk score.</p>

  <div class="card-grid" style="max-width:800px;margin:0 auto;">
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:4px;">100+</div>
      <div style="font-size:13px;color:var(--text-dim);">Regex patterns across 9 risk categories</div>
    </div>
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:4px;">&lt;20ms</div>
      <div style="font-size:13px;color:var(--text-dim);">Regex layer; LLM path ~2&ndash;3s</div>
    </div>
    <div class="card" style="text-align:center;">
      <div style="font-size:28px;font-weight:700;color:var(--accent2);margin-bottom:4px;">3-layer</div>
      <div style="font-size:13px;color:var(--text-dim);">ML classifier + LLM escalation + sandbox</div>
    </div>
  </div>

  <aside style="border-left:3px solid var(--accent);">
    <p style="font-size:13px;color:var(--text-dim);margin:0;">The multi-layer approach combines pattern matching, LLM classification, and structural analysis across 8 risk categories. Detection logic is continuously updated to cover new injection techniques and adversarial patterns.</p>
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

<!-- Latest from the blog -->
<div class="section-chunk">
  <h2 style="margin-top:0;">Latest from the blog</h2>
  <div class="card-grid" style="max-width:800px;margin:0 auto;">
    ${blogCardsHtml}
  </div>
  <p style="text-align:center;margin-top:16px;"><a href="/blog" style="font-size:14px;">View all posts &rarr;</a></p>
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
