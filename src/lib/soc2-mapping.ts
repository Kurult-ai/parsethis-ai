/**
 * SOC 2 control mapping — one source, two renderings.
 *
 * The fourth section to be moved here after drifting, and the drift was the
 * same shape every time: /trust and docs/trust-package.md each carried a
 * hand-typed copy, and the package's kept a claim the page had already lost.
 * Here it was the Availability row, still reading "Multi-instance deployment,
 * Redis HA fallback" for a service that runs on one Mac Mini.
 *
 * Two deliberate choices about how this reads, both from prospect run 13:
 *
 *  1. The status column is headed **self-assessed**, and says so in every cell.
 *     The reviewer's note was that twelve green ticks against criteria no
 *     auditor has examined land in her file as an audit result, and that the
 *     "In Progress" header above them does not travel with the table when it is
 *     screenshotted or pasted. `✅ Implemented` is a claim about the control
 *     existing, not about anyone having tested it, so it now says which.
 *
 *  2. The Availability row states the real posture. A single node with
 *     six-hourly verified backups is an argument a reviewer will accept; a
 *     single node claiming HA is one they will not, and it makes them re-read
 *     the other twelve rows.
 */

export type ControlStatus = "implemented" | "partial" | "not-implemented";

export interface Soc2Control {
  /** Trust principle. Empty string continues the previous row's principle. */
  principle: string;
  criteria: string;
  control: string;
  status: ControlStatus;
}

const LABEL: Record<ControlStatus, string> = {
  implemented: "✅ Implemented",
  partial: "⚠️ Partial",
  "not-implemented": "❌ Not implemented",
};

export const SOC2_CONTROLS: readonly Soc2Control[] = [
  { principle: "Security (Common Criteria)", criteria: "CC1: Control Environment", control: "Security governance documented; designated security contact. Parse is operated by one person, so that contact is the operator.", status: "implemented" },
  { principle: "", criteria: "CC2: Communication and Information", control: "Security headers endpoint (<code>GET /v1/security/headers</code>), trust page, docs hub, RFC 9116 security.txt", status: "implemented" },
  { principle: "", criteria: "CC3: Risk Assessment", control: "Threat model documented for the prompt injection taxonomy", status: "implemented" },
  { principle: "", criteria: "CC4: Monitoring Activities", control: "Audit logging on security-relevant events; SIEM forwarding on the compliance tier", status: "implemented" },
  { principle: "", criteria: "CC5: Control Activities", control: "RBAC, rate limiting, input validation, policy enforcement", status: "implemented" },
  { principle: "", criteria: "CC6: Logical and Physical Access", control: "Bearer auth, bcrypt-hashed API keys, HSTS, TLS, CORS allowlisting", status: "implemented" },
  { principle: "", criteria: "CC7: System Operations", control: "Structured logging, request tracing (<code>X-Request-ID</code>), graceful shutdown, health checks", status: "implemented" },
  { principle: "", criteria: "CC8: Change Management", control: "Versioned deployments, automated CI/CD, dependency audit on every build, type-safe TypeScript codebase", status: "implemented" },
  { principle: "", criteria: "CC9: Risk Mitigation", control: "Rate limiting, sandbox isolation, SSRF guards, three-layer defence pipeline", status: "implemented" },
  {
    principle: "Availability",
    criteria: "A1: Availability",
    // The row that was false. Kept blunt on purpose.
    control:
      "Single node, no failover. Database backed up every six hours with a verified restore on every run; ~30 days of snapshots retained. Health check endpoints and published availability history. Recovery is a manual operator task with no committed RTO.",
    status: "partial",
  },
  { principle: "Processing Integrity", criteria: "PI1: Processing Integrity", control: "Deterministic scoring, seeded semantic sampling with a verdict cache, nonce-tagged LLM delimiters", status: "implemented" },
  { principle: "Confidentiality", criteria: "C1: Confidentiality", control: "TLS in transit, bcrypt/AES-256 for secrets, no prompt storage on the screening endpoints", status: "implemented" },
  { principle: "Privacy", criteria: "P1–P8: Privacy", control: "Documented retention enforced by a daily purge job, data governance module, approval matrix", status: "implemented" },
] as const;

/**
 * The sentence that has to sit next to the table wherever it appears. The
 * header said "In Progress" and the table said ✅ thirteen times; only one of
 * those survives a screenshot.
 */
export const SOC2_SELF_ASSESSMENT_NOTE =
  "No auditor has examined these controls. The column records whether Parse has implemented "
  + "the control, self-assessed, and is not an audit result — SOC 2 Type II is in progress with "
  + "an expected completion of Q1 2027, and there is no independent penetration test.";

export function soc2TableHtml(): string {
  let lastPrinciple = "";
  const rows = SOC2_CONTROLS.map((c) => {
    const isNew = c.principle !== "" && c.principle !== lastPrinciple;
    if (isNew) lastPrinciple = c.principle;
    const span = isNew
      ? SOC2_CONTROLS.filter((x, i) => i >= SOC2_CONTROLS.indexOf(c) && (x.principle === "" || x === c)).length
      : 0;
    const head = isNew
      ? `<td rowspan="${span}"><strong>${c.principle}</strong></td>`
      : "";
    return `      <tr>${head}<td>${c.criteria}</td><td>${c.control}</td><td>${LABEL[c.status]}</td></tr>`;
  }).join("\n");

  return `<div class="table-wrapper">
  <table>
    <thead><tr><th>SOC 2 Trust Principle</th><th>Criteria</th><th>Parse Control</th><th>Implemented (self-assessed)</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>
<p style="font-size:14px;color:var(--text-dim)">${SOC2_SELF_ASSESSMENT_NOTE}</p>`;
}

const stripTags = (s: string): string => s.replace(/<code>/g, "`").replace(/<\/code>/g, "`").replace(/<[^>]+>/g, "");

export const SOC2_MAPPING_MARKDOWN = `| SOC 2 Trust Principle | SOC 2 Criteria | Parse Control | Implemented (self-assessed) |
|---|---|---|---|
${SOC2_CONTROLS.map(
  (c) => `| ${c.principle ? `**${c.principle}**` : ""} | ${c.criteria} | ${stripTags(c.control)} | ${LABEL[c.status]} |`
).join("\n")}

${SOC2_SELF_ASSESSMENT_NOTE}
`;
