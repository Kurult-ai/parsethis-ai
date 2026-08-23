/**
 * Shareable Evidence Report — GET /report/:id
 *
 * The forwardable artifact. An agency pastes an attack-pack sample (or their
 * own text via the demo console), screening stores a verdict snapshot in Redis
 * (7-day TTL, unguessable 24-hex id), and this page renders it in CISO
 * language: what was found, what an unscreened agent would have executed, and
 * a "screened by Parse" provenance block with the text hash and timestamp.
 *
 * The page is deliberately print/PDF-friendly — operators forward it or attach
 * it to a stalled deal thread.
 */

import { Hono } from "hono";
import { renderPage } from "../lib/html-template.js";
import { PRODUCT } from "../lib/product-facts.js";
import { organizationSchema } from "../lib/schema.js";
import { loadReport } from "./attack-pack.js";
import type { AppEnv } from "../types.js";

export const reportRoutes = new Hono<AppEnv>();

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DISPOSITION_COPY: Record<string, { label: string; color: string; bg: string; line: string }> = {
  block: {
    label: "BLOCKED",
    color: "#b42318",
    bg: "#fef3f2",
    line: "Parse would refuse this input before an agent acts on it.",
  },
  review: {
    label: "FLAGGED FOR REVIEW",
    color: "#b54708",
    bg: "#fffaeb",
    line: "Parse would hold this input for a human decision before an agent acts on it.",
  },
  report: {
    label: "REPORTED",
    color: "#175cd3",
    bg: "#eff8ff",
    line: "Parse would pass this input but log a finding to the audit trail.",
  },
  allow: {
    label: "NO FINDING",
    color: "#067647",
    bg: "#ecfdf3",
    line: "Parse found no actionable risk in this text. (Try one of the attack-pack samples for a caught payload.)",
  },
};

reportRoutes.get("/report/:id", async (c) => {
  const id = c.req.param("id");
  const report = await loadReport(id);
  if (!report) {
    const gone = `
<section style="max-width:640px;padding:60px 0">
  <h1 style="font-size:28px;font-weight:800;letter-spacing:-0.03em">Report not found</h1>
  <p style="color:#98a2b3;font-size:15px;line-height:1.6">This report link is invalid or has expired (shared reports live for 7 days). Re-screen the text at the <a href="/attack">Attack Pack</a> or the <a href="/demo">demo console</a> to generate a fresh report.</p>
</section>`;
    const baseUrl = c.req.header("x-forwarded-proto")
      ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
      : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";
    return c.html(
      renderPage({
        title: `Report not found | ${PRODUCT.name}`,
        description: "This screening report link is invalid or expired.",
        path: `/report/${id}`,
        content: gone,
        baseUrl,
        jsonLd: [],
      }),
      404,
    );
  }

  const baseUrl = c.req.header("x-forwarded-proto")
    ? `${c.req.header("x-forwarded-proto")}://${c.req.header("host")}`
    : process.env.PUBLIC_BASE_URL || "https://www.parsethis.ai";

  const v = report.verdict;
  const disp = DISPOSITION_COPY[v.disposition] ?? DISPOSITION_COPY.allow;

  const flagRows = v.flags.length
    ? v.flags
        .map((f) => {
          const name = f.label ?? f.code;
          const rationale =
            f.detail ?? f.evidence ?? undefined;
          return `
      <tr>
        <td><code>${escapeHtml(f.code)}</code></td>
        <td>${escapeHtml(name)}</td>
        <td>${f.matched_token ? `<code>${escapeHtml(f.matched_token)}</code>` : "<span style='color:#98a2b3'>—</span>"}</td>
        <td style="font-size:13px;color:#475467">${rationale ? escapeHtml(rationale.slice(0, 220)) : "<span style='color:#98a2b3'>detected by the " + escapeHtml(f.code.split(".")[0]) + " layer</span>"}</td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" style="color:#98a2b3">No flags fired.</td></tr>`;

  const catChips = v.categories.length
    ? v.categories.map((cat) => `<span class="rep-chip">${escapeHtml(cat)}</span>`).join(" ")
    : "<span style='color:#98a2b3'>none</span>";

  const content = `
<style>
  .rep-wrap { max-width: 820px; padding: 26px 0 46px; }
  .rep-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; flex-wrap: wrap; margin-bottom: 18px; }
  .rep-head h1 { font-size: 26px; font-weight: 800; letter-spacing: -0.03em; margin: 0 0 4px; }
  .rep-sub { color: #98a2b3; font-size: 13.5px; }
  .rep-score { text-align: right; }
  .rep-score-num { font-size: 42px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
  .rep-score-label { font-size: 12px; color: #98a2b3; letter-spacing: .04em; }
  .rep-banner {
    border-radius: 10px; padding: 14px 18px; margin-bottom: 20px;
    font-size: 15px; font-weight: 600; border: 1px solid currentColor;
  }
  .rep-blast {
    border-left: 3px solid #d92d20; background: #fef3f2; border-radius: 0 8px 8px 0;
    padding: 13px 16px; font-size: 14.5px; line-height: 1.55; color: #7a271a; margin-bottom: 22px;
  }
  .rep-blast strong { display: block; margin-bottom: 4px; }
  .rep-sec h2 { font-size: 15px; font-weight: 700; letter-spacing: .02em; margin: 26px 0 10px; color: #344054; }
  table.rep-flags { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  table.rep-flags th { text-align: left; font-size: 12px; color: #98a2b3; text-transform: uppercase; letter-spacing: .05em; padding: 6px 10px; border-bottom: 1px solid var(--border,#e4e7ec); }
  table.rep-flags td { padding: 8px 10px; border-bottom: 1px solid var(--border,#e4e7ec); vertical-align: top; }
  .rep-chip {
    display: inline-block; background: #f2f4f7; border: 1px solid var(--border,#e4e7ec);
    border-radius: 999px; padding: 3px 10px; font-size: 12.5px; font-weight: 600; color: #344054; margin: 2px 4px 2px 0;
  }
  .rep-preview {
    border: 1px dashed var(--border,#e4e7ec); border-radius: 10px; padding: 14px 16px;
    font-size: 13.5px; line-height: 1.6; color: #475467; white-space: pre-wrap; background: #fcfcfd;
  }
  .rep-prov {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;
    margin: 22px 0; padding: 16px; background: #f8f9fb; border: 1px solid var(--border,#e4e7ec); border-radius: 10px;
  }
  .rep-prov-item .k { font-size: 11.5px; color: #98a2b3; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 3px; }
  .rep-prov-item .val { font-size: 13.5px; font-family: ui-monospace, monospace; color: #1d2939; word-break: break-all; }
  .rep-cta { margin-top: 28px; padding: 18px; border: 1px solid #2f6fed33; background: linear-gradient(145deg, rgba(47,111,237,.08), rgba(25,182,175,.05)); border-radius: 12px; }
  .rep-cta h3 { margin: 0 0 6px; font-size: 16px; }
  .rep-cta p { margin: 0 0 12px; font-size: 14px; color: #475467; line-height: 1.55; }
  @media print { .rep-cta { display: none; } .rep-wrap { padding: 0; } }
</style>
<section class="rep-wrap">
  <div class="rep-head">
    <div>
      <h1>Screening Evidence Report</h1>
      <div class="rep-sub">${report.sample_title ? escapeHtml(report.sample_title) + " — Attack Pack sample" : "Custom text"} · screened by ${PRODUCT.name}</div>
    </div>
    <div class="rep-score">
      <div class="rep-score-num" style="color:${disp.color}">${v.risk_score.toFixed(1)}</div>
      <div class="rep-score-label">RISK SCORE / 10</div>
      <div style="font-size:11.5px;color:#98a2b3;margin-top:6px;max-width:180px;line-height:1.45;">0–2.9 allow · 3–5.9 review<br>6–9.4 block (high risk)<br>9.5–10 block (critical)</div>
    </div>
  </div>

  <div class="rep-banner" style="color:${disp.color};background:${disp.bg}">
    ${disp.label} — ${disp.line}
  </div>

  <div class="rep-blast">
    <strong>What an unscreened agent would have done</strong>
    ${escapeHtml(report.blast)}
  </div>

  <div class="rep-sec">
    <h2>Categories</h2>
    ${catChips}
  </div>

  <div class="rep-sec">
    <h2>Flags fired</h2>
    <table class="rep-flags">
      <thead><tr><th>Flag</th><th>Detection</th><th>Matched</th><th>Rationale</th></tr></thead>
      <tbody>${flagRows}</tbody>
    </table>
  </div>

  <div class="rep-sec">
    <h2>Screened text (preview)</h2>
    <div class="rep-preview">${escapeHtml(report.preview)}${report.preview.length >= 240 ? "…" : ""}</div>
  </div>

  <div class="rep-prov">
    <div class="rep-prov-item"><div class="k">Screened at (UTC)</div><div class="val">${escapeHtml(report.screened_at)}</div></div>
    <div class="rep-prov-item"><div class="k">Text SHA-256 (first 16)</div><div class="val">${report.text_sha256_16}</div></div>
    <div class="rep-prov-item"><div class="k">Deterministic floor</div><div class="val">${v.deterministic_floor ? "yes — pattern layer fired" : "no — semantic-only findings capped at report"}</div></div>
    <div class="rep-prov-item"><div class="k">Pipeline</div><div class="val">pattern + semantic (full)</div></div>
  </div>

  <div class="rep-cta">
    <h3>This is the boundary your security review is asking about.</h3>
    <p>Every input your agents read — emails, documents, tool output, web pages — can carry instructions aimed at the agent's authority. Parse screens all of it, blocks what crosses the line, and receipts every decision.</p>
    <p>
      <a class="btn-primary" href="/attack" style="display:inline-block;background:#111;color:#fff;padding:10px 18px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14.5px;margin-right:10px">Screen another →</a>
      <a class="btn-primary" href="/get-started" style="display:inline-block;background:#2f6fed;color:#fff;padding:10px 18px;border-radius:8px;font-weight:700;text-decoration:none;font-size:14.5px">Install Parse →</a>
    </p>
    <p style="font-size:13px;color:#667085;margin-top:10px">Forward this URL into the review thread. Then put the same boundary on the agent.</p>
  </div>
</section>`;

  return c.html(
    renderPage({
      title: `Screening Evidence Report — ${disp.label} | ${PRODUCT.name}`,
      description: `Parse screening evidence report: risk ${v.risk_score.toFixed(1)}/10, disposition ${v.disposition}. Forwardable artifact for agent security reviews.`,
      path: `/report/${id}`,
      content,
      baseUrl,
      jsonLd: [organizationSchema(baseUrl)],
      headExtra: `<meta name="robots" content="noindex" />`,
    }),
  );
});
