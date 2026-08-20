/**
 * The pre-answered vendor security questionnaire — one source, two renderings.
 *
 * This is the third section to be moved here after drifting, and it drifted
 * worst. /trust and docs/trust-package.md each carried a hand-typed copy of all
 * thirty answers, and a fourth-party security review (prospect run 13) found
 * the copies describing a company that does not exist: "all team members
 * complete security awareness training", "quarterly review, departed personnel
 * access revoked within 24 hours", "cloud security groups", "multi-instance
 * failover" — against the DPA's own "Single-operator infrastructure, no shared
 * credentials", two scroll-lengths above on the same page.
 *
 * The reviewer's note is the reason this file exists: the rest of the estate is
 * more candid than most vendors, which is exactly why those answers stood out,
 * and someone who catches one starts re-reading the answers they had already
 * believed. Candour is the asset a wrong answer spends.
 *
 * So: edit an answer here, run `npm run check:trust-sync -- --write`, and both
 * surfaces move together. CI fails if they do not.
 *
 * Answers may interpolate the fact modules — that is the point. A number that
 * appears both here and in a table must come from the same constant.
 */
import { CONTACT_EMAIL } from "./constants.js";
import { SECURITY_FACTS } from "./product-facts.js";
import { RETENTION } from "./retention-facts.js";
import { VALID_ROLES } from "./rbac.js";

export interface QuestionnaireEntry {
  /** Display number, e.g. "1." or "15b." */
  num: string;
  q: string;
  /** HTML. Rendered as-is on /trust and downgraded to markdown for the package. */
  a: string;
}

export interface QuestionnaireGroup {
  title: string;
  qas: QuestionnaireEntry[];
}

export const VENDOR_QUESTIONNAIRE: QuestionnaireGroup[] = [
  {
    title: `General Security (Q1–Q5)`,
    qas: [
      { num: `1.`, q: `Does your organization have an information security policy?`, a: `Partly, and it is worth being exact about which parts. Parse maintains a documented <strong>incident response runbook</strong> and a published <strong>vulnerability disclosure policy</strong> with remediation SLAs by severity. There is no separate, formally reviewed information security policy document. Access control and data protection are implemented and documented on this page rather than in a policy artefact.` },
      { num: `2.`, q: `Does your organization have a designated security officer or CISO?`, a: `There is a designated security contact, reachable at security@parsethis.ai and published in <code>/.well-known/security.txt</code>. Parse is operated by one person, so that contact is the operator rather than a separate officer with an independent reporting line.` },
      { num: `3.`, q: `Does your organization conduct security awareness training?`, a: `Not applicable in the form this question assumes. Parse is operated by one person; there are no other personnel to train. If that changes, this answer changes with it.` },
      { num: `4.`, q: `Are background checks performed on personnel?`, a: `Not applicable. There are no personnel other than the operator, and therefore no one to screen for production access.` },
      { num: `5.`, q: `Does your organization have an incident response plan?`, a: `Yes. Documented incident response plan with defined roles, escalation procedures, and communication protocols. Incidents logged and reviewed post-resolution.` },
    ],
  },
  {
    title: `Access Control (Q6–Q10)`,
    qas: [
      { num: `6.`, q: `Is access to systems and data based on role (RBAC)?`, a: `Yes. RBAC with defined roles (${VALID_ROLES.join(", ")}). Access is enforced at route level by middleware, and org-scoped routes additionally refuse a caller outside the organization that owns the record.` },
      { num: `7.`, q: `Are access rights reviewed periodically?`, a: `Not applicable in the form this question assumes. There are no employee accounts with production access, so there are no access rights to review periodically and no departures to revoke. Customer-facing access is per API key: keys are revocable immediately by their owner (<code>DELETE /v1/keys/self</code>) and self-service keys expire after ${RETENTION.selfServiceKeyExpiryDays} idle days.` },
      { num: `8.`, q: `Are MFA and SSO supported?`, a: `Yes. OAuth 2.0 / OIDC-based SSO (Team + Compliance tiers). MFA enforced for administrative access.` },
      { num: `9.`, q: `Are API keys encrypted at rest?`, a: `Yes. ${SECURITY_FACTS.apiKeyStorage}` },
      { num: `10.`, q: `Is least-privilege access enforced?`, a: `Yes. API keys scoped to organizations and roles. Cross-org access denied at middleware level.` },
    ],
  },
  {
    title: `Data Protection (Q11–Q15)`,
    qas: [
      { num: `11.`, q: `Is data encrypted in transit?`, a: `Yes. ${SECURITY_FACTS.transitTls}. HSTS enforced with max-age=31536000; includeSubDomains.` },
      { num: `12.`, q: `Is data encrypted at rest?`, a: `Secrets are encrypted at rest using AES-256-GCM, and API keys are ${SECURITY_FACTS.apiKeyStorageShort}. The database connection itself uses TLS, which protects data in transit to it rather than on disk — Parse does not claim full-disk or column-level encryption for the Postgres volume.` },
      { num: `13.`, q: `Do you store customer prompt data?`, a: `The screening endpoints (<code>/v1/parse</code>, <code>/v1/screen-output</code>, <code>/v1/agent/trust/verify</code>) do not: the screening event table has no column for prompt text or a hash of it, on every tier. <code>/v1/evaluate</code> does, for the length of the run — on completion the stored copy is overwritten with the first ${RETENTION.evaluatePlaintextPrefixChars} characters plus a SHA-256 of the full prompt, and those characters remain readable. See <a href="#storage">Data Storage</a> for the per-endpoint breakdown.` },
      { num: `14.`, q: `What is your data retention policy?`, a: `Stated retention: screening events ${RETENTION.screeningEventsDays} days, audit events ${RETENTION.auditEventsDays} days, compliance receipts 1 year, API keys until revocation or expiry. A daily purge job deletes records past each window. Rate-limit counters and the in-memory <code>/v1/evaluate</code> records expire automatically. See <a href="#retention">Retention</a>.` },
      { num: `15.`, q: `Do you support customer data deletion requests?`, a: `Yes. Via privacy@parsethis.ai or ${CONTACT_EMAIL}. Completed within ${RETENTION.deletionRequestDays} days.` },
      { num: `15b.`, q: `Does prompt text leave your infrastructure?`, a: `Yes, for the semantic analysis layer: prompt text is sent to OpenRouter for model scoring unless the caller passes <code>mode: "pattern-only"</code>, a pattern already matched at severity 9 or above, or the deployment has no OpenRouter key. Prompt text also reaches OpenRouter and the execution sandbox when the caller opts in with <code>execute: true</code>, which is off by default. See <a href="#data-flow">Where Prompt Text Goes</a>.` },
    ],
  },
  {
    title: `Network Security (Q16–Q20)`,
    qas: [
      { num: `16.`, q: `Is there a firewall or network segmentation?`, a: `Partly, and not by cloud security groups — Parse does not run on a hyperscaler. What is verified: <strong>Postgres and Redis bind to loopback only</strong> and are not routable from outside the host, and the API is published through an <strong>outbound-established Cloudflare tunnel</strong> rather than an inbound port mapping, so reaching Parse does not require an open listener on the host. What Parse does <strong>not</strong> claim: that the host has no other reachable services. It is a general-purpose machine, network exposure depends on the upstream network rather than on Parse, and no host-level firewall policy is asserted here.` },
      { num: `17.`, q: `Is rate limiting implemented?`, a: `Yes. Redis sliding-window with in-memory fallback. Tier-based limits. HTTP 429 with Retry-After.` },
      { num: `18.`, q: `Are security headers enforced?`, a: `Yes. CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy, Permissions-Policy, HSTS on all responses.` },
      { num: `19.`, q: `Is CORS configured securely?`, a: `Yes. Restricted to allowlisted origins via ALLOWED_ORIGINS env var. Unrecognized origins receive no ACAO header.` },
      { num: `20.`, q: `Is input validation enforced?`, a: `Yes. Max body: 1 MB. Max prompt: 100K chars. Strict application/json required for POST.` },
    ],
  },
  {
    title: `Vulnerability Management (Q21–Q24)`,
    qas: [
      { num: `21.`, q: `Are regular vulnerability scans performed?`, a: `Yes. Automated dependency scanning in CI/CD. Critical CVEs tracked with automated remediation.` },
      { num: `22.`, q: `Is there a vulnerability disclosure program?`, a: `Yes. Reports accepted at security@parsethis.ai. 48h acknowledgment SLA, 90h remediation SLA for critical.` },
      { num: `23.`, q: `Are penetration tests performed?`, a: `<strong>No.</strong> No independent penetration test has been performed against Parse. Saying so plainly is more useful to your assessment than a scheduled-basis claim you cannot verify — treat this as an open gap and weigh it against the compensating controls listed on this page. Automated dependency scanning does run on every CI build (<code>npm audit</code>, failing at high severity), and the vulnerability disclosure programme in section 4 is live.` },
      { num: `24.`, q: `Is there a patch management process?`, a: `Yes. Prioritized by severity. Critical patches within 90 hours. Dependency updates automated.` },
    ],
  },
  {
    title: `Logging &amp; Monitoring (Q25–Q28)`,
    qas: [
      { num: `25.`, q: `Are security-relevant events logged?`, a: `Yes. Audit events: auth failures, rate limit breaches, policy changes, screening events, bypass codeword usage. Stored in Postgres + structured logs.` },
      { num: `26.`, q: `Is SIEM integration available?`, a: `Yes. SIEM forwarding via HTTP webhook on Compliance tier. Real-time event forwarding.` },
      { num: `27.`, q: `Are logs retained and protected?`, a: `Yes, in access-controlled, encrypted storage. Stated retention is ${RETENTION.screeningEventsDays} days for screening logs and 1 year for compliance receipts, enforced by a daily purge job — see <a href="#retention">Retention</a>.` },
      { num: `28.`, q: `Is request traceability supported?`, a: `Yes. X-Request-ID on every API response for end-to-end correlation.` },
    ],
  },
  {
    title: `Business Continuity (Q29–Q30)`,
    qas: [
      { num: `29.`, q: `Is there a BCP/DR plan?`, a: `Backups yes; failover no. Parse runs on a <strong>single node</strong> — there is no multi-instance failover, and a hardware failure is an outage rather than a transparent recovery. What does exist: the production database is dumped <strong>every six hours</strong> to external storage, and <strong>every run performs a real restore into a scratch database and compares a row census against the source</strong>, because a backup nobody has restored is a hope rather than a backup. Retention is configured for the 120 most recent snapshots (about 30 days at six-hourly), and the result is checked daily. Retained history is capped by however long the schedule has been running, which is shorter than the policy on a new deployment. That gives a recovery point objective of about six hours. <strong>No recovery time objective is committed</strong>: restoring is a manual operator task. A documented incident response runbook covers the procedure.` },
      { num: `30.`, q: `What is your uptime commitment?`, a: `Parse targets 99.9% and <strong>does not commit to it contractually except on the Compliance and Enterprise tiers</strong>, where a formal SLA is available. Treat the figure as an operating target rather than a guarantee. Measured availability is published on the <a href="/status">status page</a>; liveness is monitored at <code>/health</code>.` },
    ],
  },
];

/** Total questions, so the page's own intro cannot claim a count it does not have. */
export const QUESTIONNAIRE_COUNT = VENDOR_QUESTIONNAIRE.reduce((n, g) => n + g.qas.length, 0);

/** /trust rendering: collapsible groups, first one open. */
export function questionnaireHtml(): string {
  return VENDOR_QUESTIONNAIRE.map(
    (g, i) => `<details${i === 0 ? " open" : ""}>
<summary>${g.title}</summary>
${g.qas
  .map(
    (qa) => `<div class="qa-block">
  <p class="q"><span class="qnum">${qa.num}</span>${qa.q}</p>
  <p class="a">${qa.a}</p>
</div>`
  )
  .join("\n")}
</details>`
  ).join("\n\n");
}

const htmlToMarkdown = (html: string): string =>
  html
    .replace(/<a href="([^"]+)"[^>]*>(.*?)<\/a>/gs, "[$2]($1)")
    .replace(/<strong>/g, "**")
    .replace(/<\/strong>/g, "**")
    .replace(/<code>/g, "`")
    .replace(/<\/code>/g, "`")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** docs/trust-package.md rendering. Generated, never typed. */
export const QUESTIONNAIRE_MARKDOWN = `Pre-answered responses to the ${QUESTIONNAIRE_COUNT} most common vendor security questionnaire questions. These answers can be pasted directly into CAIQ, SIG, or custom vendor security assessment forms.

${VENDOR_QUESTIONNAIRE.map(
  (g) => `### ${g.title.replace(/&amp;/g, "&")}

${g.qas.map((qa) => `**${qa.num} ${htmlToMarkdown(qa.q)}**\n\n${htmlToMarkdown(qa.a)}`).join("\n\n")}`
).join("\n\n")}
`;
