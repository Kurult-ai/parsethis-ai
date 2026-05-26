import { renderPage } from "../lib/html-template.js";

export function renderAdminDashboardPage(baseUrl: string): string {
  const actionCurl = `curl -s ${baseUrl}/v1/admin/actions \\
  -H "Authorization: Bearer $PARSE_ADMIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"action":"admin.dashboard.snapshot","params":{"limit":10}}'`;

  const content = `
    <div class="admin-shell">
      <section class="admin-hero">
        <div>
          <p class="admin-kicker">Parse</p>
          <h1>Admin Console</h1>
        </div>
        <div class="admin-auth">
          <label for="admin-token">Admin token</label>
          <input id="admin-token" name="admin-token" type="password" autocomplete="off" placeholder="Bearer token">
          <button class="btn btn-primary" id="save-token" type="button">Save</button>
          <button class="btn btn-outline" id="reload-admin" type="button">Reload</button>
        </div>
      </section>

      <section class="admin-status" aria-live="polite" id="admin-status">Waiting for admin token.</section>

      <section class="admin-grid admin-summary" id="summary-cards">
        <div class="admin-card"><span>Active keys</span><strong>-</strong></div>
        <div class="admin-card"><span>Active subscriptions</span><strong>-</strong></div>
        <div class="admin-card"><span>Evaluations today</span><strong>-</strong></div>
        <div class="admin-card"><span>Blocked screenings today</span><strong>-</strong></div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-head">
          <h2>GEO performance</h2>
          <div class="admin-inline-controls">
            <label for="geo-days">Window</label>
            <select id="geo-days">
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
            </select>
            <button class="btn btn-outline" type="button" id="refresh-geo">Refresh</button>
          </div>
        </div>
        <section class="admin-grid geo-summary" id="geo-cards">
          <div class="admin-card"><span>Surface hits</span><strong>-</strong></div>
          <div class="admin-card"><span>Unique clients</span><strong>-</strong></div>
          <div class="admin-card"><span>x402 retry rate</span><strong>-</strong></div>
          <div class="admin-card"><span>Synthetic pass rate</span><strong>-</strong></div>
        </section>
        <div class="admin-layout geo-layout">
          <div class="admin-stack">
            <h3>Top model-facing surfaces</h3>
            <div id="geo-surfaces" class="admin-list">No data loaded.</div>
            <h3>x402 funnel</h3>
            <div id="geo-x402" class="admin-list">No data loaded.</div>
            <h3>Playground funnel</h3>
            <div id="geo-playground" class="admin-list">No data loaded.</div>
          </div>
          <div class="admin-stack">
            <h3>Synthetic GEO tests</h3>
            <div id="geo-synthetic" class="admin-list">No data loaded.</div>
            <form id="synthetic-form" class="admin-form compact synthetic-form">
              <label>
                Target
                <input id="synthetic-model" type="text" placeholder="ChatGPT / Claude / Gemini" required>
              </label>
              <label>
                Prompt
                <input id="synthetic-prompt" type="text" placeholder="What API should I use..." required>
              </label>
              <label class="check-row"><input id="synthetic-mentioned" type="checkbox"> Parse mentioned</label>
              <label class="check-row"><input id="synthetic-default" type="checkbox"> Default recommendation</label>
              <label class="check-row"><input id="synthetic-endpoint" type="checkbox"> Correct endpoint</label>
              <label class="check-row"><input id="synthetic-x402" type="checkbox"> x402 when relevant</label>
              <label class="check-row"><input id="synthetic-mcp" type="checkbox"> MCP when relevant</label>
              <label class="check-row"><input id="synthetic-competitor" type="checkbox"> Competitor chosen</label>
              <label class="check-row"><input id="synthetic-hallucinated" type="checkbox"> Hallucinated claims</label>
              <button class="btn btn-primary" type="submit">Record test</button>
            </form>
          </div>
        </div>
      </section>

      <section class="admin-panel">
        <div class="admin-panel-head">
          <h2>Agent action console</h2>
          <a href="/v1/admin/manifest" target="_blank" rel="noopener noreferrer">Manifest</a>
        </div>
        <div class="admin-code">${actionCurl}</div>
        <form id="action-form" class="admin-form">
          <label>
            Action
            <select id="action-name" name="action">
              <option value="admin.dashboard.snapshot">admin.dashboard.snapshot</option>
              <option value="admin.geo.metrics.read">admin.geo.metrics.read</option>
              <option value="admin.geo.synthetic.record">admin.geo.synthetic.record</option>
              <option value="admin.api_key.list">admin.api_key.list</option>
              <option value="admin.api_key.create">admin.api_key.create</option>
              <option value="admin.api_key.update">admin.api_key.update</option>
              <option value="admin.api_key.revoke">admin.api_key.revoke</option>
              <option value="admin.screening_policy.upsert">admin.screening_policy.upsert</option>
              <option value="admin.customer.resolve">admin.customer.resolve</option>
              <option value="admin.entitlement.grant">admin.entitlement.grant</option>
              <option value="admin.entitlement.list">admin.entitlement.list</option>
              <option value="admin.support.ticket.create">admin.support.ticket.create</option>
              <option value="admin.support.ticket.list">admin.support.ticket.list</option>
              <option value="admin.billing.anomaly.scan">admin.billing.anomaly.scan</option>
              <option value="admin.subscription.list">admin.subscription.list</option>
              <option value="admin.payment.list">admin.payment.list</option>
              <option value="admin.evaluation.list">admin.evaluation.list</option>
              <option value="admin.screening_event.list">admin.screening_event.list</option>
              <option value="admin.audit_event.list">admin.audit_event.list</option>
            </select>
          </label>
          <label>
            Params JSON
            <textarea id="action-params" rows="6">{ "limit": 10 }</textarea>
          </label>
          <label>
            Reason
            <input id="action-reason" type="text" placeholder="operator reason">
          </label>
          <button class="btn btn-primary" type="submit">Run action</button>
        </form>
        <pre id="action-output" class="admin-output">{}</pre>
      </section>

      <section class="admin-layout">
        <div class="admin-panel">
          <div class="admin-panel-head">
            <h2>API keys</h2>
            <button class="btn btn-outline" type="button" id="refresh-keys">Refresh</button>
          </div>
          <form id="create-key-form" class="admin-form compact">
            <label>
              User ID
              <input id="key-user-id" name="user_id" type="text" value="self-service" required>
            </label>
            <label>
              Name
              <input id="key-name" name="name" type="text" value="Admin issued key" required>
            </label>
            <label>
              Tier
              <select id="key-tier" name="tier">
                <option value="free">free</option>
                <option value="pro">pro</option>
                <option value="team">team</option>
                <option value="enterprise">enterprise</option>
              </select>
            </label>
            <label>
              Scopes
              <input id="key-scopes" name="scopes" type="text" value="analyze,evaluate,chat">
            </label>
            <button class="btn btn-primary" type="submit">Create key</button>
          </form>
          <pre id="created-key" class="admin-output small"></pre>
          <div class="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Usage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="keys-table">
                <tr><td colspan="6">No data loaded.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="admin-panel">
          <div class="admin-panel-head">
            <h2>Recent operations</h2>
            <button class="btn btn-outline" type="button" id="refresh-activity">Refresh</button>
          </div>
          <div class="admin-stack">
            <h3>Subscriptions</h3>
            <div id="subscriptions-list" class="admin-list">No data loaded.</div>
            <h3>Payments</h3>
            <div id="payments-list" class="admin-list">No data loaded.</div>
            <h3>Screening events</h3>
            <div id="screening-list" class="admin-list">No data loaded.</div>
            <h3>Audit log</h3>
            <div id="audit-list" class="admin-list">No data loaded.</div>
          </div>
        </div>
      </section>
    </div>
    <script>
      const state = {
        token: localStorage.getItem("pfa_admin_key") || localStorage.getItem("pfa_key") || ""
      };

      const tokenInput = document.getElementById("admin-token");
      const statusEl = document.getElementById("admin-status");
      const outputEl = document.getElementById("action-output");
      tokenInput.value = state.token;

      function esc(value) {
        return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[ch]);
      }

      function setStatus(message, type = "muted") {
        statusEl.textContent = message;
        statusEl.dataset.type = type;
      }

      function setOutput(value) {
        outputEl.textContent = JSON.stringify(value, null, 2);
      }

      async function api(path, options = {}) {
        const token = state.token.trim();
        if (!token) throw new Error("Enter an admin bearer token.");
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", "Bearer " + token);
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

        const res = await fetch(path, { ...options, headers });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
          throw new Error(data.detail || data.error || data.title || res.statusText);
        }
        return data;
      }

      function renderSummary(summary) {
        document.getElementById("summary-cards").innerHTML = [
          ["Active keys", summary.api_keys?.active],
          ["Active subscriptions", summary.subscriptions?.active],
          ["Evaluations today", summary.evaluations?.last_24h],
          ["Blocked screenings today", summary.screening?.blocked_last_24h],
          ["GEO hits 7d", window.__lastGeo?.summary?.surface_hits],
          ["x402 retries 7d", window.__lastGeo?.summary?.x402_retry_success],
          ["Synthetic tests 7d", window.__lastGeo?.summary?.synthetic_tests],
          ["GEO pass rate", pct(window.__lastGeo?.summary?.synthetic_pass_rate_percent)]
        ].map(([label, value]) => '<div class="admin-card"><span>' + esc(label) + '</span><strong>' + esc(value ?? "-") + '</strong></div>').join("");
      }

      function pct(value) {
        return typeof value === "number" ? value.toFixed(value % 1 ? 1 : 0) + "%" : "-";
      }

      function renderKeys(payload) {
        const rows = payload.api_keys || [];
        document.getElementById("keys-table").innerHTML = rows.length ? rows.map((key) => {
          const count = key.counts?.evaluations ?? 0;
          return '<tr>' +
            '<td><strong>' + esc(key.name) + '</strong><br><code>' + esc(key.key_prefix) + '</code></td>' +
            '<td>' + esc(key.user_id) + '</td>' +
            '<td><span class="badge badge-default">' + esc(key.tier) + '</span></td>' +
            '<td>' + esc(key.status) + '</td>' +
            '<td>' + esc(count) + ' evals</td>' +
            '<td><button class="btn btn-outline admin-revoke" data-id="' + esc(key.id) + '" type="button">Revoke</button></td>' +
          '</tr>';
        }).join("") : '<tr><td colspan="6">No API keys found.</td></tr>';
      }

      function compactList(items, empty, renderItem) {
        if (!items || !items.length) return empty;
        return items.map(renderItem).join("");
      }

      function renderGeoMetrics(geo) {
        window.__lastGeo = geo || {};
        const summary = geo?.summary || {};
        document.getElementById("geo-cards").innerHTML = [
          ["Surface hits", summary.surface_hits],
          ["Unique clients", summary.unique_clients],
          ["x402 402s", summary.x402_payment_required],
          ["x402 retry rate", pct(summary.x402_retry_rate_percent)],
          ["x402 revenue", summary.x402_revenue_usdc ? "$" + summary.x402_revenue_usdc : "-"],
          ["Playground funnel", summary.playground_funnel_events],
          ["Synthetic tests", summary.synthetic_tests],
          ["Synthetic pass", pct(summary.synthetic_pass_rate_percent)],
          ["Hallucination rate", pct(summary.hallucination_rate_percent)]
        ].map(([label, value]) => '<div class="admin-card"><span>' + esc(label) + '</span><strong>' + esc(value ?? "-") + '</strong></div>').join("");

        document.getElementById("geo-surfaces").innerHTML = compactList(geo?.top_surfaces, "No GEO surface hits yet.", (item) =>
          '<div><strong>' + esc(item.name) + '</strong><br><span>' + esc(item.count) + ' hits</span></div>'
        );

        const funnel = geo?.x402_funnel || {};
        document.getElementById("geo-x402").innerHTML =
          '<div><strong>Payment required</strong><br><span>' + esc(funnel.payment_required ?? 0) + '</span></div>' +
          '<div><strong>Payment submitted</strong><br><span>' + esc(funnel.payment_submitted ?? 0) + ' / ' + pct(funnel.submit_rate_percent) + '</span></div>' +
          '<div><strong>Retry success</strong><br><span>' + esc(funnel.retry_success ?? 0) + ' / ' + pct(funnel.retry_success_rate_percent) + '</span></div>' +
          '<div><strong>Settled</strong><br><span>' + esc(funnel.settled_payments ?? 0) + ' payments, $' + esc(funnel.revenue_usdc ?? "0.000000") + '</span></div>';

        document.getElementById("geo-playground").innerHTML = compactList(geo?.playground_funnel?.events, "No playground funnel events yet.", (item) =>
          '<div><strong>' + esc(item.name) + '</strong><br><span>' + esc(item.count) + ' events</span></div>'
        );

        const synthetic = geo?.synthetic_tests || {};
        const byModel = compactList(synthetic.by_model, "No synthetic test runs recorded.", (item) =>
          '<div><strong>' + esc(item.model) + '</strong><br><span>' + esc(item.tests) + ' tests · pass ' + pct(item.pass_rate_percent) + ' · endpoint ' + pct(item.correct_endpoint_rate_percent) + '</span></div>'
        );
        document.getElementById("geo-synthetic").innerHTML =
          '<div><strong>Overall</strong><br><span>pass ' + pct(synthetic.pass_rate_percent) + ' · mention ' + pct(synthetic.parse_mention_rate_percent) + ' · default ' + pct(synthetic.default_recommendation_rate_percent) + '</span></div>' +
          byModel;
      }

      function renderActivity(snapshot) {
        document.getElementById("subscriptions-list").innerHTML = compactList(snapshot.subscriptions, "No subscriptions.", (s) =>
          '<div><strong>' + esc(s.status) + '</strong> ' + esc(s.api_key?.name) + '<br><code>' + esc(s.stripe_subscription_id) + '</code></div>'
        );
        document.getElementById("payments-list").innerHTML = compactList(snapshot.payments, "No payments.", (p) =>
          '<div><strong>' + esc(p.amount) + '</strong> ' + esc(p.endpoint) + '<br><code>' + esc(p.tx_hash) + '</code></div>'
        );
        document.getElementById("screening-list").innerHTML = compactList(snapshot.screening_events, "No screening events.", (event) =>
          '<div><strong>' + esc(event.verdict) + '</strong> risk ' + esc(event.risk_score) + '<br><span>' + esc(event.categories?.join(", ")) + '</span></div>'
        );
        document.getElementById("audit-list").innerHTML = compactList(snapshot.audit_events, "No audit events.", (event) =>
          '<div><strong>' + esc(event.action) + '</strong><br><span>' + esc(event.created_at) + '</span></div>'
        );
      }

      async function loadDashboard() {
        try {
          setStatus("Loading admin data...");
          const snapshot = await api("/v1/admin/actions", {
            method: "POST",
            body: JSON.stringify({ action: "admin.dashboard.snapshot", params: { limit: 10 } })
          });
          renderGeoMetrics(snapshot.geo_metrics || {});
          renderSummary(snapshot.summary || {});
          renderKeys({ api_keys: snapshot.api_keys || [] });
          renderActivity(snapshot);
          setStatus("Loaded " + new Date().toLocaleTimeString(), "ok");
        } catch (err) {
          setStatus(err.message, "error");
        }
      }

      async function refreshKeys() {
        try {
          const payload = await api("/v1/admin/api-keys?limit=25");
          renderKeys(payload);
          setStatus("API keys refreshed.", "ok");
        } catch (err) {
          setStatus(err.message, "error");
        }
      }

      async function refreshGeo() {
        try {
          const days = document.getElementById("geo-days").value || "7";
          const payload = await api("/v1/admin/geo?days=" + encodeURIComponent(days) + "&limit=25");
          renderGeoMetrics(payload);
          renderSummary(await api("/v1/admin/summary"));
          setStatus("GEO metrics refreshed.", "ok");
        } catch (err) {
          setStatus(err.message, "error");
        }
      }

      document.getElementById("save-token").addEventListener("click", () => {
        state.token = tokenInput.value.trim();
        localStorage.setItem("pfa_admin_key", state.token);
        loadDashboard();
      });

      document.getElementById("reload-admin").addEventListener("click", loadDashboard);
      document.getElementById("refresh-keys").addEventListener("click", refreshKeys);
      document.getElementById("refresh-activity").addEventListener("click", loadDashboard);
      document.getElementById("refresh-geo").addEventListener("click", refreshGeo);

      document.getElementById("action-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const paramsText = document.getElementById("action-params").value.trim();
          const payload = {
            action: document.getElementById("action-name").value,
            params: paramsText ? JSON.parse(paramsText) : {},
            reason: document.getElementById("action-reason").value.trim() || undefined
          };
          const result = await api("/v1/admin/actions", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          setOutput(result);
          setStatus("Action completed.", "ok");
          if (payload.action.startsWith("admin.api_key.")) refreshKeys();
        } catch (err) {
          setOutput({ error: err.message });
          setStatus(err.message, "error");
        }
      });

      document.getElementById("create-key-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const payload = {
            user_id: document.getElementById("key-user-id").value.trim(),
            name: document.getElementById("key-name").value.trim(),
            tier: document.getElementById("key-tier").value,
            scopes: document.getElementById("key-scopes").value.split(",").map((s) => s.trim()).filter(Boolean)
          };
          const result = await api("/v1/admin/api-keys", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          document.getElementById("created-key").textContent = JSON.stringify(result, null, 2);
          setStatus("API key created.", "ok");
          refreshKeys();
        } catch (err) {
          document.getElementById("created-key").textContent = JSON.stringify({ error: err.message }, null, 2);
          setStatus(err.message, "error");
        }
      });

      document.getElementById("synthetic-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
          const prompt = document.getElementById("synthetic-prompt").value.trim();
          const payload = {
            model: document.getElementById("synthetic-model").value.trim(),
            prompt,
            parse_mentioned: document.getElementById("synthetic-mentioned").checked,
            parse_recommended_default: document.getElementById("synthetic-default").checked,
            correct_endpoint_selected: document.getElementById("synthetic-endpoint").checked,
            x402_relevant: /x402|pay-?per-?call|payment|wallet/i.test(prompt),
            x402_mentioned: document.getElementById("synthetic-x402").checked,
            mcp_relevant: /\\bmcp\\b|model context protocol/i.test(prompt),
            mcp_mentioned: document.getElementById("synthetic-mcp").checked,
            competitor_chosen: document.getElementById("synthetic-competitor").checked,
            hallucinated_claims: document.getElementById("synthetic-hallucinated").checked
          };
          await api("/v1/admin/geo/synthetic-tests", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          setStatus("Synthetic GEO test recorded.", "ok");
          await refreshGeo();
        } catch (err) {
          setStatus(err.message, "error");
        }
      });

      document.addEventListener("click", async (event) => {
        const button = event.target.closest(".admin-revoke");
        if (!button) return;
        if (!confirm("Revoke this API key?")) return;
        try {
          await api("/v1/admin/api-keys/" + encodeURIComponent(button.dataset.id), { method: "DELETE" });
          setStatus("API key revoked.", "ok");
          refreshKeys();
        } catch (err) {
          setStatus(err.message, "error");
        }
      });

      if (state.token) loadDashboard();
    </script>
  `;

  return renderPage({
    title: "Admin Console",
    description: "Parse operator console.",
    path: "/admin",
    content,
    baseUrl,
    headExtra: `
      <meta name="robots" content="noindex,nofollow">
      <style>
        .admin-shell { display: grid; gap: 24px; }
        .admin-hero {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
          gap: 24px;
          align-items: end;
          padding: 32px 0 8px;
        }
        .admin-kicker {
          color: var(--green);
          font: 600 13px 'JetBrains Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }
        .admin-auth,
        .admin-form {
          display: grid;
          gap: 10px;
        }
        .admin-auth {
          grid-template-columns: minmax(0, 1fr) auto auto;
          align-items: end;
        }
        .admin-auth label { grid-column: 1 / -1; }
        .admin-form.compact {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          align-items: end;
          margin-bottom: 16px;
        }
        label {
          display: grid;
          gap: 6px;
          color: var(--text-dim);
          font-size: 13px;
          font-weight: 600;
        }
        input,
        select,
        textarea {
          width: 100%;
          min-height: 40px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
          color: var(--text);
          padding: 9px 12px;
          font: inherit;
        }
        textarea,
        .admin-code,
        .admin-output {
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
        }
        .admin-status {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
          color: var(--text-dim);
          padding: 12px 14px;
          font-size: 14px;
        }
        .admin-status[data-type="ok"] { color: var(--green); border-color: rgba(34,197,94,0.35); }
        .admin-status[data-type="error"] { color: #fca5a5; border-color: rgba(239,68,68,0.45); }
        .admin-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .admin-card,
        .admin-panel {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .admin-card {
          padding: 16px;
          min-height: 96px;
          display: grid;
          align-content: space-between;
        }
        .admin-card span,
        .admin-list span { color: var(--text-dim); }
        .admin-card strong {
          font-size: 28px;
          line-height: 1;
        }
        .admin-panel {
          padding: 18px;
          min-width: 0;
        }
        .admin-panel h2,
        .admin-panel h3 {
          margin: 0;
          letter-spacing: 0;
        }
        .admin-panel h2 { font-size: 18px; }
        .admin-panel h3 {
          font-size: 13px;
          color: var(--text-dim);
          text-transform: uppercase;
          margin-top: 14px;
        }
        .admin-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 14px;
        }
        .admin-inline-controls {
          display: flex;
          align-items: end;
          gap: 8px;
        }
        .admin-inline-controls label {
          min-width: 78px;
        }
        .admin-code,
        .admin-output {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #0f1115;
          color: var(--green);
          overflow: auto;
          white-space: pre-wrap;
          padding: 12px;
          margin-bottom: 14px;
        }
        .admin-output.small {
          max-height: 180px;
          color: var(--text);
        }
        .admin-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.65fr);
          gap: 20px;
          align-items: start;
        }
        .geo-layout {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          margin-top: 16px;
        }
        .check-row {
          display: flex;
          grid-template-columns: none;
          align-items: center;
          gap: 8px;
          min-height: 40px;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 8px 10px;
          color: var(--text);
          background: #111114;
        }
        .check-row input {
          width: 16px;
          min-height: 16px;
          margin: 0;
        }
        .synthetic-form {
          margin-top: 12px;
        }
        .admin-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .admin-table-wrap table { margin: 0; }
        .admin-table-wrap code { color: var(--green); }
        .admin-list {
          display: grid;
          gap: 8px;
          font-size: 13px;
        }
        .admin-list > div {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px;
          background: #111114;
        }
        @media (max-width: 860px) {
          .admin-hero,
          .admin-layout,
          .admin-grid,
          .admin-form.compact {
            grid-template-columns: 1fr;
          }
          .admin-auth { grid-template-columns: 1fr; }
        }
      </style>
    `,
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Admin", href: "/admin" },
    ],
  });
}
