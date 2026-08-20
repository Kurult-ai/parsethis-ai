/**
 * The get-started state at /dashboard/org, for a key that belongs to no
 * organization.
 *
 * Before this page, that key got the raw problem+json from `requireRole` — a
 * 403 naming three roles it did not hold and no way to obtain one. A prospect
 * on 2026-08-12 hit it on the free tier, concluded the control plane was
 * paywalled, bought the $199 Team plan, opened the page again and got the
 * byte-identical 403. `POST /v1/orgs/bootstrap` had worked the whole time, in
 * 133 ms, documented only in a compliance guide nothing links to.
 *
 * Read-only, per the dashboard convention: this GET writes nothing. The form
 * posts to the API route, which is the only thing that provisions.
 */

import { renderPage } from "../lib/html-template.js";
import { issueCsrfToken, CSRF_HEADER } from "../lib/csrf.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOrgGetStartedPage(
  baseUrl: string,
  apiKeyId: string,
  apiKeyName: string,
): string {
  const csrfToken = issueCsrfToken(apiKeyId);

  const content = `
<div class="ogs">
  <header class="ogs-head">
    <p class="ogs-eyebrow">Org control panel</p>
    <h1>Govern the agents you did not build</h1>
    <p class="ogs-lede">
      This key belongs to no organization yet, so there is nothing to govern.
      Creating one takes a single request and makes you its <code>org_admin</code>.
      Included on every plan, including Free.
    </p>
  </header>

  <section class="ogs-what" aria-labelledby="ogs-what-h">
    <h2 id="ogs-what-h">What an organization gives you</h2>
    <ul class="ogs-grid">
      <li>
        <h3>One rule bans a capability under every name</h3>
        <p>
          A rule on the <code>browser</code> category covers <code>browser_use</code>,
          <code>playwright</code>, <code>computer_use</code> and every
          <code>mcp__*</code> name the same capability ships under. No list to maintain
          when a tool is renamed.
        </p>
      </li>
      <li>
        <h3>A team lead cannot write themselves an exception</h3>
        <p>
          A scoped rule may tighten the org result and never loosen it. An
          <code>allow</code> at the maximum priority still loses to an org-wide
          <code>block</code>, and a developer key cannot create a rule at all.
        </p>
      </li>
      <li>
        <h3>A risk tolerance a member key cannot raise</h3>
        <p>
          Set the org ceiling once. Members inherit it, locked fields are refused
          outright rather than silently clamped, and the panel shows which keys are
          being held down and on which field.
        </p>
      </li>
      <li>
        <h3>Every change receipted</h3>
        <p>
          Rules, modes and tolerances are versioned with a before, an after, an
          author and your own reason string — readable by an auditor and exportable
          with your evidence pack.
        </p>
      </li>
    </ul>
  </section>

  <section class="ogs-form" aria-labelledby="ogs-form-h">
    <h2 id="ogs-form-h">Create your organization</h2>

    <label class="ogs-field">
      <span class="ogs-label">Organization name</span>
      <input id="ogs-name" type="text" maxlength="200" placeholder="Acme Health Claims"
             autocomplete="organization" spellcheck="false">
    </label>

    <fieldset class="ogs-modes">
      <legend class="ogs-label">Starting tool policy</legend>

      <label class="ogs-mode">
        <input type="radio" name="ogs-mode" value="blocklist" checked>
        <span class="ogs-mode-body">
          <strong>Blocklist</strong>
          <span>Every tool is allowed until a rule blocks it. Nothing your teams run
          breaks on day one; you add bans as you decide them.</span>
        </span>
      </label>

      <label class="ogs-mode">
        <input type="radio" name="ogs-mode" value="allowlist">
        <span class="ogs-mode-body">
          <strong>Allowlist</strong>
          <span>Every tool is blocked until a rule allows it. Deny by default —
          no agent in this org may use any tool until you say so.</span>
        </span>
      </label>
    </fieldset>

    <button id="ogs-create" class="ogs-btn" type="button">Create organization</button>
    <p id="ogs-say" class="ogs-say" role="status" aria-live="polite"></p>

    <details class="ogs-api">
      <summary>Do it from the API instead</summary>
<pre><code>curl -X POST ${escapeHtml(baseUrl)}/v1/orgs/bootstrap \\
  -H "Authorization: Bearer $PARSE_API_KEY" \\
  -H "content-type: application/json" \\
  -d '{"name": "Acme Health Claims", "tool_policy_mode": "blocklist"}'</code></pre>
      <p class="ogs-note">
        Signed in as <code>${escapeHtml(apiKeyName || "your key")}</code>. The key that
        creates the organization becomes its <code>org_admin</code>.
      </p>
    </details>
  </section>
</div>

<style>
  .ogs { max-width: 900px; margin: 0 auto; padding: 8px 0 64px; }
  .ogs-head { padding: 24px 0 8px; }
  .ogs-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
    text-transform: uppercase; color: var(--text-soft); margin: 0 0 10px; }
  .ogs h1 { font-size: 2em; line-height: 1.15; letter-spacing: -.02em; margin: 0 0 12px;
    text-wrap: balance; }
  .ogs-lede { color: var(--text-dim); max-width: 62ch; margin: 0; }

  .ogs-what { margin-top: 40px; }
  .ogs-what h2, .ogs-form h2 { font-size: 1.15em; font-weight: 600; margin: 0 0 16px; }
  .ogs-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 14px;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  .ogs-grid li { background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 18px; }
  .ogs-grid h3 { font-size: .98em; font-weight: 600; margin: 0 0 6px; }
  .ogs-grid p { margin: 0; font-size: .92em; color: var(--text-dim); }

  .ogs-form { margin-top: 40px; background: var(--surface); border: 1px solid var(--border2, var(--border));
    border-radius: 12px; padding: 22px 24px; }
  .ogs-field { display: block; margin-bottom: 18px; }
  .ogs-label { display: block; font-family: var(--mono); font-size: 11px; letter-spacing: .12em;
    text-transform: uppercase; color: var(--text-soft); margin-bottom: 7px; }
  .ogs-field input { width: 100%; padding: 11px 13px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 8px; color: var(--text);
    font-size: 15px; font-family: inherit; }
  .ogs-field input:focus-visible, .ogs-mode input:focus-visible, .ogs-btn:focus-visible {
    outline: 2px solid var(--accent, #6366f1); outline-offset: 2px; }

  .ogs-modes { border: 0; margin: 0 0 20px; padding: 0; display: grid; gap: 10px; }
  .ogs-mode { display: flex; gap: 11px; align-items: flex-start; padding: 13px 15px;
    background: var(--bg); border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
  .ogs-mode-body { display: flex; flex-direction: column; gap: 3px; }
  .ogs-mode-body strong { font-size: .95em; }
  .ogs-mode-body span { font-size: .88em; color: var(--text-dim); }

  .ogs-btn { padding: 11px 22px; font-size: 15px; font-weight: 600; font-family: inherit;
    border-radius: 8px; border: 1px solid transparent; background: var(--accent, #6366f1);
    color: #fff; cursor: pointer; }
  .ogs-btn[disabled] { opacity: .55; cursor: default; }
  .ogs-say { min-height: 1.4em; margin: 12px 0 0; font-size: .9em; color: var(--text-dim); }

  .ogs-api { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px; }
  .ogs-api summary { cursor: pointer; font-size: .9em; color: var(--text-dim); }
  .ogs-api pre { margin: 12px 0 0; padding: 13px 15px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 8px; overflow-x: auto;
    font-family: var(--mono); font-size: 12.5px; line-height: 1.6; }
  .ogs-note { font-size: .86em; color: var(--text-soft); margin: 10px 0 0; }
</style>

<script>
(function () {
  var meta = document.querySelector('meta[name="parse-csrf"]');
  var token = meta ? meta.content : '';
  var headerMeta = document.querySelector('meta[name="parse-csrf-header"]');
  var header = headerMeta ? headerMeta.content : 'x-parse-csrf';

  var btn = document.getElementById('ogs-create');
  var say = document.getElementById('ogs-say');
  var nameEl = document.getElementById('ogs-name');

  function tell(msg) { say.textContent = msg; }

  btn.addEventListener('click', function () {
    var name = (nameEl.value || '').trim();
    if (!name) { tell('Give the organization a name first.'); nameEl.focus(); return; }

    var mode = 'blocklist';
    var checked = document.querySelector('input[name="ogs-mode"]:checked');
    if (checked) mode = checked.value;

    btn.disabled = true;
    tell('Creating…');

    var headers = { 'Content-Type': 'application/json' };
    headers[header] = token;

    fetch('/v1/orgs/bootstrap', {
      method: 'POST',
      headers: headers,
      credentials: 'same-origin',
      body: JSON.stringify({ name: name, tool_policy_mode: mode })
    }).then(function (res) {
      return res.json().then(function (body) { return { ok: res.ok, body: body }; });
    }).then(function (r) {
      if (!r.ok) {
        btn.disabled = false;
        tell(r.body.detail || r.body.error || 'Could not create the organization.');
        return;
      }
      tell('Created. Opening your control panel…');
      location.href = '/dashboard/org';
    }).catch(function (err) {
      btn.disabled = false;
      tell('Could not reach Parse: ' + err.message);
    });
  });
})();
</script>
`;

  return renderPage({
    title: "Create your organization",
    description:
      "Create a Parse organization to govern which tools your agents may use, set a risk tolerance your members cannot loosen, and receipt every change.",
    path: "/dashboard/org",
    content,
    baseUrl,
    headExtra:
      `<meta name="robots" content="noindex, nofollow">\n` +
      `  <meta name="parse-csrf" content="${escapeHtml(csrfToken)}">\n` +
      `  <meta name="parse-csrf-header" content="${escapeHtml(CSRF_HEADER)}">`,
  });
}
