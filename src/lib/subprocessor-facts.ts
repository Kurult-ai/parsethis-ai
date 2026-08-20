/**
 * Sub-processor facts — one source of truth for who Parse sends data to, where
 * they are, and whether they see prompt text.
 *
 * This file exists for the same reason src/lib/retention-facts.ts does, and it
 * is the second half of the same lesson. Retention was moved here after two
 * hand-maintained copies contradicted each other; the sub-processor table, one
 * section further down the very same documents, was left as three copies —
 * /trust, /dpa and docs/trust-package.md — and drifted exactly as far as you
 * would expect:
 *
 *   - /trust and /dpa said Postgres and Redis are self-hosted on a Mac Mini in
 *     the US, and the DPA's transfer impact assessment said "not AWS/GCP/Azure"
 *     in those words.
 *   - docs/trust-package.md — the document Parse hands to reviewers for their
 *     vendor risk assessment — said "Cloud infrastructure is hosted on standard
 *     cloud providers", omitted Cloudflare entirely, and had no location column
 *     at all.
 *
 * A fourth-party security review (prospect run 13, 2026-08-14) scored that as a
 * contradiction rather than a gap, which is worse: a reviewer who finds two
 * vendor-controlled documents disagreeing cannot cite either one, and starts
 * re-reading the answers they had already believed.
 *
 * So: add a sub-processor here and nowhere else. `npm run check:trust-sync`
 * fails the build if docs/trust-package.md drifts from this file.
 *
 * The `location` field is not decoration. A customer in a regulated sector has
 * to enter it in a register of ICT providers, and it is the field the trust
 * package silently dropped.
 *
 * Verified against:
 *   - src/parse.ts — the semantic layer calls OpenRouter unless the caller
 *     passes `mode: "pattern-only"`, a pattern hit at severity >= 9 settles the
 *     verdict, or no OpenRouter key is configured.
 *   - CLAUDE.md "Deployment (production)" — served by launchd on the Mac Mini
 *     behind the kublai-mac-mini cloudflared tunnel.
 *   - src/stripe.ts — Stripe holds subscription and payment metadata; card
 *     details go to Stripe directly and never reach Parse.
 */

export interface Subprocessor {
  /** Legal/product name as a customer would enter it in their own register. */
  name: string;
  /** What it does for Parse, in the customer's terms rather than ours. */
  purpose: string;
  /** Where the processing happens. Required — a register row without it is unusable. */
  location: string;
  /** Whether prompt text reaches it, and under what condition. */
  seesPromptText: string;
  /** Transfer mechanism or why none is needed. */
  adequacy: string;
}

/**
 * The list. Order is stable so the rendered tables and the generated markdown
 * do not churn between commits.
 */
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: "OpenRouter",
    purpose:
      "Routes the semantic analysis layer (Layer 2) to a model provider, and runs the prompt when execute: true",
    location: "US",
    seesPromptText: "Only in full mode",
    adequacy: "SCCs",
  },
  {
    name: "Cloudflare",
    purpose: "CDN, tunnel, DDoS protection",
    location: "Global edge",
    seesPromptText: "No",
    adequacy: "SCCs + CISPE",
  },
  {
    name: "Stripe",
    purpose: "Subscription billing",
    location: "US / Ireland",
    seesPromptText: "No",
    adequacy: "SCCs + PCI-DSS",
  },
  {
    name: "PostgreSQL (self-hosted)",
    purpose: "Screening event storage",
    location: "US (Mac Mini M4)",
    seesPromptText: "Metadata only",
    adequacy: "N/A (self-hosted)",
  },
  {
    name: "Redis (self-hosted)",
    purpose: "Rate limiting, caching, queues",
    location: "US (Mac Mini M4)",
    seesPromptText: "No",
    adequacy: "N/A (self-hosted)",
  },
] as const;

/** Days of notice before a new sub-processor starts processing. */
export const SUBPROCESSOR_NOTICE_DAYS = 30;

/**
 * Which model actually receives prompt text.
 *
 * "OpenRouter routes the semantic analysis layer to a model provider" was true
 * and useless: OpenRouter is a router, so naming it tells a customer who to
 * invoice, not whose infrastructure their text reaches. A fourth-party reviewer
 * (prospect run 13) could not enumerate her own fifth parties from it, and that
 * was one of the blockers that stopped the review.
 *
 * Resolution order mirrors the code that picks the model — `ANALYSIS_MODEL`
 * first (`src/routes/../parse.ts` reads its first comma-separated entry), then
 * the client default in `src/model-client.ts:9`. Read at render time, so the
 * page states what this deployment actually routes to rather than what someone
 * typed into a page once.
 */
export function semanticModelId(): string {
  const analysis = (process.env.ANALYSIS_MODEL || "").split(",")[0]?.trim();
  return analysis || process.env.DEFAULT_MODEL || "deepseek/deepseek-chat";
}

/**
 * The disclosure paragraph. Deliberately states the limit as well as the name:
 * OpenRouter can serve one model id from more than one upstream host, and Parse
 * does not pin the upstream provider today, so naming the model is honest and
 * naming a single company would not be.
 */
export function modelRoutingNote(): string {
  const model = semanticModelId();
  return (
    `<strong>Which model receives prompt text.</strong> When the semantic layer runs, OpenRouter ` +
    `routes the request to <code>${model.replace(/</g, "&lt;")}</code>. OpenRouter can serve a given ` +
    `model from more than one upstream host and Parse does not pin the upstream provider, so the ` +
    `company operating the hardware for a particular request is not fixed — the model is named here ` +
    `because it is the part Parse controls and can state truthfully. What that provider retains or ` +
    `trains on is governed by their policy and OpenRouter's, not by Parse's DPA. Passing ` +
    `<code>mode: "pattern-only"</code>, per request or as an organization default, means the ` +
    `semantic layer does not run and no model receives the text at all.`
  );
}

/**
 * The paragraph that has to travel with the table, because the table on its own
 * invites the wrong conclusion: pattern-only stops the onward transfer to
 * OpenRouter, and does *not* stop the transfer to Parse in the United States.
 * Saying only the first half is how a residency claim goes wrong.
 */
export const SUBPROCESSOR_CONTROL_NOTE =
  `Any caller on any tier can keep prompt text away from OpenRouter by passing ` +
  `<code>mode: "pattern-only"</code> per request, which runs Layer 1 only. Organizations can also ` +
  `make this the default for every request by setting <code>defaultMode</code> to ` +
  `<code>pattern-only</code> on their screening policy (<code>PUT /v1/policy</code>), so the ` +
  `control does not have to be repeated per call. Prompt text still reaches Parse in the United ` +
  `States in either case — pattern-only prevents the onward transfer to OpenRouter, not the ` +
  `transfer to Parse. <strong>GDPR Art. 28(4) flow-down:</strong> Parse imposes the obligations of ` +
  `this DPA on each sub-processor in substance; see the flow-down clause beside the table above. ` +
  `New subprocessors are announced ${SUBPROCESSOR_NOTICE_DAYS} days in advance.`;

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * `execute: true` and `defaultMode` read better as code in HTML. The source
 * strings stay plain so the markdown mirror can wrap them in backticks instead.
 */
const withInlineCode = (value: string): string =>
  escapeHtml(value).replace(/execute: true/g, "<code>execute: true</code>");

/**
 * HTML table. Both /trust and /dpa render this — they used to carry their own
 * copies with different column values for the same row.
 *
 * @param heading label for the first column: "Subprocessor" on /trust,
 *        "Sub-processor" on /dpa. The pages spell it differently and that is
 *        not worth a migration.
 */
export function subprocessorTableHtml(heading = "Subprocessor"): string {
  const rows = SUBPROCESSORS.map(
    (s) =>
      `      <tr><td>${escapeHtml(s.name)}</td><td>${withInlineCode(s.purpose)}</td>` +
      `<td>${escapeHtml(s.location)}</td><td>${escapeHtml(s.seesPromptText)}</td>` +
      `<td>${escapeHtml(s.adequacy)}</td></tr>`
  ).join("\n");

  return `<div class="table-wrapper">
  <table>
    <thead><tr><th>${escapeHtml(heading)}</th><th>Purpose</th><th>Location</th><th>Sees prompt text?</th><th>GDPR adequacy</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/** Markdown mirror, for docs/trust-package.md parity. Generated, never typed. */
export const SUBPROCESSOR_FACTS_MARKDOWN = `Parse uses few third-party services. One of them receives prompt text.

| Subprocessor | Purpose | Location | Sees prompt text? | GDPR adequacy |
|---|---|---|---|---|
${SUBPROCESSORS.map(
  (s) =>
    `| **${s.name}** | ${s.purpose.replace(/execute: true/g, "`execute: true`")} | ${s.location} | ${s.seesPromptText} | ${s.adequacy} |`
).join("\n")}

Any caller on any tier can keep prompt text away from OpenRouter by passing \`mode: "pattern-only"\` per request, which runs Layer 1 only. Organizations can also make this the default for every request by setting \`defaultMode\` to \`pattern-only\` on their screening policy (\`PUT /v1/policy\`), so the control does not have to be repeated per call. Prompt text still reaches Parse in the United States in either case — pattern-only prevents the onward transfer to OpenRouter, not the transfer to Parse.

New subprocessors are announced ${SUBPROCESSOR_NOTICE_DAYS} days in advance at security@parsethis.ai.

${modelRoutingNote().replace(/<strong>/g, "**").replace(/<\/strong>/g, "**").replace(/<code>/g, "`").replace(/<\/code>/g, "`").replace(/&lt;/g, "<")}
`;
