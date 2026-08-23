---
vault_tag: parse-outreach-icp
created: 2026-08-23
source: user-prompt
tier: light
modality: compare (with committed recommendation)
---

RESEARCH QUERY: How to write high-response outreach emails for a developer-tool free-install motion, and which first ICP (ideal customer profile) will return the highest rate of FREE installs of Parse for Agents (parsethis.ai).

CONTEXT YOU MUST USE:
- Parse for Agents (parsethis.ai) screens every prompt/output before an AI agent acts — an agent-security compliance boundary. Install path = free tier (also $47 audit / $49 Pro / $199 Team / $999 Compliance).
- Product wedge: "compliance unlock" — agencies/consultancies running agent stacks (Claude Code, OpenClaw) lose deals when compliance blocks agents touching client data.
- Install = self-serve npm/SDK or API integration. Goal metric: free-install rate from cold outreach (maximize % of emailed targets who install the free tier).
- Founding team has no dedicated SDR function; emails are founder-led.
- DO NOT email spam; goal is highest quality per-email install conversion, not volume.

RESEARCH QUESTIONS:
1. What does evidence say about cold-email structure/length/CTA for developer audiences specifically (vs. generic B2B SaaS)? Subject lines, personalization depth, timing, follow-up cadence — what actually moves install/sign-up rates for dev tools?
2. Which ICP segments show the highest free-install propensity for a security/compliance dev tool: (a) AI agencies/consultancies with 10-50 employees, (b) in-house platform/DevEx teams at startups, (c) individual agent builders / solo devs shipping automations, (d) MSPs / compliance consultancies, (e) something else the evidence suggests?
3. What signals identify "about to install" targets (hiring AI engineers, publishing agent blogs, agent-adjacent job posts, GitHub activity, compliance pain signals)?
4. What are the known failure modes of dev-tool cold email (what makes developers ignore/mark spam), and what CTAs convert to a free install (docs link vs. demo vs. one-liner install command)?
5. Any benchmark response/install rates by ICP for bottom-up dev tools (PLG benchmarks)?

OUTPUT REQUIREMENTS:
- Write the final report to research/runs/parse-outreach-icp/final_report.md in the repo (also keep whatever intermediate files the pipeline creates under research/runs/parse-outreach-icp/).
- End the report with a clear single recommendation: THE first target ICP to email for maximum free-install rate, with the reasoning chain and evidence citations.
