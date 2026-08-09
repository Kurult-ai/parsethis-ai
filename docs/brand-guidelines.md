# Parse Brand Guidelines

Version 1.2 · 2026-08-09 · Owner: Danny (Kurultai LLC)

This document governs how Parse presents itself: positioning, naming, voice,
claims, and the visual system. It applies to the public site, docs, dashboards,
sales material, and any generated artifact that carries the Parse name. Code,
API names, and legal text are out of scope.

Change process: propose edits by PR against this file. The positioning and
claims sections require Danny's approval; visual-token changes require a
rendered before/after.

---

## 1. Positioning

**Category:** Agent governance and compliance platform.

Parse is not "a prompt-injection filter." Screening is the enforcement
mechanism; governance is the product. The platform is the registry, the
policy surface, the screening pipeline, and the evidence trail — together.

**One-liner:**
> Parse governs your agent fleet: every agent registered, every boundary
> screened, every decision receipted.

**Elevator (50 words):**
> AI agents read the open internet and act with real authority. Parse is the
> governance layer between those two facts: a registry of every agent, policy
> you dial per environment, screening at every trust boundary, and an audit
> receipt for every decision. Risk goes down. Evidence goes up.

**Message house — three pillars, in order:**

| Pillar | Claim | Proof points |
|--------|-------|--------------|
| **Govern** | Every agent is on the record and under policy. | Agent registry (CRUD, heartbeats, decommission) · enforcement dial (monitor/warn/block) per environment · versioned policy revisions with diffs · policy packs (OWASP-aligned presets) · data grants & data-source registry · egress control · volume budgets · approval matrix · kill switch · signed identity (agent keypairs) · SSO |
| **Enforce** | Untrusted text is screened before it gets authority. | 4-layer pipeline (pattern ~0.3ms p95, structural & contextual analysis, semantic, sandbox) · 9 risk categories · 126+ pattern rules + contextual & intent detectors · risk 0–10 · 4 surfaces (input, tool output, generated output, handoff) · gateway proxy (OpenAI-compatible) |
| **Prove** | Every decision leaves evidence an auditor can read. | Receipt on 100% of verdicts (category, score, action, trace ID) · coverage attestation · SIEM forwarding (Splunk, Datadog, Elastic, Sentinel, webhook) · evidence pack export · framework crosswalk (OWASP LLM Top 10, NIST AI RMF, EU AI Act, ISO 42001, SOC 2) · compliance dashboard · SOC 2-aligned controls at /trust · pre-answered vendor questionnaire |

The mechanism mantra — **"screen before authority"** — stays. It describes the
Enforce pillar, not the whole brand.

**Audiences, in priority order:**
1. Builders shipping agents (self-serve; they install, they advocate).
2. Security engineering (they approve; they need receipts and stated limits).
3. CISO / procurement (they sign; they need attestation, SOC 2 alignment, the
   questionnaire, and the framework crosswalk).

**Boilerplate (footer / press):**
> Parse is the agent governance and compliance platform: registry, runtime
> policy, boundary screening, and audit receipts for autonomous-agent fleets.
> Machine-readable by design — REST, MCP, OpenAPI, and x402. parsethis.ai

## 2. Naming

- The public brand is **Parse**. Never "Parse Agents," "ParseThis," or
  "Parse for agents" in customer-facing copy. The domain is parsethis.ai.
- **Parse** (parsethis.ai, agent governance) and **Parse Media**
  (parsethe.media, media credibility) are separate products. Never conflate
  them; when both appear in one document, use the full names.
- Product surfaces: **Console** (the dashboards), **Registry** (agent
  registry), **Test Lab** (public playground), **Trust Center** (/trust),
  **Compliance Center** (framework crosswalk + evidence pack exports).
- Endpoints, tools, and code identifiers are written exactly as they exist
  (`POST /v1/parse`, `screen_prompt`) and always set in monospace.

## 3. Voice

The Parse voice is a calm security engineer who documents everything.

Rules (these extend the house writing system — plain words, short sentences,
active voice):

1. **Evidence-first.** Lead with the receipt, the number, the mechanism.
   "Every verdict ships with a receipt" beats "enterprise-grade security."
2. **No fear-mongering.** Describe the attack surface factually; never sell
   with dread. The reader already knows injection is real.
3. **State limits in the open.** The sentence "Detection reduces risk; it does
   not replace least-privilege tools or output validation" (or a close
   variant) appears on every marketing surface. Honesty is the differentiator.
4. **Governed, not guarded.** Prefer governance vocabulary (registry, policy,
   receipt, attestation, disposition) over combat vocabulary (shield, fortress,
   defend, weapon). Verdict vocabulary is fixed: allow / warn / block.
5. **No hype adjectives.** Banned: bulletproof, military-grade, cutting-edge,
   revolutionary, comprehensive, robust, seamless, "100% protection."
   Numbers make the claim or the claim goes.

**Terminology (canonical spellings):**

| Term | Use it for | Not |
|------|-----------|-----|
| screening | the act of evaluating text | scanning, filtering |
| verdict | the decision (allow/warn/block) | judgment, result |
| receipt | the audit record of a verdict | log entry, event |
| enforcement dial | monitor/warn/block setting | mode, switch |
| trust boundary | where untrusted text meets authority | perimeter (ok in prose, not as term) |
| surface | one of the four boundary types | vector, channel |
| fleet | an org's set of agents | swarm, army |
| coverage attestation | screened-vs-unscreened report | coverage score |
| policy pack | OWASP-aligned preset policy bundle | template, profile |
| data grant | an agent's access permission to a data source | permission (ok in prose, not as term) |
| egress rule | a constraint on outbound data flows | firewall rule |
| evidence pack | tamper-evident compliance export | audit report (ok in prose, not as term) |
| framework crosswalk | mapping of Parse controls to compliance frameworks | compliance matrix |
| approval matrix | per-action human-approval requirement table | sign-off list |
| enforcement floor | the minimum action a flag forces (block/sandbox/log) | threshold |

## 4. Claims and proof

- Every public claim must be verifiable in the product or docs today.
  Approved numeric claims: pattern layer ~0.3ms p95, 126+ pattern rules, 9
  risk categories, 4 detection layers, risk scale 0–10, receipt on every
  verdict, free tier 10 req/min, 30-day self-serve keys, x402 from $0.005
  (USDC on Base), Pro $49/10K, Team $199/50K, Compliance $999/mo, Security
  Audit $47 one-time.
- **Four screening surfaces:** input (`POST /v1/parse`), output
  (`POST /v1/screen-output`), handoff (`POST /v1/agent/trust/verify`),
  generated-output re-screen. All four produce the same receipt structure.
- **Pipeline layers are four:** (1) deterministic pattern matching with text
  normalization, (2) structural & contextual risk analysis (encoded payloads,
  hidden content, callback URLs, tool-result JSON injection, memory
  contamination, high-risk action bypass), (3) LLM semantic analysis when
  configured, (4) optional isolated sandbox execution.
- **Compliance framework crosswalk** covers OWASP Top 10 for LLM Applications
  (2025), NIST AI RMF 1.0, EU AI Act, ISO/IEC 42001, and SOC 2 Trust Services
  Criteria. Language is always "framework crosswalk" or "framework mapping,"
  never "certification" for frameworks without a cert body.
- **Detection metrics** (internal, non-claimable without independent holdout):
  pattern recall ≥0.95, benign FPR ≤0.002, public F1 0.976 on the frozen
  holdout corpus. Quote these only with the dataset name, date, and the
  "non-claimable without independent holdout" caveat.
- **Never fabricate social proof.** No invented customers, logos, quotes,
  case studies, or review scores. Until real customer proof exists, proof is
  the product itself: live latency, the test lab, machine-readable surfaces.
- SOC 2 language is always "SOC 2-**aligned** controls" until a report exists.
  Never imply certification.
- Benchmarks are quoted only with dataset, date, and limitations attached.

### Claims-lint CI gate

The `FEATURE_STATUS` registry in `src/lib/product-facts.ts` is the single
source of truth for shipped vs. building vs. planned features. The
`claims-lint` CI gate fails the build if a page references a feature marked
"planned" or "building" without an "in development" qualifier. When a feature
ships, update `FEATURE_STATUS` to `"shipped"` in the same PR that adds
marketing copy — the brand claims section here should mirror those statuses.

## 5. Calls to action

- Primary CTA everywhere: **Install Parse** (variant: "Install Parse — free").
  The verb is install because that is the flow: `npm install @parsethis/sdk`,
  or add the MCP endpoint, or one keygen curl. Never "Get API key" as a
  primary CTA — keys are plumbing, not the product.
- Secondary CTA by audience: builders → "Open the Test Lab" / "Read the docs";
  security → "See the framework crosswalk" / "Talk to security engineering";
  executive → "Request a security briefing" / "Start a Security Audit."
- Under a primary CTA, show the self-serve fact line in monospace:
  `npm install @parsethis/sdk · no credit card, no sales call`.

## 6. Logo

- The mark is the **Event Horizon** (adopted 2026-08-09): a black pupil
  ringed by an accretion glow — amber `#ffb454` inner ring fading to Parse
  Blue `#3d7bff` at the rim, horizon keyline `#ffd9a0`. It is the trust
  boundary, the eye that watches everything crossing it, and (per the
  holographic principle) the surface where the record lives. Source of truth
  is `src/lib/logo.ts`. Do not redraw it per surface.
- The mark must read on both dark and light grounds: the pupil stays pure
  black; the accretion gradient carries the identity.
- Accretion amber in atmosphere/logo contexts does not violate the
  risk-color rule (§7); on data surfaces, amber remains reserved for
  warn-tier content.
- Clearspace: half the mark's diameter on all sides. Minimum size 16px
  (favicon-tested).
- Don'ts: no shields, locks, robots, or hoodie iconography attached to the
  mark; no rotation; no extra glows beyond the built-in gradient; never
  place a red element inside the pupil.

## 7. Color

Two sanctioned themes. Tokens are CSS variables; no hard-coded hex in page
styles.

**Parse Blue (brand accent):**

| Token | Light theme | Dark theme |
|-------|------------|-----------|
| `--blue` (primary action) | `#1f5fe0` | `#3d7bff` |
| `--blue-hover` | `#1a51c2` | `#6b9dff` |
| `--blue-dim` (fills) | `#eaf1ff` | `rgba(61,123,255,.12)` |

The production site currently ships `#0b66ff`; treat it as the legacy value.
New surfaces use the tokens above; migrate old surfaces when touched.

**Neutrals:**

| Role | Light | Dark |
|------|-------|------|
| Background | `#ffffff` / `#f7f9fc` | `#0c0f14` / `#10141b` |
| Panel | `#ffffff` / `#f2f5fa` | `#131822` / `#182030` |
| Hairline | `#e3e8f0` / `#cfd7e4` | `#222b3a` / `#2d3a50` |
| Text | `#0f1620` → `#5a6678` → `#8b96a8` | `#dfe6f1` → `#8b98ad` → `#5d6a80` |

**Verdict colors (semantic only — never decorative):**

| Verdict | Light | Dark |
|---------|-------|------|
| allow / safe | `#10794f` on `#e6f6ee` | `#34d18b` |
| warn | `#9a6410` on `#fdf3e0` | `#f5b04c` |
| block / critical | `#c0392f` on `#fdecea` | `#f2564d` |

Rules: one accent per page (Parse Blue); verdict colors appear only on
verdicts, risk numbers, and status; body text never sits below WCAG AA
contrast; red is never used for emphasis of non-risk content.

## 8. Typography

- **UI and display:** Schibsted Grotesk (weights 400–800). Display at
  -0.03em tracking; never below 400.
- **Data, code, endpoints, receipts:** IBM Plex Mono. All numerals in data
  contexts use `font-variant-numeric: tabular-nums`.
- Body 16–16.5px, line-height 1.6. Display clamps between 40–68px.
- The production site currently ships DM Sans; treat as legacy, migrate when
  touched.
- Don'ts: no Inter/Roboto/Arial; no more than the two families per surface;
  no all-caps body text (kickers and labels only, letterspaced ≥ .1em).

## 9. UI idioms

Recurring components that make a surface read as Parse:

- **Receipt strip:** monospace key-value line (receipt id, surface, risk,
  verdict, categories, action, latency). Appears wherever a verdict is shown.
- **Verdict chip:** pill, mono, lowercase (`blocked`, `warned`, `allowed`),
  semantic color fills from §7.
- **Stat cell:** segmented strip of 4–5 cells (label / big tabular number /
  footnote), hairline-divided, not floating cards.
- **Console frame:** product screenshots are framed in a neutral browser
  chrome with the real URL; mock data must be plausible and clearly non-real
  (org "acme-industries").
- **Enforcement dial:** MONITOR / WARN / BLOCK segmented control, active
  segment filled with Parse Blue.
- **Framework badge:** small pill, mono, showing a compliance framework
  short-name (e.g. `OWASP LLM`, `NIST AI RMF`, `SOC 2`). Appears on evidence
  pack exports and the compliance dashboard.
- **Policy pack card:** labelled card showing pack name, description, and the
  enforcement floor it sets (e.g. "block on prompt_injection ≥ 7"). Parse Blue
  accent on the active pack.
- **Approval gate:** inline panel that appears when a verdict triggers an
  approval-request, showing the blocked action, reason, and approve / deny
  controls.
- Radius: 8–14px. Borders: 1px hairline everywhere; shadows soft and rare.
- Miller's law: navigation and section groups hold 4–7 items; a page has
  at most 7 top-level zones.

## 10. Motion

One well-orchestrated page-load sequence beats scattered effects: staggered
reveals ≤ 1.2s total, each element ≤ 400ms, `animation-fill-mode: both`.
Allowed accents: verdict stamp-in, row landing, dial set. No scroll-jacking,
no parallax, no looping attention-seekers except status pulses. Respect
`prefers-reduced-motion`.

## 11. Imagery

- The product is the imagery: consoles, receipts, diagrams. No stock photos.
- Diagrams use the line-work style: hairline boxes, dashed untrusted flows,
  solid screened flows, Parse checkpoint filled in accent.
- Never: hooded hackers, padlocks, shields, binary rain, glowing brains.

## 12. Machine-readable brand

Agents are an audience. Discovery surfaces (`/llms.txt`, `/openapi.json`,
`/mcp`, `/skill`, `/v1/pricing`) carry the same positioning language as the
human site, kept in sync when this document changes. The 402 and 401 responses
are brand surfaces too: they stay self-describing and polite.

---

Appendix — approved short descriptions:

- ≤ 60 chars: `Agent governance & compliance. Every decision receipted.`
- ≤ 120 chars: `Parse governs agent fleets: registry, runtime policy, boundary screening, and an audit receipt for every decision.`
- Tagline candidates: "Every agent governed. Every decision receipted." ·
  "Screening is the floor. Governance is the product." · "Screen before
  authority."

---

## Change log

- **v1.2 (2026-08-09):** Logo replaced with the Event Horizon mark. Landing
  page moved to the dark full-viewport design (serif hero, boundary-gate
  animation, starfield/aurora, scroll-driven hue); docs/blog/pricing keep the
  light shell. Accretion amber sanctioned for atmosphere and logo.

- **v1.1 (2026-08-09):** Updated Govern/Enforce/Prove pillars to reflect the
  full platform buildout — agent registry, policy packs, data governance,
  egress control, approval matrix, enforcement floor, signed identity, SSO,
  gateway proxy, four-layer pipeline (126+ patterns + contextual + intent
  detection), compliance framework crosswalk (5 frameworks), SIEM forwarding,
  evidence pack export. Added Compliance tier and Security Audit to approved
  claims. Added new terminology (policy pack, data grant, egress rule,
  evidence pack, framework crosswalk, approval matrix, enforcement floor).
  Added new UI idioms (framework badge, policy pack card, approval gate).
  Added claims-lint CI gate section.
- **v1.0 (2026-08-09):** Initial brand guidelines — reposition as agent
  governance and compliance platform.
