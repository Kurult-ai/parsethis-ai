# Scaffold — parse-outreach-icp

## Run config
- vault_tag: `parse-outreach-icp`
- query_file: `research/runs/parse-outreach-icp/query.md`
- modality: **compare** (proportionate per-ICP depth + one committed recommendation)
- response_format: argumentative-structured (decision memo)
- output path (binding): `research/runs/parse-outreach-icp/final_report.md`
- terminal section (binding): single recommended first ICP + reasoning chain + citations

## Tier classification
**LIGHT.** Rationale: the query is a go-to-market decision with 5 well-bounded
sub-questions. The evidence base is public benchmark/practitioner literature
(cold-email benchmarks, PLG conversion benchmarks, developer-marketing
writeups, AI-agent-security category reporting) rather than a contested
technical literature needing contradiction graphs and depth loci. The user
explicitly asked for LIGHT on borderline. Steps run: 1 → 2 (width sweep) →
10 (draft) → 15 (polish) → 16 (readability).

**Known constraint, stated up front in the report:** there is no published
benchmark that measures "cold-email → free install of an agent-security dev
tool by ICP." Any number that claims to is invented. The report must therefore
build the ICP ranking from *decomposed* evidence (reply-rate benchmarks by
segment/persona characteristics × free-tier activation benchmarks × category
adoption evidence) and label every derived figure as derived.

## Harness constraint
`hyperresearch` CLI unavailable (permission-blocked in this session). Vault
notes are written as markdown files under `research/runs/parse-outreach-icp/notes/`
instead of SQLite vault notes. Pipeline architecture otherwise unchanged.

## Atomic items (coverage matrix)

| id | atomic item | maps to Q | owner sweep |
|----|-------------|-----------|-------------|
| A1 | Cold-email structure for technical/developer recipients vs generic B2B | Q1 | A |
| A2 | Email length evidence (word count → reply rate) | Q1 | A |
| A3 | Subject-line evidence (length, personalization, question form) | Q1 | A |
| A4 | Personalization depth → reply-rate lift, and where it stops paying | Q1 | A |
| A5 | Send timing (day/hour) evidence and its actual effect size | Q1 | A |
| A6 | Follow-up cadence: number of touches, spacing, marginal reply per touch | Q1 | A |
| B1 | PLG benchmarks: visitor→signup, signup→activation, free→paid | Q5 | B |
| B2 | Outbound→PLG hybrid ("product-led sales") conversion evidence | Q5 | B |
| B3 | Dev-tool specific activation/install benchmarks (npm/SDK/API) | Q5 | B |
| B4 | Cold-email reply-rate benchmarks by company size / seniority / industry | Q5, Q2 | B |
| C1 | AI agencies/consultancies (10–50 emp): buying behavior, tool adoption | Q2 | C |
| C2 | In-house platform/DevEx teams at startups: adoption path for security tools | Q2 | C |
| C3 | Solo agent builders / indie devs: install propensity, discovery channels | Q2 | C |
| C4 | MSPs / compliance consultancies: sales cycle, self-serve propensity | Q2 | C |
| C5 | Candidate 5th segment the evidence suggests (e.g. AI-app startups selling into enterprise; vertical SaaS shipping agents) | Q2 | C |
| D1 | Hiring signals (AI/agent engineer job posts) as intent | Q3 | D |
| D2 | GitHub/OSS activity signals | Q3 | D |
| D3 | Compliance pain signals (SOC 2 start, security questionnaire, VPAT/DPA pages, trust-page creation) | Q3 | D |
| D4 | Content signals (agent blog posts, conference talks, changelog) | Q3 | D |
| D5 | Evidence that signal-based targeting actually lifts reply/conversion | Q3 | D |
| E1 | Why developers ignore/mark cold email as spam — documented complaints | Q4 | E |
| E2 | Deliverability + legal mechanics (CAN-SPAM, GDPR legit interest, domain warmup, spam-trap risk) | Q4 | E |
| E3 | CTA form evidence: interest-CTA vs meeting-CTA vs resource link vs install command | Q4 | E |
| E4 | Friction cost of signup (credit card, SSO, waitlist) on free-install rate | Q4 | E |
| F1 | AI-agent-security category map + how incumbents acquire (OSS-led vs sales-led) | Q2, Q5 | F |
| F2 | Regulatory/compliance drivers creating agent-security urgency in 2025–2026 | Q2, Q3 | F |
| F3 | Evidence on the "compliance blocks the agent deal" wedge for agencies | Q2 | F |
| F4 | Prior art: OSS/free prompt-security tools' adoption curves (Guardrails AI, NeMo Guardrails, LLM Guard, Rebuff, Lakera) | Q2, Q5 | F |

## Deliverable shape
1. What we can and cannot know (evidence-quality preface)
2. Q1 — the email itself (structure, length, subject, personalization, timing, cadence)
3. Q4 — failure modes + CTA (folded next to Q1 because they are the same craft)
4. Q5 — benchmarks, and how to convert them into an expected install rate
5. Q2 — the five ICP candidates, scored against a stated model
6. Q3 — signals that identify "about to install"
7. Recommendation — one ICP, reasoning chain, first-90-emails plan, kill criteria
