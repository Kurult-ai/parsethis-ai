import { readFile } from "node:fs/promises";
import {
  INTERNAL_ADVERSARIAL_EVIDENCE_NOTE,
  auditCoverage,
  auditPromptBlindness,
  normalizeReportRows,
  summarize,
  type ResultRow,
} from "../src/lib/hermes-playground-report.js";

type ReportFile = {
  session_id?: string;
  base_url?: string;
  generated_at?: string;
  evidence_note?: string;
  rows?: ResultRow[];
};

function usage(): never {
  console.error("Usage: npm run audit:hermes-playground-report -- PATH_TO_REPORT.json [--require-primary|--require-complete]");
  process.exit(2);
}

const args = process.argv.slice(2);
const reportPath = args.find((arg) => !arg.startsWith("--"));
const requirePrimary = args.includes("--require-primary") || args.includes("--require-complete");
const requireSecondary = args.includes("--require-complete");
if (!reportPath || reportPath === "--help" || reportPath === "-h") usage();

const raw = await readFile(reportPath, "utf8");
const report = JSON.parse(raw) as ReportFile;
if (!Array.isArray(report.rows)) {
  throw new Error("Report JSON must include a rows array.");
}

const rows = normalizeReportRows(report.rows);
const totals = summarize(rows);
const promptBlindness = auditPromptBlindness();
const audit = auditCoverage(rows, { requireSecondary, checkPromptBlindness: true });

console.log(JSON.stringify({
  report: reportPath,
  session_id: report.session_id || "",
  base_url: report.base_url || "",
  generated_at: report.generated_at || "",
  evidence_note: report.evidence_note || INTERNAL_ADVERSARIAL_EVIDENCE_NOTE,
  totals: {
    total: totals.total,
    errors: totals.errors,
    safe_overblocked: totals.safe_overblocked,
    conversation_failed: totals.conversation_failed,
    conversation_warning: totals.conversation_warning,
  },
  strict_status: {
    checked: requirePrimary,
    ok: requirePrimary ? audit.ok : null,
    blockers: requirePrimary ? audit.blockers : [],
  },
  primary_conversation: totals.goal_coverage.primary_conversation,
  secondary_fixtures: totals.goal_coverage.secondary_fixtures,
  hard_guardrails: totals.goal_coverage.hard_guardrails,
  prompt_blindness: {
    ok: promptBlindness.ok,
    checked_texts: promptBlindness.checked_texts,
    leaks: promptBlindness.leaks,
  },
  family_totals: totals.family_totals,
}, null, 2));

if (requirePrimary && !audit.ok) process.exit(1);
