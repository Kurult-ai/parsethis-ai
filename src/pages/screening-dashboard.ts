import { renderPage } from "../lib/html-template.js";
import { prisma } from "../db.js";

export async function renderScreeningDashboardPage(baseUrl: string): Promise<string> {
  let totalScreenings = 0;
  let screenings24h = 0;
  let blockedTotal = 0;
  let riskDist: Array<{ verdict: string; count: number }> = [];
  let topCategories: Array<{ category: string; count: number }> = [];

  try {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, last24h, blocked, verdictGroups, catGroups] = await Promise.all([
      prisma.screeningEvent.count(),
      prisma.screeningEvent.count({ where: { createdAt: { gte: since24h } } }),
      prisma.screeningEvent.count({ where: { blocked: true } }),
      prisma.screeningEvent.groupBy({
        by: ["verdict"],
        _count: true,
        orderBy: { _count: { verdict: "desc" } },
      }),
      prisma.$queryRaw<Array<{ category: string; count: bigint }>>`
        SELECT unnest(categories) as category, count(*) as count
        FROM screening_events
        GROUP BY category
        ORDER BY count DESC
        LIMIT 8
      `,
    ]);

    totalScreenings = total;
    screenings24h = last24h;
    blockedTotal = blocked;
    riskDist = verdictGroups.map((r) => ({ verdict: r.verdict, count: r._count }));
    topCategories = catGroups.map((r) => ({ category: r.category, count: Number(r.count) }));
  } catch {
    // Table may not exist yet — show empty state
  }

  const chartDataJson = JSON.stringify(riskDist);
  const catDataJson = JSON.stringify(topCategories);

  const verdictColors: Record<string, string> = {
    safe: "#22c55e",
    low_risk: "#84cc16",
    medium_risk: "#eab308",
    high_risk: "#f97316",
    critical: "#ef4444",
  };

  const content = `
<!-- Chunk 1: Header + KPIs (Miller's Law: 1 of 3, 4 KPI cards) -->
<div class="section-chunk animate-in">
  <h1>Screening Dashboard</h1>
  <p class="muted">Real-time prompt safety screening analytics. Data refreshes on page load.</p>

  <div class="card-grid" style="margin-top:24px;">
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;font-weight:700;color:#60a5fa;letter-spacing:-0.03em;">${totalScreenings.toLocaleString()}</div>
      <div class="muted" style="font-size:13px;">Total Screenings</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;font-weight:700;color:var(--accent2);letter-spacing:-0.03em;">${screenings24h.toLocaleString()}</div>
      <div class="muted" style="font-size:13px;">Last 24 Hours</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;font-weight:700;color:var(--destructive);letter-spacing:-0.03em;">${blockedTotal.toLocaleString()}</div>
      <div class="muted" style="font-size:13px;">Blocked</div>
    </div>
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;font-weight:700;color:var(--green);letter-spacing:-0.03em;">${totalScreenings > 0 ? ((1 - blockedTotal / totalScreenings) * 100).toFixed(1) : "100"}%</div>
      <div class="muted" style="font-size:13px;">Pass Rate</div>
    </div>
  </div>
</div>

<!-- Chunk 2: Charts (Miller's Law: 2 of 3, 2 charts) -->
<div class="section-chunk">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
    <div class="card">
      <h3 style="margin-top:0;">Risk Distribution</h3>
      <canvas id="riskChart" height="250"></canvas>
    </div>
    <div class="card">
      <h3 style="margin-top:0;">Top Categories</h3>
      <canvas id="catChart" height="250"></canvas>
    </div>
  </div>

  ${riskDist.length === 0 ? '<p class="muted" style="text-align:center;margin-top:24px;">No screening data yet. Screen some prompts via the API or SDK to populate this dashboard.</p>' : ""}
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.9/dist/chart.umd.min.js" crossorigin="anonymous"></script>
<script>
(function() {
  const riskData = ${chartDataJson};
  const catData = ${catDataJson};
  const verdictColors = ${JSON.stringify(verdictColors)};

  Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

  if (riskData.length > 0) {
    new Chart(document.getElementById('riskChart'), {
      type: 'doughnut',
      data: {
        labels: riskData.map(d => d.verdict.replace('_', ' ')),
        datasets: [{
          data: riskData.map(d => d.count),
          backgroundColor: riskData.map(d => verdictColors[d.verdict] || '#52525b'),
          borderWidth: 0,
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom', labels: { color: '#a1a1aa', padding: 16 } } }
      }
    });
  }

  if (catData.length > 0) {
    new Chart(document.getElementById('catChart'), {
      type: 'bar',
      data: {
        labels: catData.map(d => d.category.replace('_', ' ')),
        datasets: [{
          label: 'Detections',
          data: catData.map(d => d.count),
          backgroundColor: '#6366f1',
          borderRadius: 4,
        }]
      },
      options: {
        responsive: true,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#a1a1aa' }, grid: { color: '#27272a' } },
          y: { ticks: { color: '#a1a1aa' }, grid: { display: false } },
        }
      }
    });
  }
})();
</script>
`;

  return renderPage({
    title: "Screening Dashboard",
    description: "Parse Agents prompt-protection analytics and risk distribution",
    path: "/dashboard/screening",
    content,
    baseUrl,
  });
}
