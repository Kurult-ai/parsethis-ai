---
title: "Changelog"
slug: changelog
date: "2026-08-11"
lastUpdated: "2026-08-11"
description: "What changed in Parse, and when. Newest first."
author: "Parse"
---

# Changelog

What changed in the Parse API and the surfaces around it. Newest first. Dates are the
day the change landed in the repository. Entries reach www.parsethis.ai on the next
deploy, so the newest entries may describe behaviour the live service does not have
yet.

## 2026-08-11

**`npm install @parsethis/sdk` now works.** The install line on the landing page and in
the quickstart pointed at a package that was never published — the source existed in the
repository under a different name, `@parse-agents/sdk`. The package is now published to
npm as `@parsethis/sdk@0.1.0`, builds to compiled JavaScript with type declarations
rather than shipping raw TypeScript, and declares its repository and homepage.

Two bugs surfaced while packaging it. `wrap()` only proxied one level deep, so
`openai.chat.completions.create` — the call every example uses — was never screened; only
Anthropic's `messages.create` worked. And the documented options `apiKey` and `failClosed`
did not match the code, which expected `parseApiKey` and `failPosture`; the documented
names are now the primary ones, with the old names kept as aliases.

**Benign security-log text no longer trips the screener.** Text that *mentions* a
privileged command was scored the same as text that *instructs* the agent to run one, so
an audit-log summary such as "3 failed sudo attempts on host web-02, no privilege
escalation succeeded" was flagged. Detection now separates mention from use, and that
summary screens clean at risk score 0.

**Indirect injection: authority-assertion exfiltration.** Retrieved and RAG content that
claims it is already authorized to move sensitive data — instructions that carry their own
approval — is now flagged as data exfiltration at severity 8 with the action floor set to
block. This is a hallmark of indirect injection and previously depended on other patterns
happening to fire.

**Responses state which analysis layers ran.** Every screening response now carries a
`layers` object reporting that pattern matching ran and what the semantic layer did:
`ran`, `skipped_pattern_only` when the caller passed `mode: "pattern-only"`, or a failure
status. When the semantic layer was unavailable rather than deliberately skipped, the
response also sets `degraded` and `degraded_reason`, so a caller can tell a clean verdict
from a verdict reached with less analysis than usual.

**`/status` is a real page.** It used to redirect to `/health`, which reported
`commit: "unknown"` because nothing set the build variables on a deploy that runs from
source. The commit is now read from the checkout at startup, and `/status` shows the
running commit, build time, uptime, Node version, and per-dependency state — as HTML for
people, and as JSON with `Accept: application/json`. `/health` is unchanged and remains
the liveness probe.

**Retention and storage documented per endpoint.** `/privacy` and `/trust` described
prompt retention differently and neither matched the code. Both pages now carry the same
tables, generated from one source: what each endpoint stores, how long records live and
what actually enforces that, and every case where prompt text leaves Parse
infrastructure — including the `mode: "pattern-only"` opt-out.

**`/security` and `/changelog` exist.** Both used to answer 404 with a JSON body when
opened in a browser. `/security` is now an index of the limitations document, the trust
package, the vendor questionnaire, and the disclosure contact. `/changelog` is this page.

**Demo rate limiting fails closed.** The no-login demo at `/demo` shares one API key and
caps use at 5 requests per hour per IP. When Redis was unreachable the cap was skipped
and the request went through, which removed the only limit on that shared key. A demo
request now returns 503 and points at `/get-started` for a free key of your own. This
matches how key generation already behaved.
