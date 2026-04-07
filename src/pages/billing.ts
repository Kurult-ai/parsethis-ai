import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";
import { prisma } from "../db.js";
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
  const overageCost = config ? (overageCount * config.overageRate).toFixed(2) : "0.00";

  // Build KPI cards
  const kpiCards = `
    <div class="card-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Current Plan</div>
        <div style="font-size:24px;font-weight:700;">${tier.charAt(0).toUpperCase() + tier.slice(1)}</div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Requests Used</div>
        <div style="font-size:24px;font-weight:700;">${currentUsage.toLocaleString()} <span style="font-size:14px;color:var(--text-dim);">/ ${includedRequests > 0 ? includedRequests.toLocaleString() : "\u221E"}</span></div>
      </div>
      <div class="card">
        <div style="font-size:13px;color:var(--text-dim);margin-bottom:4px;">Overage Cost</div>
        <div style="font-size:24px;font-weight:700;">$${overageCost}</div>
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
            <a href="/v1/billing/portal" class="btn btn-outline" onclick="event.preventDefault();fetch('/v1/billing/portal',{method:'POST',headers:{'Authorization':'Bearer '+localStorage.getItem('pfa_key'),'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{if(d.url)window.location=d.url})">Manage Subscription</a>
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
