/**
 * Shareable Evidence Report pages — the forwardable artifact and its afterlife.
 *
 * Two renders, one visual grammar (Event Horizon — docs/style-guide.md):
 *
 *   renderEvidenceReportPage    GET /report/:id while the link is alive.
 *   renderReportUnavailablePage GET /report/:id after the 7-day horizon, or
 *                               for an id that was never issued.
 *
 * The signature element is the VALIDITY STRIP: seven mono ticks — one per day
 * of the link's life — lit gold for the days remaining, spent-dim for the days
 * elapsed, bracketed by ISSUED and EXPIRES receipts. The lifetime is stated in
 * the strip, in the provenance block, and at the moment of forwarding, so a
 * reviewer holding the URL knows exactly how long it answers. The expired page
 * keeps the same strip (fully spent) and gives the two regeneration paths:
 * re-screen the sample at /attack, or re-paste the text at /demo.
 *
 * Both renders are pure (report + id + clock in, HTML out) so the lifetime
 * copy is testable without Redis. All lifetime figures interpolate
 * REPORT_TTL_DAYS from src/lib/report-ttl.ts — the same constant the store's
 * EX uses — never a typed number.
 *
 * Print is the sanctioned forced-light ground (style guide §7): tokens flip to
 * paper values inside @media print, chrome drops away, and the strip survives
 * onto the PDF, because the PDF is the copy that outlives the URL.
 */

import { renderPage } from "../lib/html-template.js";
import { PRODUCT } from "../lib/product-facts.js";
import { organizationSchema } from "../lib/schema.js";
import { flagsFiredDeterministicFloor } from "../lib/deterministic-floor.js";
import {
  REPORT_TTL_DAYS,
  reportDaysLeft,
  reportExpiresAt,
  formatUtcMinute,
} from "../lib/report-ttl.js";
import type { StoredReport } from "../routes/attack-pack.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DISPOSITION_COPY: Record<string, { label: string; tone: string; line: string }> = {
  block: {
    label: "Blocked",
    tone: "destructive",
    line: "Parse would refuse this input before an agent acts on it.",
  },
  review: {
    label: "Flagged for review",
    tone: "yellow",
    line: "Parse would hold this input for a human decision before an agent acts on it.",
  },
  report: {
    label: "Reported",
    tone: "accent",
    line: "Parse would pass this input but log a finding to the audit trail.",
  },
  allow: {
    label: "No finding",
    tone: "green",
    line: "Parse found no actionable risk in this text. (Try one of the attack-pack samples for a caught payload.)",
  },
};

/**
 * Shared stylesheet for both report states. Dark tokens come from the shell;
 * @media print re-declares them as paper values — the one sanctioned light
 * ground — so the forwarded PDF stays legible without a second template.
 */
const REPORT_CSS = `
  .evr-wrap { max-width: 860px; padding: 18px 0 46px; }
  .evr-kicker {
    font-family: var(--mono); font-size: 11px; font-weight: 500;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-soft);
    margin: 0 0 10px;
  }
  .evr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; flex-wrap: wrap; margin-bottom: 18px; }
  .evr-head h1 {
    font-family: var(--serif); font-weight: 400;
    font-size: clamp(1.9rem, 4.4vw, 2.7rem); line-height: 1.06;
    letter-spacing: -0.01em; margin: 0 0 6px; color: var(--text);
  }
  .evr-sub { color: var(--text-soft); font-size: 13.5px; }
  .evr-score { text-align: right; }
  .evr-score-num {
    font-family: var(--mono); font-weight: 600; font-size: 44px; line-height: 1;
    font-variant-numeric: tabular-nums; color: var(--tone, var(--text));
  }
  .evr-score-label {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--text-soft); margin-top: 4px;
  }
  .evr-score-scale {
    font-family: var(--mono); font-size: 11px; color: var(--text-soft);
    margin-top: 8px; max-width: 190px; line-height: 1.5; font-variant-numeric: tabular-nums;
  }

  .tone-destructive { --tone: var(--destructive); --tone-dim: var(--destructive-dim); }
  .tone-yellow { --tone: var(--yellow); --tone-dim: var(--yellow-dim); }
  .tone-accent { --tone: var(--accent2); --tone-dim: var(--accent-dim); }
  .tone-green { --tone: var(--green); --tone-dim: var(--green-dim); }

  .evr-banner {
    border: 1px solid var(--border); border-left: 3px solid var(--tone, var(--border2));
    background: var(--tone-dim, var(--surface)); padding: 13px 18px; margin-bottom: 16px;
    font-size: 15px; line-height: 1.5; color: var(--text);
  }
  .evr-banner .evr-banner-label {
    font-family: var(--mono); font-size: 11.5px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--tone, var(--text));
    display: block; margin-bottom: 3px;
  }

  /* ── The validity strip — seven days, seven ticks ── */
  .evr-valid {
    position: relative; border: 1px solid var(--border); background: var(--surface);
    padding: 16px 18px 13px; margin-bottom: 22px;
  }
  .evr-valid::before {
    content: ""; position: absolute; top: -1px; left: -1px; right: -1px; height: 1px;
    background: linear-gradient(90deg, var(--accent), #7a5cff 55%, var(--gold));
    opacity: 0.7;
  }
  .evr-valid-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .evr-vcell { display: flex; flex-direction: column; gap: 3px; min-width: 128px; }
  .evr-vcell.evr-right { text-align: right; margin-left: auto; }
  .evr-k {
    font-family: var(--mono); font-size: 10.5px; font-weight: 500;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-soft);
  }
  .evr-v {
    font-family: var(--mono); font-size: 13px; color: var(--text);
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .evr-v .evr-left-count { color: var(--gold); }
  .is-expired .evr-v .evr-left-count { color: var(--text-soft); }
  .evr-ticks { display: flex; gap: 5px; align-items: center; flex: 1 1 160px; min-width: 130px; }
  .evr-tick {
    display: block; height: 8px; flex: 1; border-radius: 1.5px;
    background: linear-gradient(90deg, var(--gold), var(--yellow));
    animation: evrTickIn 300ms cubic-bezier(0.2, 0, 0, 1) both;
    animation-delay: calc(var(--i) * 45ms);
  }
  .evr-tick.spent { background: rgba(255,255,255,.13); }
  .evr-valid-note { margin: 11px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--text-dim); }
  .evr-valid-note a { text-decoration: underline; text-underline-offset: 3px; }
  @keyframes evrTickIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) { .evr-tick { animation: none; } }

  .evr-blast {
    border: 1px solid var(--border); border-left: 3px solid var(--destructive);
    background: var(--destructive-dim); padding: 13px 16px; font-size: 14.5px;
    line-height: 1.55; color: var(--text); margin-bottom: 22px;
  }
  .evr-blast strong { display: block; margin-bottom: 4px; }

  .evr-h {
    font-family: var(--mono); font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-soft);
    margin: 26px 0 10px;
  }
  .evr-chip {
    display: inline-block; font-family: var(--mono); font-size: 12px;
    background: var(--surface2); border: 1px solid var(--border); border-radius: 999px;
    padding: 3px 11px; color: var(--text-dim); margin: 2px 6px 2px 0;
  }
  table.evr-flags { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  table.evr-flags th {
    text-align: left; font-family: var(--mono); font-size: 10.5px; font-weight: 500;
    color: var(--text-soft); text-transform: uppercase; letter-spacing: 0.1em;
    padding: 6px 10px; border-bottom: 1px solid var(--border); background: transparent; position: static;
  }
  table.evr-flags td { padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  table.evr-flags td.evr-rationale { font-size: 13px; color: var(--text-dim); }
  table.evr-flags tbody tr:hover { background: rgba(255,255,255,.025); }
  .evr-dash { color: var(--text-soft); }

  .evr-preview {
    border: 1px dashed var(--border2); padding: 14px 16px;
    font-family: var(--mono); font-size: 12.5px; line-height: 1.7;
    color: var(--text-dim); white-space: pre-wrap; background: var(--surface);
  }

  .evr-prov {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;
    margin: 24px 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border);
  }
  .evr-prov-item .k {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--text-soft); margin-bottom: 4px;
  }
  .evr-prov-item .val {
    font-size: 12.5px; font-family: var(--mono); color: var(--text);
    word-break: break-all; font-variant-numeric: tabular-nums; line-height: 1.55;
  }

  .evr-cta { margin-top: 30px; padding: 20px; border: 1px solid var(--border); background: var(--surface); }
  .evr-cta h3 { margin: 0 0 6px; font-size: 17px; letter-spacing: -0.01em; }
  .evr-cta p { margin: 0 0 12px; font-size: 14px; color: var(--text-dim); line-height: 1.55; }
  .evr-cta .evr-forward { font-size: 13px; color: var(--text-soft); margin: 12px 0 0; }
  .evr-cta .evr-forward .evr-days-word { color: var(--gold); }

  /* ── Expired state ── */
  .evr-gone-lede { max-width: 56ch; color: var(--text-dim); font-size: 15.5px; line-height: 1.65; margin: 0 0 22px; }
  .evr-regen { margin-top: 26px; border-top: 1px solid var(--border); }
  .evr-regen-row {
    display: grid; grid-template-columns: 3.5rem 1fr auto; gap: 14px 22px; align-items: start;
    padding: 20px 4px; border-bottom: 1px solid var(--border);
    color: inherit; text-decoration: none;
    transition: border-color 100ms cubic-bezier(0.2, 0, 0.38, 0.9), color 100ms cubic-bezier(0.2, 0, 0.38, 0.9);
  }
  .evr-regen-row:hover, .evr-regen-row:focus-visible {
    color: var(--text);
    border-bottom-color: color-mix(in srgb, var(--gold) 45%, transparent);
  }
  .evr-regen-row:focus-visible { outline-offset: 6px; }
  .evr-regen-num {
    font-family: var(--mono); font-size: 1.05rem; font-variant-numeric: tabular-nums;
    letter-spacing: 0.08em; color: var(--gold); padding-top: 2px;
  }
  .evr-regen-row h2 { font-family: var(--sans); font-size: 1.15rem; font-weight: 600; letter-spacing: -0.015em; color: var(--text); margin: 0 0 6px; }
  .evr-regen-row p { margin: 0; color: var(--text-dim); font-size: 14.5px; max-width: 52ch; }
  .evr-regen-cta {
    align-self: center; font-family: var(--mono); font-size: 12px;
    letter-spacing: 0.06em; color: var(--gold); white-space: nowrap;
  }
  .evr-regen-row:hover .evr-regen-cta { color: var(--text); }
  .evr-gone-fine { margin-top: 22px; font-family: var(--mono); font-size: 12px; line-height: 1.7; color: var(--text-soft); max-width: 62ch; }

  @media (max-width: 680px) {
    .evr-head { flex-direction: column; }
    .evr-score { text-align: left; }
    .evr-valid-row { gap: 12px; }
    .evr-vcell.evr-right { text-align: left; margin-left: 0; }
    .evr-ticks { flex-basis: 100%; order: 3; }
    .evr-regen-row { grid-template-columns: 2.5rem 1fr; }
    .evr-regen-cta { grid-column: 2; }
  }

  /* ── Print: the sanctioned forced-light ground (style guide §7). The PDF is
     the copy that outlives the URL, so the validity strip prints too. ── */
  @media print {
    :root {
      --bg: #ffffff; --surface: #ffffff; --surface2: #f3f4f6; --surface3: #e5e7eb;
      --border: #d0d5dd; --border2: #98a2b3;
      --text: #111827; --text-dim: #374151; --text-soft: #6b7280;
      --accent: #1d4ed8; --accent2: #1d4ed8; --accent-dim: #eff4ff;
      --green: #067647; --green-dim: #ecfdf3;
      --yellow: #b54708; --yellow-dim: #fffaeb;
      --destructive: #b42318; --destructive-dim: #fef3f2;
      --gold: #b54708;
    }
    body { background: #ffffff !important; color: #111827 !important; }
    body::before, body::after { display: none !important; }
    .site-header, .site-footer, .evr-cta, .evr-regen, nav.breadcrumb { display: none !important; }
    .evr-tick { animation: none; }
    .evr-valid::before { background: #d0d5dd; }
  }
`;

/** aria + visual for the seven-day strip; `daysLeft` = whole days remaining. */
function validityTicks(daysLeft: number): string {
  const spent = REPORT_TTL_DAYS - daysLeft;
  return Array.from({ length: REPORT_TTL_DAYS }, (_, i) => {
    const isSpent = i < spent;
    return `<span class="evr-tick${isSpent ? " spent" : ""}" style="--i:${i}"></span>`;
  }).join("");
}

function livesLine(): string {
  return (
    `This URL lives ${REPORT_TTL_DAYS} days from screening, then it is deleted from the report store. ` +
    `To reissue it after expiry, re-screen the same text: a pack sample re-screens in one click at the ` +
    `<a href="/attack">Attack Pack</a>, and your own text re-screens at the <a href="/demo">demo console</a> — ` +
    `either mints a fresh ${REPORT_TTL_DAYS}-day link.`
  );
}

// ── Live report ──────────────────────────────────────────────────────────────

export function renderEvidenceReportPage(opts: {
  report: StoredReport;
  id: string;
  baseUrl: string;
  now?: Date;
}): string {
  const { report, id, baseUrl } = opts;
  const now = opts.now ?? new Date();
  const v = report.verdict;
  const disp = DISPOSITION_COPY[v.disposition] ?? DISPOSITION_COPY.allow;

  const expires = reportExpiresAt(report.screened_at);
  const daysLeft = reportDaysLeft(report.screened_at, now);
  const daysLeftLabel = daysLeft <= 0 ? "expiring now" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  const stripAria = `Report link lifetime: ${daysLeft} of ${REPORT_TTL_DAYS} days remaining.`;

  const flagRows = v.flags.length
    ? v.flags
        .map((f) => {
          const name = f.label ?? f.code;
          const rationale = f.detail ?? f.evidence ?? undefined;
          return `
      <tr>
        <td><code>${escapeHtml(f.code)}</code></td>
        <td>${escapeHtml(name)}</td>
        <td>${f.matched_token ? `<code>${escapeHtml(f.matched_token)}</code>` : `<span class="evr-dash">—</span>`}</td>
        <td class="evr-rationale">${rationale ? escapeHtml(rationale.slice(0, 220)) : `<span class="evr-dash">detected by the ${escapeHtml(f.code.split(".")[0])} layer</span>`}</td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="evr-dash">No flags fired.</td></tr>`;

  const catChips = v.categories.length
    ? v.categories.map((cat) => `<span class="evr-chip">${escapeHtml(cat)}</span>`).join(" ")
    : `<span class="evr-dash">none</span>`;

  const deterministicFloor =
    flagsFiredDeterministicFloor(v.flags ?? []) || v.deterministic_floor;

  const ctaButtons =
    v.disposition === "block"
      ? `<a class="btn btn-primary" href="/ledger/sample">See the ledger sample →</a>
      <a class="btn btn-outline" href="/attack">Screen another →</a>`
      : `<a class="btn btn-primary" href="/attack">Screen another →</a>
      <a class="btn btn-outline" href="/get-started">Install Parse →</a>`;

  const content = `
<style>${REPORT_CSS}</style>
<section class="evr-wrap tone-${disp.tone}">
  <div class="evr-kicker">Parse · screening evidence · receipt ${escapeHtml(id.slice(0, 8))}…</div>
  <div class="evr-head">
    <div>
      <h1>Screening evidence report</h1>
      <div class="evr-sub">${report.sample_title ? escapeHtml(report.sample_title) + (report.blast ? " — Attack Pack sample" : "") : "Custom text"} · screened by ${PRODUCT.name}</div>
    </div>
    <div class="evr-score">
      <div class="evr-score-num">${v.risk_score.toFixed(1)}</div>
      <div class="evr-score-label">risk score / 10</div>
      <div class="evr-score-scale">0–2.9 allow · 3–5.9 review<br>6–9.4 block (high risk)<br>9.5–10 block (critical)</div>
    </div>
  </div>

  <div class="evr-banner">
    <span class="evr-banner-label">${escapeHtml(disp.label)}</span>
    ${escapeHtml(disp.line)}
  </div>

  <section class="evr-valid" aria-label="Report link lifetime">
    <div class="evr-valid-row">
      <div class="evr-vcell">
        <span class="evr-k">issued</span>
        <span class="evr-v">${escapeHtml(formatUtcMinute(new Date(report.screened_at)))}</span>
      </div>
      <div class="evr-ticks" role="img" aria-label="${escapeHtml(stripAria)}">${validityTicks(daysLeft)}</div>
      <div class="evr-vcell evr-right">
        <span class="evr-k">expires</span>
        <span class="evr-v">${escapeHtml(formatUtcMinute(expires))} · <span class="evr-left-count">${escapeHtml(daysLeftLabel)}</span></span>
      </div>
    </div>
    <p class="evr-valid-note">${livesLine()}</p>
  </section>

  ${report.blast ? `<div class="evr-blast">
    <strong>What an unscreened agent would have done</strong>
    ${escapeHtml(report.blast)}
  </div>` : ""}

  <h2 class="evr-h">Categories</h2>
  ${catChips}

  <h2 class="evr-h">Flags fired</h2>
  <table class="evr-flags">
    <thead><tr><th>Flag</th><th>Detection</th><th>Matched</th><th>Rationale</th></tr></thead>
    <tbody>${flagRows}</tbody>
  </table>

  <h2 class="evr-h">Screened text (preview)</h2>
  <div class="evr-preview">${escapeHtml(report.preview)}${report.preview.length >= 240 ? "…" : ""}</div>

  <div class="evr-prov">
    <div class="evr-prov-item"><div class="k">Screened at (UTC)</div><div class="val">${escapeHtml(report.screened_at)}</div></div>
    <div class="evr-prov-item"><div class="k">Text SHA-256 (first 16)</div><div class="val">${escapeHtml(report.text_sha256_16)}</div></div>
    <div class="evr-prov-item"><div class="k">Deterministic floor</div><div class="val">${deterministicFloor ? "yes — pattern layer fired" : "no — semantic-only findings capped at report"}</div></div>
    <div class="evr-prov-item"><div class="k">Pipeline</div><div class="val">pattern + semantic (full)</div></div>
    <div class="evr-prov-item"><div class="k">Link lifetime</div><div class="val">${REPORT_TTL_DAYS} days · expires ${escapeHtml(formatUtcMinute(expires))}</div></div>
    <div class="evr-prov-item"><div class="k">Report id</div><div class="val">${escapeHtml(id)}</div></div>
  </div>

  <div class="evr-cta">
    <h3>This is the boundary your security review is asking about.</h3>
    <p>Every input your agents read — emails, documents, tool output, web pages — can carry instructions aimed at the agent's authority. Parse screens all of it, blocks what crosses the line, and receipts every decision.</p>
    <p>${ctaButtons}</p>
    <p class="evr-forward">Forward this URL into the review thread — it answers for <span class="evr-days-word">${REPORT_TTL_DAYS} days</span>. Then put the same boundary on the agent.</p>
  </div>
</section>`;

  return renderPage({
    title: `Screening Evidence Report — ${disp.label}`,
    description: `Parse screening evidence report: risk ${v.risk_score.toFixed(1)}/10, disposition ${v.disposition}. Shareable ${REPORT_TTL_DAYS}-day evidence URL for agent security reviews.`,
    path: `/report/${id}`,
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    headExtra: `<meta name="robots" content="noindex" />`,
  });
}

// ── Expired / unknown ────────────────────────────────────────────────────────

export function renderReportUnavailablePage(opts: { id: string; baseUrl: string }): string {
  const { id, baseUrl } = opts;
  // Only echo an id that has the shape we ever issue (24 lowercase hex).
  const knownShape = /^[a-f0-9]{24}$/.test(id);
  const idReceipt = knownShape ? `${escapeHtml(id)}` : "unrecognized id";

  const content = `
<style>${REPORT_CSS}</style>
<section class="evr-wrap">
  <div class="evr-kicker">Parse · screening evidence · ${idReceipt}</div>
  <div class="evr-head">
    <div>
      <h1>This evidence link has expired.</h1>
    </div>
  </div>
  <p class="evr-gone-lede">Shareable evidence reports live for <strong>${REPORT_TTL_DAYS} days</strong> from the moment of screening, then they are deleted from the report store — not archived. Either this URL is past its ${REPORT_TTL_DAYS}-day window, or the id was never issued (report ids are unguessable, so a mistyped link reads the same as an expired one).</p>

  <section class="evr-valid is-expired" aria-label="Report link lifetime">
    <div class="evr-valid-row">
      <div class="evr-vcell">
        <span class="evr-k">lifetime</span>
        <span class="evr-v">${REPORT_TTL_DAYS} days from screening</span>
      </div>
      <div class="evr-ticks" role="img" aria-label="Link lifetime of ${REPORT_TTL_DAYS} days fully elapsed.">${validityTicks(0)}</div>
      <div class="evr-vcell evr-right">
        <span class="evr-k">status</span>
        <span class="evr-v"><span class="evr-left-count">expired or unknown</span></span>
      </div>
    </div>
    <p class="evr-valid-note">Regenerating takes one screen — same text in, fresh ${REPORT_TTL_DAYS}-day URL out.</p>
  </section>

  <nav class="evr-regen" aria-label="Regenerate this report">
    <a class="evr-regen-row" href="/attack">
      <span class="evr-regen-num">01</span>
      <span>
        <h2>It was an Attack Pack sample</h2>
        <p>Open the same sample and press “Screen this text” — one click runs it back through the production pipeline and mints a fresh ${REPORT_TTL_DAYS}-day evidence URL.</p>
      </span>
      <span class="evr-regen-cta">Reopen the Attack Pack →</span>
    </a>
    <a class="evr-regen-row" href="/demo">
      <span class="evr-regen-num">02</span>
      <span>
        <h2>It was your own text</h2>
        <p>Paste it again at the demo console. The verdict card links the new report the moment screening finishes.</p>
      </span>
      <span class="evr-regen-cta">Open the demo console →</span>
    </a>
  </nav>

  <p class="evr-gone-fine">Same text, same deterministic pattern layer, same evidence — a reissued report is a fresh artifact, not a recovered copy. If the thread needs something that outlives ${REPORT_TTL_DAYS} days, print the live report to PDF before it closes.</p>
</section>`;

  return renderPage({
    title: `Report expired or not found`,
    description: `This screening report link is past its ${REPORT_TTL_DAYS}-day life or was never issued. Re-screen at /attack or /demo to mint a fresh evidence URL.`,
    path: `/report/${knownShape ? id : "unknown"}`,
    content,
    baseUrl,
    jsonLd: [],
    headExtra: `<meta name="robots" content="noindex" />`,
  });
}
