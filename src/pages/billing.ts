import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { prisma } from "../db.js";
import { readDeepUsage } from "../lib/model-budget.js";
import { getUsage } from "../lib/usage-tracker.js";
import { TIER_CONFIG, isStripeEnabled, type PaidTier } from "../stripe.js";

export async function renderBillingDashboardPage(baseUrl: string, apiKeyId: string): Promise<string> {
  // Query subscription and recent billing usage from DB
  const subscription = await prisma.subscription.findUnique({
    where: { apiKeyId },
  });

  const apiKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId },
    select: { tier: true, name: true },
  });

  const tier = apiKey?.tier || "free";
  const currentUsage = await getUsage(apiKeyId);
  const config = tier in TIER_CONFIG ? TIER_CONFIG[tier as PaidTier] : null;
  const includedRequests = config?.includedRequests ?? 0;
  const overageCount = config ? Math.max(0, currentUsage - includedRequests) : 0;
  // The deep meter, not the billable one, is what a key actually spends day
  // to day (free: 50/day). Same posture as /v1/billing/usage: zeros on
  // metering failure, never an error tile.
  const deep = await readDeepUsage(apiKeyId, tier);
  const deepUsed = deep.used, deepLimit = deep.limit, deepWindow = deep.window;

  // Build KPI cards
  const kpiCards = `
    <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Current Plan</div>
        <div style="font-size:24px;font-weight:700;">${tier.charAt(0).toUpperCase() + tier.slice(1)}</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Screenings this month</div>
        <div style="font-size:24px;font-weight:700;">${currentUsage.toLocaleString()} <span style="font-size:14px;color:var(--text-dim);">/ ${includedRequests > 0 ? includedRequests.toLocaleString() : "\u221E"}</span></div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">This calendar month. <code>GET /v1/activity</code> counts every screening for this key since it was created, so the two figures differ by design.</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Beyond included</div>
        <div style="font-size:24px;font-weight:700;">${overageCount.toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Served, not billed. Included volume is not a cap.</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Deep screenings (${deepWindow})</div>
        <div style="font-size:24px;font-weight:700;">${deepUsed.toLocaleString()} <span style="font-size:14px;color:var(--text-dim);">/ ${deepLimit.toLocaleString()}</span></div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Model-backed screenings (the semantic layer). Spent budget <strong>degrades, never refuses</strong> — instant screening keeps running.</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Next Invoice</div>
        <div style="font-size:24px;font-weight:700;">${subscription ? new Date(subscription.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "\u2014"}</div>
      </div>
    </div>
  `;

  // Subscription details
  let subscriptionHtml = "";
  if (subscription) {
    subscriptionHtml = `
      <div class="section-chunk">
        <h2 style="margin-top:0;">Subscription</h2>
        <div class="card" style="padding:20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div>
              <div style="font-weight:600;">${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan</div>
              <div style="font-size:13px;color:var(--text-dim);">
                Period: ${new Date(subscription.currentPeriodStart).toLocaleDateString()} \u2014 ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}
                ${subscription.cancelAtPeriodEnd ? ' \u00B7 <span class="badge badge-destructive">Cancels at period end</span>' : ' \u00B7 <span class="badge badge-green">Active</span>'}
              </div>
            </div>
            <a href="/v1/billing/portal" class="btn btn-outline" onclick="event.preventDefault();var s=document.getElementById('billing-portal-status');if(s)s.textContent='Opening billing portal…';fetch('/v1/billing/portal',{method:'POST',headers:{'Authorization':'Bearer '+(localStorage.getItem('pfa_key')||''),'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d.url){window.location=d.url}else if(s){s.textContent=d.detail||d.error||'Could not open the billing portal.'}}).catch(function(){if(s)s.textContent='Could not reach the billing portal. Email support and we will cancel it for you.'})">Manage Subscription</a>
            <div id="billing-portal-status" role="status" aria-live="polite" style="font-size:13px;color:var(--text-dim);margin-top:8px;"></div>
          </div>
        </div>
      </div>
    `;
  } else if (tier === "free") {
    subscriptionHtml = `
      <div class="section-chunk">
        <h2 style="margin-top:0;">Upgrade</h2>
        <p class="answer-capsule">You're on the Free plan. Upgrade to Pro or Team for higher rate limits and included requests.</p>
        <div style="display:flex;gap:12px;">
          <a href="/pricing" class="btn btn-primary">View Plans</a>
        </div>
      </div>
    `;
  }

  const content = `
    <div class="section-chunk animate-in">
      <h1>Billing Dashboard</h1>
      <p class="answer-capsule">API Key: ${apiKeyId.slice(0, 8)}...</p>
      ${kpiCards}
    </div>
    ${subscriptionHtml}
  `;

  return renderPage({
    title: "Billing Dashboard",
    description: "Manage your Parse subscription, view usage, and track billing.",
    path: "/dashboard/billing",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Dashboard", href: "/dashboard" },
      { name: "Billing", href: "/dashboard/billing" },
    ],
  });
}
