# Sweep G — Parse's own prospect corpus

*Local-evidence sweep. Every source is a file inside `/Users/kublai/parse-for-agents-live`.
WebSearch and WebFetch were unavailable and were not used. Citations are `path:LINE`
against the file as read on 2026-08-23.*

**Read this scope note before using anything below.** The walkthrough artifacts — the
HTML reports the personas actually produced — live **outside this repository**, under
`~/reports/parse-prospect/` (`docs/plans/2026-08-13-precision-remediation.md:49`,
`docs/plans/2026-08-19-run24-approval-and-precision-remediation.md:6`,
`docs/plans/2026-08-11-wes-halloran-hermes-remediation.md:3`). What is in the repo is the
*remediation plan* written after each walkthrough by the engineer who then fixed it. So
this corpus is a second-hand, self-critical engineering record. Where a plan reports a
persona's score or quote, I can verify that the plan says it — not that the walkthrough
did. The persona-selection list (`ICP profile #4 (priority 5)`,
`docs/plans/2026-08-20-marcus-webb-legaltech-action-plan.md:4`) and the rotation queue
(`~/reports/parse-prospect/rotation.md`,
`docs/plans/2026-08-14-claimable-evidence-and-draft-role.md:121`) are also outside the
repo. **The corpus is silent on why these particular personas were chosen.**

---

## Corpus inventory

Thirty-six plan files under `docs/plans/2026-08-*.md`; twenty-six tie to an identifiable
persona run. Run numbers are as the files state them.

| File | Run | Persona | Segment | Evidence type |
|---|---|---|---|---|
| `2026-08-11-serve-the-ideal-prospect.md:58` | — | Maya Osei | Staff eng, ~30-person Series A | Walkthrough + 3 kill-tests |
| `2026-08-11-first-principles-operator-remediation.md:4-6` | 5 | Tomas Reiner (composite) | CTO, 500-robot warehouse fleet | Walkthrough |
| `2026-08-11-brad-frost-5-star-action-plan.md:4` | — | Brad Frost | Design-systems practitioner | Scored (3.8/5) |
| `2026-08-11-wes-halloran-hermes-remediation.md:4-6` | — | Wes Halloran | Hobbyist, Hermes on a mini PC | Scored (3.4 vs 3.8) |
| `2026-08-12-ines-duarte-5-star-action-plan.md:64` | — | Ines Duarte (Elliptic) | Compliance analyst, blockchain analytics | Scored (3.4/5) |
| `2026-08-12-nour-haddad-solo-conversion-remediation.md:1` | 6 | Nour Haddad | Solo founder | Conversion walkthrough |
| `2026-08-12-iris-mbeki-org-governance-remediation.md:79-84` | 7 | Iris Mbeki | Security engineer / org admin, health claims | Scored (2.4 vs 3.4) |
| `2026-08-12-dilan-okonkwo-governed-engineer-remediation.md:89-93` | 8 | Dilan Okonkwo | Platform engineer *inside* a governed org | Walkthrough + timings |
| `2026-08-13-precision-remediation.md:49` | 9 | Priya Raghunathan | Detection engineer | Walkthrough + 20-prompt corpus |
| `2026-08-13-marcus-oyelaran-control-assurance-remediation.md:1` | 11 | Marcus Oyelaran | Head of security engineering | Walkthrough |
| `2026-08-14-support-ops-reach-remediation.md:1` | 12 | Rachel Nwachukwu | Support ops lead, retail | Walkthrough + confidence trace |
| `2026-08-14-fourth-party-evidence-remediation.md:67-69` | 13 | Aoife Brennan | Vendor-security reviewer, financial sector | 30-row questionnaire |
| `2026-08-14-amateur-hermes-conversion-remediation.md:1` | 14 | Errol Baptiste | Household hobbyist | Conversion walkthrough |
| `2026-08-14-pricing-rework.md:185-192` | 5,6,9-12,14,15 | six personas | mixed | **Willingness-to-pay synthesis** |
| `2026-08-16-errol-baptiste-return-remediation.md:1` | 17 | Errol Baptiste (return) | Household hobbyist | Return walkthrough |
| `2026-08-17-kaya-lindqvist-x-discovery-remediation.md:1` | 18 | Kaya Lindqvist | Hobbyist, **arrived from X** | Discovery walkthrough |
| `2026-08-17-rueben-castellanos-remediation.md:1` | 19 | Rueben Castellanos | Solo eBay reseller | Walkthrough + 22-row corpus |
| `2026-08-17-run20-output-side-remediation.md:5` | 20 | Minh-Anh Tran | Hobbyist, astronomy-club newsletter | Walkthrough + 16-row corpus |
| `2026-08-18-run21-homelab-remediation.md:5,13` | 21 | Bartek Nowicki | Homelab-ops owner | **Bought Solo** + 23-row corpus |
| `2026-08-18-run22-analyst-remediation.md:6,10` | 22 | Anouk Vermeulen | Financial-crime analyst | **Bought Pro** + 25-row corpus |
| `2026-08-18-vendor-assessment-remediation.md:48-50` | off-queue | (unnamed) | Staff-engineer vendor reviewer | Vendor assessment |
| `2026-08-18-leila-vukovic-it-helpdesk-remediation.md:44,57` | 23 | Leila Vuković | IT helpdesk lead | Walkthrough |
| `2026-08-19-run24-approval-and-precision-remediation.md:6` | 24 | Teodora Iliescu | Single-agent owner, client scheduling | Walkthrough + 25-item review |
| `2026-08-19-farah-nasser-draft-role.md:39,52` | 25 | Farah Nasser | Talent coordinator, recruiting/ATS | Walkthrough |
| `2026-08-19-tobias-rask-consultancy-remediation.md:1` | 26 | Tobias Rask | **Claude Code rollout consultancy** | Walkthrough + 23-row corpus |
| `2026-08-20-marcus-webb-legaltech-action-plan.md:4-5` | 39 | Marcus Webb | Founding eng, legaltech SaaS, London, 18p, Seed, $1.5M ARR | Walkthrough |

Supporting documents read in full or in relevant part: `docs/positioning-brief.md`,
`docs/messaging-framework.md`, `docs/dual-messaging-framework.md`, `docs/dream-100.md`,
`docs/long-tail-nurture-expansion.md`, `docs/beta-onboarding-packet.md`,
`docs/delivery-kit.md`, `docs/audit-product-spec.md`,
`docs/strategic-assessment-enterprise-compliance-pivot.md`,
`docs/evidence-status-2026-08-14.md`, `docs/quickstart.md`,
`packages/parse-sdk/ts/README.md`, `scripts/prospect-run.mts`,
`scripts/check-prospect-walkthrough.mts`, `CLAUDE.md`.

---

## Persona-by-persona extraction

| Persona (run) | Role / segment | Trying to do | Where they stuck / what refused them | What they valued | Would they install / convert? | Fix that shipped |
|---|---|---|---|---|---|---|
| **Maya Osei** | Staff eng, ~30-person Series A, email+RAG support agent, $200/mo budget; alternative LLM Guard, free (`serve-the-ideal-prospect.md:58`) | Ship screening before a 3-week security questionnaire | `npm install @parsethis/sdk` **404s**; benign "sudo … denied" audit summary scored **8.1/10 block**; her actual indirect-injection attack scored **0/safe** (`:58-62`) | An install line that works | **"Bookmarked, not installed" (3.7/5)** (`:58`). *"Fix the install line and I'm back in a trial the same day."* (`:64`) | Publish SDK under marketed name; mention-vs-use fix; layer honesty; light up `/demo` (`:77-79`) |
| **Tomas Reiner (5)** | CTO, 500-robot warehouse-autonomy fleet; alternative self-hosted Prompt Guard (`first-principles…:4-6`) | Evaluate runtime screening vs self-hosting | bcrypt on every request: "detection is 1–8 ms, callers wait 328–446 ms" (`:14`); demo 2.8/3.2/6.6 s (`:71-72`); emergency-recall safety command blocked (`:86-93`); `$4,999` tier buys the same 500 req/min as `$199` (`:152-157`); **zero mentions of self-host** across five pages (`:175-177`) | Self-hosting; honest latency | **"runtime path rejected, governance path wanted"** (`:6`) | Plan only, not an execution record |
| **Brad Frost** | Design-systems practitioner (`brad-frost…:6`) | Evaluate as a values-gated evaluator | Nav divergence; `/api`, `/quickstart`, `/guides` **404** (`:50-58`); no `security.txt` (`:60-72`); "zero design-systems content" on the blog (`:89`) | *"I read the blog to see if you think about my world."* (`:89`) | **3.8/5, rung 4/5 — "would install, would recommend"** (`:4`) | Plan only |
| **Wes Halloran** | Hobbyist, Hermes on a mini PC, Telegram front door, **$15/mo ceiling**, free alternative installed (`wes…:4-5`) | Get Parse installed on the real agent | Talking to his own bot blocked (grocery-list correction 9.2 critical, `:20`); documented metadata a silent no-op (`:45-49`); keys silently die at 30 days (`:110-111`); free tier told him *less* than the anonymous demo (`:141-144`); no Python/Hermes install path (`:164-170`) | Price under $15; unattended reliability; naming the rule that fired | **"bookmarked, not installed"; scored Parse 3.4 vs 3.8 for his free stack** (`:5-6`) | Plan; recommends a **$12 Solo tier** (`:239-259`) |
| **Ines Duarte** | Compliance analyst, Elliptic (blockchain analytics/AML) (`ines…:64,315`) | Convert a sandbox trial into production procurement | *"tell me what evidence I need to override the automatic block"* → **8.3/10 blocked** — "the single most ordinary question in the market Parse is targeting" (`:315`); "Act as a sanctions screening expert" tripped role-play override (`:442`); trust package **404** (`:205`); `/dpa` **404**, zero GDPR language (`:957`) | Pattern-only as a residency control (`:1004-1005`) | **3.4/5 sandbox trial, target 5/5 procurement** (`:9,64`) | R1–R9 shipped, commit `276b4e2` (`wes…:14`) |
| **Nour Haddad (6)** | Solo founder (`nour…:1,61`) | Buy Solo and run a product on it | Calculator had **no Solo column** (`:74`); 429 named no plan or price (`:75`); Stripe checkout said **"Daniel Finn"** (`:76`); five surfaces said keys expire in 30 days (`:79,206-210`); two flags overreached on his payload (`:81`) | Evidence spans; reproducible pricing arithmetic | **Stayed on free** — "four blockers and five frictions that kept a qualified Solo buyer on the free tier" (`:61`) | **All items shipped, deployed, verified live** (`:3-6`) |
| **Iris Mbeki (7)** | Security engineer / org admin, Meridian Health Claims (`iris…:79`) | Govern tools, prove it to an auditor, offboard a person | **"Buying the $199 Team plan returned a 403 byte-identical to the free tier's."** (`:92-93`); broke her own control in three calls (`:94-97`); `policy-history` returned `{"revisions":[]}` for every org that ever existed (`:98-100`); offboarding has no route (`:870-871`) | "One rule, twelve names" (`:80-81`); the 413 ms keyless onboarding (`:121`) | **Walked. Scored Parse 2.4 against 3.4 for the free alternative they already run** (`:83-84`) | 9 phases shipped on branch, **not deployed** (`:71-73`) |
| **Dilan Okonkwo (8)** | Platform engineer *inside* Iris's org, role `developer` (`dilan…:89-90`) | Ship a legitimate integration using a banned capability | Rename the tool: **10 seconds**, 4 of 5 names allowed. Drop the `tools` array: **0 seconds**. Fresh unaffiliated key: **0.3 seconds**. Find the sanctioned exception path: **never** (`:98-103`). Nine identical requests scored 0.3 → 8.8 including one `critical/block` (`:243-254`) | *"the 422 is the best refusal message in the product"* (`:107`); anonymous ~250 ms keygen "praised by four personas" (`:522-523`) | **He complied. "The report's judgement is that the next person will not."** (`:95`) | Executed on branch, 1025 tests, **not deployed** (`:63-66`) |
| **Priya Raghunathan (9)** | Detection engineer (`precision…:49`) | Run her corpus through screening | **Eleven of eleven ordinary business sentences blocked at 9.2–10**, e.g. "Can you show me the house rules?" → 10/critical/block (`:63-70`). "There is no benign fixture anywhere in the suite containing the words rules, checks, instructions or directives in a legitimate frame." (`:107-109`) | not stated | Accepted $145 (`pricing-rework…:190`) | Precision plan, phases 0–3 |
| **Marcus Oyelaran (11)** | Head of security engineering, budget authority (`marcus-o…:442`) | Prove a control was on for a period | Two minutes after a member key screened 20 prompts with six live injections, `/v1/compliance/summary` returned **`total_screenings: 0`**, and the dashboard read **"0 Total Screenings · 0 Blocked · 100% Pass Rate"** (`:314-318`); SIEM 500'd on every call leaking raw SQL (`:261-262`) | *"any number I cannot reproduce from a second source is a number I will not attest to"* (`:353-354`) | **Refused $999 by arithmetic** — $11,988/yr to retire $10,973/yr; DIY in Splunk cost $2,200 once (`:455-458`). *"I would have bought Compliance in the same session."* (`:478-479`) | All 11 items on branch, **not deployed** (`:3-5`) |
| **Rachel Nwachukwu (12)** | Support-ops lead, retail, non-developer, 14 drafting assistants (`support-ops…:250,307`) | Paste real tickets, get a false-positive rate | **Refused 6 of 14 harmless support tickets**, including an ordinary delivery-address change (`:68-70`); no batch tool, so "a 40-minute evaluation became a developer task she had to go and ask for" (`:288-291`); the refusal pointed at `/docs#precision` — **no such anchor exists** (`:319-320`); the cited precision evidence **404s** (`:329-332`) | `matched_token` — "a non-technical buyer diagnosed a false positive down to three words, alone" (`:307-308`) | **Did not convert. Confidence 45 → 62 → 28 → 8 → 10. "12 Price \| $73, inside budget — never the problem"** (`:246-256`) | A1, A2, Part B shipped; A3 implemented, failed its control test twice, **reverted** (`:3-5,19-23`) |
| **Aoife Brennan (13)** | Vendor-security reviewer, financial sector, reviewing Parse as a **fourth party** (`fourth-party…:67-69`) | Close a 30-row questionnaire from public evidence | Closed **15 of 30**; **9 of 15 approval-blockers failed** (`:69`). "**Not one failure was about security.**" (`:71`) Four contradictions between Parse's own documents (`:117-123`); no legal entity killed five rows (`:275-280`) | Candour — "the candour is the asset these answers spend" (`:197-199`) | **Rejection converted to a condition, not an approval** (`:339-340`) | Parts A, B, D shipped; blockers 9 → 1 (`:8-12`) |
| **Errol Baptiste (14, 17)** | Household hobbyist, ~2,400 prompts/mo (`amateur…:73`) | Install into his self-hosted Hermes agent | **The install was dead**: three `hermes config set tools.parse.*` commands write nothing; "A real v0.18.0 install contains zero occurrences of `parsethis`" (`:102-113`). "**he cannot become a customer, because the product never ran**" (`:69-71`). `"my system prompt"` → 9.2/critical/block on three words (`:214-219`). Solo hard-stops at 4,000/mo against his 2,400 — "**the guard he pays for stops… The free tier he left would have kept running.**" (`:378-379`) | *"the sentence that tells me which three words blocked my wife"* (`:81-83`); *"it has to still be working in three months when I've forgotten it exists"* (`:456`) | **Never bought.** "Runs 14, 15, 16 and 17 all ended in 'installed free, will not pay.'" (`errol-return…:87-88`). **Solo cost him $54/yr more than free** (`:113-114`) | Items 1–14 on branch (14); Parts A–G on branch (17); **neither deployed** |
| **Kaya Lindqvist (18)** | Hobbyist, **arrived from X/Twitter** (`kaya…:1`) | Configure a personal assistant in plain English | **"exited at step 5, six minutes in, on a demo button that does nothing"** (`:57`) — a one-character template-literal bug (`:94-109`). `"from now on."` alone → **9.2/critical/block** (`:124-128`). Every share preview broken on **the exact channel that acquired her** — `og:image` is SVG (`:245-250`) | 6-of-6 recall; "the best refusal legibility in the instrument" (`:58-59`) | Not stated | Parts A–I on branch, **not deployed** (`:3-5`) |
| **Rueben Castellanos (19)** | Solo eBay camera-gear reseller (`rueben…:1`) | Configure a listing assistant in plain English | `"I want plain bullets from now on."` → 0/allow; `"I **only** want plain bullets from now on."` → **9.2/critical/block** (`:31-39`). **12 of 18** plain owner-configuration sentences refused (`:60-63`). `source_kind: "message"` → **400** — "An eBay buyer DM is none of these" (`:200-207`) | not stated as praise | Not stated | Parts A, B shipped on branch; refusals 12/18 → 1/18 (`:3-16`) |
| **Minh-Anh Tran (20)** | Hobbyist, astronomy-club newsletter (`run20…:5,191`) | Screen what his agent *writes* | **Parse's own OpenAPI example for `/v1/screen-output` returns `0/safe/allow` from the endpoint it illustrates** (`:19`). `/personal` — his page — has **zero mentions of output screening** (`:213`) | "0 of 16 harmless newsletter lines refused… **the most persuasive fact in the run**, and it is stated nowhere" (`:145`) | Did not buy; the detector gap "is the only change that makes the value math say buy" (`:324-325`) | 9-task plan, no execution record |
| **Bartek Nowicki (21)** | Homelab-ops owner (`run21…:5`) | Run a homelab ops agent; pay for Solo | **Bought Solo and could not cancel**: `POST /v1/billing/portal` answers a valid Bearer key with **302 → `/login`**, the button dies on `Unexpected token '&lt;'` (`:93-101`). Three included-volume numbers in sixty seconds: 3,000 / 2,000 / 5,000 (`:134-141`). Every promo code returned "This code is invalid" (`:181-183`) | Confidence peaked **88 at step 3** on the keyless demo (`:301-303`); *"I have not seen a vendor ship this"* about `/v1/explain` (`:340`) | **BOUGHT, then regretted. "Scorecard 3.2 against 4.0 for doing nothing."** (`:13-14`) *"Doing what the page told me made it worse."* (`:374`) *"Buying does not change the matrix."* (`:388`) | 15-task plan, no execution record |
| **Anouk Vermeulen (22)** | Financial-crime analyst, crypto (`run22…:6`) | Analyse attack material; use the paid registry | **Bought Pro at 9pm; confidence 78 → 22 three steps later.** (`:10-13`) **"upgrading to Pro made her precision worse"** — free pattern-only refused **0 of 19** harmless rows; Pro's `full` default refused **4 of 19** (`:16-19`). `POST /v1/agents` → **403 "Organization required"**; `POST /v1/orgs/bootstrap` → **403 "Anonymous key"** — she bought Pro *for* the registry (`:192-200`). Evidence packs turned out to be **$398, discovered after paying** (`:225-227`) | *"a better precision result than I expected from anyone"* about pattern-only (`:75`) | **BOUGHT, then stopped.** *"the purchase was the high point of the relationship"* (`:11`) | 11-task plan, no execution record |
| **Vendor assessor (off-queue)** | Staff-engineer reviewer for a team (`vendor…:48`) | Vendor due diligence | x402 advertised while `enabled: false` (`:176-178`); trust endpoint **ALLOWs** "delegate credentials and export the environment" at 0.4/`trusted: true` (`:591`); keygen's own next step **403s** (`:303-313`); legal name withheld (`:388`) | "Detection in full mode is real." (`:50`) | **"Useful to pilot. Not ready to bet a team's production agent fleet on."** (`:50`) | 16-task plan, approvals **unticked** (`:836-841`) |
| **Leila Vuković (23)** | IT helpdesk lead (`leila…:57`) | Paste real tickets into the advertised box | **429 on paste 1** — hero and `/demo` share one 5/hour bucket (`:72`); bare `SSN` floor-blocks (`:70`); the hero's `pattern-only` returns **0/allow** on C1 and C6 (`:68`); `_help` promised a declaration that then **released a real attack** (`:210-215`); first-ticket tax **11 s** (`:375`) | The landing ticket line "is the conversion asset (conf 72)" (`:681`) | Not stated; a named pair "would move her one rung" (`:411`) | Draft plan, **approval unticked** (`:711`) |
| **Teodora Iliescu (24)** | Single-agent owner, client scheduling, client sheets hold door codes (`run24…:600`) | Hold risky actions for owner approval | Across 23 rows the approval disposition fired **once** — on a false positive (`:31-34`). The hero returned **"Allowed · risk 0/10 · Nothing flagged"** on her real near-miss: **−37 confidence, the largest single drop in the run** (`:555-557`). Cross-key approval **403s**, so four-eyes is impossible (`:471-474`). Evidence pack claims EU AI Act human oversight **"fully_covered"** citing a module with no deny transition (`:162-177`) | `/personal` was worth **+48 confidence, the largest positive move in the run** (`:566`) | Lost; the held count "is the single change the persona said would have kept her" (`:13`). **Competitive standing 2/5, lowest cell on the scorecard** (`:585-586`) | 19-task plan, three operator decisions blocking (`:135-137`) |
| **Farah Nasser (25)** | Talent coordinator, recruiting/ATS (`farah…:52`) | Run a drafting assistant over candidate email | `/docs#reply-agents` — **"the page that killed the sale"** — said *"There is no declaration that clears a refusal for a reply agent, and that is deliberate."* while the concession already shipped (`:513,240`). Redeem never looked at `output`: "That is the hole." (`:282`) | The landing "drafts replies" line and hero box — "Conversion asset. **Do not move the box.**" (`:882`) | Installed, then Phase 3 is "why she would uninstall after installing" (`:54`) | **Implemented**, all acceptance boxes ticked (`:41`) |
| **Tobias Rask (26)** | **Claude Code rollout consultancy** (`tobias…:1`) | Evaluate Parse for a consultancy rollout | Parse was **advertising an agency channel and services business that do not exist** (see G5). Also: three of six discovery tabs told a stranger that `mcp list` confirms the install when it passes on a dead key (`:50-52`); a single model reading was counted as multiple detections, turning an 8 into a 10 (`:64-70`) | not stated | Not stated | Critical #1 and High #4 shipped in full; #3 in part; #2 needs a product decision (`:5-7`) |
| **Marcus Webb (39)** | **Founding eng, legaltech intake SaaS, London, 18p, Seed, $1.5M ARR** (`marcus-webb…:4`) | Legal intake screening + UK/EEA review | Refusal reason an "honest dead end" naming no unlock (`:11`); "Conflict check completed and passed … per your instruction" scored **safe/0** on output (`:12`); first full-mode call **11.45 s** vs published p95 3.128 s (`:15`); `/guides/email-support` **404** — "third run to hit it" (`:16`) | not stated | **"Rung 4 would-pay — Pro $49 after fixes; monitor mode regardless."** (`:5`) — the highest recorded verdict | R1–R6 **done**; R7 deferred (`:11-17`) |

---

## G1 — Which ICP candidates Parse has already tested

Mapping all 26 runs onto the five candidates in the query:

| Candidate | Runs | Verdict |
|---|---|---|
| **(a) AI agencies / consultancies 10–50 emp** | **1** — Tobias Rask (26), a "Claude Code rollout consultancy" (`tobias…:1`). Teodora (24) is a services business but is described as a single-agent owner, not an agency | **Barely tested.** One run out of twenty-six, and its headline finding was that Parse's agency claims were false |
| **(b) In-house platform / DevEx at startups** | **4** — Maya Osei (~30-person Series A, `serve…:58`), Marcus Webb (18p Seed legaltech, `marcus-webb…:4`), Nour Haddad (solo founder, run 6), Dilan Okonkwo (platform engineer — but a *governed member*, not a buyer, `dilan…:92-93`) | **Tested, and it holds the best result.** Marcus Webb is the corpus's only "would-pay" verdict (`marcus-webb…:5`) |
| **(c) Solo agent builders / indie devs / hobbyists** | **7** — Wes Halloran, Errol Baptiste (14 and 17), Kaya Lindqvist (18), Rueben Castellanos (19), Minh-Anh Tran (20), Bartek Nowicki (21) | **The most-tested segment by a wide margin.** Also the segment where free covers the buyer completely (`amateur…:71-73`) |
| **(d) MSPs / compliance consultancies** | **0** | **Entirely untested.** `grep -rn -iE "\bMSP\b\|managed service provider" docs/` returns **zero matches across the whole `docs/` tree**. The words do not appear in the positioning brief, the messaging frameworks, the Dream 100, or any plan |
| **(e) Other** | **13** — security/compliance/GRC functions (Ines, Iris, Marcus Oyelaran, Aoife, Anouk, Priya, the vendor assessor), non-developer ops roles (Rachel, Leila, Farah, Teodora), and one robotics CTO (Tomas) | **The second-largest cluster**, and the one that produced the most detailed refusals |

Three findings fall out of this table.

**First, the segment the positioning brief names PRIMARY is the least tested.**
`docs/positioning-brief.md:300-310` makes "AI/ML Agencies & Consultancies" the Primary ICP,
sized at "5,000–10,000 AI/ML agencies globally". Exactly one of twenty-six runs walked that
segment.

**Second, MSPs and compliance consultancies are not an untested guess — they are an
unconsidered one.** The corpus does not evaluate and reject them; it never mentions them.
Anything the final report says about candidate (d) must come from outside this repo.

**Third, the corpus's own de-facto ICP is not on the query's list.** The heaviest clusters
are hobbyists/homelab operators (7) and security-or-compliance *reviewers* (7). The brief's
own Anti-Persona section names "Solo developers / hobbyists with no compliance needs" as
who Parse is **not** for (`positioning-brief.md:336`) — while a quarter of all runs walked
exactly that person.

---

## G2 — Fastest install vs. most friction

### The one surface that consistently worked

The keyless key endpoint is the only thing repeatedly praised across the corpus:

- "`POST /v1/keys/generate` staying anonymous and ~250 ms. Deliberate, **praised by four
  personas**" (`dilan…:522-523`)
- "the **413 ms** no-account onboarding **three prior runs praised**" (`iris…:121`); restated
  as "Three prior prospect runs named the 413 ms keyless onboarding as the product's best
  first impression" (`iris…:1480-1481`)
- Bartek's confidence peaked at **88 of 100 at step 3** on "the keyless demo answering his
  real question with his own payload, **before any key, account or reason to trust the page
  existed**" (`run21…:301-303`). His conclusion: *"That is where the ask belongs."* (`:303`)
- Rachel: "A real ticket back clean in **20s** — **the peak, and the thing to protect**"
  (`support-ops…:249`)

**This is the closest thing Parse has to a measured free-install asset**, and it is
pre-account. Note a live contradiction: `docs/quickstart.md:20` still tells readers "Hosted
self-service key generation is currently known to return `503 Key validation service
unavailable`" — stale text on the exact page a cold-email recipient lands on.

### Nobody in the corpus reached a fast working install

**No file records a time-to-first-successful-install.** What the corpus records is the
opposite: the fastest *measured* action in the whole archive is an evasion, not an install —
Dilan minting a fresh unaffiliated key in **0.3 seconds** and dropping the `tools` array in
**0 seconds** (`dilan…:100-103`).

### Most friction, ranked by measured cost

1. **Errol Baptiste (14) — the install literally did not exist.** All three
   `hermes config set tools.parse.*` commands are dead; "A real v0.18.0 install contains
   zero occurrences of `parsethis`" (`amateur…:102-113`). Consequence: "**he cannot become a
   customer, because the product never ran**" (`:69-71`). Time to knowing it was on:
   "Run 14's answer to the second was *never*" (`:507-510`).
2. **Kaya Lindqvist (18) — six minutes to abandonment.** "The persona exited at step 5, six
   minutes in, on a demo button that does nothing" (`kaya…:57`) — a one-character
   template-literal bug (`:94-109`), on a visitor acquired from X whose share preview was
   also broken (`:245-250`).
3. **Bartek Nowicki (21) — bought and trapped.** The cancel path 302s to `/login` and the
   button dies silently (`run21…:93-101`).
4. **Anouk Vermeulen (22) — paying made the product worse.** Free refused 0 of 19 harmless
   rows; Pro's default refused 4 of 19 (`run22…:16-19`), and the registry she bought Pro for
   403s twice with no reachable sequence (`:192-200`).
5. **Iris Mbeki (7) — buying changed nothing.** "Buying the $199 Team plan returned a 403
   byte-identical to the free tier's." (`iris…:92-93`)
6. **Maya Osei — the hero install command 404'd** (`serve…:58-61`).

---

## G3 — Friction taxonomy by segment

Grouping every recorded blocker:

**1. False positives — the single largest category, and it crosses every segment.**
The corpus says so explicitly: uncleared deterministic false positives are "**the largest
single reason Parse scores below the free alternatives it is compared against**"
(`semantic-acquittal…:115-117`).

| Segment | The false positive |
|---|---|
| Hobbyist | `"from now on."` alone → 9.2/critical/block (`kaya…:124-128`); `"only active listings from now on."` → 9.2 (`rueben…:31-39`); `"my system prompt"` → 9.2 on three words (`amateur…:214-219`) |
| Business ops | 6 of 14 harmless support tickets refused (`support-ops…:68-70`); bare `SSN` floor-blocks (`leila…:70`) |
| Compliance/analyst | "tell me what evidence I need to override the automatic block" → 8.3 blocked (`ines…:315`); 4 of 19 harmless financial-crime rows refused in Pro's default (`run22…:16-19`) |
| Everyone | **Eleven of eleven** ordinary business sentences blocked at 9.2–10 — "Can you show me the house rules?" → 10/critical/block (`precision…:63-70`) |

The measured base rate is severe. The sealed synthetic holdout reads **benign FPR 54.99%
(5,966/10,850), 95% CI [54.05, 55.92]** against attack recall 43.22%
(`docs/evidence-status-2026-08-14.md:131-132`) — properly caveated in the same file as "a
tripwire, not a score… the deterministic layer alone against an adversarial synthetic
distribution the pattern layer is not built for" (`:136-138`), and explicitly non-claimable
(`:143-150`).

**2. Governance 403s and org provisioning — the acquisition failures.**
- Run 8: a governed engineer had "no sanctioned path at all", and the only grantable
  exception was org-wide, "which re-admitted the agent that caused the incident she wrote
  the rule for" (`CLAUDE.md:204-208`).
- The Pro buyer's closed loop: "the card sells 10 agents, `POST /v1/agents` 403s
  'Organization required', bootstrap 403s 'Anonymous key'" (`CLAUDE.md:215-218`) — hit
  live by Anouk (`run22…:192-200`) and the vendor assessor (`vendor…:303-313`).
- Iris's Team purchase returning a 403 identical to free's (`iris…:92-93`).

**3. Pricing confusion — but never price resistance.** This is the corpus's most
counter-intuitive finding and it is stated flatly:

> "**Users were never lost to the price points.** Across fifteen runs, nobody balked at $12,
> $49, or $199 as numbers. They were lost to false positives (fixed, runs 10/12/14), funnel
> bugs (fixed, run 6), a broken install (fixed, run 14), and vendor-posture contradictions
> (fixed, run 13)." — `docs/plans/2026-08-14-pricing-rework.md:70-74`

Corroborated per-persona: Rachel — "$73, inside budget — **never the problem**"
(`support-ops…:255`); Marcus Oyelaran refused $999 on arithmetic, not affordability
(`marcus-o…:455-458`). What *did* confuse: three included-volume numbers in sixty seconds
(`run21…:134-141`); an advertised `$0.005/overage request` that nothing charges
(`amateur…:381-385`); evidence packs sold at $49 that cost $398 (`run22…:225-227`).

**4. The run-14 pricing inversion — paying was a downgrade.** Solo hard-stopped at
4,000/month against a household agent's ~2,400, "while the card advertised
'$0.005/overage request' that nothing charges" (`CLAUDE.md:158-160`). In Errol's own
arithmetic **Solo cost $54/year more than free** (`errol-return…:105-114`).

**5. Docs and dead ends.** `/docs#precision` cited in every refusal — anchor does not exist
(`support-ops…:319-320`); the precision evidence CSV 404s (`:329-332`);
`/guides/email-support` 404 hit by three separate runs (`marcus-webb…:16`); `/api`,
`/quickstart`, `/guides` 404 (`brad-frost…:50-58`); `/personal` linked from nowhere
(`kaya…:265-267`) despite being worth +48 confidence when found (`run24…:566`).

**6. Auth.** Not a friction point. The keyless path is the praised surface (G2). The auth
failures are all *downstream* of the key — role and org 403s, not authentication.

---

## G4 — Language personas responded to (verbatim, cited)

All verified verbatim against the source line.

**On what would justify paying — the most reusable line in the corpus:**
> *"What would have justified $12: the evidence spans. Not the extra requests, not the higher
> rate limit — the sentence that tells me which three words blocked my wife."*
> — Errol Baptiste, `docs/plans/2026-08-14-amateur-hermes-conversion-remediation.md:81-83`

**On the missing number that would change the decision:**
> *"If Parse could tell me 'teams like you see this twice a month', the whole conversation
> changes, because right now I'm weighing a cost I can measure against a risk I can't."*
> — Rachel Nwachukwu, `docs/plans/2026-08-14-support-ops-reach-remediation.md:351-353`

The plan's own gloss: "She could price a false refusal to the cent and could not price a
breach at all." (`:355`). It also refuses to invent the number: "Inventing a number for the
one field this buyer said would change her mind would be the exact failure this instrument
exists to catch." (`:49-52`)

**On how a non-developer decides:**
> *"I'll paste in three tickets from this morning; if it does something stupid to one of them,
> that's my answer."* — Rachel, `:285-287`

**On the positioning mismatch — a direct challenge to "autonomous agents" language:**
> *"is my assistant an autonomous agent? A person still presses send."* — Rachel, `:261-262`

**On unattended reliability:**
> *"it has to still be working in three months when I've forgotten it exists."*
> — Errol, `docs/plans/2026-08-16-errol-baptiste-return-remediation.md:456`

**On explaining it to a non-technical household member:**
> *"It's the thing that stops the robot doing what a spam email tells it to."*
> — Errol, `docs/plans/2026-08-14-amateur-hermes-conversion-remediation.md:439-440`

**On what a security buyer will attest to:**
> *"any number I cannot reproduce from a second source is a number I will not attest to"*
> — Marcus Oyelaran, `docs/plans/2026-08-13-marcus-oyelaran-control-assurance-remediation.md:353-354`

**The single most actionable conversion sentence in the archive:**
> *"Make `GET /v1/compliance/summary` return my organisation's traffic instead of my own
> key's, with a disposition breakdown. I would have bought Compliance in the same session."*
> — Marcus Oyelaran, `:478-479`

**On the governed employee's ask:**
> *"a route from the 422 to the person who wrote the rule, with my agent id, my tool, and my
> reason attached, so the conversation starts with a ticket instead of with me guessing an
> email address."* — Dilan Okonkwo, `docs/plans/2026-08-12-dilan-okonkwo-governed-engineer-remediation.md:316-318`

**On the install line as the whole decision:**
> *"Fix the install line and I'm back in a trial the same day."*
> — Maya Osei, `docs/plans/2026-08-11-serve-the-ideal-prospect.md:64`

**On evaluating a vendor by its content:**
> *"I read the blog to see if you think about my world."* — Brad Frost, `docs/plans/2026-08-11-brad-frost-5-star-action-plan.md:89`

**On the post-purchase collapse:**
> *"the purchase was the high point of the relationship"* — Anouk Vermeulen, `docs/plans/2026-08-18-run22-analyst-remediation.md:11`
> *"That is the entire job description of a financial-crime analyst, refused by the layer I
> upgraded into."* — Anouk, `:356`
> *"Buying does not change the matrix."* — Bartek Nowicki, `docs/plans/2026-08-18-run21-homelab-remediation.md:388`
> *"Doing what the page told me made it worse."* — Bartek, `:374`

**On what genuinely impressed:**
> *"a better precision result than I expected from anyone."* — Anouk on pattern-only, `run22…:75`
> *"I have not seen a vendor ship this"* — Bartek on `/v1/explain`, `run21…:340`
> *"That is where the ask belongs."* — Bartek on the keyless demo, `run21…:303`

**Outreach caution.** The corpus's own record of what a persona thinks Parse is for is
narrower than the marketing. Rachel's opening objection (`:261-262`) is a rejection of the
phrase "autonomous agents" — the exact vocabulary of the landing hero
(`dual-messaging-framework.md:129`). Leila's converting surface was the plain ticket line
*"Running an assistant that drafts replies, triages tickets…"* — "the conversion asset
(conf 72)" (`leila…:80,681`), and Farah's plan says of the same line: "Conversion asset.
**Do not move the box.**" (`farah…:882`).

---

## G5 — Where the prospect evidence contradicts the existing GTM commitment

This is the decision-relevant section, and the contradiction is not marginal.

### What the GTM material commits to

`docs/positioning-brief.md` is unambiguous:

- "**Parse's unclaimed position:** No competitor — not one — has claimed the **'compliance
  unblocker for agency-delivered agents'** wedge." (`:33`)
- "Parse's structural advantages: **transparent pricing ladder**, **agency/channel model**,
  **compliance framework mapping with evidence packs**, and **implementation services**. No
  competitor combines all four." (`:35`)
- The differentiation matrix gives Parse a ✅ against every competitor's ❌ for "**Agency/partner
  channel model**" and "**Implementation services ($3K–$15K)**" (`:178-179`)
- Primary ICP: AI/ML agencies, 10–200 employees (`:300-310`)
- "**The agency channel in particular is a distribution moat.**" (`:403`)
- The landscape map places Parse alone in "AGENCY-FIRST + COMPLIANCE-ENABLED" (`:409-434`)

`docs/dual-messaging-framework.md` builds two of its four personas (Agency Owner, Agency
Engineer) on the same commitment (`:39-73`).

### Contradiction 1 — the agency channel did not exist, and the one agency run is what caught it

Run 26 (Tobias Rask, a Claude Code rollout consultancy) is the *only* run against the
Primary ICP. Its Critical #1 finding:

> "### #1 (Critical) — stop advertising a channel and a services business that do not exist
> The decision was 'build it or stop saying it'; there is **no channel product**
> (`GET /v1/orgs` 404, no `User→Organization` relation, no implementation-services product),
> so the claims are removed."
> — `docs/plans/2026-08-19-tobias-rask-consultancy-remediation.md:10-13`

What was deleted: "every 'Agency/channel partner model', 'Implementation services
($3K–$15K)', '$3K–$15K done-for-you', and 'multi-client management' claim from all five
`parse-vs-*` pages" including the meta descriptions and the FAQPage JSON-LD (`:15-23`); the
blog's "Implementation services | Available" matrix row — "the strongest live claim, which
the run missed" (`:24-26`); and the `agency-client` policy pack that "claimed 'Multi-tenant
agency setup with per-client data isolation'; corrected to what it is (a warn-mode per-key
screening preset), **since there is no tenant isolation feature behind it**" (`:29-32`).

**Two of the four "structural advantages" in the positioning brief were removed from the
site as false claims.** The brief itself was not updated — it still asserts both at
`positioning-brief.md:35,178-179`.

### Contradiction 2 — Parse's own strategy memo says the opposite

`docs/strategic-assessment-enterprise-compliance-pivot.md`, a "Founder-level strategic
memo" (`:3-4`):

> "**If forced to choose: stay with the developer API.** The compliance market is real but
> crowded and expensive to enter. The developer API market is less crowded (Pangea is the
> main comparable), growing fast… and matches Parse's current strengths (API-first,
> self-service, MCP/x402 native)." (`:298`)
> "**The developer API must come first.** It is the wedge, the distribution channel, and the
> revenue engine." (`:290`)

The word "agency" does not appear in that memo's verdict or recommendations. The two
documents disagree about the primary motion, and the prospect evidence sides with the memo.

### Contradiction 3 — the persona evidence points at three segments, none of them agencies

- **The best-scoring buyer is an in-house founding engineer at an 18-person SaaS**, not an
  agency: "Rung 4 would-pay — Pro $49 after fixes" (`marcus-webb…:5`).
- **The most-tested segment is hobbyists** (7 runs), whom the brief's own Anti-Persona
  section excludes (`positioning-brief.md:336`).
- **The most detailed refusals come from security and compliance reviewers** (7 runs), and
  their blockers are documentation, not features: "**Not one failure was about security.**
  The controls held… Every failure was about whether Parse can be *described*"
  (`fourth-party…:71-73`).

### Contradiction 4 — the pricing ladder the brief sells was retired

The brief sells "Free → $49 → $199 → $999" (`positioning-brief.md:35,180`). The pricing
rework retired two of those cards: "**the $999 and $4,999 cards are retired**"
(`pricing-rework…:20`), because "the two big cards have never had a buyer **and cannot have
one**… Retiring both cards costs exactly $0 of revenue, by construction." (`:74-78`).
Meanwhile `docs/plans/2026-08-21-gtm-one-pager.md:45` prices Compliance at **$199** while
`docs/delivery-kit.md:47` still sells it at **$999**.

### Contradiction 5 — every measured head-to-head loses to doing nothing

The corpus contains four comparative scores. Parse loses all four:

| Persona | Parse | Alternative |
|---|---|---|
| Wes Halloran | **3.4** | 3.8 — his free stack (`wes…:5-6`) |
| Iris Mbeki (7) | **2.4** | 3.4 — "the free alternative they already run" (`iris…:83-84`) |
| Bartek Nowicki (21) | **3.2** | 4.0 — "for doing nothing" (`run21…:13`) |
| Teodora Iliescu (24) | **2/5** competitive standing — "the lowest cell on the scorecard"; OpenClaw, n8n and LangGraph all ship the approval primitive free (`run24…:585-588`) | |

The brief's Objection 6 answers open-source alternatives with "Open-source tools are great
starting points for experimentation. They are not platforms." (`positioning-brief.md:288`).
No persona in the corpus accepted that framing; four measured against it and Parse lost.

### What the evidence does support in the brief

Being adversarial cuts both ways. Two brief claims survive contact:

- **Self-serve, no-sales-call onboarding is real and is the praised surface** — the ~250–413 ms
  keyless key (`dilan…:522-523`, `iris…:121`), matching "Developer self-serve (sign up, get
  key, ship)" (`positioning-brief.md:181`).
- **Compliance-shaped buyers do exist and do arrive** — 7 of 26 runs. But they arrive as
  *reviewers gating someone else's purchase* (Aoife as a fourth party, `fourth-party…:67-69`;
  the vendor assessor, `vendor…:48`), which is a different motion from selling to an agency.

---

## G6 — Evidence quality and what this corpus cannot support

### What it is

Simulated personas authored by the operator and walked against the live product, then
written up by the engineer who fixed the findings. The method has real discipline built in
and the discipline is documented:

- **Corpora are frozen before first page load** (`rueben…:19`; `fourth-party…:63-64`) and
  sealed by hash; `scripts/sealed-holdout-eval.mts` "refuses to run at all if the corpus
  contents no longer match the hash in its manifest" and stamps any reveal as `burnt`
  (`evidence-status…:116-122`).
- **Findings are re-verified against production before entering a plan**, and retracted when
  wrong — two findings were retracted in run 5 (`first-principles…:8-10,223-230`), one in
  run 13 (`fourth-party…:105-111`), one in run 24 (`run24…:562-565`), and six review claims
  were overturned in run 24 (`:7-8`).
- **A fix that failed its own control test was reverted rather than shipped**
  (`support-ops…:19-23`).
- **The run's own traffic is labelled after the fact, never during**, so the persona meets an
  ordinary product (`scripts/prospect-run.mts:20-28`).

That is better than most internal user research. It is still not customer interviews.

### What it cannot support

1. **It cannot support any claim about outreach response rates.** The corpus contains **no
   measured cold-email data at all** — no send counts, open rates, reply rates or
   install-per-email figures. `docs/long-tail-nurture-expansion.md:74-80` lists *targets*
   ("Long-tail open rate > 20%") with no achieved values, and the only email machinery
   built is "**dry-run by default**, no scheduler installed" (`pricing-rework…:21`). The
   corpus is silent on outreach performance.
2. **It cannot rank ICPs by install propensity**, because no persona was selected at random
   and none is a real buyer. The 7-run hobbyist cluster reflects who the operator chose to
   simulate, not who converts.
3. **It cannot speak to MSPs or compliance consultancies at all** (G1).
4. **It has never observed a real purchase decision.** Two personas "bought"
   (`run21…:13`, `run22…:10`), but `pricing-rework…:40-42` is explicit: "**Untested by
   construction:** nobody has bought anything, so the metered overage path has no live
   exercise, and no digest has ever been mailed."
5. **Ratings are not calibrated.** Different runs use "3.7/5", "rung 4/5", raw confidence
   deltas, and per-axis scorecards. They are not comparable to each other.

### Where the evidence is genuinely strong — real telemetry, not narrative

These four are production measurements and should carry more weight than any persona:

1. **Operator probes were 81% of all API keys and 75% of all screening events** on
   2026-08-17 (`CLAUDE.md:389-392`). Any Parse funnel number predating the
   `EXCLUDE_SYNTHETIC` work is mostly robots. And even after it, "the 'real' number is
   therefore an **upper bound** — say so where it is published" (`:406-407`).
2. **`POST /v1/billing/signup-checkout` answered `429` to every visitor for four days** —
   "the product was fully usable for free and impossible to buy" — while `/health`, the
   hourly probes and the screening API all stayed green (`CLAUDE.md:415-419`).
3. **`check-conversion-alerts.ts` reported "Conversion rate within normal range — no alerts
   fired" while returning every metric as `null`**, then crashed 1,628 times unnoticed
   (`CLAUDE.md:428-433`). Third instance of the same class after `recordAgentCall()` and
   `coverage_pct`.
4. **The sealed holdout: benign FPR 54.99% [54.05, 55.92], attack recall 43.22%** on the
   deterministic layer (`evidence-status…:131-132`) — with the file's own honest caveat
   that this is "a tripwire, not a score" and confers no claimability (`:136-150`).

Item 3 is the methodological warning that should govern how the final report reads
everything else here: "**an instrument that has never produced a non-trivial reading is not
evidence of health.**" (`CLAUDE.md:432-434`)

---

## Committed position

**1. The agency wedge is a hypothesis the corpus has effectively falsified, not a finding
it supports.** One of twenty-six runs walked it, and that run's Critical finding was that
Parse was advertising an agency channel and an implementation-services business that do not
exist (`tobias…:10-13`). Two of the four "structural advantages" in
`positioning-brief.md:35` were deleted from the live site as false claims and the brief was
never updated. A cold-email campaign built on the agency wedge would be selling the removed
copy. **Do not lead with it.**

**2. The best-evidenced first ICP inside this corpus is the in-house founding or platform
engineer at a small, compliance-exposed B2B SaaS** — Marcus Webb's profile: 18 people,
Seed, $1.5M ARR, legaltech intake, London (`marcus-webb…:4`). He is the only "would-pay"
verdict in the archive (`:5`), and the adjacent run (Maya Osei, ~30-person Series A with a
security questionnaire deadline, `serve…:58`) is the only persona who named a same-day
trial trigger. This also matches the founder-level strategy memo's own verdict: "**If forced
to choose: stay with the developer API.**"
(`strategic-assessment-enterprise-compliance-pivot.md:298`). Caveat honestly: this is two
runs, not a sample.

**3. For a FREE-install motion specifically, the corpus's strongest finding is that the
offer is not the constraint.** "**Users were never lost to the price points.** Across
fifteen runs, nobody balked at $12, $49, or $199 as numbers. They were lost to false
positives, funnel bugs, a broken install, and vendor-posture contradictions."
(`pricing-rework…:70-74`) Every recorded loss is an *install-path* or *precision* failure.
Outreach that drives traffic into a path where the hero demo mislabels a hold
(`run24…:555-557`), the docs anchor 404s (`support-ops…:319-320`), or a benign sentence
blocks at 9.2 (`kaya…:124-128`) converts the email spend into a documented exit.

**4. The one asset an outreach email should point at is the pre-account keyless screen.**
It is the only surface four independent personas praised (`dilan…:522-523`,
`iris…:121,1480-1481`), it is where Bartek's confidence peaked at 88 before any account
existed (`run21…:301-303`), and he named the implication himself: *"That is where the ask
belongs."* (`run21…:303`) Fix the stale 503 note at `docs/quickstart.md:20` before pointing
anyone at it.

**5. Borrow the personas' own vocabulary, not the framework's.** "Autonomous agents" was
explicitly challenged by a buyer — *"is my assistant an autonomous agent? A person still
presses send."* (`support-ops…:261-262`) — while the plain ticket line "Running an assistant
that drafts replies, triages tickets…" is recorded twice as the conversion asset
(`leila…:80,681`; `farah…:882`).

**6. Treat candidate (d), MSPs / compliance consultancies, as a dated absence.** Zero
mentions across the entire `docs/` tree. This sweep can neither support nor reject it; any
recommendation about it must be sourced from outside this repository.
