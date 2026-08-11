# Plan — semantic analysis layer reliability

> **Read this first: the semantic layer is not down.** Diagnosed against the
> live service on 2026-08-11. Eight consecutive full-mode calls to production
> succeeded (`layers.llm: "ran"`, ~2.4–3.4 s), the real OpenRouter key is
> installed and working, and a single full-mode probe returned a clean
> `pattern+llm` verdict. The "degraded" on `/status` was real but historical.
> **Do not go looking for a live outage — there isn't one.** This plan is about
> why the layer silently degraded earlier, why nobody knew, and how to make the
> next real failure fail loud and recover on its own.

## What "degraded" actually was

Every semantic failure in the logs is the same line, nine times:

```
[analysis] llmRiskAnalysis failed: OpenRouter API error 401:
  {"error":{"message":"Missing Authentication header","code":401}}
```

That is not a rejected key — it is OpenRouter reporting **no Authorization
header at all**, which is the signature of a process that held the placeholder
key (`sk-or-.....`) or no key when it made the call. Evidence it is historical:

- The current API process (started 18:56 local, after the real key was in
  place) passes **8/8** live full-mode calls.
- The failure lines live in the main API log, from earlier process instances.
- The worker (`com.kublai.parse-for-agents-worker`, PID from 09:56 this
  morning) shows **zero** such errors and does not call the semantic layer.
- `/status` reads the **hourly** degraded counter, which self-heals; it went
  operational again on its own once the failing hour rolled over.

So the degradation was: an earlier deploy ran with a bad key, screening
silently fell back to pattern matching, the hourly counter ticked, `/status`
flipped to degraded, and it cleared itself an hour later. The daily counter
(`screening:llm_degraded:2026-08-11 = 11`) is cumulative and cosmetic — it
includes every pre-fix failure and is not what `/status` reads.

The problem is not the key today. The problem is that every part of this was
invisible until a human happened to load `/status`, and that a bad-key deploy
degrades screening quality with nothing stopping it. This is the same failure
class as the original "the semantic layer never ran in production" incident.

## Root causes, each with the fix

### Phase 1 — Boot-time OpenRouter preflight (P0, small, highest value)

`src/model-client.ts:7` captures the key as a module constant and the first
time anyone learns it is bad is a runtime 401 on a real screening call
(`src/parse.ts:309`). There is no startup check — grep confirms the only
"preflight" in the tree is the unrelated Numbat exposure endpoint.

Add a startup probe in `src/index.ts`: if `OPENROUTER_API_KEY` is set, make one
cheap authenticated OpenRouter call (a 1-token completion, or the
`GET /api/v1/auth/key` endpoint which just validates the key) behind a short
timeout. Log the result loudly — `[startup] OpenRouter key OK` or
`[startup] OpenRouter key REJECTED (<status>): screening will fall back to
pattern-only` — and surface it on `/health` as a boot-time field. Do **not**
fail the process on a bad key; pattern-only is a valid degraded mode and the
service must still start. The point is that a bad key is known at boot, in the
log and on `/health`, not discovered later by a customer.

This one change would have turned both the original incident and today's
degradation from "silent for hours" into "obvious in the startup log."

### Phase 2 — Make `/status` distinguish a blip from an outage (P1)

`src/routes/public.ts:2289` marks the whole layer `degraded` when the hourly
counter is `> 0` — a single transient failure in an hour flips it, which is
crying wolf for exactly the kind of one-off blip that OpenRouter (a
multi-provider router) will always produce occasionally.

Report a **rate**, not a boolean tripwire. Alongside the degraded counter,
track a total-calls counter for the same hour (increment on every semantic
attempt, success or fail). Then:

- `operational` when the failure ratio is below a threshold (e.g. < 5% of the
  last hour's calls, or fewer than N absolute in a low-traffic hour),
- `degraded` only on a sustained ratio,
- and always show the numbers in `detail` ("3 of 214 calls fell back in the
  last hour"), so the page states magnitude instead of a bare status word.

Keep the hourly self-heal. The counter increment already lives at
`src/routes/parse.ts:491-492`; add the denominator next to it.

### Phase 3 — Retry a transient failure before falling back (P1)

`src/model-client.ts:73` retries only on HTTP 429. Any other non-ok — a 401
blip, a 500, a provider timeout — throws on the first try
(`src/model-client.ts:81-83`), and `llmRiskAnalysis` drops straight to
pattern-only. A single transient counts as a full degradation.

Widen the retry to transient statuses (500/502/503/504, and network/abort
errors) with the existing backoff, capped so total added latency stays within
the full-mode budget. Leave 401/403 **non-retryable** — a genuinely bad key
should fail fast to pattern-only, not spend three retries getting rejected
three times. Distinguish "retryable transient" from "terminal auth failure" so
the two do not share a code path.

### Phase 4 — ~~Configure the model fallback chain~~ REVERSED: no chain (operator decision, 2026-08-11)

**Superseded. Do not implement the section below.** The operator's call is: no
fallback chain — fail gracefully instead. Implemented that way, and the unused
chain code was *removed* rather than configured.

The reasoning is better than the original plan's. Chaining buys availability at
the cost of the two properties that matter more for a screening product:

- **Reproducibility.** Different models return different verdicts for the same
  prompt. With a chain, a caller who is blocked cannot tell which model judged
  them, and the same prompt can screen differently minute to minute depending
  on which provider was healthy. For an audit product whose output is evidence,
  that is worse than an honest gap.
- **Latency.** Full mode already runs seconds. A failed primary would stack a
  second provider's round trip on top before giving up, making the worst case
  markedly worse — the opposite of graceful.

So: one model, one attempt. When it cannot answer, fall back to pattern-only
**visibly** — `degraded: true`, `degraded_reason`, the `layers.llm` status, the
hourly counter, and a credential-specific log line. Removing the chain also
deleted a latent bug: when every configured model failed, the old code fell
through to an *extra* unconfigured default-model attempt.

For the same reason, no aggressive retry was added. A bounded retry on the same
model is defensible, but three retries against a several-second call turns a
transient blip into a much worse p95, and the plan's own framing is that a
transient should degrade cleanly rather than be papered over.

<details>
<summary>Original Phase 4 text, superseded — kept for the record</summary>

#### Configure the model fallback chain that already exists (P2)

`src/parse.ts:261` builds `ANALYSIS_MODELS` from a comma-separated
`ANALYSIS_MODEL` env var and iterates it as a fallback chain
(`src/parse.ts:269-278`) — but `ANALYSIS_MODEL` is **unset**, so the chain is
empty and every call uses the single default `deepseek/deepseek-chat`
(`src/model-client.ts:9`). If DeepSeek has a bad hour, the whole semantic layer
has a bad hour.

Set `ANALYSIS_MODEL` to two or three models from **different providers**
(the code already warns at `src/parse.ts:686-688` if the analysis and execution
models share a provider, so honour that — e.g. a DeepSeek primary with an
OpenAI or Anthropic secondary). This is mostly an operator/config change plus a
test that the chain actually advances on a primary failure. Note the cost trade:
a secondary provider may be pricier per call, and it only fires on primary
failure, so the expected cost increase is small — quantify it before enabling.

</details>

### Phase 5 — Alert on sustained degradation (P2)

Eleven fallbacks happened today and the only way anyone found out was loading
`/status`. There is no push signal. Once Phase 2 gives a real rate, emit an
alert (the same channel the rest of Kurultai uses — `hermes send`, or a
webhook) when the hourly failure ratio crosses the degraded threshold for two
consecutive hours. Two hours, not one, so a single self-healing blip stays
quiet — the whole point of Phase 2.

## Not the semantic layer, but adjacent and worth noting

`[migrate] continuing startup with degraded database-dependent routes` recurs
in the log: Postgres is not reachable at boot, which is why self-service keys
fall back to Redis records and why the fastHash cache never populates (the
latency finding in `2026-08-11-post-review-remediation.md`). Same shape as the
semantic issue — a dependency degraded at startup, discovered late — and the
Phase 1 preflight idea should extend to it: probe Postgres at boot and log the
verdict loudly rather than discovering it per-request. Tracked separately; do
not fold it into this plan's scope.

## Operator items (no code)

- Confirm the real `OPENROUTER_API_KEY` is durably in `.env`, not only in the
  running process's environment — a future restart must pick it up. (It is
  present and valid as of this writing: 73 chars, `sk-or-v1` prefix.)
- Decide the `ANALYSIS_MODEL` fallback set for Phase 4 (provider diversity +
  cost).
- The daily `screening:llm_degraded:2026-08-11` counter is cosmetic and
  cumulative; it does not need clearing, but know that it is not what `/status`
  reads.

## Verification for each phase

- Phase 1: restart with a deliberately bad `OPENROUTER_API_KEY` in a scratch
  env; confirm the startup log and `/health` both say REJECTED and the service
  still serves pattern-only. Restore the real key; confirm OK.
- Phase 2: with a real key, inject a handful of forced failures (or replay the
  counter) and confirm `/status` stays operational under the threshold and
  reports the ratio in `detail`.
- Phase 3: point the model client at an unreachable URL for one call; confirm it
  retries transient errors and does not retry a 401.
- Phase 4: set a two-model chain with a bogus primary; confirm the log shows the
  primary failing and the secondary succeeding, and the verdict is `llm: ran`.
- Phase 5: force a sustained failure ratio across two hours in a scratch Redis;
  confirm exactly one alert fires, and none for a single-hour blip.

All of Phase 1–5 is testable without a real provider outage. None of it should
deploy without the CI suite (now green) passing, and the model-client changes
want unit coverage of the retry/terminal split before they ship.
