import type {
  ExposureEvaluationResult,
  ExposureSeverity,
  SanitizedExposureFinding,
  SanitizedExposurePayload,
} from "./types.js";
import { createExposureReceiptId, exposureFindingsDigest, exposurePolicyDigest } from "./receipt.js";

const severityRank: Record<ExposureSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  unknown: 0,
};

function highestSeverity(findings: SanitizedExposureFinding[]): ExposureSeverity {
  if (!findings.length) return "info";
  return findings.reduce<ExposureSeverity>((highest, finding) => {
    return severityRank[finding.severity] > severityRank[highest] ? finding.severity : highest;
  }, "unknown");
}

function recommendedActionForFinding(finding: SanitizedExposureFinding): string {
  const subject = [finding.ecosystem, finding.package_name, finding.version].filter(Boolean).join(":") || finding.catalog_name || finding.catalog_id || "the exposed component";
  if (finding.finding_type.includes("mcp")) {
    return `Disable or inspect ${subject}; verify local MCP command/env configuration and rotate credentials if exposure is confirmed.`;
  }
  if (finding.finding_type.includes("extension")) {
    return `Remove or update ${subject}; verify publisher/source and rerun the local exposure scan.`;
  }
  return `Remove or upgrade ${subject}; inspect the referenced lockfile metadata locally and rerun the exposure scan.`;
}

export function evaluateExposurePayload(payload: SanitizedExposurePayload): ExposureEvaluationResult {
  const findingsCount = payload.findings.length;
  const highest = highestSeverity(payload.findings);
  const decision = findingsCount === 0 && payload.policy.allow_on_empty
    ? "allow"
    : payload.policy.block_on.includes(highest)
      ? "block"
      : payload.policy.warn_on.includes(highest)
        ? "warn"
        : severityRank[highest] <= severityRank.low
          ? "allow_with_note"
          : "warn";

  const noun = findingsCount === 1 ? "finding" : "findings";
  const summary = findingsCount === 0
    ? "No endpoint exposure findings were provided."
    : `${findingsCount} ${highest} endpoint exposure ${noun} evaluated.`;

  const recommendedActions = findingsCount === 0
    ? ["Proceed with normal agent runtime policy. Re-run local exposure scans when catalogs or dependencies change."]
    : [
        ...payload.findings.slice(0, 10).map(recommendedActionForFinding),
        ...(decision === "block" ? ["Block sensitive autonomous agent actions until remediation is verified by a clean scan."] : []),
      ];

  return {
    decision,
    severity: highest,
    summary,
    receipt_id: createExposureReceiptId(),
    findings_count: findingsCount,
    highest_severity: highest,
    findings_digest: exposureFindingsDigest(payload),
    policy_digest: exposurePolicyDigest(payload),
    recommended_actions: recommendedActions,
    policy: payload.policy,
  };
}
