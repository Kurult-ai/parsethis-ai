/**
 * Retention facts — one source of truth for what Parse stores, for how long,
 * and where prompt text travels.
 *
 * /privacy and /trust used to answer these questions differently, and neither
 * matched the code. Both pages now render the fragments below, so the numbers
 * cannot drift apart again. docs/trust-package.md carries the same figures.
 *
 * Every claim here was checked against the code. Keep it that way — if you
 * change storage behaviour, change this file in the same commit.
 *
 * Verified against:
 *   - prisma/schema.prisma — `ScreeningEvent` has no prompt column; `AuditEvent`
 *     stores an `action`, a JSON detail blob, and the caller IP; `ComplianceReceipt`
 *     stores verdict metadata and a hash chain.
 *   - src/lib/screening-event-log.ts — the persisted metadata object is a fixed
 *     list of verdict and label fields; no prompt text, no prompt hash.
 *   - src/lib/audit-log.ts (buildAuditDetail) — records `promptLength` as a
 *     number, never the prompt.
 *   - src/routes/evaluate.ts — evaluations live in an in-process Map capped at
 *     500 entries; `redactPrompt` overwrites the prompt on completion.
 *   - src/lib/prompt-privacy.ts — redaction keeps the first 100 characters
 *     verbatim plus a SHA-256 of the whole prompt.
 *   - src/parse.ts — the semantic layer calls OpenRouter unless
 *     `mode: "pattern-only"`, a pattern hit at severity >= 9 already settles the
 *     verdict, or no OpenRouter key is configured.
 *   - No scheduled deletion job exists anywhere in src/ or scripts/.
 */

/** Retention figures quoted in prose elsewhere. Keep in sync with the tables. */
export const RETENTION = {
  screeningEventsDays: 90,
  auditEventsDays: 90,
  complianceReceiptsDays: 365,
  evaluateInMemoryRecords: 500,
  evaluatePlaintextPrefixChars: 100,
  selfServiceKeyExpiryDays: 30,
  deletionRequestDays: 30,
} as const;

/**
 * Section 1 — what each endpoint writes down. HTML fragment, no wrapper
 * heading, so each page can title it in its own voice.
 */
export const STORAGE_BY_ENDPOINT_HTML = `
<p>Storage does not vary by plan. Free, Pro, Team, and Compliance keys are handled
identically — the tier changes rate limits, cost caps, and which fields come back
in the response, not what Parse writes down.</p>

<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Endpoint</th><th>Is your prompt text stored?</th><th>What Parse records</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><code>POST /v1/parse</code>, <code>POST /v1/screen-output</code>, <code>POST /v1/agent/trust/verify</code></td>
        <td><strong>No.</strong> The screening event table has no column for prompt or output text, and none for a hash of it.</td>
        <td>Risk score, verdict, categories, screening mode, latency, blocked flag, enforcement mode, request ID, matched rule IDs, the metadata labels you send (<code>source_kind</code>, <code>trust_level</code>, <code>intended_action</code>), API key ID, timestamp.</td>
      </tr>
      <tr>
        <td><code>POST /v1/evaluate</code></td>
        <td><strong>Yes, while the run is in flight.</strong> When the evaluation ends, successfully or not, Parse overwrites its copy with the first ${RETENTION.evaluatePlaintextPrefixChars} characters of your prompt plus a SHA-256 of the whole prompt. Those first ${RETENTION.evaluatePlaintextPrefixChars} characters stay readable.</td>
        <td>Evaluation results, model name, token counts, cost, and the redacted prompt described to the left.</td>
      </tr>
      <tr>
        <td>Audit log (written by every screened call)</td>
        <td><strong>No.</strong> The prompt's length is recorded as a number; the text is not.</td>
        <td>Action, API key ID, risk score, verdict, prompt length, categories, rule IDs, request ID, and the caller's IP address.</td>
      </tr>
      <tr>
        <td>Compliance receipts</td>
        <td><strong>No.</strong></td>
        <td>Verdict, risk score, matched rule IDs, agent ID, policy version, and the receipt hash chain.</td>
      </tr>
      <tr>
        <td>API keys</td>
        <td>Not applicable</td>
        <td>A bcrypt hash plus a lookup prefix. The full key is never written down; it is shown once at generation.</td>
      </tr>
    </tbody>
  </table>
</div>
`;

/**
 * Section 2 — how long records live, and whether anything enforces that. The
 * second column says how each window is enforced, so the claim and the
 * mechanism are read together.
 */
export const RETENTION_TABLE_HTML = `
<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Record</th><th>Stated retention</th><th>How it is enforced today</th></tr>
    </thead>
    <tbody>
      <tr><td>Screening events</td><td>${RETENTION.screeningEventsDays} days</td><td>Automatic. A daily job deletes records past the window.</td></tr>
      <tr><td>Audit events, including the caller IP</td><td>${RETENTION.auditEventsDays} days</td><td>Automatic, as above.</td></tr>
      <tr><td>Compliance receipts</td><td>1 year, fixed so the hash chain stays verifiable</td><td>Automatic, as above.</td></tr>
      <tr><td>Redacted <code>/v1/evaluate</code> records</td><td>The ${RETENTION.evaluateInMemoryRecords} most recent, then dropped</td><td>Automatic. They are held in the server's memory, so a restart clears them.</td></tr>
      <tr><td>Rate-limit counters in Redis</td><td>The length of the rate-limit window</td><td>Automatic, via Redis key expiry.</td></tr>
      <tr><td>API keys</td><td>Until revoked, or the expiry set when the key was made (${RETENTION.selfServiceKeyExpiryDays} days by default for self-service keys)</td><td>Automatic on expiry.</td></tr>
    </tbody>
  </table>
</div>

<p><strong>Read the third column literally.</strong> The retention periods above are
our policy, not a job on a timer. Nothing in the codebase deletes screening
events, audit events, or receipts on a schedule today. We would rather say so
than imply a lifecycle we have not built. To have your data removed, email
<a href="mailto:privacy@parsethis.ai">privacy@parsethis.ai</a> — we complete
deletion requests within ${RETENTION.deletionRequestDays} days.</p>
`;

/**
 * Section 3 — third-party exposure and the per-request opt-out. The question a
 * privacy-conscious buyer asks first, so it gets its own section on both pages.
 */
export const DATA_FLOW_HTML = `
<p>Screening runs on Parse's own infrastructure. Prompt text leaves it in three
cases, all of them listed here.</p>

<div class="table-wrapper">
  <table>
    <thead>
      <tr><th>Recipient</th><th>When it receives your prompt</th><th>How to prevent it</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>OpenRouter</strong> — routes the semantic analysis layer to a model provider</td>
        <td>On <code>POST /v1/parse</code> and <code>POST /v1/screen-output</code>, the text is sent for scoring. Parse skips the call when you pass <code>mode: "pattern-only"</code>, when a pattern already matched at severity 9 or above and settles the verdict, or when the deployment has no OpenRouter key configured.</td>
        <td>Pass <code>"mode": "pattern-only"</code> on the request.</td>
      </tr>
      <tr>
        <td><strong>OpenRouter</strong> — runs the prompt against a model</td>
        <td>Only when you pass <code>execute: true</code>, which asks Parse to run the prompt on purpose and screen what comes back.</td>
        <td>Omit <code>execute</code>. It is off by default. <code>mode: "pattern-only"</code> does <em>not</em> turn it off.</td>
      </tr>
      <tr>
        <td><strong>The execution sandbox</strong> — an isolated runner, configured per deployment</td>
        <td>Only on the same <code>execute: true</code> path, which sends the prompt and any <code>test_input</code>.</td>
        <td>Omit <code>execute</code>.</td>
      </tr>
      <tr>
        <td><strong>Stripe</strong></td>
        <td>Never. Stripe sees subscription and payment metadata. Card details go to Stripe directly and Parse never holds them.</td>
        <td>—</td>
      </tr>
    </tbody>
  </table>
</div>

<p>What OpenRouter and the model providers behind it do with text they receive is
governed by their policies, not ours. If that matters to you, use pattern-only
mode and the text never reaches them.</p>

<div class="code-block"><pre><code class="language-json">POST /v1/parse
{
  "prompt": "...",
  "mode": "pattern-only"
}</code></pre></div>

<p>Pattern-only screening stays entirely on Parse infrastructure, and it is a real
trade: pattern matching alone under-reports paraphrased and indirect attacks that
the semantic layer catches. Parse does not hide the trade — every response reports
which layers ran, and a pattern-only response carries
<code>layers.llm: "skipped_pattern_only"</code>.</p>
`;

/** Markdown mirror of the three sections, for docs/trust-package.md parity. */
export const RETENTION_FACTS_MARKDOWN = `Storage does not vary by plan. Free, Pro, Team, and Compliance keys are handled identically — the tier changes rate limits, cost caps, and which fields come back in the response, not what Parse writes down.

| Endpoint | Is the prompt text stored? | What Parse records |
|---|---|---|
| \`POST /v1/parse\`, \`POST /v1/screen-output\`, \`POST /v1/agent/trust/verify\` | **No.** The screening event table has no column for prompt or output text, and none for a hash of it. | Risk score, verdict, categories, screening mode, latency, blocked flag, enforcement mode, request ID, matched rule IDs, caller-supplied metadata labels (\`source_kind\`, \`trust_level\`, \`intended_action\`), API key ID, timestamp. |
| \`POST /v1/evaluate\` | **Yes, while the run is in flight.** When the run ends, successfully or not, Parse overwrites its copy with the first ${RETENTION.evaluatePlaintextPrefixChars} characters of the prompt plus a SHA-256 of the whole prompt. Those first ${RETENTION.evaluatePlaintextPrefixChars} characters stay readable. | Evaluation results, model name, token counts, cost, and the redacted prompt. |
| Audit log (written by every screened call) | **No.** The prompt's length is recorded as a number; the text is not. | Action, API key ID, risk score, verdict, prompt length, categories, rule IDs, request ID, caller IP address. |
| Compliance receipts | **No.** | Verdict, risk score, matched rule IDs, agent ID, policy version, receipt hash chain. |
| API keys | Not applicable | bcrypt hash plus a lookup prefix. The full key is never written down. |

| Record | Stated retention | How it is enforced today |
|---|---|---|
| Screening events | ${RETENTION.screeningEventsDays} days | Automatic. A daily job deletes records past the window. |
| Audit events, including the caller IP | ${RETENTION.auditEventsDays} days | Automatic, as above. |
| Compliance receipts | 1 year, fixed so the hash chain stays verifiable | Automatic, as above. |
| Redacted \`/v1/evaluate\` records | The ${RETENTION.evaluateInMemoryRecords} most recent, then dropped | Automatic. Held in server memory, so a restart clears them. |
| Rate-limit counters in Redis | The length of the rate-limit window | Automatic, via Redis key expiry. |
| API keys | Until revoked, or the expiry set at creation (${RETENTION.selfServiceKeyExpiryDays} days by default for self-service keys) | Automatic on expiry. |

Read the third column literally. The retention periods are policy, not a job on a timer. Nothing in the codebase deletes screening events, audit events, or receipts on a schedule today. To have data removed, email privacy@parsethis.ai — deletion requests are completed within ${RETENTION.deletionRequestDays} days.

### Where prompt text goes

Screening runs on Parse's own infrastructure. Prompt text leaves it in three cases, all listed here.

| Recipient | When it receives the prompt | How to prevent it |
|---|---|---|
| **OpenRouter** — routes the semantic analysis layer | On \`POST /v1/parse\` and \`POST /v1/screen-output\`, the text is sent for scoring. Parse skips the call when the caller passes \`mode: "pattern-only"\`, when a pattern already matched at severity 9 or above and settles the verdict, or when the deployment has no OpenRouter key configured. | Pass \`"mode": "pattern-only"\`. |
| **OpenRouter** — runs the prompt against a model | Only when the caller passes \`execute: true\`, which asks Parse to run the prompt on purpose and screen the output. | Omit \`execute\`. It is off by default. \`mode: "pattern-only"\` does *not* turn it off. |
| **The execution sandbox** — isolated runner, configured per deployment | Only on the same \`execute: true\` path, which sends the prompt and any \`test_input\`. | Omit \`execute\`. |
| **Stripe** | Never. Stripe sees subscription and payment metadata; card details go to Stripe directly and Parse never holds them. | — |

What OpenRouter and the model providers behind it do with text they receive is governed by their policies, not ours. Pattern-only mode keeps the text away from them entirely.

\`\`\`json
POST /v1/parse
{
  "prompt": "...",
  "mode": "pattern-only"
}
\`\`\`

Pattern-only screening is a real trade: pattern matching alone under-reports paraphrased and indirect attacks that the semantic layer catches. Every response reports which layers ran, and a pattern-only response carries \`layers.llm: "skipped_pattern_only"\`.
`;
