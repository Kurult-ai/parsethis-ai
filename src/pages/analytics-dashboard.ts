/**
 * Conversion Analytics Dashboard (Task 14.3)
 *
 * Shows daily/weekly funnel counts per stage, conversion rates between stages,
 * unique visitors per stage, and 7/30-day trends.
 *
 * Uses Redis data from src/lib/funnel.ts.
 */

import { renderPage } from "../lib/html-template.js";
import { getFunnelMetrics, type FunnelStage } from "../lib/funnel.js";

const STAGE_ORDER: FunnelStage[] = [
  "discovery_hit",
  "pricing_view",
  "signup",
  "first_call",
  "free_limit",
  "checkout_started",
  "checkout_completed",
];

const STAGE_LABELS: Record<FunnelStage, string> = {
  discovery_hit: "Discovery / Landing",
  pricing_view: "Pricing Page View",
  signup: "API Key Signup",
  first_call: "First API Call",
  free_limit: "Free Tier Limit Hit",
  checkout_started: "Checkout Started",
  checkout_completed: "Checkout Completed",
};

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "—";
  const val = (numerator / denominator) * 100;
  return `${val.toFixed(1)}%`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

interface DailyData {
  date: string;
  counts: Record<FunnelStage, number>;
}

/**
 * Fetch per-day funnel counts for a date range (for trend charts).
 */
async function getDailyCounts(
  startDate: string,
  endDate: string,
): Promise<DailyData[]> {
  // Lazy import to avoid circular dependency issues
  const { isRedisAvailable, ensureRedisConnected, getRedis } = await import("../redis.js");
  if (!isRedisAvailable()) return [];

  try {
    const connected = await ensureRedisConnected();
    if (!connected) return [];
    const redis = getRedis();

    const dates: string[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }

    const result: DailyData[] = [];
    for (const date of dates) {
      const counts = {} as Record<FunnelStage, number>;
      for (const stage of STAGE_ORDER) {
        const countStr = await redis.get(`funnel:count:${stage}:${date}`);
        counts[stage] = countStr ? parseInt(countStr, 10) : 0;
      }
      result.push({ date, counts });
    }
    return result;
  } catch {
    return [];
  }
}

export async function renderAnalyticsDashboardPage(baseUrl: string): Promise<string> {
  const todayStr = today();
  const sevenDaysAgo = dateNDaysAgo(6);
  const thirtyDaysAgo = dateNDaysAgo(29);

  // Fetch aggregated metrics for both windows
  const [metrics7d, metrics30d, daily7d, daily30d] = await Promise.all([
    getFunnelMetrics(sevenDaysAgo, todayStr),
    getFunnelMetrics(thirtyDaysAgo, todayStr),
    getDailyCounts(sevenDaysAgo, todayStr),
    getDailyCounts(thirtyDaysAgo, todayStr),
  ]);

  // ── 7-day summary table ──
  const stageRows7d = STAGE_ORDER.map((stage, i) => {
    const data = metrics7d.stages.find((s) => s.stage === stage);
    const total = data?.total_count ?? 0;
    const uniques = data?.unique_count ?? 0;
    const prevData = i > 0 ? metrics7d.stages.find((s) => s.stage === STAGE_ORDER[i - 1]) : null;
    const prevUniques = prevData?.unique_count ?? 0;
    const stepConv = i > 0 ? pct(uniques, prevUniques) : "—";

    return `<tr>
      <td><strong>${STAGE_LABELS[stage]}</strong></td>
      <td>${fmt(total)}</td>
      <td>${fmt(uniques)}</td>
      <td>${stepConv}</td>
    </tr>`;
  }).join("\n");

  // ── 30-day summary ──
  const stageRows30d = STAGE_ORDER.map((stage, i) => {
    const data = metrics30d.stages.find((s) => s.stage === stage);
    const total = data?.total_count ?? 0;
    const uniques = data?.unique_count ?? 0;
    const prevData = i > 0 ? metrics30d.stages.find((s) => s.stage === STAGE_ORDER[i - 1]) : null;
    const prevUniques = prevData?.unique_count ?? 0;
    const stepConv = i > 0 ? pct(uniques, prevUniques) : "—";
    return `<tr>
      <td><strong>${STAGE_LABELS[stage]}</strong></td>
      <td>${fmt(total)}</td>
      <td>${fmt(uniques)}</td>
      <td>${stepConv}</td>
    </tr>`;
  }).join("\n");

  // ── Overall conversion (discovery → checkout_completed) ──
  const discovery7 = metrics7d.stages.find((s) => s.stage === "discovery_hit")?.unique_count ?? 0;
  const completed7 = metrics7d.stages.find((s) => s.stage === "checkout_completed")?.unique_count ?? 0;
  const overallConv7 = pct(completed7, discovery7);
  const discovery30 = metrics30d.stages.find((s) => s.stage === "discovery_hit")?.unique_count ?? 0;
  const completed30 = metrics30d.stages.find((s) => s.stage === "checkout_completed")?.unique_count ?? 0;
  const overallConv30 = pct(completed30, discovery30);

  // ── Sparkline data for 7-day daily trend (discovery + completed) ──
  const sparkLabels7 = JSON.stringify(daily7d.map((d) => d.date.slice(5)));
  const sparkDiscovery7 = JSON.stringify(daily7d.map((d) => d.counts.discovery_hit));
  const sparkCompleted7 = JSON.stringify(daily7d.map((d) => d.counts.checkout_completed));
  const sparkSignup7 = JSON.stringify(daily7d.map((d) => d.counts.signup));

  // ── 30-day daily trend for key stages ──
  const sparkLabels30 = JSON.stringify(daily30d.map((d) => d.date.slice(5)));
  const sparkDiscovery30 = JSON.stringify(daily30d.map((d) => d.counts.discovery_hit));
  const sparkCompleted30 = JSON.stringify(daily30d.map((d) => d.counts.checkout_completed));

  const hasData = discovery7 > 0 || discovery30 > 0;

  const content = `
<style>
  .analytics-metric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .analytics-metric {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 20px;
  }
  .analytics-metric .label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .analytics-metric .value {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text);
  }
  .analytics-metric .sub {
    font-size: 13px;
    color: var(--text-dim);
    margin-top: 4px;
  }
  .analytics-tabs {
    display: flex;
    gap: 0;
    border-bottom: 2px solid var(--border);
    margin-bottom: 24px;
  }
  .analytics-tab {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-dim);
    border: none;
    background: none;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    transition: all 0.2s;
  }
  .analytics-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .analytics-tab:hover {
    color: var(--text);
  }
  .analytics-panel { display: none; }
  .analytics-panel.active { display: block; }
  .sparkline-chart {
    width: 100%;
    height: 120px;
    margin: 16px 0;
  }
  .analytics-empty {
    text-align: center;
    padding: 48px 24px;
    color: var(--text-dim);
  }
  .analytics-empty-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }
</style>

<!-- Chunk 1: Header + KPIs -->
<div class="section-chunk">
  <h1 style="margin-top:0;">Conversion Analytics</h1>
  <p class="answer-capsule">Funnel performance from landing page to completed checkout. Data is tracked via Redis and reflects all visitors across the selected time window.</p>

  <div class="analytics-metric-grid">
    <div class="analytics-metric">
      <div class="label">7-Day Discovery Hits</div>
      <div class="value">${fmt(discovery7)}</div>
      <div class="sub">unique visitors (last 7 days)</div>
    </div>
    <div class="analytics-metric">
      <div class="label">7-Day Checkouts</div>
      <div class="value">${fmt(completed7)}</div>
      <div class="sub">completed subscriptions</div>
    </div>
    <div class="analytics-metric">
      <div class="label">7-Day Conversion Rate</div>
      <div class="value">${overallConv7}</div>
      <div class="sub">discovery → checkout</div>
    </div>
    <div class="analytics-metric">
      <div class="label">30-Day Conversion Rate</div>
      <div class="value">${overallConv30}</div>
      <div class="sub">${fmt(discovery30)} → ${fmt(completed30)} uniques</div>
    </div>
  </div>
</div>

${!hasData ? `
<!-- Empty state -->
<div class="section-chunk">
  <div class="analytics-empty">
    <div class="analytics-empty-icon">📊</div>
    <h2>No funnel data yet</h2>
    <p>Funnel events will appear here once visitors interact with the site.</p>
    <p style="font-size:13px;margin-top:8px;">Tracked stages: ${STAGE_ORDER.map((s) => STAGE_LABELS[s]).join(" → ")}</p>
  </div>
</div>
` : `
<!-- Chunk 2: Tabbed funnel tables -->
<div class="section-chunk">
  <div class="analytics-tabs">
    <button class="analytics-tab active" data-tab="7d" onclick="document.querySelectorAll('.analytics-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.analytics-panel').forEach(p=>p.classList.remove('active'));this.classList.add('active');document.getElementById('panel-7d').classList.add('active');">Last 7 Days</button>
    <button class="analytics-tab" data-tab="30d" onclick="document.querySelectorAll('.analytics-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.analytics-panel').forEach(p=>p.classList.remove('active'));this.classList.add('active');document.getElementById('panel-30d').classList.add('active');">Last 30 Days</button>
  </div>

  <!-- 7-day panel -->
  <div id="panel-7d" class="analytics-panel active">
    <h3 style="margin-top:0;">Funnel Breakdown — Last 7 Days</h3>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Total Events</th>
            <th>Unique Visitors</th>
            <th>Step Conversion</th>
          </tr>
        </thead>
        <tbody>
          ${stageRows7d}
        </tbody>
      </table>
    </div>

    <h3>Daily Trend — Last 7 Days</h3>
    <svg class="sparkline-chart" id="spark7" viewBox="0 0 700 120" preserveAspectRatio="none"></svg>
  </div>

  <!-- 30-day panel -->
  <div id="panel-30d" class="analytics-panel">
    <h3 style="margin-top:0;">Funnel Breakdown — Last 30 Days</h3>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Stage</th>
            <th>Total Events</th>
            <th>Unique Visitors</th>
            <th>Step Conversion</th>
          </tr>
        </thead>
        <tbody>
          ${stageRows30d}
        </tbody>
      </table>
    </div>

    <h3>Daily Trend — Last 30 Days</h3>
    <svg class="sparkline-chart" id="spark30" viewBox="0 0 700 120" preserveAspectRatio="none"></svg>
  </div>
</div>

<script>
(function() {
  function drawSparkline(svgId, labels, series) {
    var svg = document.getElementById(svgId);
    if (!svg) return;

    // series = [{ data: [], color: string, label: string }]
    var W = 700, H = 120;
    var pad = { l: 8, r: 8, t: 16, b: 24 };
    var innerW = W - pad.l - pad.r;
    var innerH = H - pad.t - pad.b;

    var allVals = series.flatMap(function(s) { return s.data; });
    var maxVal = Math.max.apply(null, allVals.concat([1]));
    var n = labels.length;
    var step = n > 1 ? innerW / (n - 1) : innerW;

    // Build paths
    var parts = '';
    series.forEach(function(s) {
      if (s.data.length === 0) return;
      var pathD = s.data.map(function(v, i) {
        var x = pad.l + i * step;
        var y = pad.t + innerH - (v / maxVal) * innerH;
        return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      parts += '<path d="' + pathD + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';

      // Dots
      s.data.forEach(function(v, i) {
        var x = pad.l + i * step;
        var y = pad.t + innerH - (v / maxVal) * innerH;
        parts += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.5" fill="' + s.color + '"/>';
      });
    });

    // X-axis labels (every nth)
    var labelInterval = Math.max(1, Math.ceil(n / 7));
    var labelParts = '';
    for (var i = 0; i < n; i += labelInterval) {
      var lx = pad.l + i * step;
      labelParts += '<text x="' + lx.toFixed(1) + '" y="' + (H - 6) + '" font-size="10" fill="#5a6678" text-anchor="middle">' + labels[i] + '</text>';
    }

    // Y-axis max label
    var maxLabel = '<text x="' + (pad.l + 2) + '" y="' + (pad.t + 10) + '" font-size="10" fill="#5a6678">' + maxVal + '</text>';

    svg.innerHTML = maxLabel + parts + labelParts;

    // Legend
    var legendParts = series.filter(function(s) { return s.data.length > 0; }).map(function(s) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:16px;font-size:12px;color:var(--text-dim);">' +
        '<span style="width:12px;height:2px;background:' + s.color + ';display:inline-block;"></span>' + s.label + '</span>';
    }).join('');
    var legend = document.createElement('div');
    legend.style.cssText = 'margin-top:4px;';
    legend.innerHTML = legendParts;
    svg.parentNode.insertBefore(legend, svg.nextSibling);
  }

  drawSparkline('spark7', ${sparkLabels7}, [
    { data: ${sparkDiscovery7}, color: '#1f5fe0', label: 'Discovery' },
    { data: ${sparkSignup7}, color: '#9a6410', label: 'Signup' },
    { data: ${sparkCompleted7}, color: '#10794f', label: 'Checkout' }
  ]);

  drawSparkline('spark30', ${sparkLabels30}, [
    { data: ${sparkDiscovery30}, color: '#1f5fe0', label: 'Discovery' },
    { data: ${sparkCompleted30}, color: '#10794f', label: 'Checkout' }
  ]);
})();
</script>
`}
`;

  return renderPage({
    title: "Conversion Analytics",
    description: "Funnel analytics dashboard: daily and weekly conversion rates across discovery, pricing, signup, and checkout stages.",
    path: "/dashboard/analytics",
    content,
    baseUrl,
    breadcrumbs: [
      { name: "Home", href: "/" },
      { name: "Dashboard", href: "/dashboard" },
      { name: "Analytics", href: "/dashboard/analytics" },
    ],
  });
}
