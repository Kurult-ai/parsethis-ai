export function getDashboardHTML(demoKey: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parse for Agents - Dashboard</title>
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
      --yellow: #fbbf24;
      --red: #f87171;
      --orange: #fb923c;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }
    header h1 {
      font-size: 24px;
      font-weight: 700;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    header .badge {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      background: var(--surface2);
      border: 1px solid var(--border);
      color: var(--text-dim);
    }
    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0;
    }
    .tab {
      padding: 10px 20px;
      cursor: pointer;
      border: none;
      background: none;
      color: var(--text-dim);
      font-size: 14px;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: var(--text); }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }
    .panel { display: none; }
    .panel.active { display: block; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
    }
    .card h3 {
      font-size: 16px;
      margin-bottom: 16px;
      color: var(--accent2);
    }
    .form-group { margin-bottom: 16px; }
    label {
      display: block;
      font-size: 13px;
      color: var(--text-dim);
      margin-bottom: 6px;
    }
    input, select, textarea {
      width: 100%;
      padding: 10px 14px;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
    }
    textarea { resize: vertical; min-height: 80px; }
    button.primary {
      padding: 10px 24px;
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button.primary:hover { opacity: 0.9; }
    button.primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .row { display: flex; gap: 16px; }
    .row > * { flex: 1; }
    .key-display {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      padding: 10px;
      background: var(--surface2);
      border-radius: 6px;
      word-break: break-all;
      user-select: all;
      border: 1px solid var(--border);
    }
    .result-box {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-top: 16px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 600px;
      overflow-y: auto;
      line-height: 1.5;
    }
    .score-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 8px 0;
    }
    .score-bar .bar {
      flex: 1;
      height: 8px;
      background: var(--surface2);
      border-radius: 4px;
      overflow: hidden;
    }
    .score-bar .bar .fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s;
    }
    .score-label {
      font-size: 14px;
      font-weight: 600;
      min-width: 40px;
      text-align: right;
    }
    .verdict {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    .verdict.reliable { background: rgba(52, 211, 153, 0.15); color: var(--green); }
    .verdict.mostly_reliable { background: rgba(52, 211, 153, 0.1); color: var(--green); }
    .verdict.mixed { background: rgba(251, 191, 36, 0.15); color: var(--yellow); }
    .verdict.questionable { background: rgba(251, 146, 60, 0.15); color: var(--orange); }
    .verdict.unreliable { background: rgba(248, 113, 113, 0.15); color: var(--red); }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--surface2);
      border-radius: 3px;
      overflow: hidden;
      margin: 12px 0;
    }
    .progress-bar .fill {
      height: 100%;
      background: var(--accent);
      border-radius: 3px;
      transition: width 0.3s;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
    }
    .status-dot.ok { background: var(--green); }
    .status-dot.running { background: var(--yellow); animation: pulse 1s infinite; }
    .status-dot.error { background: var(--red); }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .chat-container {
      display: flex;
      flex-direction: column;
      height: 500px;
    }
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .chat-msg {
      padding: 10px 14px;
      border-radius: 12px;
      max-width: 80%;
      font-size: 14px;
      line-height: 1.5;
    }
    .chat-msg.user {
      align-self: flex-end;
      background: var(--accent);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .chat-msg.assistant {
      align-self: flex-start;
      background: var(--surface2);
      border: 1px solid var(--border);
      border-bottom-left-radius: 4px;
    }
    .chat-input {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--border);
    }
    .chat-input input { flex: 1; }
    .analysis-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 16px 0;
    }
    .stat-card {
      background: var(--surface2);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat-card .value {
      font-size: 28px;
      font-weight: 700;
      margin: 4px 0;
    }
    .stat-card .label { font-size: 12px; color: var(--text-dim); }
    .claim-list { list-style: none; }
    .claim-list li {
      padding: 10px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .claim-verdict {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
      font-weight: 600;
    }
    .claim-verdict.supported { background: rgba(52, 211, 153, 0.15); color: var(--green); }
    .claim-verdict.partially_supported { background: rgba(251, 191, 36, 0.15); color: var(--yellow); }
    .claim-verdict.unsupported { background: rgba(248, 113, 113, 0.15); color: var(--red); }
    .claim-verdict.misleading { background: rgba(248, 113, 113, 0.2); color: var(--red); }
    @media (max-width: 768px) {
      .row { flex-direction: column; }
      .container { padding: 16px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Parse for Agents</h1>
      <span class="badge">v1.0.0</span>
    </header>

    <div class="tabs">
      <button class="tab active" onclick="switchTab('analyze')">Analyze URL</button>
      <button class="tab" onclick="switchTab('chat')">Chat</button>
      <button class="tab" onclick="switchTab('evaluate')">Evaluate Prompt</button>
      <button class="tab" onclick="switchTab('api')">API Info</button>
    </div>

    <!-- Analyze Panel -->
    <div id="panel-analyze" class="panel active">
      <div class="card">
        <h3>Media Credibility Analysis</h3>
        <p style="color: var(--text-dim); margin-bottom: 16px; font-size: 14px;">
          Submit any URL for AI-powered credibility analysis. The analysis runs multiple specialized agents to evaluate claims, detect bias, identify fallacies, and assess evidence quality.
        </p>
        <div class="row">
          <div class="form-group" style="flex: 3;">
            <label>URL to Analyze</label>
            <input type="url" id="analyze-url" placeholder="https://example.com/article">
          </div>
          <div class="form-group" style="flex: 1;">
            <label>Depth</label>
            <select id="analyze-depth">
              <option value="quick">Quick</option>
              <option value="standard" selected>Standard</option>
              <option value="deep">Deep</option>
            </select>
          </div>
        </div>
        <button class="primary" id="analyze-btn" onclick="runAnalysis()">Analyze</button>
      </div>

      <div id="analyze-progress" style="display:none;" class="card">
        <h3><span class="status-dot running"></span> Analysis in Progress</h3>
        <div class="progress-bar"><div class="fill" id="progress-fill" style="width: 0%"></div></div>
        <p id="progress-text" style="font-size: 13px; color: var(--text-dim);">Starting...</p>
      </div>

      <div id="analyze-result" style="display:none;"></div>
    </div>

    <!-- Chat Panel -->
    <div id="panel-chat" class="panel">
      <div class="card">
        <h3>Chat with Parse AI</h3>
        <div class="chat-container">
          <div class="chat-messages" id="chat-messages">
            <div class="chat-msg assistant">
              Hi! I'm Parse, your media analysis assistant. Ask me about news articles, media credibility, fact-checking, or paste a URL to discuss.
            </div>
          </div>
          <div class="chat-input">
            <input type="text" id="chat-input" placeholder="Ask about media analysis..." onkeydown="if(event.key==='Enter')sendChat()">
            <button class="primary" onclick="sendChat()">Send</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Evaluate Panel -->
    <div id="panel-evaluate" class="panel">
      <div class="card">
        <h3>Prompt Evaluation</h3>
        <p style="color: var(--text-dim); margin-bottom: 16px; font-size: 14px;">
          Test and evaluate prompts for safety, quality, and cost estimation.
        </p>
        <div class="form-group">
          <label>System Prompt</label>
          <textarea id="eval-prompt" rows="3" placeholder="You are a helpful assistant that..."></textarea>
        </div>
        <div class="row">
          <div class="form-group">
            <label>Test Input</label>
            <input type="text" id="eval-input" placeholder="What would you like me to help with?">
          </div>
          <div class="form-group">
            <label>Model</label>
            <select id="eval-model">
              <option value="deepseek/deepseek-chat-v3-0324:free">DeepSeek V3 (Free)</option>
              <option value="google/gemini-2.0-flash-exp:free">Gemini Flash (Free)</option>
              <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
              <option value="anthropic/claude-3-haiku">Claude 3 Haiku</option>
            </select>
          </div>
        </div>
        <button class="primary" id="eval-btn" onclick="runEvaluation()">Evaluate</button>
      </div>
      <div id="eval-result" style="display:none;"></div>
    </div>

    <!-- API Info Panel -->
    <div id="panel-api" class="panel">
      <div class="card">
        <h3>Your API Key</h3>
        <p style="color: var(--text-dim); margin-bottom: 12px; font-size: 14px;">
          Use this key to authenticate API requests. Include it as a Bearer token or query parameter.
        </p>
        <div class="key-display" id="api-key-display">${demoKey}</div>
        <div style="margin-top: 12px; font-size: 13px; color: var(--text-dim);">
          <p><strong>Authorization header:</strong> <code>Authorization: Bearer ${demoKey}</code></p>
          <p><strong>Query parameter:</strong> <code>?api_key=${demoKey}</code></p>
        </div>
      </div>
      <div class="card">
        <h3>Quick Start</h3>
        <div class="result-box">
# Analyze a URL
curl -X POST \\
  ${"{BASE_URL}"}/v1/analyze \\
  -H "Authorization: Bearer ${demoKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url": "https://example.com/article", "depth": "standard"}'

# Check results
curl ${"{BASE_URL}"}/v1/analyze/{id} \\
  -H "Authorization: Bearer ${demoKey}"

# Chat with Parse
curl -X POST \\
  ${"{BASE_URL}"}/v1/chat \\
  -H "Authorization: Bearer ${demoKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "Is BBC generally reliable?"}]}'

# Evaluate a prompt
curl -X POST \\
  ${"{BASE_URL}"}/v1/evaluate \\
  -H "Authorization: Bearer ${demoKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "You are a factual assistant", "test_inputs": ["Is the earth flat?"]}'</div>
      </div>
      <div class="card">
        <h3>API Endpoints</h3>
        <table style="width:100%; font-size: 13px;">
          <tr style="text-align: left; color: var(--text-dim);">
            <th style="padding: 8px;">Method</th>
            <th style="padding: 8px;">Endpoint</th>
            <th style="padding: 8px;">Description</th>
          </tr>
          <tr><td style="padding: 8px;"><code>POST</code></td><td style="padding: 8px;"><code>/v1/analyze</code></td><td style="padding: 8px;">Submit URL for analysis</td></tr>
          <tr><td style="padding: 8px;"><code>GET</code></td><td style="padding: 8px;"><code>/v1/analyze/:id</code></td><td style="padding: 8px;">Get analysis results</td></tr>
          <tr><td style="padding: 8px;"><code>GET</code></td><td style="padding: 8px;"><code>/v1/analyze/:id/stream</code></td><td style="padding: 8px;">Stream analysis progress (SSE)</td></tr>
          <tr><td style="padding: 8px;"><code>POST</code></td><td style="padding: 8px;"><code>/v1/evaluate</code></td><td style="padding: 8px;">Evaluate prompt safety/quality</td></tr>
          <tr><td style="padding: 8px;"><code>POST</code></td><td style="padding: 8px;"><code>/v1/chat</code></td><td style="padding: 8px;">Chat with Parse AI</td></tr>
          <tr><td style="padding: 8px;"><code>GET</code></td><td style="padding: 8px;"><code>/v1/models</code></td><td style="padding: 8px;">List available models</td></tr>
          <tr><td style="padding: 8px;"><code>GET</code></td><td style="padding: 8px;"><code>/docs</code></td><td style="padding: 8px;">Full API documentation</td></tr>
        </table>
      </div>
    </div>
  </div>

  <script>
    const API_KEY = '${demoKey}';
    const BASE = '';

    function switchTab(name) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('panel-' + name).classList.add('active');
    }

    async function apiCall(method, path, body) {
      const opts = {
        method,
        headers: {
          'Authorization': 'Bearer ' + API_KEY,
          'Content-Type': 'application/json',
        },
      };
      if (body) opts.body = JSON.stringify(body);
      const res = await fetch(BASE + path, opts);
      return res.json();
    }

    // === Analysis ===
    async function runAnalysis() {
      const url = document.getElementById('analyze-url').value.trim();
      if (!url) return alert('Please enter a URL');

      const depth = document.getElementById('analyze-depth').value;
      const btn = document.getElementById('analyze-btn');
      btn.disabled = true;
      btn.textContent = 'Starting...';

      document.getElementById('analyze-progress').style.display = 'block';
      document.getElementById('analyze-result').style.display = 'none';

      try {
        const { id } = await apiCall('POST', '/v1/analyze', { url, depth });
        pollAnalysis(id);
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Analyze';
      }
    }

    async function pollAnalysis(id) {
      const poll = async () => {
        const result = await apiCall('GET', '/v1/analyze/' + id);

        // Update progress
        const pct = result.progress || 0;
        document.getElementById('progress-fill').style.width = pct + '%';
        const agents = result.agents_completed || [];
        document.getElementById('progress-text').textContent =
          result.status + ' - ' + agents.length + '/' + (result.agents_total || []).length + ' agents complete (' + pct + '%)';

        if (result.status === 'completed' || result.status === 'error') {
          document.getElementById('analyze-progress').style.display = 'none';
          document.getElementById('analyze-btn').disabled = false;
          document.getElementById('analyze-btn').textContent = 'Analyze';
          renderAnalysisResult(result);
          return;
        }

        setTimeout(poll, 1500);
      };
      poll();
    }

    function renderAnalysisResult(result) {
      const el = document.getElementById('analyze-result');
      el.style.display = 'block';

      if (result.status === 'error') {
        el.innerHTML = '<div class="card"><h3 style="color: var(--red)">Error</h3><p>' + result.error + '</p></div>';
        return;
      }

      const a = result.analysis || {};
      const article = result.article || {};
      const score = a.credibility_score || 0;
      const scoreColor = score >= 70 ? 'var(--green)' : score >= 40 ? 'var(--yellow)' : 'var(--red)';

      let html = '<div class="card">';
      html += '<h3>' + (article.title || 'Analysis Complete') + '</h3>';
      html += '<p style="color: var(--text-dim); font-size: 13px; margin-bottom: 16px;">' + (article.source || '') + ' | ' + (result.depth || '') + ' analysis | ' + (result.duration_ms || 0) + 'ms</p>';

      // Summary stats
      html += '<div class="analysis-summary">';
      html += '<div class="stat-card"><div class="label">Credibility Score</div><div class="value" style="color:' + scoreColor + '">' + score + '</div></div>';
      html += '<div class="stat-card"><div class="label">Verdict</div><div class="value"><span class="verdict ' + (a.verdict || '') + '">' + (a.verdict || 'N/A') + '</span></div></div>';
      html += '<div class="stat-card"><div class="label">Genre</div><div class="value" style="font-size:18px">' + (a.genre || 'N/A') + '</div></div>';
      html += '<div class="stat-card"><div class="label">Evidence Score</div><div class="value">' + (a.evidence_quality?.score || 'N/A') + '</div></div>';
      html += '</div>';

      // Summary
      if (a.summary) {
        html += '<div style="margin: 16px 0; padding: 12px; background: var(--surface2); border-radius: 8px; font-size: 14px;">' + a.summary + '</div>';
      }

      // Key takeaways
      if (a.key_takeaways && a.key_takeaways.length > 0) {
        html += '<h3 style="margin-top: 20px;">Key Takeaways</h3><ul style="margin: 8px 0; padding-left: 20px;">';
        a.key_takeaways.forEach(t => { html += '<li style="margin: 4px 0; font-size: 14px;">' + t + '</li>'; });
        html += '</ul>';
      }

      // Claims
      if (a.claims && a.claims.length > 0) {
        html += '<h3 style="margin-top: 20px;">Claims Fact-Check</h3><ul class="claim-list">';
        a.claims.forEach(c => {
          html += '<li><span class="claim-verdict ' + c.verdict + '">' + c.verdict + '</span><span style="font-size:14px;">' + c.text + '</span></li>';
        });
        html += '</ul>';
      }

      // Bias
      if (a.bias_assessment) {
        html += '<h3 style="margin-top: 20px;">Bias Assessment</h3>';
        html += '<p style="font-size:14px;">Direction: <strong>' + a.bias_assessment.direction + '</strong> (confidence: ' + (a.bias_assessment.confidence * 100).toFixed(0) + '%)</p>';
        if (a.bias_assessment.indicators?.length) {
          html += '<ul style="margin: 8px 0; padding-left: 20px;">';
          a.bias_assessment.indicators.forEach(i => { html += '<li style="font-size:13px; color: var(--text-dim);">' + i + '</li>'; });
          html += '</ul>';
        }
      }

      // Deception
      if (a.deception_indicators && a.deception_indicators.length > 0) {
        html += '<h3 style="margin-top: 20px; color: var(--orange);">Deception Indicators</h3>';
        a.deception_indicators.forEach(d => {
          html += '<div style="margin: 8px 0; padding: 8px; border-left: 3px solid var(--orange); font-size: 13px;"><strong>' + d.type + '</strong> (' + d.severity + '): ' + d.description + '</div>';
        });
      }

      // Fallacies
      if (a.fallacies && a.fallacies.length > 0) {
        html += '<h3 style="margin-top: 20px; color: var(--yellow);">Logical Fallacies</h3>';
        a.fallacies.forEach(f => {
          html += '<div style="margin: 8px 0; padding: 8px; border-left: 3px solid var(--yellow); font-size: 13px;"><strong>' + f.name + '</strong>: ' + f.description + '</div>';
        });
      }

      // Steel man
      if (a.steel_man) {
        html += '<h3 style="margin-top: 20px;">Steel Man</h3>';
        html += '<div style="margin: 8px 0; padding: 12px; background: var(--surface2); border-radius: 8px; font-size: 14px; font-style: italic;">' + a.steel_man + '</div>';
      }

      // Raw JSON toggle
      html += '<h3 style="margin-top: 20px; cursor: pointer;" onclick="document.getElementById(\\'raw-json\\').style.display=document.getElementById(\\'raw-json\\').style.display===\\'none\\'?\\'block\\':\\'none\\'">Raw JSON Response &#9660;</h3>';
      html += '<div id="raw-json" class="result-box" style="display:none">' + JSON.stringify(result, null, 2) + '</div>';

      html += '</div>';
      el.innerHTML = html;
    }

    // === Chat ===
    const chatHistory = [];

    async function sendChat() {
      const input = document.getElementById('chat-input');
      const msg = input.value.trim();
      if (!msg) return;

      input.value = '';
      chatHistory.push({ role: 'user', content: msg });
      appendChatMsg('user', msg);

      try {
        const response = await apiCall('POST', '/v1/chat', { messages: chatHistory });
        const content = response.message?.content || 'No response';
        chatHistory.push({ role: 'assistant', content });
        appendChatMsg('assistant', content);
      } catch (err) {
        appendChatMsg('assistant', 'Error: ' + err.message);
      }
    }

    function appendChatMsg(role, content) {
      const container = document.getElementById('chat-messages');
      const div = document.createElement('div');
      div.className = 'chat-msg ' + role;
      div.textContent = content;
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }

    // === Evaluation ===
    async function runEvaluation() {
      const prompt = document.getElementById('eval-prompt').value.trim();
      if (!prompt) return alert('Please enter a prompt');

      const input = document.getElementById('eval-input').value.trim();
      const model = document.getElementById('eval-model').value;
      const btn = document.getElementById('eval-btn');
      btn.disabled = true;
      btn.textContent = 'Evaluating...';

      try {
        const { id } = await apiCall('POST', '/v1/evaluate', {
          prompt,
          model,
          test_inputs: input ? [input] : [''],
          evaluators: ['safety', 'quality', 'cost'],
        });
        pollEvaluation(id);
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'Evaluate';
      }
    }

    async function pollEvaluation(id) {
      const poll = async () => {
        const result = await apiCall('GET', '/v1/evaluate/' + id);
        if (result.status === 'completed' || result.status === 'error') {
          document.getElementById('eval-btn').disabled = false;
          document.getElementById('eval-btn').textContent = 'Evaluate';
          renderEvalResult(result);
          return;
        }
        setTimeout(poll, 1000);
      };
      poll();
    }

    function renderEvalResult(result) {
      const el = document.getElementById('eval-result');
      el.style.display = 'block';
      let html = '<div class="card"><h3>Evaluation Results</h3>';
      html += '<div class="analysis-summary">';
      html += '<div class="stat-card"><div class="label">Safe</div><div class="value" style="color:' + (result.safe ? 'var(--green)' : 'var(--red)') + '">' + (result.safe ? 'Yes' : 'No') + '</div></div>';
      html += '<div class="stat-card"><div class="label">Quality</div><div class="value">' + ((result.quality_score || 0) * 100).toFixed(0) + '%</div></div>';
      html += '<div class="stat-card"><div class="label">Tokens</div><div class="value">' + (result.total_tokens || 0) + '</div></div>';
      html += '<div class="stat-card"><div class="label">Cost</div><div class="value">$' + (result.total_cost_estimate || 0).toFixed(6) + '</div></div>';
      html += '</div>';
      html += '<div class="result-box">' + JSON.stringify(result, null, 2) + '</div>';
      html += '</div>';
      el.innerHTML = html;
    }
  </script>
</body>
</html>`;
}
