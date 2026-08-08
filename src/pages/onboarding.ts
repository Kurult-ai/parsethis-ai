import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";

/**
 * Guided Onboarding Flow (Task 17.1)
 *
 * A self-serve activation page that walks a developer from zero to their first
 * successful /v1/parse call in under 3 minutes. Three-step wizard:
 *
 *  1. Generate an API key (calls POST /v1/keys/generate client-side)
 *  2. Copy the curl command (pre-filled with their key)
 *  3. Run it and see the expected response
 *
 * Each step emits activation funnel events via POST /v1/activation/track.
 */
export function renderOnboardingPage(baseUrl: string): string {
  const expectedResponse = JSON.stringify(
    {
      id: "prs_00000000-0000-0000-0000-000000000000",
      verdict: "safe",
      risk_score: 0,
      safe: true,
      categories: [],
      flags: [],
      suggested_action: "allow",
      recommended_action: "allow",
      policy: {
        auto_block: false,
        threshold: 7,
        tier: "free",
      },
      analyzed_at: "2025-01-01T00:00:00.000Z",
    },
    null,
    2,
  ).replace(/</g, "\\u003c");

  const content = `
<style>
.ob-shell{max-width:760px;margin:0 auto;}
.ob-hero{text-align:center;padding:48px 0 28px;}
.ob-hero h1{font-size:clamp(32px,5vw,52px);line-height:1;letter-spacing:-0.045em;margin:0 0 14px;}
.ob-hero p{font-size:17px;color:var(--text-dim);line-height:1.6;max-width:520px;margin:0 auto;}
.ob-hero .ob-timer{display:inline-flex;align-items:center;gap:8px;margin-top:22px;padding:8px 16px;border:1px solid var(--border);border-radius:999px;background:var(--surface);font-size:14px;font-weight:600;color:var(--text-dim);}
.ob-timer-dot{width:10px;height:10px;border-radius:999px;background:var(--accent);animation:ob-pulse 2s ease-in-out infinite;}
@keyframes ob-pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}

.ob-steps{display:grid;gap:20px;padding:12px 0 48px;}
.ob-step{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px;box-shadow:var(--shadow);transition:border-color 0.3s,opacity 0.3s;}
.ob-step.ob-done{border-color:var(--green);}
.ob-step.ob-pending{opacity:0.55;}
.ob-step-head{display:flex;align-items:center;gap:14px;margin-bottom:16px;}
.ob-step-num{flex-shrink:0;width:36px;height:36px;border-radius:999px;background:var(--surface2);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:var(--text-dim);transition:all 0.3s;}
.ob-step.ob-active .ob-step-num{background:var(--accent);border-color:var(--accent);color:white;}
.ob-step.ob-done .ob-step-num{background:var(--green);border-color:var(--green);color:white;}
.ob-step-ob-done .ob-step-num::after{content:'\\2713';}
.ob-step h2{margin:0;font-size:20px;letter-spacing:-0.02em;}
.ob-step p{margin:0 0 16px;color:var(--text-dim);font-size:14px;line-height:1.55;}

.ob-key-display{display:none;background:#10141a;border:1px solid #202a35;border-radius:10px;padding:14px 16px;font-family:'JetBrains Mono','SF Mono',monospace;font-size:13px;color:#b7f0ce;word-break:break-all;margin-bottom:14px;}
.ob-key-display.ob-visible{display:block;}

.ob-terminal{background:#10141a;border:1px solid #202a35;border-radius:10px;overflow:hidden;margin-bottom:14px;}
.ob-terminal-top{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #202a35;background:#151b23;}
.ob-terminal-top span{font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8190a0;}
.ob-copy-btn{appearance:none;border:1px solid #263342;background:#0e141c;color:#dce8f5;border-radius:999px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;transition:background 0.2s;}
.ob-copy-btn:hover{background:#171f29;}
.ob-terminal pre{margin:0;padding:16px;font:13px/1.65 'JetBrains Mono','SF Mono',monospace;color:#b7f0ce;white-space:pre-wrap;word-break:break-word;overflow-x:auto;}
.ob-terminal pre .ob-placeholder{color:#6f859d;}

.ob-response{display:none;}
.ob-response.ob-visible{display:block;}
.ob-response pre{margin:0;}
.ob-response .ob-response-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;font:13px/1.65 'JetBrains Mono','SF Mono',monospace;overflow-x:auto;white-space:pre;}

.ob-error{display:none;padding:12px 16px;border-radius:8px;background:var(--destructive-dim);color:var(--destructive);font-size:14px;margin-bottom:14px;}
.ob-error.ob-visible{display:block;}

.ob-actions{display:flex;gap:12px;flex-wrap:wrap;align-items:center;}
.ob-status{font-size:13px;color:var(--text-dim);min-height:1.3em;}

.ob-final{display:none;text-align:center;padding:28px;border:1px solid var(--border);border-radius:14px;background:linear-gradient(135deg,var(--green-dim),var(--surface));}
.ob-final.ob-visible{display:block;}
.ob-final h2{margin:0 0 8px;font-size:24px;color:var(--green);}
.ob-final p{margin:0 0 18px;color:var(--text-dim);font-size:15px;}
.ob-final .ob-ttfc{font-size:32px;font-weight:800;letter-spacing:-0.03em;color:var(--green);}
.ob-final .ob-ttfc-label{font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-soft);display:block;margin-bottom:6px;}

@media(max-width:640px){
  .ob-hero{padding:28px 0 18px;}
  .ob-step{padding:18px;}
  .ob-step h2{font-size:17px;}
}
</style>

<div class="ob-shell">
  <section class="ob-hero">
    <h1>Get to your first call in 3 minutes.</h1>
    <p>Generate an API key, copy a curl command, and make your first screening call. No account required.</p>
    <div class="ob-timer" id="ob-timer">
      <span class="ob-timer-dot"></span>
      <span>Elapsed: <strong id="ob-timer-value">0s</strong></span>
    </div>
  </section>

  <div class="ob-steps">
    <!-- Step 1: Generate Key -->
    <div class="ob-step ob-active" id="ob-step-1">
      <div class="ob-step-head">
        <div class="ob-step-num" id="ob-step-1-num">1</div>
        <h2>Generate your API key</h2>
      </div>
      <p>Click the button below to create a free API key. No signup, no credit card. The key is valid for 30 days.</p>
      <div class="ob-error" id="ob-key-error"></div>
      <div class="ob-key-display" id="ob-key-display"></div>
      <div class="ob-actions">
        <button type="button" class="btn btn-primary" id="ob-generate-key">Generate API Key</button>
        <span class="ob-status" id="ob-key-status" aria-live="polite"></span>
      </div>
    </div>

    <!-- Step 2: Copy curl -->
    <div class="ob-step ob-pending" id="ob-step-2">
      <div class="ob-step-head">
        <div class="ob-step-num" id="ob-step-2-num">2</div>
        <h2>Copy the curl command</h2>
      </div>
      <p>Run this in your terminal to screen a sample prompt. Your key is already included.</p>
      <div class="ob-terminal">
        <div class="ob-terminal-top">
          <span>curl</span>
          <button type="button" class="ob-copy-btn" id="ob-copy-curl">Copy</button>
        </div>
        <pre id="ob-curl-command"><span class="ob-placeholder"># Generate a key first to see your curl command</span></pre>
      </div>
    </div>

    <!-- Step 3: Expected response -->
    <div class="ob-step ob-pending" id="ob-step-3">
      <div class="ob-step-head">
        <div class="ob-step-num" id="ob-step-3-num">3</div>
        <h2>Expected response</h2>
      </div>
      <p>When you run the curl command, you'll get a JSON response like this:</p>
      <div class="ob-response ob-visible">
        <div class="ob-response-box">${"<"}pre>${expectedResponse}${"</"}pre></div>
      </div>
      <div class="ob-actions" style="margin-top:16px;">
        <button type="button" class="btn btn-primary" id="ob-try-now">Try it now</button>
        <span class="ob-status" id="ob-try-status" aria-live="polite"></span>
      </div>
    </div>

    <!-- Success panel -->
    <div class="ob-final" id="ob-final">
      <span class="ob-ttfc-label">Time to first call</span>
      <div class="ob-ttfc" id="ob-ttfc-value">--</div>
      <h2>You're all set!</h2>
      <p>Your API key is saved in your browser. Head to the dashboard to see your screening history, or read the docs to integrate Parse into your agent.</p>
      <div class="ob-actions" style="justify-content:center;">
        <a href="/dashboard" class="btn btn-primary" id="ob-go-dashboard">Go to Dashboard</a>
        <a href="/docs" class="btn btn-outline">Read Docs</a>
      </div>
    </div>
  </div>
</div>

<script>
(function() {
  var apiKey = '';
  var apiKeyId = '';
  var startTime = Date.now();
  var keyGeneratedTs = null;

  // ── Timer ──
  function updateTimer() {
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var el = document.getElementById('ob-timer-value');
    if (el) {
      if (elapsed < 60) {
        el.textContent = elapsed + 's';
      } else {
        el.textContent = Math.floor(elapsed / 60) + 'm ' + (elapsed % 60) + 's';
      }
    }
  }
  setInterval(updateTimer, 1000);

  // ── Track activation event ──
  function track(event, keyId) {
    try {
      fetch('/v1/activation/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key_id: keyId || apiKeyId, event: event })
      }).catch(function() {});
    } catch(e) {}
  }

  // ── Step management ──
  function activateStep(num) {
    for (var i = 1; i <= 3; i++) {
      var step = document.getElementById('ob-step-' + i);
      if (!step) continue;
      if (i < num) {
        step.className = 'ob-step ob-done';
        var numEl = document.getElementById('ob-step-' + i + '-num');
        if (numEl) numEl.textContent = '\\u2713';
      } else if (i === num) {
        step.className = 'ob-step ob-active';
      } else {
        step.className = 'ob-step ob-pending';
      }
    }
  }

  function showFinal(ttfcMs) {
    var panel = document.getElementById('ob-final');
    var steps = document.querySelectorAll('.ob-step');
    steps.forEach(function(s) { s.style.display = 'none'; });
    var timer = document.getElementById('ob-timer');
    if (timer) timer.style.display = 'none';
    if (panel) panel.classList.add('ob-visible');
    var ttfcEl = document.getElementById('ob-ttfc-value');
    if (ttfcEl && ttfcMs != null) {
      if (ttfcMs < 60000) {
        ttfcEl.textContent = (ttfcMs / 1000).toFixed(1) + 's';
      } else {
        ttfcEl.textContent = (ttfcMs / 60000).toFixed(1) + 'm';
      }
    }
  }

  // ── Step 1: Generate key ──
  var genBtn = document.getElementById('ob-generate-key');
  var keyDisplay = document.getElementById('ob-key-display');
  var keyStatus = document.getElementById('ob-key-status');
  var keyError = document.getElementById('ob-key-error');

  function setError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.classList.add('ob-visible');
    setTimeout(function() { el.classList.remove('ob-visible'); }, 5000);
  }

  if (genBtn) {
    genBtn.addEventListener('click', async function() {
      genBtn.disabled = true;
      if (keyStatus) keyStatus.textContent = 'Generating...';
      try {
        var res = await fetch('/v1/keys/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'onboarding' })
        });
        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          throw new Error(errBody.detail || errBody.error || ('HTTP ' + res.status));
        }
        var data = await res.json();
        apiKey = data.key;
        apiKeyId = data.id;
        keyGeneratedTs = new Date().toISOString();
        try { localStorage.setItem('pfa_key', apiKey); } catch(e) {}

        // Display the key (masked)
        if (keyDisplay) {
          keyDisplay.textContent = apiKey.slice(0, 12) + '••••••••••••••••••••••••';
          keyDisplay.classList.add('ob-visible');
        }
        if (keyStatus) keyStatus.textContent = 'Key created!';
        genBtn.textContent = 'Key Generated';

        // Track activation
        track('key_generated', apiKeyId);

        // Update curl command
        var host = window.location.origin;
        var curlCmd = 'curl -s ' + host + '/v1/parse \\\\\\n' +
          '  -H "Authorization: Bearer ' + apiKey + '" \\\\\\n' +
          '  -H "Content-Type: application/json" \\\\\\n' +
          '  -d \\'{"prompt":"Hello, this is a safe test prompt."}\\'';

        var curlEl = document.getElementById('ob-curl-command');
        if (curlEl) curlEl.textContent = curlCmd;

        activateStep(2);
      } catch(err) {
        genBtn.disabled = false;
        genBtn.textContent = 'Generate API Key';
        if (keyStatus) keyStatus.textContent = '';
        setError(keyError, err.message || 'Failed to generate key. Please try again.');
      }
    });
  }

  // ── Step 2: Copy curl ──
  var copyBtn = document.getElementById('ob-copy-curl');
  if (copyBtn) {
    copyBtn.addEventListener('click', function() {
      var curlEl = document.getElementById('ob-curl-command');
      if (!curlEl) return;
      var text = curlEl.textContent;
      if (!apiKey) {
        copyBtn.textContent = 'Generate key first';
        setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
        return;
      }
      function fallback() {
        var area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); copyBtn.textContent = 'Copied!'; } catch(_) { copyBtn.textContent = 'Copy failed'; }
        document.body.removeChild(area);
        setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 2000);
        }).catch(fallback);
      } else { fallback(); }
    });
  }

  // ── Step 3: Try it now (client-side /v1/parse call) ──
  var tryBtn = document.getElementById('ob-try-now');
  var tryStatus = document.getElementById('ob-try-status');

  if (tryBtn) {
    tryBtn.addEventListener('click', async function() {
      if (!apiKey) {
        if (tryStatus) tryStatus.textContent = 'Generate a key first.';
        return;
      }
      tryBtn.disabled = true;
      if (tryStatus) tryStatus.textContent = 'Calling /v1/parse...';

      // Track attempt
      track('first_screen_attempted');

      try {
        var res = await fetch('/v1/parse', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ prompt: 'Hello, this is a safe test prompt.' })
        });

        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          throw new Error(errBody.detail || errBody.error || ('HTTP ' + res.status));
        }

        var data = await res.json();

        // Track success
        track('first_screen_succeeded');

        // Update the response display
        var respBox = document.querySelector('.ob-response-box');
        if (respBox) {
          respBox.innerHTML = '<pre>' + JSON.stringify(data, null, 2).replace(/</g, '\\u003c') + '</pre>';
        }

        if (tryStatus) tryStatus.textContent = 'Success! Verdict: ' + (data.verdict || 'unknown');
        tryBtn.textContent = 'Done!';

        // Show final panel
        var ttfc = keyGeneratedTs ? Date.now() - new Date(keyGeneratedTs).getTime() : null;
        activateStep(4);
        showFinal(ttfc);

      } catch(err) {
        tryBtn.disabled = false;
        tryBtn.textContent = 'Try it now';
        if (tryStatus) tryStatus.textContent = 'Error: ' + (err.message || 'Failed');
      }
    });
  }

  // ── Dashboard link: track dashboard_viewed ──
  var dashLink = document.getElementById('ob-go-dashboard');
  if (dashLink) {
    dashLink.addEventListener('click', function() {
      track('dashboard_viewed');
    });
  }
})();
</script>
`;

  return renderPage({
    title: "Get Started — 3-Minute Onboarding",
    description:
      "Generate an API key, copy a curl command, and make your first Parse screening call in under 3 minutes. No signup or credit card required.",
    path: "/onboarding",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
  });
}
