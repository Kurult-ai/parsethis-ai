# Decision: one ICP, ledger is core

**Question:** Do we change the ICP to sell an agent-action ledger, or keep the ICP and make the ledger the artifact they already need?  
**Approver:** Danny  
**Deadline:** now (build started)

# Recommendation
**Decision:** Do **not** add a second ICP. Keep one revenue ICP. Make the **hash-chained agent-action ledger a core Parse product**, not an add-on.  
**Confidence:** High  
**Change condition:** Change this if five live design-partner conversations say they need screening only and refuse to install a hook / MCP collector.

# Why
- The job is one sentence: **unblock a client security review for someone who ships agents that read untrusted input.**
- Runs 41–42 (agency TD) bought the **forwardable evidence report**. Run 43 (MCP staff engineer) bought the **MCP + output-screening** path. Same job, two ponds.
- Enterprise reviews now ask for **immutable logs of what the agent accessed** (ISO 42001 A.6.2.8, SOC 2 CC6.7/CC7.2, custom AI questionnaires). Screening answers a threat-model question; the ledger answers the checkbox.
- Competing “new ICP” docs (Maya-only PLG vs agency-as-firm vs mid-market CTO) are **targeting variations**, not different products. A second ICP would force a second pricing page, a second feature set, and a second security story. Kill that.

# One ICP (canonical, 2026-08-23)
**Name:** Security-review unblocker.

**Who:** Technical director / staff engineer at a 10–80 person agency or product team that ships Claude Code / MCP / multi-agent workflows **for clients or paying customers**.

**Pain this week:** A deal or launch is stalled because a reviewer asked *what stops the agent from executing hidden instructions, and what did it actually touch?*

**Budget:** $49–$199/mo on a card. No security hire. No 6-month procurement.

**Disqualify:** Solo hobbyists (free-tier discovery only). Enterprise SOC / shadow-AI platforms. Anyone who will not put an agent in front of untrusted input.

**Targeting variations (not new ICPs):**
| Pond | Face | Hook |
|---|---|---|
| Agency delivery | Devrim — technical director | Attack pack → forwardable report → ledger pack into the stalled thread |
| Product / MCP | Maya / Sana — staff engineer | `/mcp` + `screen_output` → ledger of tool calls their customers’ agents make |

# Funnel (same for both ponds)
1. **60s artifact** — `/attack` (keyless). Paste or screen a sample.
2. **Forwardable report** — `/report/:id` (SHA-256, named flags, 0–10 legend).
3. **Core ledger** — `/ledger` (what the agent called, which files, chained). The CISO page.
4. **Paid** — $47 audit and/or $49–$199/mo. Ledger included on Team; 1-agent / 7-day demo on free.

Do not ask for a meeting. The report + ledger **are** the meeting.

# What “core” means
- Nav, homepage, sitemap, llms.txt, pricing all name **Ledger** next to Attack Pack.
- Screening receipts and activity events share one hash algorithm and one evidence-pack shape.
- Honest claim: *tamper-evident trail of every screening decision and every tool call / file path routed through Parse (MCP gateway or Claude Code hooks).* Never: “every tool call and file access at all levels.”

# What we will not do
- No new ICP, no agency-channel fiction, no implementation-services SKU.
- No EDR daemon, no file-content capture, no prompt-text storage.
- No outbound email/Discord until a human approves the draft.
