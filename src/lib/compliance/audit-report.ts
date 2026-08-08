/**
 * Audit Report Generator — transforms screening results into a branded,
 * self-contained HTML report for the $47 self-serve audit product.
 *
 * Sections:
 *  1. Risk score summary (0-100 scale)
 *  2. Vulnerability breakdown by category
 *  3. Remediation checklist (actionable items)
 *  4. Compliance framework mapping (OWASP, NIST, SOC 2)
 *  5. Call-to-action for higher-tier plans
 */

import type { ParseResponse, RiskFlag } from "../../parse.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuditReportInput {
  /** The original prompts that were screened */
  prompts: Array<{
    text: string;
    label?: string;
    parseResponse: ParseResponse;
  }>;
  /** Customer name or organization */
  customerName?: string;
  /** When the audit was run */
  auditedAt?: string;
  /** Base URL for branding/links */
  baseUrl?: string;
}

interface VulnerabilityBreakdown {
  category: string;
  count: number;
  maxSeverity: number;
  flags: RiskFlag[];
}

interface ComplianceMapping {
  framework: string;
  control: string;
  description: string;
  status: "pass" | "warn" | "fail";
}

// ── Risk category display names ─────────────────────────────────────────────

const CATEGORY_DISPLAY: Record<string, string> = {
  prompt_injection: "Prompt Injection",
  jailbreak: "Jailbreak Attempt",
  data_exfiltration: "Data Exfiltration",
  harmful_content: "Harmful Content",
  system_prompt_leak: "System Prompt Leak",
  social_engineering: "Social Engineering",
  code_execution: "Code Execution",
  indirect_injection: "Indirect Injection",
  privilege_escalation: "Privilege Escalation",
};

const COMPLIANCE_FRAMEWORKS: Array<{
  framework: string;
  controls: Array<{ id: string; description: string; riskCategories: string[] }>;
}> = [
  {
    framework: "OWASP LLM Top 10",
    controls: [
      { id: "LLM01", description: "Prompt Injection", riskCategories: ["prompt_injection", "indirect_injection"] },
      { id: "LLM02", description: "Insecure Output Handling", riskCategories: ["code_execution", "harmful_content"] },
      { id: "LLM06", description: "Sensitive Information Disclosure", riskCategories: ["data_exfiltration", "system_prompt_leak"] },
    ],
  },
  {
    framework: "NIST AI RMF",
    controls: [
      { id: "MS.1.1", description: "Characterize and manage risk for third-party data and content", riskCategories: ["prompt_injection", "indirect_injection"] },
      { id: "MS.2.9", description: "Track and manage data, content, and model outputs", riskCategories: ["harmful_content", "code_execution"] },
      { id: "MS.3.2", description: "Protect against unauthorized access to sensitive data", riskCategories: ["data_exfiltration", "system_prompt_leak"] },
    ],
  },
  {
    framework: "SOC 2",
    controls: [
      { id: "CC6.1", description: "Logical access controls for sensitive data", riskCategories: ["data_exfiltration", "system_prompt_leak", "privilege_escalation"] },
      { id: "CC7.1", description: "Detection and monitoring of security events", riskCategories: ["prompt_injection", "jailbreak", "social_engineering"] },
    ],
  },
];

// ── Computation helpers ────────────────────────────────────────────────────

function computeRiskScore(responses: ParseResponse[]): number {
  if (responses.length === 0) return 0;
  const avgScore = responses.reduce((sum, r) => sum + r.risk_score, 0) / responses.length;
  const maxScore = Math.max(...responses.map((r) => r.risk_score));
  // Weighted: 60% max, 40% average → emphasizes worst case
  const blended = maxScore * 0.6 + avgScore * 0.4;
  // Scale 0-10 → 0-100
  return Math.round(blended * 10);
}

function computeVulnerabilityBreakdown(responses: ParseResponse[]): VulnerabilityBreakdown[] {
  const allFlags = responses.flatMap((r) => r.flags);
  const byCategory = new Map<string, RiskFlag[]>();

  for (const flag of allFlags) {
    const existing = byCategory.get(flag.category) ?? [];
    existing.push(flag);
    byCategory.set(flag.category, existing);
  }

  return Array.from(byCategory.entries())
    .map(([category, flags]) => ({
      category,
      count: flags.length,
      maxSeverity: Math.max(...flags.map((f) => f.severity)),
      flags: flags.sort((a, b) => b.severity - a.severity),
    }))
    .sort((a, b) => b.maxSeverity - a.maxSeverity);
}

function computeComplianceMapping(breakdown: VulnerabilityBreakdown[]): ComplianceMapping[] {
  const hitCategories = new Set(breakdown.map((b) => b.category));
  const mappings: ComplianceMapping[] = [];

  for (const framework of COMPLIANCE_FRAMEWORKS) {
    for (const control of framework.controls) {
      const hasRisk = control.riskCategories.some((c) => hitCategories.has(c));
      mappings.push({
        framework: framework.framework,
        control: control.id,
        description: control.description,
        status: hasRisk ? "fail" : "pass",
      });
    }
  }

  return mappings;
}

function generateRemediationChecklist(breakdown: VulnerabilityBreakdown[]): Array<{ item: string; category: string; priority: "critical" | "high" | "medium" | "low" }> {
  const checklist: Array<{ item: string; category: string; priority: "critical" | "high" | "medium" | "low" }> = [];

  for (const vuln of breakdown) {
    const priority = vuln.maxSeverity >= 8 ? "critical" : vuln.maxSeverity >= 6 ? "high" : vuln.maxSeverity >= 4 ? "medium" : "low";

    switch (vuln.category) {
      case "prompt_injection":
      case "indirect_injection":
        checklist.push({
          item: "Deploy Parse prompt screening on all untrusted input boundaries before the agent LLM processes them.",
          category: vuln.category,
          priority,
        });
        checklist.push({
          item: "Validate and sanitize retrieved/RAG content before injecting into agent context windows.",
          category: vuln.category,
          priority,
        });
        break;
      case "data_exfiltration":
        checklist.push({
          item: "Implement egress filtering to block callback URLs and exfiltration channels from agent outputs.",
          category: vuln.category,
          priority,
        });
        break;
      case "system_prompt_leak":
        checklist.push({
          item: "Add output screening to detect and block system prompt reflections before they reach users.",
          category: vuln.category,
          priority,
        });
        break;
      case "code_execution":
        checklist.push({
          item: "Restrict tool permissions and sandbox all code execution paths with least-privilege controls.",
          category: vuln.category,
          priority,
        });
        break;
      case "jailbreak":
        checklist.push({
          item: "Enable pattern-based jailbreak detection and LLM semantic analysis on every agent input.",
          category: vuln.category,
          priority,
        });
        break;
      case "social_engineering":
        checklist.push({
          item: "Train agents to recognize urgency, authority impersonation, and phishing patterns.",
          category: vuln.category,
          priority,
        });
        break;
      case "privilege_escalation":
        checklist.push({
          item: "Enforce strict role-based access control (RBAC) on agent tool invocations and data access.",
          category: vuln.category,
          priority,
        });
        break;
      default:
        checklist.push({
          item: `Review and remediate ${CATEGORY_DISPLAY[vuln.category] ?? vuln.category} vulnerabilities detected in screening.`,
          category: vuln.category,
          priority,
        });
    }
  }

  return checklist.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.priority] - order[b.priority];
  });
}

function riskScoreBand(score: number): { label: string; color: string; bgColor: string } {
  if (score >= 80) return { label: "Critical Risk", color: "#dc2626", bgColor: "#fef2f2" };
  if (score >= 60) return { label: "High Risk", color: "#ea580c", bgColor: "#fff7ed" };
  if (score >= 40) return { label: "Medium Risk", color: "#ca8a04", bgColor: "#fefce8" };
  if (score >= 20) return { label: "Low Risk", color: "#16a34a", bgColor: "#f0fdf4" };
  return { label: "Minimal Risk", color: "#15803d", bgColor: "#f0fdf4" };
}

// ── Main report generator ──────────────────────────────────────────────────

export function generateAuditReport(input: AuditReportInput): string {
  const responses = input.prompts.map((p) => p.parseResponse);
  const riskScore = computeRiskScore(responses);
  const band = riskScoreBand(riskScore);
  const breakdown = computeVulnerabilityBreakdown(responses);
  const compliance = computeComplianceMapping(breakdown);
  const checklist = generateRemediationChecklist(breakdown);
  const auditedAt = input.auditedAt ?? new Date().toISOString();
  const baseUrl = input.baseUrl ?? "https://www.parsethis.ai";
  const totalFlags = responses.reduce((sum, r) => sum + r.flags.length, 0);
  const promptsBlocked = responses.filter((r) => r.risk_score >= 7).length;

  // ── HTML ──
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parse Security Audit Report — ${escapeHtml(input.customerName ?? "Organization")}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      line-height: 1.6;
      padding: 24px;
    }
    .report {
      max-width: 900px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .report-header {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%);
      color: #fff;
      padding: 36px 40px;
    }
    .report-header .logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 8px;
    }
    .report-header h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .report-header .meta {
      font-size: 14px;
      opacity: 0.8;
      margin-top: 12px;
    }
    .report-body { padding: 36px 40px; }
    .section { margin-bottom: 36px; }
    .section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e2e8f0;
    }
    /* Risk score */
    .score-card {
      display: flex;
      align-items: center;
      gap: 24px;
      background: ${band.bgColor};
      border: 2px solid ${band.color};
      border-radius: 10px;
      padding: 28px 32px;
    }
    .score-number {
      font-size: 56px;
      font-weight: 800;
      color: ${band.color};
      line-height: 1;
    }
    .score-label {
      font-size: 18px;
      font-weight: 600;
      color: ${band.color};
      margin-bottom: 4px;
    }
    .score-detail { font-size: 14px; color: #475569; }
    /* Stats grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-top: 16px;
    }
    .stat-tile {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .stat-tile .value { font-size: 28px; font-weight: 700; color: #0f172a; }
    .stat-tile .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    /* Vulnerability table */
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    th { font-weight: 600; color: #475569; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; background: #f8fafc; }
    .severity-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .sev-critical { background: #fef2f2; color: #dc2626; }
    .sev-high { background: #fff7ed; color: #ea580c; }
    .sev-medium { background: #fefce8; color: #ca8a04; }
    .sev-low { background: #f0fdf4; color: #16a34a; }
    /* Remediation */
    .checklist { list-style: none; padding: 0; }
    .checklist li {
      padding: 14px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 8px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }
    .checklist .checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #cbd5e1;
      border-radius: 4px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .checklist .item-text { flex: 1; font-size: 14px; }
    .checklist .item-priority { flex-shrink: 0; }
    /* Compliance */
    .compliance-pass { color: #16a34a; font-weight: 600; }
    .compliance-fail { color: #dc2626; font-weight: 600; }
    .compliance-warn { color: #ca8a04; font-weight: 600; }
    /* CTA */
    .cta-box {
      background: linear-gradient(135deg, #1e3a5f 0%, #2d6a9f 100%);
      color: #fff;
      border-radius: 10px;
      padding: 32px 36px;
      text-align: center;
    }
    .cta-box h3 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .cta-box p { font-size: 15px; opacity: 0.9; margin-bottom: 20px; }
    .cta-btn {
      display: inline-block;
      background: #fff;
      color: #1e3a5f;
      padding: 12px 32px;
      border-radius: 8px;
      font-weight: 700;
      text-decoration: none;
      font-size: 16px;
    }
    .report-footer {
      padding: 20px 40px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
    @media (max-width: 640px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .score-card { flex-direction: column; text-align: center; }
    }
  </style>
</head>
<body>
<div class="report">
  <div class="report-header">
    <div class="logo">🔒 Parse</div>
    <h1>AI Agent Security Audit Report</h1>
    <div class="meta">
      Prepared for: <strong>${escapeHtml(input.customerName ?? "Organization")}</strong><br>
      Date: ${new Date(auditedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}<br>
      Prompts screened: ${responses.length}
    </div>
  </div>

  <div class="report-body">

    <!-- Section 1: Risk Score Summary -->
    <div class="section">
      <h2>1. Risk Score Summary</h2>
      <div class="score-card">
        <div class="score-number">${riskScore}</div>
        <div>
          <div class="score-label">${band.label}</div>
          <div class="score-detail">
            Overall risk score on a 0–100 scale. Scores above 60 indicate significant
            exposure to prompt injection, data exfiltration, or other AI agent attack vectors.
          </div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-tile">
          <div class="value">${responses.length}</div>
          <div class="label">Prompts Screened</div>
        </div>
        <div class="stat-tile">
          <div class="value">${totalFlags}</div>
          <div class="label">Vulnerabilities</div>
        </div>
        <div class="stat-tile">
          <div class="value">${promptsBlocked}</div>
          <div class="label">High-Risk Prompts</div>
        </div>
        <div class="stat-tile">
          <div class="value">${breakdown.length}</div>
          <div class="label">Risk Categories Hit</div>
        </div>
      </div>
    </div>

    <!-- Section 2: Vulnerability Breakdown -->
    <div class="section">
      <h2>2. Vulnerability Breakdown</h2>
      ${breakdown.length === 0
        ? `<p style="color:#16a34a;font-size:15px;">✅ No vulnerabilities detected. All screened prompts passed the security screening pipeline.</p>`
        : `<table>
        <thead>
          <tr>
            <th>Category</th>
            <th>Findings</th>
            <th>Max Severity</th>
            <th>Top Finding</th>
          </tr>
        </thead>
        <tbody>
        ${breakdown
          .map((v) => {
            const sevClass = v.maxSeverity >= 8 ? "sev-critical" : v.maxSeverity >= 6 ? "sev-high" : v.maxSeverity >= 4 ? "sev-medium" : "sev-low";
            const sevLabel = v.maxSeverity >= 8 ? "Critical" : v.maxSeverity >= 6 ? "High" : v.maxSeverity >= 4 ? "Medium" : "Low";
            const topFlag = v.flags[0];
            return `<tr>
              <td><strong>${CATEGORY_DISPLAY[v.category] ?? v.category}</strong></td>
              <td>${v.count}</td>
              <td><span class="severity-badge ${sevClass}">${sevLabel} (${v.maxSeverity}/10)</span></td>
              <td>${escapeHtml(truncate(topFlag?.label ?? "—", 60))}</td>
            </tr>`;
          })
          .join("\n        ")}
        </tbody>
      </table>`
      }
    </div>

    <!-- Section 3: Remediation Checklist -->
    <div class="section">
      <h2>3. Remediation Checklist</h2>
      ${checklist.length === 0
        ? `<p style="color:#16a34a;font-size:15px;">✅ No remediation actions required based on this screening.</p>`
        : `<ul class="checklist">
        ${checklist
          .map((item) => {
            const sevClass = item.priority === "critical" ? "sev-critical" : item.priority === "high" ? "sev-high" : item.priority === "medium" ? "sev-medium" : "sev-low";
            const sevLabel = item.priority.charAt(0).toUpperCase() + item.priority.slice(1);
            return `<li>
              <div class="checkbox"></div>
              <div class="item-text">${escapeHtml(item.item)}</div>
              <div class="item-priority"><span class="severity-badge ${sevClass}">${sevLabel}</span></div>
            </li>`;
          })
          .join("\n        ")}
      </ul>`
      }
    </div>

    <!-- Section 4: Compliance Framework Mapping -->
    <div class="section">
      <h2>4. Compliance Framework Mapping</h2>
      <table>
        <thead>
          <tr>
            <th>Framework</th>
            <th>Control</th>
            <th>Description</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
        ${compliance
          .map((c) => {
            const statusClass = c.status === "pass" ? "compliance-pass" : c.status === "warn" ? "compliance-warn" : "compliance-fail";
            const statusIcon = c.status === "pass" ? "✅ Pass" : c.status === "warn" ? "⚠️ Review" : "❌ Fail";
            return `<tr>
              <td>${c.framework}</td>
              <td><strong>${c.control}</strong></td>
              <td>${escapeHtml(c.description)}</td>
              <td class="${statusClass}">${statusIcon}</td>
            </tr>`;
          })
          .join("\n        ")}
        </tbody>
      </table>
    </div>

    <!-- Section 5: Call to Action -->
    <div class="section">
      <div class="cta-box">
        <h3>Ready to close your security gaps?</h3>
        <p>Upgrade to a Parse Compliance plan for continuous screening, SIEM forwarding, evidence packs,
        and custom policy enforcement across all your AI agents.</p>
        <a href="${baseUrl}/pricing" class="cta-btn">Explore Plans →</a>
      </div>
    </div>

  </div>

  <div class="report-footer">
    Generated by Parse Security Audit · ${new Date(auditedAt).toISOString()}<br>
    This report is based on automated screening and does not constitute a formal security certification.
  </div>
</div>
</body>
</html>`;
}

// ── Utils ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
