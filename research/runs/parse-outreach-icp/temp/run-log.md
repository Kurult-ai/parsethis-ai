# Run log — parse-outreach-icp

## What ran, and what did not

| Step | Planned | Actual |
|---|---|---|
| Bootstrap | `hyperresearch init` + `install --steps-only` | **Blocked.** The `hyperresearch` CLI is not permitted in this session and the session cannot prompt. The 16 V8 step skills were never installed, so `Skill(hyperresearch-N-…)` was not invocable. Ran the light-tier architecture by hand instead. |
| 1 — decompose | tier + scaffold + coverage matrix | Done. `query.md`, `scaffold.md`. Tier **light**, per the user's "choose LIGHT if borderline". |
| 2 — width sweep | 6 parallel fetchers, 90–140 sources | **Blocked.** `WebSearch`, `WebFetch` and outbound `curl` denied for every agent. Zero sources fetched. Each of the six recorded a blocker note rather than filling sections from recall. |
| 2b — local sweep (added) | not in the standard pipeline | Added once the network block was confirmed: one agent over Parse's own prospect corpus, 26 persona runs plus the GTM documents. **This became the run's primary evidence base.** |
| 10 — draft | single draft (light tier) | Written by the orchestrator from the sweep notes plus code read directly. |
| 14 — patch | full tier only | Ran anyway, because the local sweep landed after the draft. Surgical Edits only. |
| 15 — polish | Edit-locked subagent | Done. 28 edits. |
| 16 — readability | recommender + selective apply | Done as an Edit-locked audit pass. |

## Why the run still produced something

The blocked half was the published-benchmark half. The question turned out to
rest more heavily on two evidence classes that were never external:

1. **What Parse's code actually does** — the two-door free tier, the anonymous
   keygen, the SDK surface, the hero demo's pattern-only default. Read directly,
   cited by `file:line`.
2. **What Parse already learned from 26 persona walkthroughs** — including the
   only would-pay verdict, the four lost head-to-heads, and the finding that no
   user was ever lost on price.

The second is what changed the answer. The recommendation does not match the
positioning brief's Primary ICP, and the reason is first-party and dated.

## Honest limits of this run

- No external benchmark was verified. Every craft rule in §2 is mechanism, not
  measurement, and says so.
- The persona corpus is operator-authored simulation, not customer interviews.
  It measures friction well and propensity poorly.
- Two of the strongest supports for the recommendation (Marcus Webb, Maya Osei)
  are two runs, not a sample. The report says this in the same paragraph that
  cites them.
- Three operational facts could not be checked because production is
  unreachable from here: whether keygen returns 201, whether `@parsethis/sdk` is
  published, and whether the hero box renders. All three are pre-flight gates.

## If this is re-run with network access

Re-dispatch sweeps A, B, C, D, E and F with identical prompts — each file ends
with a ready fetch list. The three highest-leverage fetches, in order:

1. GitHub's Acceptable Use Policies information-usage clause (decides whether
   the list-building method is legal).
2. `npm view @parsethis/sdk` (decides whether the CTA works).
3. Adoption curves for the free/OSS prompt-security tools — the curve shape
   answers the channel question better than any total.
