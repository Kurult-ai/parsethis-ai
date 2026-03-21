import { getParseSkillPrompt } from "./skill.js";

export function getDashboardHTML(demoKey: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parse for Agents</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface2: #1a1a2e;
      --border: #2a2a3e;
      --text: #e0e0e8;
      --text-dim: #8888a0;
      --accent: #6366f1;
      --accent2: #818cf8;
      --green: #34d399;
      --green-dim: #065f46;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .container { max-width: 900px; margin: 0 auto; padding: 24px; }
    header {
      text-align: center;
      padding: 48px 0 24px;
    }
    header h1 {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
    }
    header p {
      color: var(--text-dim);
      font-size: 16px;
      max-width: 600px;
      margin: 0 auto;
    }
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 20px;
    }
    .section h2 {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .section p.desc {
      font-size: 14px;
      color: var(--text-dim);
      margin-bottom: 16px;
    }
    .code-block {
      position: relative;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 48px 16px 16px;
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
      color: var(--text);
    }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 5px 12px;
      background: var(--surface);
      color: var(--text-dim);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .copy-btn:hover { color: var(--text); border-color: var(--accent2); }
    .copy-btn.copied { background: var(--green-dim); color: var(--green); border-color: var(--green); }
    .skill-prompt {
      font-size: 12px;
      max-height: 500px;
      overflow-y: auto;
    }
    .gen-btn {
      padding: 10px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .gen-btn:hover { opacity: 0.9; }
    .gen-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .key-result {
      margin-top: 16px;
      display: none;
    }
    .key-result.visible { display: block; }
    .key-value {
      font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      font-size: 14px;
      padding: 12px 16px;
      background: var(--green-dim);
      border-radius: 8px;
      border: 1px solid var(--green);
      word-break: break-all;
      user-select: all;
      color: var(--green);
      margin-bottom: 8px;
    }
    .key-note {
      font-size: 12px;
      color: var(--text-dim);
    }
    footer {
      text-align: center;
      padding: 32px 0 16px;
      font-size: 12px;
      color: var(--text-dim);
    }
    footer a {
      color: var(--accent2);
      text-decoration: none;
    }
    footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Parse for Agents</h1>
      <p>Agent-optimized prompt safety API. The skill prompt below teaches your agent everything it needs — including automatic API key generation.</p>
    </header>

    <!-- Skill Prompt -->
    <div class="section">
      <h2>Skill Prompt</h2>
      <p class="desc">Copy this into your agent's system instructions or save as a skill file. The agent will self-provision an API key and use all Parse endpoints automatically.</p>
      <div class="code-block">
        <button class="copy-btn" onclick="copySkill(this)">Copy</button>
        <pre id="skill-prompt" class="skill-prompt">Loading...</pre>
      </div>
    </div>

    <!-- API Key Generator -->
    <div class="section">
      <h2>API Key Generator</h2>
      <p class="desc">Optional: generate an API key here. Agents using the skill prompt will auto-generate their own keys via POST /v1/keys/generate.</p>
      <button class="gen-btn" id="gen-btn" onclick="generateKey()">Generate API Key</button>
      <div class="key-result" id="key-result">
        <div class="key-value" id="key-value"></div>
        <div class="key-note">Store this key securely. Set it as <code>PARSE_API_KEY</code> in your agent's environment.</div>
      </div>
    </div>

    <footer>
      <a href="/docs">API Reference</a> · <a href="/health">Health</a> · <a href="/skill/install.sh">Install Script</a>
    </footer>
  </div>

  <script>
    const BASE = window.location.origin;

    // Load skill prompt
    fetch(BASE + '/skill')
      .then(r => r.text())
      .then(text => {
        window._skillPrompt = text;
        document.getElementById('skill-prompt').textContent = text;
      });

    function copySkill(btn) {
      const text = window._skillPrompt || document.getElementById('skill-prompt').textContent;
      navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
    }

    async function generateKey() {
      const btn = document.getElementById('gen-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';
      try {
        const res = await fetch('/v1/keys/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Dashboard Key ' + new Date().toISOString().slice(0, 10) }),
        });
        const data = await res.json();
        if (data.key) {
          document.getElementById('key-value').textContent = data.key;
          document.getElementById('key-result').classList.add('visible');
        } else {
          alert('Error: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Failed to generate key: ' + err.message);
      }
      btn.disabled = false;
      btn.textContent = 'Generate API Key';
    }
  </script>
</body>
</html>`;
}
