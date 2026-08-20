# Fourth-Party Evidence Remediation — Aoife Brennan Run (Run 13)

> **Execution record (2026-08-14). Parts A, B and D implemented on branch
> `fourth-party-evidence`. Part C is one line, blocked on a decision. Not
> deployed — production still runs `30cf7e6`.**
>
> | Row | Before | After |
> |---|---|---|
> | Failed approval-blockers | 9 of 15 | **1** (A2, the entity/LEI row) |
> | Targeted blocker rows closed | — | **8 of 9** |
> | Contradictions between Parse-controlled documents | 4 | **0** |
> | Hand-typed copies of the same fact | 3–4 per section | **1**, CI-enforced |
>
> **Part A went further than planned, because the drift had.** The plan named
> three sub-processor copies. Two more sections had drifted the same way and
> were carrying false claims: the pre-answered questionnaire (all 31 answers,
> hand-typed twice) and the SOC 2 control mapping, whose package copy still read
> "Multi-instance deployment, Redis HA fallback". `check-retention-sync.mts` is
> now `check-trust-sync.mts`, a registry of four generated blocks, wired into CI
> in place of the old single-block check.
>
> **The plan had one finding framed wrongly and this pass corrected it again.**
> §0.1 already corrected "pick one" to "the DPA is wrong about key storage".
> Measuring the edge then showed the DPA is wrong about TLS too — `openssl
> s_client -tls1_2` completes a handshake, so "TLS 1.3 for all connections" was
> false. Both now render from `SECURITY_FACTS`. The DPA's §6 security-measures
> list was the least accurate block on the estate, and it is the contractual one.
>
> **Two answers turned out better than the claims they replaced.** Q29 claimed
> multi-instance failover; the truth is six-hourly backups that perform a real
> restore into a scratch database and compare a row census on every run, ~30 days
> retained, verified daily — an RPO of about six hours, stated with no committed
> RTO. Q16 claimed cloud security groups; the truth is that the host exposes no
> inbound ports at all, because traffic arrives over an outbound-established
> tunnel. In both cases the honest answer is the stronger one.
>
> **Part D shipped as the self-hosted heartbeat**, per the decision taken at
> implementation time. Migration `021_service_heartbeats.sql` applied to a
> throwaway database, verified idempotent, and exercised end-to-end: 35 of 41
> minutes with a planted 5-minute hole reported 85.37% and one outage. The
> degraded path was tested by dropping the table — `/status` renders "no
> availability history yet" and the writer survives.
>
> **Part C is not done and is one line.** `LEGAL_ENTITY.governingLaw` in
> `product-facts.ts` is `null`; while it is null `/terms` keeps its existing
> circular wording, because naming the wrong jurisdiction is worse than naming
> none. Set it and the clause becomes specific everywhere it is quoted. A2 — the
> LEI and registration row — stays open until then and is the last failing
> blocker.
>
> **Gates:** `typecheck`, `claims-lint`, `brand-lint`, `check:trust-sync` and
> every suite under `src/lib`, `src/routes` and `src/pages` pass. `claims-lint`
> gained a narrow exemption for import lines — it flagged `soc2-mapping.js` as a
> SOC 2 claim — and was verified both ways: it still fails an unqualified claim
> in rendered copy.
>
> **Deploy is a separate decision.** Production serves from the working
> directory, so this reaches customers only on `launchctl kickstart`, and the
> migration must be applied first.

**Status:** implemented on `fourth-party-evidence`; see the execution record above.
**Source review:** `~/reports/parse-prospect/2026-08-14-aoife-brennan-fourth-party.html`
**Corpus:** `~/reports/parse-prospect/run13/questionnaire.json` (30 rows, written before the
first page load), scored in `run13/scored.json`.
**Measured against:** production `30cf7e6`, 2026-08-14.

Run 13 pointed a vendor-security reviewer at Parse as a **fourth party** — the sub-processor
of a sub-processor, reached through run 11's chain. She could close **15 of 30** questionnaire
rows from public evidence. **9 of the 15 approval-blockers failed.**

**Not one failure was about security.** The controls held; several are better than vendors ten
times this size publish. Every failure was about whether Parse can be *described*: who it
legally is, where it runs, whether anyone independent has looked, and what happens when the
machine stops.

That is the thesis of this plan. **Eight of the nine failed blockers are copy or one generator
fix.** One is engineering. One is a business decision that is not mine to take.

---

## 0. What I re-verified at plan time

The run-5 lesson: the plan pass is the last cheap place to kill a wrong finding. Every finding
below was re-checked against the tree at `30cf7e6`. Three results changed.

### 0.1 One finding was wrong in the way it was framed — corrected here

The report said the trust page and the DPA disagree about API key storage, and asked the team
to "say one thing". The code says which one is right, and it is not a coin toss:

- `src/api-key-service.ts:295` — `bcrypt.hash(rawKey, BCRYPT_ROUNDS)` is what goes in Postgres.
  The comment at :24 states the intent: *"bcrypt stays the at-rest hash in Postgres: a database
  leak must not hand an attacker anything cheap to attack."*
- `src/api-key-service.ts:42` — `fastKeyHash` is `sha256(rawKey)`, used only for the
  constant-time compare against the **Redis validation cache**, added to get bcrypt off the
  hot path.

So `/trust` ("bcrypt-hashed with salt", `trust-page.ts:399`) is **correct** about storage, and
`/dpa` §6 ("API keys: Stored as SHA-256 hashes", `dpa.ts:107`) is **wrong** — it names the
per-request cache hash as the storage mechanism, which understates the control in the one
document a customer can hold Parse to. B4 in this plan fixes the DPA, not the trust page.

### 0.2 Two candidate findings killed before they became tickets

- **`/refunds` 404.** That was my own URL guess. The footer links `/refund`, which returns 200.
  No broken link. Excluded from the report and from this plan.
- **`brand-lint` "missed" enterprise-grade.** It did not. `scripts/brand-lint.ts` checks visual
  brand conformance (fonts, the shell template) and has never covered vocabulary. The
  banned-vocabulary scan in `docs/claims-gate-sweep-protocol.md` §2 is a **manual** checklist
  item. That is a real gap, but it is a gap in the protocol, not a bug in the linter — and it
  is the argument for Part A.

### 0.3 Everything else confirmed, with line numbers

| Finding | Confirmed at |
|---|---|
| Three hand-maintained sub-processor tables | `trust-page.ts:268-277`, `dpa.ts:33-80`, `docs/trust-package.md:233-237` |
| The package contradicts the contract on hosting | `trust-package.md:243` "standard cloud providers" vs `dpa.ts:90` "not AWS/GCP/Azure" |
| The two *truthful* copies also differ | "US (Mac Mini)" vs "US (Mac Mini M4)" |
| Package omits Cloudflare entirely | 0 occurrences in `docs/trust-package.md` |
| Personnel-voice answers | `trust-page.ts:371, 374, 391, 439, 471, 503` |
| Multi-instance claim, twice | `trust-page.ts:331` (SOC 2 A1), `trust-page.ts:503` (Q29) |
| TLS 1.2+ vs TLS 1.3 | `trust-page.ts:216,411` vs `dpa.ts:91,106` |
| No entity, no jurisdiction | `dpa.ts:17`, `public.ts:2332` |
| No training answer | `grep -c train src/pages/dpa.ts` → **0**; purpose clause at `dpa.ts:27` |
| `security.txt` has no `Expires` | `public.ts:1198-1200` |
| Landing has its own footer | `landing.ts:617` (5 links) vs shared `html-template.ts:665` (16 links) |
| Uptime is process-local | `public.ts:2777` `process.uptime()`; no incident or uptime table in `prisma/schema.prisma` |

---

## Part A — One fact, one source

**This is the fix that matters, and the mechanism already exists in this repo.**

`scripts/check-retention-sync.mts` was written for exactly this failure, and its header says so:

> *"The contradiction this whole area started with came from two hand-maintained copies of the
> same policy. Moving the copy into `src/lib/retention-facts.ts` only fixed that for the two web
> pages — `docs/trust-package.md` was still typed by hand, which made it a third copy rather
> than a second."*

That is a precise description of the sub-processor table today, one section further down the
same document. Retention was fixed; sub-processors were not, and drifted into a statement that
contradicts the contract.

### A1 — `src/lib/subprocessor-facts.ts`

New module on the exact pattern of `src/lib/retention-facts.ts`: one typed array of
sub-processor records — name, purpose, location, sees-prompt-text, adequacy mechanism — plus
`SUBPROCESSOR_FACTS_MARKDOWN` and an HTML table renderer.

Fields must include **location**, because that is the field the reviewer's regulatory register
requires and the one the package silently dropped.

Consumers, all three replaced with a call:
- `src/pages/trust-page.ts:268-277` (§3 table)
- `src/pages/dpa.ts:33-80` (§3 table)
- `docs/trust-package.md:231-247` (§3 table at :233-237, notes at :239-247), inside `BEGIN/END GENERATED` markers

### A2 — Extend the sync checker

Generalise `check-retention-sync.mts` to a block registry rather than adding a second script:
one map of `{ marker → markdown source }`, iterated. Retention keeps working unchanged;
sub-processors join it. Wire into CI beside `check:retention-sync`.

### A3 — Two more facts that belong in a module, once each

Both caused a contradiction this run and both are single values:

- **Transit TLS version.** One constant, consumed by `trust-page.ts:216,411` and
  `dpa.ts:91,106`. Today they disagree.
- **Key storage description.** One sentence describing both layers — bcrypt at rest, SHA-256
  for the request cache — consumed by `trust-page.ts:399` and `dpa.ts:107`. See §0.1.

**Control:** delete one row from `subprocessor-facts.ts`, run `npm run check:trust-sync`, and it
must fail naming `docs/trust-package.md`. Then `grep -c Cloudflare docs/trust-package.md` must
return non-zero, and the package's §3 must carry a location column.

**Size:** one to two days.

---

## Part B — The copy debt

Eight tickets. All are text. None needs a migration, a test fixture, or a deploy window beyond
the usual.

### B1 — Rewrite the pre-answered questionnaire in the voice of the actual company

`src/pages/trust-page.ts` Q3 (:371), Q4 (:374), Q7 (:391), Q16 (:439), Q23 (:471), Q29 (:503).

These describe an organisation with team members, departed personnel, quarterly access reviews,
cloud security groups, scheduled penetration tests and multi-instance failover. `dpa.ts:109`
says **"Access controls: Single-operator infrastructure, no shared credentials."**

The rest of this estate is more candid than any vendor in the reviewer's book, which is exactly
why these stand out: a reviewer who catches one starts re-reading the answers they had already
believed. The candour is the asset these answers spend.

Rewrite each to the true single-operator answer. Where the honest answer is "no", say no with
what compensates:

- Q23 is the sharpest. *"Yes. On a scheduled basis and prior to major releases"* cannot be
  closed by a reviewer — no date, no scope, no tester. **"No independent penetration test has
  been performed. Planned for <date>."** closes the row. The current answer fails it *and*
  costs the answers above it.
- Q29 must lose "Multi-instance failover" — see B5.

### B2 — Delete the resilience claims that the hosting disclosure contradicts

`trust-page.ts:331` (SOC 2 A1 "Multi-instance, Redis HA") and `trust-page.ts:503` (Q29
"Multi-instance failover").

Replace with the real posture: single node, what happens when it stops, and — if they exist —
an RTO, an RPO and the date of the last restore test. A single-node vendor with a four-hour RTO
and a tested restore is approvable. A single-node vendor claiming Redis HA is not, because the
reviewer then starts checking everything else.

If no restore test has been run, say that. It is a smaller finding than the contradiction.

### B3 — Answer the training question in the DPA

`src/pages/dpa.ts:27`. "train" occurs **zero** times across `/dpa`, `/privacy` and `/terms`,
while the purpose clause permits *"(d) aggregate analytics for detection improvement"* — which
a reviewer can read as either a yes or a no, so the row escalates.

Add one sentence stating whether customer content is used to train, tune or evaluate models,
and if aggregate statistics are used, say precisely which. This is a top-five row on every AI
vendor questionnaire written since 2024.

### B4 — Correct the DPA's key-storage clause

`src/pages/dpa.ts:107`. Currently "Stored as SHA-256 hashes", which is wrong (§0.1). Should
name both layers, sourced from the A3 constant.

### B5 — Fix the SOC 2 table's honesty gradient

`trust-page.ts:326-335`. Twelve of thirteen rows are green ticks against criteria no auditor has
examined, including CC4 Monitoring — which run 11 already found failing in session. The header
does say "In Progress", and the reviewer still recorded it as an overclaim, because a green tick
is a green tick once it lands in her file.

Change the column from a pass/fail tick to a **self-assessed** marker, or retitle it "Control
implemented (self-assessed, not audited)". The information is the same; the claim is not.

### B6 — Put the legal links in the landing footer

`src/pages/landing.ts:617-624` emits a bespoke five-link footer. Every other page uses the
shared footer at `src/lib/html-template.ts:665`, which carries Privacy, Terms, DPA, Security,
Changelog and the rest. A reviewer landing on the homepage sees none of them.

Use the shared footer, or add the legal row to the landing one.

### B7 — `CAQH` → `CAIQ`

`src/pages/trust-page.ts:353`, `docs/trust-package.md:16, 330, 332`.

CAQH is a US healthcare credentialing body. The questionnaire meant is CAIQ, the CSA Consensus
Assessments Initiative Questionnaire. "CAIQ" appears **zero** times on the estate, so a
reviewer's keyword ingestion for it finds nothing. Four occurrences, one character each.

### B8 — Add the mandatory `Expires` field to `security.txt`

`src/routes/public.ts:1198-1200`. RFC 9116 §2.5.5 makes `Expires` a MUST; the file is otherwise
valid. Automated scanners mark it non-conformant. Generate it as `now + 12 months` at boot, or
pin a date and add it to the claims-gate sweep.

**Size for Part B:** one day, all eight.

---

## Part C — The decision that is not mine

**Five questionnaire rows (A1–A5) died on one fact: there is no legal entity.**

- `dpa.ts:17` — the counterparty is *"Parse, operated by Daniel Finn"*, a natural person.
- `public.ts:2332` — governing law is *"the laws of the jurisdiction in which Parse operates"*,
  which names no jurisdiction.
- The landing footer reads "© 2026 Parse" with no company.
- The GLEIF golden copy (2026-08-13) holds **two** ACTIVE records with the exact legal name
  Parse — `894500JJI7IJOP5D3H37` (DK, registration LAPSED) and `254900S1RHYKAY13SG09`
  ("Parse AB", SE, registration ISSUED). Neither is this vendor. The register field is not
  blank, it is baited: a reviewer in a hurry enters the Swedish company.

This is a business decision with cost, tax and privacy consequences, so I am setting out the
options rather than writing a ticket.

| Option | What it unlocks | What it costs |
|---|---|---|
| **Publish the trading form as it is** — "sole trader, trading as Parse, jurisdiction X", plus a contact address | Closes A1 and A3. A reviewer can process a sole trader; she cannot process a blank | Free, and honest. Does **not** produce an LEI. Requires deciding what address to publish |
| **Incorporate** | Closes A1–A3 and makes an LEI obtainable, which is what regulated buyers actually need for their registers | Real money and ongoing admin. Only worth it if financial-sector customers are a target |
| **Do neither, and say so** | Nothing, but stops the estate implying an entity that does not exist | Free. Enterprise and regulated deals stay capped at whatever the third party will covenant for |

Two things worth knowing before choosing:

1. **A natural person generally cannot obtain an LEI.** If customers like this reviewer's
   institution matter commercially, incorporation is the unlock, and no amount of copy
   substitutes for it.
2. **Publishing an address is a personal-data decision** if the trading address is a home
   address. A registered agent or virtual office is the usual answer. Do not let a remediation
   plan push you into publishing a home address.

Whichever is chosen, **`public.ts:2332` should name a real jurisdiction.** A governing-law
clause that points at itself is unusable for any customer, and that part is free.

---

## Part D — Engineering

### D1 — Publish availability history

`/status` reads `process.uptime()` (`public.ts:2777`) and there is no uptime or incident table
in `prisma/schema.prisma`. So the only availability number Parse publishes is time since the
last restart — it read **10m 16s** during the review — with nothing around it for context. A
number that can only hurt.

Needs an external prober (the check must survive the thing it measures going down) writing to a
small table, plus a 30-day availability figure and an incident list with durations on `/status`.

With history, a single node with a good record is an argument the reviewer said she would
actually make. Without it, there is nothing to argue with.

**Size:** a sprint. This is the only item here that is not text.

---

## What this plan deliberately does not fix

Say this plainly, because a plan that implies otherwise would be the same failure it is fixing.

- **It does not make Parse pass a bank's resilience bar.** One Mac Mini running Postgres and
  Redis is a resilience finding whatever the copy says. The goal is to stop failing on
  *describability* and start failing — or passing — on the real facts.
- **It does not produce independent assurance.** No SOC 2, no pen test report. B1 makes the
  absence closable rather than unanswerable; that converts a rejection into a condition, which
  is what happened in this review.
- **It does not name the model providers behind OpenRouter** (row C2). The trust page states
  their policies govern, not Parse's, which is honest and leaves the reviewer unable to
  enumerate her fifth parties. Naming them, or publishing the routing policy, is a separate
  decision about the OpenRouter integration.

---

## Sell what already works

One addition rather than a correction, and it is the run's named unsold asset.

The transfer restriction is **self-evidencing on every response** — verified live this run:

```
mode: "pattern-only"  → layers: {"pattern":"ran","llm":"skipped_pattern_only"}   48ms / 214ms wall
default               → layers: {"pattern":"ran","llm":"ran"}                  2668ms / 2.76s wall
```

That is a supplementary-measure attestation, per request, machine-checkable. No vendor on this
reviewer's book produces one. Today it is described on `/trust` inside a paragraph explaining
that pattern-only is "a real trade".

**Add a short section to `/trust`: "How to prove the restriction engaged"**, showing both
responses side by side. Half a day, and it speaks to the row the ladder scored 3 delivered /
1 communicated.

---

## Controls

How we know each part worked, rather than that it was written.

| Part | Control |
|---|---|
| A | Delete a row from `subprocessor-facts.ts` → `check:trust-sync` fails naming the doc. Package §3 carries a location column and mentions Cloudflare |
| B1, B2 | No occurrence of "team members", "departed personnel", "cloud security groups", "multi-instance" on `/trust`. Q23 and Q29 each state a fact a reviewer can cite or a plain "no" |
| B3 | `grep -c train src/pages/dpa.ts` > 0 |
| B4 | Key-storage sentence identical on `/trust` and `/dpa`, and matches `api-key-service.ts` |
| B7, B8 | `curl /.well-known/security.txt` shows `Expires:`; `grep -c CAIQ` > 0 and `CAQH` = 0 |
| C | `/trust` names a legal form and a jurisdiction; `/terms` §11 names a country |
| D | `/status` shows 30-day availability and an incident list |
| **All** | **Re-run the run-13 questionnaire unchanged** — queue entry 5 in `~/reports/parse-prospect/rotation.md`. Target: closable rows 15 → 26+, failed blockers 9 → ≤3 |

**On the re-test, apply the run-10 lesson.** Ask whether the fix closed the row or only silenced
the sentence. A row is closed when a reviewer can cite a URL and paste an answer that is true —
not when the contradicting text was deleted. `run13/questionnaire.json` stays unburnt precisely
so it can measure that; it burns the moment a row is "closed" with an answer that is not true.

---

## Order and sizing

Ordered by what the fix costs, not by how sharply it was felt.

| # | Item | Size | Blockers closed |
|---|---|---|---|
| 1 | B7, B8, B6 — CAIQ, `Expires`, landing footer | ~1 hour | 0 (but free) |
| 2 | B3, B4 — training answer, key storage | ~1 hour | 1 |
| 3 | B1, B2, B5 — questionnaire voice, resilience claims, SOC 2 column | ~1 day | 2 |
| 4 | A1–A3 — one fact, one source | 1–2 days | 3 |
| 5 | "How to prove the restriction engaged" | ~½ day | 0 (sells the unsold asset) |
| 6 | C — entity decision | a decision, then ~1 hour | 3 |
| 7 | D1 — availability history | a sprint | 1 |

Items 1–4 are two and a half days of writing and close **six of the nine failed blockers**.
The reviewer's own summary of the whole review was that eight of the nine things standing
between Parse and her approval were sentences, not systems.
