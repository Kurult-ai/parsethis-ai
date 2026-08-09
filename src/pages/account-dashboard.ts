import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";
import type { PublicUser } from "../lib/user-auth.js";

export async function renderAccountDashboard(
  baseUrl: string,
  user: PublicUser
): Promise<string> {
  // Fetch user's API keys
  let apiKeys: Array<{
    id: string;
    name: string;
    keyPrefix: string;
    tier: string;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
  }> = [];
  try {
    apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        tier: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  } catch {
    // DB unavailable — render empty section
  }

  // Fetch subscription
  let subscription: {
    status: string;
    currentPeriodEnd: Date;
  } | null = null;
  try {
    // Find the subscription for any of the user's API keys
    const userKeyIds = apiKeys.map((k) => k.id);
    if (userKeyIds.length > 0) {
      const sub = await prisma.subscription.findFirst({
        where: { apiKeyId: { in: userKeyIds } },
        select: {
          status: true,
          currentPeriodEnd: true,
        },
      });
      subscription = sub;
    }
  } catch {
    // DB unavailable
  }

  const formatDate = (d: Date | null): string => {
    if (!d) return "—";
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // API Keys table rows
  const apiKeyRows = apiKeys.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:32px;">No API keys yet. Create one to get started.</td></tr>`
    : apiKeys
        .map((key) => {
          const isActive = !key.revokedAt;
          const statusBadge = isActive
            ? `<span class="badge badge-green">Active</span>`
            : `<span class="badge badge-destructive">Revoked</span>`;
          return `
          <tr>
            <td style="font-weight:600;">${escapeHtml(key.name)}</td>
            <td><code style="font-size:12px;">${escapeHtml(key.keyPrefix)}…</code></td>
            <td><span class="badge badge-default">${escapeHtml(key.tier)}</span></td>
            <td>${formatDate(key.lastUsedAt)}</td>
            <td>${statusBadge}</td>
            <td>
              ${
                isActive
                  ? `<button class="btn btn-outline" style="font-size:12px;padding:5px 12px;" onclick="revokeKey('${key.id}','${escapeHtml(key.name)}')">Revoke</button>`
                  : `<span style="color:var(--text-soft);font-size:12px;">—</span>`
              }
            </td>
          </tr>`;
        })
        .join("");

  // Subscription section — derive tier from the first active API key
  const tier = apiKeys.find((k) => !k.revokedAt)?.tier || apiKeys[0]?.tier || "free";
  const subStatus = subscription?.status || "—";
  const nextBilling = subscription
    ? formatDate(subscription.currentPeriodEnd)
    : "—";

  const subscriptionHtml = `
    <div class="card-grid" style="margin-bottom:24px;">
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Current Plan</div>
        <div style="font-size:22px;font-weight:700;text-transform:capitalize;">${escapeHtml(tier)}</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Status</div>
        <div style="font-size:22px;font-weight:700;text-transform:capitalize;">${escapeHtml(subStatus)}</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Next Billing Date</div>
        <div style="font-size:22px;font-weight:700;">${nextBilling}</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      ${
        subscription && user.stripeCustomerId
          ? `<button class="btn btn-primary" onclick="manageSubscription()">Manage Subscription</button>`
          : `<a class="btn btn-primary" href="/pricing">Upgrade Plan</a>`
      }
      <a class="btn btn-outline" href="/pricing">View Plans</a>
    </div>
  `;

  const content = `
    <div class="container" style="padding-top:48px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;flex-wrap:wrap;gap:16px;">
        <div>
          <h1 style="margin-bottom:4px;">Account</h1>
          <p class="answer-capsule" style="margin-bottom:0;">${escapeHtml(user.email)}${user.name ? ` · ${escapeHtml(user.name)}` : ""}</p>
        </div>
        <div style="display:flex;gap:8px;">
          <a class="btn btn-outline" href="/dashboard/agents">Agents</a>
          <a class="btn btn-outline" href="/dashboard/compliance">Compliance</a>
          <a class="btn btn-outline" href="/dashboard/billing">Billing</a>
          <button class="btn btn-ghost" onclick="logout()">Logout</button>
        </div>
      </div>

      <div class="section-chunk">
        <h2 style="margin-top:0;">Subscription</h2>
        ${subscriptionHtml}
      </div>

      <div class="section-chunk">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h2 style="margin-top:0;margin-bottom:0;">API Keys</h2>
          <button class="btn btn-primary" onclick="showCreateKeyModal()">Create New Key</button>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th>Tier</th>
                <th>Last Used</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${apiKeyRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Create Key Modal -->
    <div id="create-key-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;justify-content:center;align-items:center;">
      <div class="card" style="max-width:480px;width:90%;">
        <h3 style="margin-top:0;">Create New API Key</h3>
        <p style="color:var(--text-dim);font-size:14px;margin-bottom:16px;">Name your key so you can identify it later.</p>
        <input type="text" id="new-key-name" placeholder="e.g. Production Agent" style="width:100%;padding:10px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;margin-bottom:16px;box-sizing:border-box;" autofocus>
        <div id="new-key-result" style="display:none;margin-bottom:16px;"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="closeCreateKeyModal()">Cancel</button>
          <button class="btn btn-primary" id="create-key-btn" onclick="createKey()">Create Key</button>
        </div>
      </div>
    </div>

    <!-- Revoke Key Modal -->
    <div id="revoke-key-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:200;justify-content:center;align-items:center;">
      <div class="card" style="max-width:420px;width:90%;">
        <h3 style="margin-top:0;">Revoke API Key</h3>
        <p style="color:var(--text-dim);font-size:14px;margin-bottom:16px;">Are you sure you want to revoke <strong id="revoke-key-name"></strong>? This cannot be undone.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="btn btn-ghost" onclick="closeRevokeModal()">Cancel</button>
          <button class="btn btn-primary" style="background:var(--destructive);" id="confirm-revoke-btn">Revoke</button>
        </div>
      </div>
    </div>

    <script>
      let revokeKeyId = null;

      function logout() {
        fetch('/auth/logout', { method: 'POST' })
          .then(() => { window.location.href = '/'; });
      }

      function showCreateKeyModal() {
        document.getElementById('create-key-modal').style.display = 'flex';
        document.getElementById('new-key-name').focus();
      }

      function closeCreateKeyModal() {
        document.getElementById('create-key-modal').style.display = 'none';
        document.getElementById('new-key-name').value = '';
        document.getElementById('new-key-result').style.display = 'none';
      }

      async function createKey() {
        const name = document.getElementById('new-key-name').value.trim() || 'Account Key';
        const btn = document.getElementById('create-key-btn');
        btn.disabled = true;
        btn.textContent = 'Creating...';
        try {
          const res = await fetch('/v1/keys/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          const data = await res.json();
          if (res.ok && data.key) {
            const result = document.getElementById('new-key-result');
            result.style.display = 'block';
            result.innerHTML = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:12px;"><div style="font-size:13px;color:var(--text-dim);margin-bottom:6px;">Your new API key (copy now — shown only once):</div><code style="font-size:13px;word-break:break-all;">' + data.key + '</code></div>';
            document.getElementById('create-key-btn').textContent = 'Close';
            document.getElementById('create-key-btn').onclick = function() { window.location.reload(); };
          } else {
            alert(data.error || 'Failed to create key');
            btn.disabled = false;
            btn.textContent = 'Create Key';
          }
        } catch (err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Create Key';
        }
      }

      function revokeKey(id, name) {
        revokeKeyId = id;
        document.getElementById('revoke-key-name').textContent = name;
        document.getElementById('revoke-key-modal').style.display = 'flex';
      }

      function closeRevokeModal() {
        document.getElementById('revoke-key-modal').style.display = 'none';
        revokeKeyId = null;
      }

      document.getElementById('confirm-revoke-btn').onclick = async function() {
        if (!revokeKeyId) return;
        try {
          const res = await fetch('/v1/keys/' + revokeKeyId, { method: 'DELETE' });
          if (res.ok) {
            window.location.reload();
          } else {
            alert('Failed to revoke key');
            closeRevokeModal();
          }
        } catch (err) {
          alert('Error: ' + err.message);
          closeRevokeModal();
        }
      };

      async function manageSubscription() {
        try {
          const res = await fetch('/v1/billing/portal', { method: 'POST' });
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            alert(data.error || 'Failed to open billing portal');
          }
        } catch (err) {
          alert('Error: ' + err.message);
        }
      }

      // Close modals on background click
      document.getElementById('create-key-modal').addEventListener('click', function(e) {
        if (e.target === this) closeCreateKeyModal();
      });
      document.getElementById('revoke-key-modal').addEventListener('click', function(e) {
        if (e.target === this) closeRevokeModal();
      });
    </script>
  `;

  return renderPage({
    title: "Account",
    description: "Manage your Parse account, API keys, and subscription.",
    path: "/account",
    content,
    baseUrl,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
