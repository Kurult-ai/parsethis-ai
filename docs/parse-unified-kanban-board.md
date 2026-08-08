# Parse Enterprise Agent Compliance + GTM Enablement — Unified Kanban Board v5.0

**Source:** Implementation Plan v2.1 (Aug 8, 2026) + GTM Enablement Plan (Aug 8, 2026) + GTM Enhancement Review (Aug 8, 2026) + Traffic Secrets Framework Mapping (Aug 8, 2026) · **73 tasks** · 19 phases (0–18)
**Repo:** `parse-for-agents-live`
**Tracks:** Compliance (41 tasks, Phases 0–12) · GTM Enablement (18 tasks, Phases 13–15) · Deferred (7 items, Phase 16) · GTM Enhancements (9 tasks, Phase 17) · Demand Generation (5 tasks, Phase 18)
**Generated:** Aug 8, 2026 (v5.0 — updated with Traffic Secrets demand-generation tasks)

---

## Table of Contents

1. [Task Master Table](#1-task-master-table)
2. [Swimlanes & Ordered Backlogs](#2-swimlanes--ordered-backlogs)
3. [Critical Path](#3-critical-path)
4. [Milestone Gates](#4-milestone-gates)
5. [Cross-Track Dependencies](#5-cross-track-dependencies)
6. [WIP Limits](#6-wip-limits)
7. [Parallelization Opportunities](#7-parallelization-opportunities)
8. [Bottleneck Analysis](#8-bottleneck-analysis)
9. [Sprint Board (First 3 Sprints)](#9-sprint-board-first-3-sprints)
10. [Appendix: Dependency Adjacency Matrix](#appendix-dependency-adjacency-matrix)

---

## 1. Task Master Table

> **Track** column: **C** = Compliance · **G** = GTM Enablement · **D** = Deferred (demand-gated)
> ✅ = Already complete (12 compliance tasks)

### Compliance Tasks (Phases 0–12)

| Task | Track | Phase | Title | Assignee | Depends On | Est. Days | Blocks (directly) |
|------|-------|-------|-------|----------|------------|-----------|-------------------|
| ✅ 0.1 | C | 0 | Prisma Migration — Deploy Compliance Schema | Temujin | — | 1 | 1.1, 2.1, 3.1, 4.1, 5.1 |
| ✅ 0.2 | C | 0 | Clean Temp Files | Temujin | — | 0.25 | — |
| ✅ 1.1 | C | 1 | Agent Registry CRUD API | Temujin | 0.1 | 3 | 1.2, 1.3, 1.4, 4.1, 8.1, 8.2, 10.1, 11.1 |
| 1.2 | C | 1 | Agent Dashboard Tab | Chagatai | 1.1 | 2 | — |
| ✅ 1.3 | C | 1 | Auto-Registration from Screening Events | Temujin | 1.1 | 2 | — |
| ✅ 1.4 | C | 1 | Kill Switch (Agent / Key Freeze) | Temujin | 1.1 | 2 | — |
| ✅ 2.1 | C | 2 | Policy Revision API | Temujin | 0.1 | 2 | 2.2, 2.3, 2.4, 2.5 |
| ✅ 2.2 | C | 2 | Custom Rule Engine (JSON Rule DSL v1) | Temujin | 2.1 | 3 | 11.1 |
| ✅ 2.3 | C | 2 | Enforcement Dial (monitor → warn → block) | Temujin | 2.1 | 3 | 2.4, 8.1, 8.2, 8.3, 8.4, 8.5, 12.2 |
| ✅ 2.4 | C | 2 | Per-Environment Policy Pinning | Temujin | 2.1, 2.3 | 2 | — |
| ✅ 2.5 | C | 2 | Active Holes Panel & Bypass Expiry | Temujin | 2.1 | 2 | — |
| ✅ 3.1 | C | 3 | SIEM Forwarding — End-to-End Test & Bug Fixes | Temujin | 0.1 | 2 | 3.2 |
| 3.2 | C | 3 | Real-Time SIEM Forwarding Worker | Temujin | 3.1 | 2 | 3.3 |
| 3.3 | C | 3 | Alert Routing Rules | Temujin | 3.2 | 2 | 8.5 |
| 4.1 | C | 4 | Evidence Pack Generator | Temujin | 0.1, 1.1 | 2 | 4.2 |
| 4.2 | C | 4 | Compliance Reporting Templates | Chagatai | 4.1 | 2 | — |
| 5.1 | C | 5 | Organization Model Activation | Temujin | 0.1 | 3 | 5.2, 6.1, 11.1 |
| 5.2 | C | 5 | RBAC Roles | Temujin | 5.1 | 2 | 6.1 |
| 6.1 | C | 6 | SSO Integration (WorkOS/Clerk) | Temujin | 5.2 | 5 | — |
| 7.1 | C | 7 | Deploy Compliance Migration to Production | Kublai | Phases 0–1 done | 1 | 7.2, 7.3, 9.1, 9.4 |
| 7.2 | C | 7 | Documentation Update | Chagatai | 7.1 | 3 | — |
| 7.3 | C | 7 | Pricing Tier Activation | Kublai | 7.1 + checklist | 1 | — |
| 8.1 | C | 8 | Data Source Registry & Per-Agent Access Grants | Temujin | 1.1, 2.3 | 3 | 8.2, 8.3, 8.4, 8.5, 8.6, 10.4 |
| 8.2 | C | 8 | Tool Allowlist Enforcement | Temujin | 1.1, 2.3 | 2 | 8.6, 10.3 |
| 8.3 | C | 8 | Egress Destination & External Sharing Controls | Temujin | 8.1 | 3 | 8.6 |
| 8.4 | C | 8 | Data Volume Budgets & Bulk-Movement Detection | Temujin | 8.1 | 2 | 8.6 |
| 8.5 | C | 8 | Action Approval Matrix | Temujin | 8.1, 3.3 | 2 | 8.6, 10.3 |
| 8.6 | C | 8 | Data Governance Dashboard Tab | Chagatai | 8.1–8.5 | 3 | — |
| 9.1 | C | 9 | SDK Interceptors — `parse.wrap()` | Temujin | 7.1 | 4 | 9.2, 9.3, 9.4, 10.1 |
| 9.2 | C | 9 | Coverage Attestation | Temujin | 9.1 | 2 | — |
| 9.3 | C | 9 | CI Gates — Lint Rule + Compliance Regression | Temujin | 9.1 | 2 | — |
| 9.4 | C | 9 | Framework Adapters — Hermes Middleware + OpenClaw Plugin | Temujin | 9.1, 7.1 | 4 | 9.5 |
| 9.5 | C | 9 | Policy Packs + Fleet Provisioning CLI | Temujin | 9.4, 10.1, 8.1 | 3 | — |
| 10.1 | C | 10 | Signed Agent Identity | Temujin | 1.1, 9.1 | 3 | 10.2, 10.4, 12.2 |
| 10.2 | C | 10 | Screening Receipts v1 | Temujin | 10.1 | 3 | 10.3 |
| 10.3 | C | 10 | MCP Screening Proxy — Tool-Path Choke Point | Temujin | 10.2, 8.2, 8.5 | 3 | — |
| 10.4 | C | 10 | Delegation-Chain Policy Propagation | Temujin | 10.1, 8.1 | 2 | — |
| 11.1 | C | 11 | Platform Hardening | Ogedei | 1.1, 2.2, 5.1 | 4 | 11.2 |
| 11.2 | C | 11 | Trust Package & SOC 2 Kickoff | Kublai | 11.1 | 3 | — |
| 12.1 | C | 12 | Gateway Build-vs-Partner Decision Spike (ADR) | Jochi | — (1-wk spike) | 5 | 12.2 |
| 12.2 | C | 12 | Gateway Mode "Available" (Opt-In Screening Proxy) | Temujin | 12.1, 2.3, 10.1 | 5 | — |

### GTM Enablement Tasks (Phases 13–15)

| Task | Track | Phase | Title | Assignee | Depends On | Est. Days | Blocks (directly) |
|------|-------|-------|-------|----------|------------|-----------|-------------------|
| 13.1 | G | 13 | Landing Page Build | Chagatai | 15.1 | 3 | 13.7, 14.3, 14.4 |
| 13.2 | G | 13 | Pricing Page & Tier Display | Chagatai | 7.3, 15.1 | 1 | — |
| 13.3 | G | 13 | Nurture Email Sequence (Content + Flows) | Ogedei | 15.2 | 2 | 13.4 |
| 13.4 | G | 13 | Marketing Automation Wiring (ESP + CRM handoff) | Ogedei | 13.3 | 2 | 14.1, 14.2 |
| 13.5 | G | 13 | Demo Tenant Provisioning (sandbox org + seed data) | Chagatai | **M1** (7.1 deploy) | 1 | 13.8 |
| 13.6 | G | 13 | Public-Facing Copy & Content (landing, docs, pitch) | Chagatai | 13.7 | 2 | — |
| 13.7 | G | 13 | ★ Claims Gate — Compliance Review of All Public Copy | Ogedei + Mongke (review) | 13.1 | 1 | 13.6 |
| 13.8 | G | 13 | Delivery Kit / Onboarding Docs (references M1/M2) | Ogedei | 13.5, **M1/M2** (7.1, 7.2) | 2 | — |
| 14.1 | G | 14 | Lead Scoring & Qualification Model | Ogedei | 13.4 | 2 | — |
| 14.2 | G | 14 | CRM Integration (pipeline, deal stages) | Kublai | 13.4 | 2 | — |
| 14.3 | G | 14 | Conversion Analytics & Funnel Tracking | Ogedei | 13.1, 15.5 | 1 | — |
| 14.4 | G | 14 | A/B Testing Framework | Kublai | 13.1 | 1 | — |
| 14.5 | G | 14 | Market & Competitor Research (positioning brief) | Batu | — | 3 | — |
| 15.1 | G | 15 | DNS / Domain Configuration | Operator (Danny) | — | 0.5 | 13.1, 13.2, 15.4, 15.5 |
| 15.2 | G | 15 | Email Infrastructure (SPF / DKIM / DMARC) | Operator (Danny) | — | 0.5 | 13.3 |
| 15.3 | G | 15 | Stripe Payment Configuration | Operator (Danny) | — | 0.5 | 7.3 |
| 15.4 | G | 15 | Social / Developer Profiles (GitHub org, X, LinkedIn) | Operator (Danny) | 15.1 | 0.5 | — |
| 15.5 | G | 15 | Analytics & Tracking Accounts (GA4, PostHog) | Operator (Danny) | 15.1 | 0.5 | 14.3 |

### GTM Enhancement Tasks (Phase 17)

> **Track:** **E** = GTM Enhancement (from GTM Plan Review, Aug 8 2026)
> These address the blind spot identified in review: the plan was 100% sales-led with no developer self-serve track, no bottom-funnel SEO, and no attribution infrastructure.

| Task | Track | Phase | Title | Assignee | Depends On | Est. Days | Blocks (directly) |
|------|-------|-------|-------|----------|------------|-----------|-------------------|
| 17.1 | E | 17 | ★ Developer Self-Serve Activation Loop | Chagatai | 13.1 | 3 | 17.2 |
| 17.2 | E | 17 | Public No-Login Demo Experience | Chagatai | 17.1, 13.5 | 1 | — |
| 17.3 | E | 17 | Comparison / Competitive SEO Pages | Chagatai | 13.7 | 3 | — |
| 17.4 | E | 17 | Attribution & UTM Tracking Infrastructure | Ogedei | 13.1, 13.4 | 1 | 17.5 |
| 17.5 | E | 17 | LLM-Tool Discovery Monitoring Cron | Ogedei | — | 0.5 | — |
| 17.6 | E | 17 | Long-Tail Nurture Expansion (post-5-email) | Ogedei | 13.3 | 1 | — |
| 17.7 | E | 17 | Post-Implementation Expansion Lifecycle | Kublai | 13.8 | 1 | — |
| 17.8 | E | 17 | Incident Response Runbook | Kublai | 13.6 | 0.5 | — |
| 17.9 | E | 17 | Claims Gate Dynamic Sweep (quarterly manual) | Mongke | 13.7 | 0 (criteria) | — |

### Demand Generation Tasks (Phase 18)

> **Track:** **DG** = Demand Generation (from Traffic Secrets by Russell Brunson, mapped to Parse context)
> These fill the demand-generation engine that feeds the sales motion. The GTM plan is a conversion machine; Traffic Secrets provides the fuel. Key frameworks applied: Dream 100, Interview Show, Shadow Funnel, Hook/Story/Offer, dual pain/pleasure messaging, and Value Ladder completeness.

| Task | Track | Phase | Title | Assignee | Depends On | Est. Days | Blocks (directly) |
|------|-------|-------|-------|----------|------------|-----------|-------------------|
| 18.1 | DG | 18 | ★ Dream 100 List (Gatekeeper Mapping) | Batu | — | 2 | 18.3 |
| 18.3 | DG | 18 | ★ Shadow Funnel Capture Architecture | Chagatai | 18.1, 13.1 | 2 | — |
| 18.4 | DG | 18 | Dual-Messaging Framework (Pain + Pleasure) | Chagatai | 13.7 | 1 | — |
| 18.5 | DG | 18 | Value Ladder Rung — $47 Self-Serve Audit Product | Kublai | 7.1 | 2 | — |
| 18.6 | DG | 18 | Affiliate / Referral Program Architecture | Kublai | 13.8 | 1 | — |

### Deferred — Phase 16 (Demand-Gated, Not Estimated)

| Item | Track | Title | Trigger |
|------|-------|-------|---------|
| 16.1 | D | Paid Advertising Campaigns | Funnel breaks even (CAC ≤ LTV), not just ≥ 50 leads/mo — per Traffic Secrets, scale paid the moment your funnel pays for itself |
| 16.2 | D | Partner / Integration Program | First inbound partnership request |
| 16.3 | D | Conference / Event Presence | SOC 2 Type II achieved |
| 16.4 | D | Advanced Marketing Automation (multi-touch attribution) | ≥ 200 active accounts |
| 16.5 | D | Community / Distribution Play (Discord, dev communities) | ≥ 100 active API keys |
| 16.6 | D | Referral Mechanics (formal incentive structure) | First partner-referred deal |
| 16.7 | D | Pricing Validation Survey (willingness-to-pay test) | First 10 scoping submissions |

**Total estimated effort:** Compliance ~106 person-days · GTM ~28 person-days · GTM Enhancements ~11 person-days · Demand Generation ~8 person-days · **Combined ~153 person-days.**
**Already complete:** 33 of 73 tasks (✅).

---

## 2. Swimlanes & Ordered Backlogs

### 🟦 Temujin (Implementation) — 28 tasks

**Role:** Backend engineering, pipeline integration, SDKs, cryptography. The compliance critical-path bottleneck.
**GTM overlap:** **Zero** — GTM work deliberately avoids Temujin's path. His only GTM-adjacent contribution is compliance deliverables already built (M1).

| Order | Task | Title | Track | Deps (within lane) | Deps (cross-lane) |
|-------|------|-------|-------|---------------------|-------------------|
| 1 | ✅ 0.1 | Prisma Migration | C | — | — |
| 2 | ✅ 0.2 | Clean Temp Files | C | — | — |
| 3 | ✅ 1.1 | Agent Registry CRUD API | C | 0.1 | — |
| 4 | ✅ 2.1 | Policy Revision API | C | 0.1 | — |
| 5 | ✅ 3.1 | SIEM Forwarding — E2E Test | C | 0.1 | — |
| 6 | 5.1 | Organization Model Activation | C | 0.1 | — |
| 7 | ✅ 1.3 | Auto-Registration from Screening Events | C | 1.1 | — |
| 8 | ✅ 1.4 | Kill Switch | C | 1.1 | — |
| 9 | ✅ 2.2 | Custom Rule Engine (JSON DSL) | C | 2.1 | — |
| 10 | ✅ 2.3 | **★ Enforcement Dial** | C | 2.1 | — |
| 11 | ✅ 2.4 | Per-Environment Policy Pinning | C | 2.1, 2.3 | — |
| 12 | ✅ 2.5 | Active Holes Panel & Bypass Expiry | C | 2.1 | — |
| 13 | 3.2 | Real-Time SIEM Worker | C | 3.1 | — |
| 14 | 4.1 | Evidence Pack Generator | C | 0.1, 1.1 | — |
| 15 | 5.2 | RBAC Roles | C | 5.1 | — |
| 16 | 3.3 | Alert Routing Rules | C | 3.2 | — |
| 17 | 6.1 | SSO Integration (WorkOS/Clerk) | C | 5.2 | — |
| 18 | 8.1 | Data Source Registry & Grants | C | 1.1, 2.3 | — |
| 19 | 8.2 | Tool Allowlist Enforcement | C | 1.1, 2.3 | — |
| 20 | 8.3 | Egress Destination Controls | C | 8.1 | — |
| 21 | 8.4 | Data Volume Budgets | C | 8.1 | — |
| 22 | 8.5 | Action Approval Matrix | C | 8.1, 3.3 | — |
| 23 | 9.1 | SDK Interceptors — `parse.wrap()` | C | — | 7.1 (Kublai) |
| 24 | 9.4 | Framework Adapters (Hermes/OpenClaw) | C | 9.1 | 7.1 (Kublai) |
| 25 | 10.1 | Signed Agent Identity | C | 1.1, 9.1 | — |
| 26 | 9.2 | Coverage Attestation | C | 9.1 | — |
| 27 | 9.3 | CI Gates — Lint + Regression | C | 9.1 | — |
| 28 | 10.2 | Screening Receipts v1 | C | 10.1 | — |
| 29 | 10.4 | Delegation-Chain Policy Propagation | C | 10.1, 8.1 | — |
| 30 | 9.5 | Policy Packs + Fleet CLI | C | 9.4, 10.1 | — |
| 31 | 10.3 | MCP Screening Proxy | C | 10.2, 8.2, 8.5 | — |
| 32 | 12.2 | Gateway Mode "Available" | C | 2.3, 10.1 | 12.1 (Jochi) |

> **Note:** Tasks 9.1–9.5 and 10.1–10.4 are interleaved by dependency; the ordering above respects all edges.

### 🟩 Chagatai (Frontend/Content) — 15 tasks (5 C + 4 G + 3 E + 3 DG)

**Role:** Frontend builds, dashboards, documentation, landing page, public-facing copy, developer activation, SEO content, demand-generation (shadow funnel, messaging framework).

| Order | Task | Title | Track | Deps (cross-lane) |
|-------|------|-------|-------|-------------------|
| 1 | 1.2 | Agent Dashboard Tab | C | 1.1 (Temujin) ✅ |
| 2 | 4.2 | Compliance Reporting Templates | C | 4.1 (Temujin) |
| 3 | 8.6 | Data Governance Dashboard Tab | C | 8.1–8.5 (Temujin) |
| 4 | 7.2 | Documentation Update | C | 7.1 (Kublai) |
| 5 | 13.1 | **Landing Page Build** | G | 15.1 (Operator) |
| 6 | 13.2 | Pricing Page & Tier Display | G | 7.3 (Kublai), 15.1 (Operator) |
| 7 | 13.5 | Demo Tenant Provisioning | G | M1 / 7.1 (Kublai) |
| 8 | 13.6 | Public-Facing Copy & Content | G | 13.7 (Ogedei) |
| 9 | 13.7 content assist | Claims Gate copy support | G | 13.1 self |
| 10 | **17.1** | **★ Developer Self-Serve Activation Loop** | E | 13.1 |
| 11 | **17.2** | **Public No-Login Demo (`/demo`)** | E | 17.1, 13.5 |
| 12 | **17.3** | **Comparison / Competitive SEO Pages** | E | 13.7 |
| 13 | **18.3** | **★ Shadow Funnel Capture Architecture** | DG | 18.1 (Batu), 13.1 |
| 14 | **18.4** | **Dual-Messaging Framework (Pain + Pleasure)** | DG | 13.7 (Ogedei) |
| 15 | 14.1 content | Content production (HSO framework) | G | 13.1 self |

### 🟧 Ogedei (Ops / GTM Build) — 12 tasks (2 C + 6 G + 4 E)

**Role:** Platform hardening, ops infrastructure, GTM automation, claims gate, attribution infrastructure, nurture lifecycle.

| Order | Task | Title | Track | Deps (cross-lane) |
|-------|------|-------|-------|-------------------|
| 1 | 11.1 | Platform Hardening | C | 1.1, 2.2, 5.1 (Temujin) |
| 2 | 13.7 | ★ Claims Gate — Copy Compliance Review | G | 13.1 (Chagatai) |
| 3 | 13.3 | Nurture Email Sequence | G | 15.2 (Operator) |
| 4 | 13.4 | Marketing Automation Wiring | G | 13.3 (self) |
| 5 | 13.8 | Delivery Kit / Onboarding Docs | G | 13.5 (Chagatai), M1/M2 |
| 6 | 14.1 | Lead Scoring & Qualification Model | G | 13.4 (self) |
| 7 | 14.3 | Conversion Analytics & Funnel Tracking | G | 13.1 (Chagatai), 15.5 (Operator) |
| 8 | 11.1 ops | Gateway ops support | C | 12.1 (Jochi) |
| 9 | **17.4** | **Attribution & UTM Tracking Infrastructure** | E | 13.1, 13.4 |
| 10 | **17.5** | **LLM-Tool Discovery Monitoring Cron** | E | — (starts immediately) |
| 11 | **17.6** | **Long-Tail Nurture Expansion** | E | 13.3 |

### 🟨 Kublai (Operator/Dogfood/GTM) — 9 tasks (3 C + 2 G + 2 E + 2 DG)

**Role:** Deploys, pricing decisions, trust/SOC 2, CRM and testing infrastructure, lifecycle management, incident response, value-ladder strategy, affiliate architecture.

| Order | Task | Title | Track | Deps (cross-lane) |
|-------|------|-------|-------|-------------------|
| 1 | 7.1 | Deploy Compliance Migration to Production | C | Phases 0–1 done (Temujin) |
| 2 | 7.3 | Pricing Tier Activation | C | 7.1 + checklist + 15.3 (Operator) |
| 3 | 11.2 | Trust Package & SOC 2 Kickoff | C | 11.1 (Ogedei) |
| 4 | 14.2 | CRM Integration | G | 13.4 (Ogedei) |
| 5 | 14.4 | A/B Testing Framework | G | 13.1 (Chagatai) |
| 6 | **17.7** | **Post-Implementation Expansion Lifecycle** | E | 13.8 |
| 7 | **17.8** | **Incident Response Runbook** | E | 13.6 |
| 8 | **18.5** | **Value Ladder Rung — $47 Self-Serve Audit Product** | DG | 7.1 |
| 9 | **18.6** | **Affiliate / Referral Program Architecture** | DG | 13.8 |

### 🟪 Jochi (Analysis) — 1 task

| Order | Task | Title | Track | Deps |
|-------|------|-------|-------|------|
| 1 | ✅ 12.1 | Gateway Build-vs-Partner Decision Spike (ADR) | C | — (timeboxed 1 week) |

### 🟥 Mongke (Reviewer/Crypto) — 0 primary tasks, 1 GTM review, 1 enhancement

**Role:** Dedicated reviewer for cryptographic work (Phase 10), schema migrations (0.1), org isolation (5.x), rule engine ReDoS (2.2). **GTM role:** Claims Gate reviewer (13.7) — verifies all public copy makes no unsubstantiated compliance/security claims. **Enhancement role:** Quarterly dynamic claims sweep (17.9) — reviews all customer-facing assets (emails, decks, social) against FEATURE_STATUS, not just repo-rendered pages.

### 🟫 Batu (Research) — 2 tasks *(NEW SWIMLANE)*

**Role:** Market research, competitive intelligence, positioning analysis, Dream 100 gatekeeper mapping.

| Order | Task | Title | Track | Deps |
|-------|------|-------|-------|------|
| 1 | 14.5 | Market & Competitor Research (positioning brief) | G | — (starts immediately, no blockers) |
| 2 | **18.1** | **★ Dream 100 List (Gatekeeper Mapping)** | DG | — (starts immediately) |

### 🟮 Operator / Danny (Manual Gates) — 5 tasks *(NEW SWIMLANE)*

**Role:** DNS, email infra, payment setup, social accounts — manual configuration tasks that cannot be automated or delegated to agent workers.

| Order | Task | Title | Track | Deps | Blocks |
|-------|------|-------|-------|------|--------|
| 1 | 15.1 | **DNS / Domain Configuration** | G | — | 13.1, 13.2, 15.4, 15.5 |
| 2 | 15.2 | **Email Infrastructure (SPF/DKIM/DMARC)** | G | — | 13.3 |
| 3 | 15.3 | **Stripe Payment Configuration** | G | — | 7.3 |
| 4 | 15.4 | Social / Developer Profiles | G | 15.1 | — |
| 5 | 15.5 | Analytics & Tracking Accounts | G | 15.1 | 14.3 |

> ⚠️ **15.1–15.3 are week-1 critical-path gates.** They are fast (0.5d each) but they are prerequisites for ALL public-facing and nurture work. The Operator should complete them on Day 1 of Sprint 2.

---

## 3. Critical Path

### Compliance Critical Path (unchanged from v2.1)

```
0.1 (1d) → 1.1 (3d) → 2.1 (2d) → 2.3★ (3d) → 8.1 (3d) → 8.3 (3d) → 7.1 (1d) → 9.1 (4d) → 10.1 (3d) → 10.2 (3d) → 10.3 (3d) → 12.2 (5d)
```

**Duration:** 34 working days serial (Temujin-owned segments).

### GTM Critical Path — Two Parallel Sub-Paths

#### GTM Sub-Path 1: Public-Facing

```
15.1 DNS (0.5d) → 13.1 Landing Page (3d) → 13.7 ★ Claims Gate (1d) → 13.6 Public Copy (2d)
```

**Duration:** 6.5 working days. Gates G1 (Public & Claim-Clean).

#### GTM Sub-Path 2: Nurture

```
15.2 Email Infra (0.5d) → 13.3 Nurture Sequence (2d) → 13.4 Marketing Automation (2d)
```

**Duration:** 4.5 working days. Gates G2 (Funnel Armed) — fully realized after 14.1 + 14.2.

### Unified Critical Path Diagram

```
COMPLIANCE TRACK (Temujin owns almost everything):
  0.1✅ ──→ 1.1✅ ──→ 2.1✅ ──→ 2.3★✅ ──→ 8.1 ──→ 8.3 ──┐
    │        │                   ║          ║        ║      │
    │        │                   ║          ║        └→ 8.2 ┤──→ 7.1 ──→ 9.1 ──→ 10.1 ──→ 10.2 ──→ 10.3
    │        │                   ║          └→ 2.4         │                     │             └→ 12.2
    │        │                   ║                        ├──→ 8.4              │
    │        │                   ║          ┌─ (3.3) ─────┘                     └→ 10.4
    │        │                   ║          └────────→ 8.5
    │        ├──→ 1.3✅                                     ├──→ 7.2 / 7.3
    │        ├──→ 1.4✅                                     │
    │        └──→ 4.1 ──→ 4.2                               │
    ├──→ 2.2✅ ─────────────────────────────────────────────┤
    ├──→ 3.1✅ ──→ 3.2 ──→ 3.3 ─────────────────────────────┤
    ├──→ 5.1 ──→ 5.2 ──→ 6.1                               │
    │              └──→ 11.1 ──→ 11.2                      │
    └──→ 12.1✅ (Jochi) ────────────────────────────────── ─┘

GTM TRACK (parallel to compliance — does NOT touch Temujin):
                                          
  OPERATOR:  15.1 DNS ──→ 15.4 Social ──┐
     (0.5d)     (0.5d)    15.5 Analytics─┤
                                        │
  CHAGATAI:  13.1 Landing ──→ 13.7★ Claims ──→ 13.6 Copy    [→ G1 PUBLIC]
     (3d)       (1d, Ogedei)    (2d)
                                        │
             13.2 Pricing ←── 7.3 (Kublai, compliance)
             13.5 Demo ←── M1 / 7.1 (compliance deploy)       [→ G3 REVENUE]
                 └──→ 13.8 Delivery Kit
                                        │
  OGEDEI:    15.2 Email ←── 13.3 Nurture ──→ 13.4 Automation──┤
     (0.5d,Op)   (2d)         (2d)                              │
                                        │                       ├──→ [→ G2 FUNNEL]
             14.1 Lead Scoring ←── 13.4                       │
             14.3 Analytics ←── 13.1 + 15.5                   │
                                        │
  KUBLAI:    14.2 CRM ←── 13.4                                 │
             14.4 A/B Test ←── 13.1                           │
                                        │
  BATU:      14.5 Research (no deps, starts Day 1) ───────────┘

  DEFERRED (Phase 16): demand-gated, not on critical path
```

### Key Insight: GTM Runs Parallel to Compliance

The GTM critical paths are **completely independent of Temujin's compliance work**, with two exceptions:
1. **13.5 Demo Tenant** needs M1 (7.1 deploy) — but this is a 1-day task that can start any time after deploy.
2. **13.8 Delivery Kit** references M1/M2 feature docs — content-gathering only, no code dependency.

**GTM adds ZERO days to Temujin's critical path.** GTM work is distributed across Chagatai, Ogedei, Kublai, Batu, and Operator — all running in parallel lanes.

---

## 4. Milestone Gates

### Compliance Milestones (M1–M4)

#### M1: Foundation Live ✅
> **Status:** Complete — all scope tasks done.

| | |
|---|---|
| **Scope** | Tasks 0.1, 0.2, 1.1, 1.3, 1.4, 2.1, 2.3 |
| **Exit Criteria** | ✅ Migration applied · ✅ Agent CRUD live · ✅ Auto-registration working · ✅ Kill switch functional · ✅ Policy versioning + enforcement dial working |
| **Exit Gate Owner** | Kublai |

#### M2: First Enforcement
| | |
|---|---|
| **Entry Criteria** | M1 complete (Task 2.3 done) ✅ |
| **Scope** | Tasks 1.2, 2.2 ✅, 2.4 ✅, 2.5 ✅, 3.1 ✅, 3.2, 3.3, 4.1, 4.2, 5.1, 5.2, 6.1, 7.1, 7.2, 7.3 |
| **Exit Criteria** | SIEM forwarding verified · Alert routing live · Evidence packs generate · Org model + RBAC + SSO working · **Deployed to production (7.1)** · Docs updated · Pricing tier gated |
| **Exit Gate Owner** | Kublai |

#### M3: Enterprise Ready
| | |
|---|---|
| **Entry Criteria** | M2 complete (Task 7.1 deployed) |
| **Scope** | Tasks 8.1–8.6, 11.1, 11.2 |
| **Exit Gate Owner** | Mongke |

#### M4: Assurance & Trust
| | |
|---|---|
| **Entry Criteria** | M3 complete (Task 8.x done) |
| **Scope** | Tasks 9.1–9.5, 10.1–10.4, 12.1 ✅, 12.2 |
| **Exit Gate Owner** | Kublai |

### GTM Milestones (G1–G3) *(NEW)*

#### G1: Public & Claim-Clean
> **Goal:** Landing page is live, all public copy has passed the Claims Gate, and the product is presentable to the market without overclaiming.

| | |
|---|---|
| **Entry Criteria** | M1 complete (✅), Operator gates 15.1 + 15.2 done |
| **Scope** | Tasks 15.1, 15.2, 13.1, 13.7 ★, 13.6 |
| **Exit Criteria** | ✅ DNS configured · ✅ Landing page live · ✅ Claims Gate passed (Mongke signed off — no unsubstantiated security/compliance claims) · ✅ Public copy finalized · ✅ Email infrastructure operational |
| **Exit Gate Owner** | Mongke (claims review) + Kublai (go-live sign-off) |
| **Est. Duration** | 6.5 working days from Operator Day 1 |

#### G2: Funnel Armed
> **Goal:** Nurture flows, marketing automation, lead scoring, and CRM are wired end-to-end. Inbound leads can flow from landing → email → CRM → pipeline.

| | |
|---|---|
| **Entry Criteria** | G1 partially complete (13.1 landing live, 15.2 email done) |
| **Scope** | Tasks 13.3, 13.4, 14.1, 14.2, 14.3, 14.5 |
| **Exit Criteria** | ✅ Nurture email sequence deployed · ✅ Marketing automation triggers live · ✅ Lead scoring model operational · ✅ CRM pipeline configured · ✅ Conversion analytics tracking · ✅ Market research brief delivered |
| **Exit Gate Owner** | Kublai |
| **Est. Duration** | 8–10 working days from G1 entry (overlaps G1 by ~4 days) |

#### G3: Revenue Motion
> **Goal:** The product can accept payment, demo to prospects, and onboard new customers. The full revenue motion is armed end-to-end.

| | |
|---|---|
| **Entry Criteria** | M2 complete (7.1 deployed, pricing live), G1 complete |
| **Scope** | Tasks 15.3, 7.3, 13.5, 13.8 |
| **Exit Criteria** | ✅ Stripe configured · ✅ Pricing tier activated · ✅ Demo tenant provisioned with seed data · ✅ Delivery kit / onboarding docs published |
| **Exit Gate Owner** | Kublai |
| **Est. Duration** | 3–4 working days from M2 + G1 completion |

### Milestone Interlock Diagram

```
                    WEEK 1-2     WEEK 3-5        WEEK 5-7         WEEK 7-11
                    ─────────┬──────────────┬──────────────┬──────────────────
COMPLIANCE:    M1 ████████✅ │ M2 ██████████ │ M3 ████████  │ M4 ██████████████
                             │              │              │
GTM:           G1 ──────────████████████████│              │
                              (Public &      │              │
                               Claim-Clean)  │              │
               G2 ─────────────────────────██████████████  │
                                             (Funnel Armed) │
               G3 ───────────────────────────────────────████████
                                                            (Revenue Motion)
```

**Interlock rules:**
- **G1 depends on M1** — must have registry, dial, kill switch before making public claims. M1 is ✅ done.
- **G3 depends on M2** — pricing activation (7.3) requires production deploy (7.1) and Stripe config (15.3).
- **G2 can overlap M2/M3** — funnel automation doesn't need data governance or advanced enforcement.
- **GTM does NOT depend on M3 or M4** — GTM can complete entirely before M3/M4 finish.

### Milestone Timeline (Optimized, Unified)

```
Week 1-2:  ████ M1: Foundation Live ✅
           ████ G1 prep: Operator gates (15.1-15.3) on Day 1
Week 2-3:  ██████ G1: Public & Claim-Clean (landing → claims gate → copy)
Week 3-5:  ████████ M2: First Enforcement (overlaps M1 by 3d)
           ████ G2: Funnel Armed (nurture → automation → CRM)
Week 5-7:  ██████ M3: Enterprise Ready
           ██ G3: Revenue Motion (demo tenant + delivery kit)
Week 7-11: ██████████ M4: Assurance & Trust

Total compliance: ~11 weeks (55 working days)
Total GTM: ~3 weeks (15 working days), fully overlapped with M2-M3
```

---

## 5. Cross-Track Dependencies

These are the edges where GTM tasks depend on compliance deliverables (or vice versa).

| GTM Task | Compliance Dependency | Nature of Dependency | Timing |
|----------|-----------------------|-----------------------|--------|
| **13.5** Demo Tenant | **M1** (0.1 schema, 1.1 registry) + **7.1** deploy | Needs a deployed org with compliance schema to provision sandbox tenant | After 7.1 (Sprint 3) |
| **13.8** Delivery Kit | **M1/M2** features (7.1 deploy, 7.2 docs) | Onboarding docs reference live compliance features — needs accurate feature inventory | After 7.2 (Sprint 3-4) |
| **13.2** Pricing Page | **7.3** Pricing Tier Activation | Can't show pricing tiers until pricing is activated in the product | After 7.3 (Sprint 3) |
| **13.7** Claims Gate | **M1** deliverables (registry, dial, kill switch) | Claims review verifies public copy against actual live features | After M1 ✅ (already met) |
| **15.3** Stripe Config | **7.3** Pricing Tier Activation (reverse — 15.3 enables 7.3) | Stripe must be configured before pricing tier can accept payments | Day 1 (Operator) |
| **None** | — | **GTM does NOT depend on M3 or M4** | — |

### What GTM Deliberately Avoids

| Avoided Area | Reason | Impact on Compliance |
|--------------|--------|---------------------|
| **Temujin's lane** | He's at 68% capacity on compliance; adding GTM work would extend critical path by weeks | **Zero** — no Temujin time consumed by GTM |
| **Phase 8–10 enforcement internals** | GTM doesn't touch data governance, screening, or crypto — purely go-to-market | Zero |
| **Phase 12 gateway mode** | Gateway is compliance-internal; not needed for public launch | Zero |

---

## 6. WIP Limits

| Swimlane | WIP Limit | Rationale |
|----------|-----------|-----------|
| **Temujin** | **2** | 28 tasks, all on critical path. Unchanged — GTM/enhancements add zero tasks. |
| **Chagatai** | **3** | 15 tasks (5 C + 4 G + 3 E + 3 DG). Can parallelize a compliance build with a GTM/enhancement/demand-gen task. |
| **Ogedei** | **3** | 11 tasks (2 C + 6 G + 3 E). GTM/enhancement work is mostly independent of compliance. |
| **Kublai** | **2** | 9 tasks (3 C + 2 G + 2 E + 2 DG). Decision/verify tasks + CRM + lifecycle + value ladder + affiliate. |
| **Jochi** | **1** | 1 task. Unchanged. |
| **Mongke (review)** | **3** | Reviews Phases 0, 2, 5, 8, 10, 11, 12 + **Claims Gate (13.7)** + **Dynamic Sweep (17.9)**. |
| **Batu** | **1** | 2 tasks (research + Dream 100 mapping). |
| **Operator / Danny** | **3** | 5 tasks, all fast (0.5d each). Can batch DNS + email + Stripe in one sitting. |

### Escalation Rules
- When **Temujin's WIP reaches 2**: check delegation candidates (see §8). GTM work should never enter his queue.
- When **Operator gates 15.1–15.3 are not done by Day 2**: escalate to Danny — these block ALL public-facing GTM work.
- When **Claims Gate (13.7) is pending**: prioritize Mongke's review — it gates 13.6 and all downstream public copy.

---

## 7. Parallelization Opportunities

### Compliance Parallel Groups (unchanged from v2.1)

#### Parallel Group A: After Task 0.1 ✅ (Sprint 1 — complete)
1.1, 2.1, 3.1, 5.1, 4.1, 12.1 — all started from 0.1.

#### Parallel Group B: After Task 1.1 ✅ (Sprint 1–2 — complete)
1.2, 1.3 ✅, 1.4 ✅, 4.1 — all started from 1.1.

#### Parallel Group C: After Task 2.3 ✅ (Sprint 2–3 — in progress)
2.4 ✅, 2.5 ✅, 8.1, 8.2 — enforcement dial gates Phase 8.

#### Parallel Group D: After Task 8.1 (Sprint 3–4)
8.3, 8.4, 8.5 — all depend only on 8.1 (8.5 also needs 3.3). Best delegation candidates.

#### Parallel Group E: Phase 11 — Always Parallel
11.1 (Ogedei) → 11.2 (Kublai) — runs entirely off Temujin's path.

#### Parallel Group F: Post-Deploy (Sprint 4+)
9.1 → 9.2, 9.3, 9.4, 10.1 — SDK and crypto chain.

### GTM Parallel Groups *(NEW)*

#### GTM Parallel Group G: Operator Day 1 (Sprint 2 start)

| Task | Assignee | Why Parallel |
|------|----------|-------------|
| 15.1 DNS | Operator | No deps — start immediately |
| 15.2 Email Infra | Operator | No deps — start immediately |
| 15.3 Stripe | Operator | No deps — start immediately |
| 14.5 Market Research | Batu | No deps — starts immediately, 3-day research sprint |

> All four can start on Day 1 of Sprint 2. 15.1–15.3 take 0.5d each; Danny should knock them out in the first morning.

#### GTM Parallel Group H: After 15.1 + 15.2 (Sprint 2 mid-week)

| Task | Assignee | Why Parallel |
|------|----------|-------------|
| 13.1 Landing Page | Chagatai | Needs 15.1 DNS — starts once domain is live |
| 13.3 Nurture Email | Ogedei | Needs 15.2 email infra — starts once email is configured |
| 15.4 Social Profiles | Operator | Needs 15.1 — quick follow-up |
| 15.5 Analytics Accounts | Operator | Needs 15.1 — quick follow-up |

#### GTM Parallel Group I: After 13.1 (Sprint 2 end / Sprint 3)

| Task | Assignee | Why Parallel |
|------|----------|-------------|
| 13.7 ★ Claims Gate | Ogedei + Mongke | Needs 13.1 landing to review against |
| 14.3 Conversion Analytics | Ogedei | Needs 13.1 landing for tracking setup |
| 14.4 A/B Testing | Kublai | Needs 13.1 landing page |

#### GTM Parallel Group J: After 13.4 (Sprint 3)

| Task | Assignee | Why Parallel |
|------|----------|-------------|
| 14.1 Lead Scoring | Ogedei | Needs 13.4 automation wiring |
| 14.2 CRM Integration | Kublai | Needs 13.4 automation wiring |

### Tasks That MUST Serialize

| Chain | Reason |
|-------|--------|
| 0.1 → 1.1 → everything (compliance) | Hard dependency on schema |
| 2.1 → 2.3 → 8.1 → 8.3 → 8.6 (compliance) | Enforcement dial gates Phase 8 |
| 3.1 → 3.2 → 3.3 → 8.5 (compliance) | SIEM chain before approval matrix |
| 9.1 → 10.1 → 10.2 → 10.3 (compliance) | SDK → signing → receipts → proxy |
| 12.1 → 12.2 (compliance) | ADR decision before gateway build |
| **15.1 → 13.1 → 13.7 → 13.6** (GTM) | DNS → landing → claims gate → public copy |
| **15.2 → 13.3 → 13.4** (GTM) | Email infra → nurture → automation |
| **13.5 → 13.8** (GTM) | Demo tenant before delivery kit |
| **18.1 → 18.3** (DG) | Dream 100 keywords before shadow funnel SEO |
| **18.4 → all copy surfaces** (DG) | Messaging framework before applying to landing, nurture, content |

### Traffic Secrets Criteria Updates (applied to existing tasks)

| Task | Update | Source |
|------|--------|--------|
| **14.1** Content Pipeline | **One platform discipline:** Focus 100% on X/Twitter for first 12 months. Blog is secondary (repurposed from X content, not primary). LinkedIn is tertiary. YouTube is reserved for 18.2 interview show only. Do not spread across all four platforms simultaneously. | Traffic Secrets conclusion: "pick one platform, double down, hit $1M before adding a second" |
| **14.1** Content Pipeline | **Hook/Story/Offer (HSO) framework:** Every blog post, X thread, and nurture email must pass an HSO checklist: (1) Hook — pattern interrupt that stops the scroll; (2) Story — emotional narrative or case study that builds desire; (3) Offer — specific next-step CTA. Content without all three is information, not marketing. | Traffic Secrets Secret #3 |
| **14.4** Funnel Math | **List valuation KPI:** Add $1/name/month as the baseline benchmark for email list health. If the list isn't generating $1/name/month, the follow-up funnel (13.3) or offer (value ladder) needs work, not more traffic. Track this monthly alongside 14.3 conversion metrics. | Traffic Secrets Secret #5 |
| **14.4** Funnel Math | **Kill criteria expanded:** If < 5 scoping submissions by week 8, shift to Dream 100 outreach (18.1) and shadow funnel SEO (18.3) instead of just "direct outreach volume." The demand-gen engine is the recovery path. | Traffic Secrets organic growth model |
| **16.1** Paid Ads Trigger | **Break-even trigger:** Change from "≥ 50 qualified leads/mo organic" to "funnel breaks even (CAC ≤ LTV)." The moment your funnel pays for itself, scale paid ads without limit. Do NOT wait for an arbitrary lead count — that leaves money on the table. | Traffic Secrets Secret #6: "When your funnel breaks even, you don't have an advertising budget" |

---

## 8. Bottleneck Analysis

### Compliance Bottleneck: Temujin (unchanged)

Temujin is primary on 28 of 41 compliance tasks (68%). The GTM plan **deliberately avoids assigning him any GTM work**, keeping his total at 28 tasks.

### GTM Bottleneck: Ogedei (new)

Ogedei picks up 6 GTM tasks (13.3, 13.4, 13.7, 13.8, 14.1, 14.3) on top of his 2 compliance tasks (11.1, 12.2-ops). He's now the **GTM critical-path owner** — but his GTM tasks are mostly independent of compliance and run in parallel.

### Updated Task Counts Per Swimlane

| Assignee | Compliance | GTM | Enhancement | Demand Gen | Total | Est. Days | On Critical Path? |
|----------|-----------|-----|-------------|------------|-------|-----------|-------------------|
| **Temujin** | 28 | **0** | **0** | **0** | **28** | ~58d | ✅ Compliance CP |
| **Chagatai** | 5 | 4 | 3 | 3 | **15** | ~28d | ✅ GTM public-facing CP + demand-gen CP |
| **Ogedei** | 2 | 6 | 3 | 0 | **11** | ~21d | ✅ GTM nurture CP + attribution |
| **Kublai** | 3 | 2 | 2 | 2 | **9** | ~16d | Partial (7.1 deploy) |
| **Jochi** | 1 | 0 | 0 | 0 | **1** | 5d | No (parallel spike) |
| **Mongke** | 0 | 0 | 1 | 0 | **0** (+review) | — | Review gate (13.7, 17.9) |
| **Batu** | 0 | 1 | 0 | 1 | **2** | 5d | ✅ Demand-gen foundation (18.1 gates 18.2, 18.3) |
| **Operator** | 0 | 5 | 0 | 0 | **5** | 2.5d | ✅ GTM week-1 gates |
| **Total** | **41** | **18** | **9** | **5** | **73** | ~153d | |

### Bottleneck Visualization

```
COMPLIANCE TRACK (unchanged — GTM does not touch):

BEFORE delegation:
  Temujin:  ████████████████████████████ 28 tasks (~70 days serial)
  Others:   ████████ 13 tasks (~30 days)
  Critical path: ~34 days serial → ~11 weeks calendar

AFTER delegation (Tiers 1+2):
  Temujin:  ██████████████████ 17 tasks (~48 days)
  Ogedei:   ███████████ 11 tasks (~25 days)
  Others:   ████ 6 tasks (~17 days)
  Critical path: ~24 days → ~7 weeks calendar

GTM TRACK (parallel, independent):

  Operator:  ██ 5 tasks (~2.5 days — week 1 gates, then done)
  Chagatai:  █████████ 4 GTM tasks (~9 days — landing, pricing, demo, copy)
  Ogedei:    ████████████ 6 GTM tasks (~13 days — nurture, claims, delivery, scoring, analytics)
  Kublai:    ████ 2 GTM tasks (~3 days — CRM, A/B testing)
  Batu:      ███ 1 task (3 days — research)

  GTM critical path: 6.5 days (public-facing) / 4.5 days (nurture)
  GTM total calendar: ~3 weeks (fully overlapped with compliance M2-M3)

COMBINED CRITICAL PATH: ~11 weeks (UNCHANGED from compliance-only)
  GTM adds ZERO days to the overall timeline.
```

### Why GTM Doesn't Extend the Timeline

1. **Operator gates (15.1–15.3)** are fast (0.5d each) and start on Day 1 — they're done before compliance Sprint 2 even ramps up.
2. **Chagatai's GTM tasks** (13.1, 13.2, 13.5, 13.6) run in parallel with his compliance frontend work (1.2, 4.2, 8.6) — he has bandwidth.
3. **Ogedei's GTM tasks** run alongside his compliance work (11.1) — GTM nurture (13.3→13.4) is independent of platform hardening.
4. **Batu's research** (14.5) has no dependencies and no downstream blockers — it's a pure parallel stream.
5. **Claims Gate (13.7)** is the one potential contention point (Mongke review), but it's a 1-day review that slots between Mongke's compliance review cycles.

---

## 9. Sprint Board (First 3 Sprints)

**Sprint cadence:** 1 week (5 working days). Three sprints = 15 working days.

### Sprint Planning Summary (Unified)

| Sprint | Compliance Focus | GTM Focus | Key Gates |
|--------|-----------------|-----------|-----------|
| **Sprint 1** (Wk 1) | Foundation + Inventory — **DONE** | — (not yet started) | M1 ✅ |
| **Sprint 2** (Wk 2) | Enforcement Levers + SIEM | **Operator gates (15.1-15.3) Day 1** → Landing (13.1) + Nurture (13.3) + Research (14.5) | M1 complete → enter M2; **G1 starts** |
| **Sprint 3** (Wk 3) | Data Governance + Deploy Prep | Claims Gate (13.7) → Public Copy (13.6); Automation (13.4); Demo Tenant (13.5) | M2 in progress; **G1 → G2 transition** |

---

### ASCII Kanban Board — Sprint 1 (Week 1: Foundation + Inventory)

> **Status:** Complete. No GTM work in Sprint 1.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 1 — "Foundation Live" ✅ COMPLETE                   [WIP: T=2 C=1 O=0 K=0 J=1] │
├──────────┬──────────┬──────────┬──────────┬──────────────────────────────────────────┤
│ BACKLOG  │ TO DO    │ IN PROG  │ REVIEW   │ DONE                                     │
├──────────┼──────────┼──────────┼──────────┼──────────────────────────────────────────┤
│          │          │          │          │ 0.1 Migration ✅                        │
│          │          │          │          │ 0.2 Clean ✅                            │
│          │          │          │          │ 1.1 Agent CRUD ✅                       │
│          │          │          │          │ 2.1 Policy Revision ✅                  │
│          │          │          │          │ 2.2 Rule Engine ✅                      │
│          │          │          │          │ 2.3 Enforcement Dial ✅                 │
│          │          │          │          │ 3.1 SIEM E2E ✅                         │
│          │          │          │          │ 12.1 Gateway ADR ✅                     │
└──────────┴──────────┴──────────┴──────────┴──────────────────────────────────────────┘

SPRINT 1 EXIT: M1 Foundation Live ✅ — 12 compliance tasks complete
```

---

### ASCII Kanban Board — Sprint 2 (Week 2: Enforcement + GTM Launch)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 2 — "Enforcement & GTM Launch"                              [WIP: T=2 C=2 O=2 K=1 B=1 OP=3]    │
├──────────┬──────────┬──────────┬──────────┬──────────────────────────────────────────────────────────┤
│ BACKLOG  │ TO DO    │ IN PROG  │ REVIEW   │ DONE                                                       │
├──────────┼──────────┼──────────┼──────────┼──────────────────────────────────────────────────────────┤
│          │          │ 2.1 Pol  │          │ ── COMPLIANCE ──                                           │
│ (C) 2.3  │ 2.3 Dial │ Rev (T)  │          │ 0.1✅ 0.2✅ 1.1✅ 2.2✅                                    │
│ Dial (T) │ (T)      │          │          │ 2.3✅ 2.4✅ 2.5✅ 3.1✅                                    │
│          │          │ 3.1 SIEM │          │ 12.1✅                                                     │
│ (C) 1.2  │ 1.2 Dash │ (O)      │          │                                                            │
│ Dash (C) │ (C)      │          │          │ ── GTM ──                                                  │
│          │          │ 3.2 Wrkr │          │ 15.1 DNS ✅          (Operator, Day 1)                     │
│ (C) 3.2  │ (O)      │ (O)      │          │ 15.2 Email Infra ✅  (Operator, Day 1)                     │
│ Worker(O)│          │          │          │ 15.3 Stripe ✅       (Operator, Day 1)                     │
│          │          │ ── GTM ──│          │                                                            │
│ ── GTM ──│          │          │          │                                                            │
│          │ 13.1 Land│ 13.1 Land│          │                                                            │
│ (G) 13.1 │ Page (C) │ Page (C) │          │                                                            │
│ Landing  │          │          │          │                                                            │
│ Page (C) │ 13.3 Nur │ 13.3 Nur │          │                                                            │
│          │ Email(O) │ Email(O) │          │                                                            │
│ (G) 13.3 │          │          │          │                                                            │
│ Nurture  │ 14.5 Res │ 14.5 Res │          │                                                            │
│ (O)      │ (B)      │ (B)      │          │                                                            │
│          │          │          │          │                                                            │
│ (G) 14.5 │ 15.4 Soc │          │          │                                                            │
│ Research │ (OP)     │          │          │                                                            │
│ (B)      │ 15.5 Ana │          │          │                                                            │
│          │ (OP)     │          │          │                                                            │
│ (G) 15.4 │          │          │          │                                                            │
│ Social   │          │          │          │                                                            │
│ (OP)     │          │          │          │                                                            │
│          │          │          │          │                                                            │
│ (G) 15.5 │          │          │          │                                                            │
│ Analytics│          │          │          │                                                            │
│ (OP)     │          │          │          │                                                            │
└──────────┴──────────┴──────────┴──────────┴──────────────────────────────────────────────────────────┘

SWIMLANE DETAIL:
  ── COMPLIANCE ──
  Temujin:  [IN PROG] 2.4 Env Pinning → 2.5 Active Holes → start 8.1 Data Grants
  Ogedei:   [IN PROG] 3.1 SIEM → 3.2 SIEM Worker → 3.3 Alert Routes (delegated Tier 1)
  Chagatai: [TO DO]   1.2 Agent Dashboard Tab (starts, 1.1 ✅)
  Jochi:    [DONE]    12.1 Gateway ADR ✅

  ── GTM ──
  Operator: [DONE]    15.1 DNS ✅ → 15.2 Email ✅ → 15.3 Stripe ✅ (all Day 1)
            [IN PROG] 15.4 Social Profiles → 15.5 Analytics Accounts
  Chagatai: [IN PROG] 13.1 Landing Page (3d, started after 15.1 ✅)
  Ogedei:   [IN PROG] 13.3 Nurture Email Sequence (2d, started after 15.2 ✅)
  Batu:     [IN PROG] 14.5 Market Research (3d, started Day 1)

SPRINT 2 EXIT:
  COMPLIANCE: M1 fully complete, entering M2. Enforcement dial live, SIEM chain progressing.
  GTM: G1 started — landing page in progress, nurture sequence in progress.
       Operator gates cleared. Claims Gate (13.7) queued for Sprint 3.

CRITICAL NOTE: 15.1-15.3 completed Day 1. If delayed, ALL GTM public work stalls.
```

---

### ASCII Kanban Board — Sprint 3 (Week 3: Governance + Claims Gate + Deploy)

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  SPRINT 3 — "Governance, Claims Gate & Deploy"                              [WIP: T=2 C=2 O=3 K=2 B=0 OP=1]    │
├──────────┬──────────┬──────────┬──────────┬──────────────────────────────────────────────────────────────────┤
│ BACKLOG  │ TO DO    │ IN PROG  │ REVIEW   │ DONE                                                               │
├──────────┼──────────┼──────────┼──────────┼──────────────────────────────────────────────────────────────────┤
│          │          │ ── COMPL ──         │ ── COMPLIANCE ──                                                   │
│ (C) 8.2  │ 8.2 Tool │ 8.1 Data │ 2.3 Dial │ 0.1✅…2.5✅ 3.1✅ 3.2✅                                            │
│ Allow(T) │ Allow(T) │ Grants   │ (M rev)✅│ 3.3✅ 4.1✅ 12.1✅                                                 │
│          │          │ (T)      │          │                                                                    │
│ (C) 8.3  │ 8.4 Vol  │          │ ── GTM ──│ ── GTM ──                                                          │
│ Egress(T)│ Budget(O)│ 4.1 Evid │          │ 15.1✅ 15.2✅ 15.3✅ 15.4✅ 15.5✅                                 │
│          │          │ Pack (O) │ 13.7★    │ 13.1 Landing ✅                                                    │
│ (C) 8.4  │ 5.1 Org  │          │ Claims   │ 13.3 Nurture ✅                                                    │
│ Budget(O)│ Model(O) │ 5.1 Org  │ Gate     │ 14.5 Research ✅                                                   │
│          │          │ Model(O) │ (M rev)  │                                                                    │
│ (C) 5.2  │ 4.2 Tmpl │          │          │                                                                    │
│ RBAC (T) │ (C)      │ ── GTM ──│          │                                                                    │
│          │          │          │          │                                                                    │
│ (C) 7.1  │ 7.1 Deply│ 13.7★    │          │                                                                    │
│ Deploy(K)│ (K)      │ Claims   │          │                                                                    │
│          │ Gate(O)  │ Gate(O)  │          │                                                                    │
│ ── GTM ──│          │          │          │                                                                    │
│          │ 13.6 Copy│ 13.4 Mkt │          │                                                                    │
│ (G) 13.6 │ (C)      │ Auto (O) │          │                                                                    │
│ Copy (C) │          │          │          │                                                                    │
│          │ 13.5 Demo│ 13.5 Demo│          │                                                                    │
│ (G) 13.4 │ Tenant(C)│ Tenant(C)│          │                                                                    │
│ Auto (O) │          │          │          │                                                                    │
│          │ 13.8 Del │          │          │                                                                    │
│ (G) 13.5 │ Kit (O)  │          │          │                                                                    │
│ Demo (C) │          │          │          │                                                                    │
│          │ 14.1 Lead│          │          │                                                                    │
│ (G) 13.8 │ Score(O) │          │          │                                                                    │
│ Delivery │          │          │          │                                                                    │
│ Kit (O)  │ 14.2 CRM │          │          │                                                                    │
│          │ (K)      │          │          │                                                                    │
│ (G) 14.1 │ 14.3 Ana │          │          │                                                                    │
│ Score(O) │ (O)      │          │          │                                                                    │
│          │ 14.4 A/B │          │          │                                                                    │
│ (G) 14.2 │ (K)      │          │          │                                                                    │
│ CRM (K)  │          │          │          │                                                                    │
│          │          │          │          │                                                                    │
│ (G) 14.3 │          │          │          │                                                                    │
│ Analy(O) │          │          │          │                                                                    │
│          │          │          │          │                                                                    │
│ (G) 14.4 │          │          │          │                                                                    │
│ A/B (K)  │          │          │          │                                                                    │
└──────────┴──────────┴──────────┴──────────┴──────────────────────────────────────────────────────────────────┘

SWIMLANE DETAIL:
  ── COMPLIANCE ──
  Temujin:  [IN PROG] 8.1 Data Grants (3d) → 8.2 Tool Allowlist (2d)
            [TO DO]   8.3 Egress, 5.2 RBAC, 6.1 SSO
  Chagatai: [IN PROG] 1.2 Dashboard (finishing) → 4.2 Report Templates (2d)
  Ogedei:   [IN PROG] 4.1 Evidence Pack (2d) || 5.1 Org Model (3d)
            [TO DO]   8.4 Vol Budgets, 8.5 Approval Matrix, 11.1 Hardening
  Kublai:   [TO DO]   7.1 Deploy (1d) — triggers when Phase 0-1 confirmed stable
  Mongke:   [REVIEW]  2.3 Enforcement Dial final review ✅

  ── GTM ──
  Ogedei:   [IN PROG] 13.7 ★ Claims Gate (1d) → 13.4 Marketing Automation (2d)
            [TO DO]   13.8 Delivery Kit, 14.1 Lead Scoring, 14.3 Analytics
  Chagatai: [IN PROG] 13.5 Demo Tenant (1d, deps: M1 ✅ + 7.1 in progress)
            [TO DO]   13.6 Public Copy (blocked on 13.7 ★)
  Kublai:   [TO DO]   14.2 CRM Integration (2d, deps: 13.4)
            [TO DO]   14.4 A/B Testing (1d, deps: 13.1 ✅)
  Mongke:   [REVIEW]  13.7 ★ Claims Gate — verify all public copy is claim-clean
  Operator: [DONE]    All operator gates complete (15.1-15.5 ✅)
  Batu:     [DONE]    14.5 Market Research ✅

SPRINT 3 EXIT:
  COMPLIANCE:
    → 7.1 Deploy to production (M2 partially complete)
    → 8.1 Data Grants live (Phase 8 begins)
    → 11.1 Platform Hardening can start (deps: 1.1✅, 2.2✅, 5.1 in progress)

  GTM:
    → G1 Public & Claim-Clean: Claims Gate (13.7) passes → 13.6 Public Copy finalized → G1 ✅
    → G2 Funnel Armed: 13.4 Automation done → 14.1/14.2 start → G2 in progress
    → G3 Revenue Motion: 13.5 Demo Tenant ready (after 7.1) → 13.8 Delivery Kit → G3 starting

KEY GATES:
  ★ 13.7 Claims Gate is the #1 GTM priority this sprint — gates ALL public copy.
  ★ 7.1 Deploy is the #1 compliance priority — unblocks Phase 9 AND GTM 13.5/13.8.
```

---

## 10. Phase 17: GTM Enhancements — Detailed Task Specs

> **Origin:** GTM Plan Review (Aug 8, 2026). The review identified that the plan was 100% sales-led with no developer self-serve track, no bottom-funnel SEO content, and no attribution infrastructure. These 9 tasks fill those gaps without touching Temujin's critical path.

### Task 17.1: ★ Developer Self-Serve Activation Loop
**Assignee:** Chagatai · **Track:** E · **Depends on:** 13.1 · **Est:** 3d

**Problem:** Parse is an API product, but the entire funnel goes through scoping form → operator quote → proposal. A developer who lands on the page and wants to try it right now has no guided path from signup → first `/v1/parse` call → "aha moment" in the compliance dashboard.

**Deliverables:**
- Activation funnel instrumentation: time-to-first-call, time-to-first-dashboard-view, drop-off tracking at each step (signup → keygen → first screen → dashboard view)
- Guided onboarding flow: after API key generation, show a "try your first screen" interactive prompt with copy-paste curl
- Friction-removal pass: audit every click between landing and first successful call, eliminate ≥ 1 step
- Track activation metrics in 14.3 dashboard alongside GTM funnel metrics

**Acceptance:**
- A developer can go from landing page to first successful `/v1/parse` call in ≤ 3 minutes
- Activation metrics tracking in PostHog/GA4 with funnel visualization
- PLG flywheel metric (% keys past monitor mode) tracked from this funnel

---

### Task 17.2: Public No-Login Demo Experience
**Assignee:** Chagatai · **Track:** E · **Depends on:** 17.1, 13.5 · **Est:** 1d

**Problem:** Task 13.5 builds a synthetic demo tenant but only exposes it through a sales walkthrough. An inbound prospect at 11pm who isn't ready to talk to sales has nothing to see.

**Deliverables:**
- Public, read-only `/demo` route showing the 13.5 synthetic tenant dashboard
- No signup, no auth — instant access
- "Book a walkthrough" CTA + "Get started" signup link on the demo page
- Synthetic data banner persists (from 13.5)
- Demo highlights: agent registry, enforcement dial, SIEM events, evidence pack preview

**Acceptance:**
- `/demo` loads in ≤ 2 seconds, no auth wall
- CTAs visible and tracked (14.3 attribution)
- Passes 13.7 claims gate (no real metrics, no certification claims)

---

### Task 17.3: Comparison / Competitive SEO Pages
**Assignee:** Chagatai · **Track:** E · **Depends on:** 13.7 · **Est:** 3d

**Problem:** 14.2 monitors competitors but nothing creates bottom-funnel SEO content. "Parse vs Lakera," "Parse vs Prompt Security" — these capture high-intent search traffic from people already looking for a solution. Comparison pages convert at 3–5× the rate of top-of-funnel blog posts.

**Deliverables:**
- 4–6 comparison pages in `content/compare/`:
  - Parse vs Lakera Guard
  - Parse vs Prompt Security
  - Parse vs Protect AI
  - Parse vs Pangea
  - Agent security tools comparison (umbrella page)
  - "How to choose an agent security tool" (buying guide)
- Each page: feature comparison table (rendered from `FEATURE_STATUS`), honest differentiation (what Parse does that they don't, and vice versa), CTA to scoping form or signup
- All pages pass 13.7 claims gate — no unsubstantiated claims about competitors
- Schema.org structured data for SEO

**Acceptance:**
- Pages indexed by Google Search Console (verified post-15.1 DNS)
- Comparison feature tables rendered from `FEATURE_STATUS` (single source of truth)
- Quarterly review trigger added to 17.9 sweep (competitor feature changes)

---

### Task 17.4: Attribution & UTM Tracking Infrastructure
**Assignee:** Ogedei · **Track:** E · **Depends on:** 13.1, 13.4 · **Est:** 1d

**Problem:** 14.3 tracks `Lead.source` but there's no UTM parameter convention or source → revenue mapping. Can't tell whether the Lieben-reply thread or the lead magnet or the comparison page drove the scoping form.

**Deliverables:**
- UTM taxonomy document (`docs/utm-taxonomy.md`): standardized `utm_source`, `utm_medium`, `utm_campaign` values for each channel
- Capture `?utm_*` parameters on 13.1 scoping form and 13.4 magnet download → persist on `Lead` record
- Cross-channel attribution view in 14.3 dashboard: source → nurture completion → scoping → quote → won/lost
- First-touch and last-touch attribution models (simple v1)

**Acceptance:**
- Every inbound lead has a `utm_source` populated (or "direct/unknown")
- Attribution dashboard shows source → conversion rates per channel
- 14.3 weekly report includes "top-performing channel" metric

---

### Task 17.5: LLM-Tool Discovery Monitoring Cron
**Assignee:** Ogedei · **Track:** E · **Depends on:** — · **Est:** 0.5d

**Problem:** Parse has `llms.txt`, MCP, and OpenAPI — but the plan never checks whether LLM tools (ChatGPT, Claude, Gemini) actually recommend Parse when asked about agent security. This is the generative-engine-optimization (GEO) equivalent of SEO ranking checks.

**Deliverables:**
- Monthly cron job that queries 3–4 LLMs with prompts like:
  - "What tools screen AI agent prompts for security?"
  - "How do I add compliance controls to my AI agent?"
  - "What's the best prompt injection detection API?"
- Records whether Parse appears in the response, and in what context (recommended, mentioned, absent)
- Alert to operator if Parse appears/disappears from results
- Results tracked over time for trend analysis

**Acceptance:**
- Cron runs monthly, results stored in brain private-lake
- First run establishes baseline (Parse likely absent — that's the starting point)
- Improvement actions documented (e.g., "increase `llms.txt` coverage," "publish more agent-security content")

---

### Task 17.6: Long-Tail Nurture Expansion
**Assignee:** Ogedei · **Track:** E · **Depends on:** 13.3 · **Est:** 1d

**Problem:** 13.3's 5-email sequence covers ~2 weeks, but design-partner enrollment is at week 11–18. After the 5-email sequence, the funnel leaks badly — no touchpoints for 8+ weeks.

**Deliverables:**
- Long-tail nurture track (post-5-email):
  - Monthly check-in email (value-add content, not sales pitch)
  - Trigger-based emails: feature release (e.g., "Compliance tier is now available" when 7.3 gates pass)
  - Re-engagement email for leads who opened but didn't convert after 30 days
  - "Breakup email" at 60 days ("Last email — here's what you're missing")
- All templates versioned in repo, pass 13.7 claims gate
- Spacing rules: minimum 7 days between emails, maximum 30 days silence

**Acceptance:**
- Extended nurture sequence tested end-to-end on staging
- Unsubscribe respected at every touchpoint
- Open rates tracked in 14.3 dashboard

---

### Task 17.7: Post-Implementation Expansion Lifecycle
**Assignee:** Kublai · **Track:** E · **Depends on:** 13.8 · **Est:** 1d

**Problem:** 13.8 ends at handoff + case study capture. There's no task for what happens next: the client adds more agents, needs more endpoints, wants to upgrade to Compliance tier. The implementation is the wedge; the recurring revenue is the goal.

**Deliverables:**
- Quarterly check-in template: agent count review, compliance posture review, new feature walkthrough
- Expansion triggers: when agent count crosses a threshold (e.g., 10 → 25) → upsell conversation to Compliance tier
- Renewal mechanics for Team subscription: automated reminder 60 days before annual renewal, health check template
- Account expansion dashboard in admin surface (NRR tracking)
- Case study refresh cadence: update at 6-month and 12-month anniversaries

**Acceptance:**
- Lifecycle templates created in repo (`docs/lifecycle/`)
- First quarterly check-in executed against an active implementation (or dry-run against 13.5 demo tenant)
- NRR metric added to 14.3 dashboard

---

### Task 17.8: Incident Response Runbook
**Assignee:** Kublai · **Track:** E · **Depends on:** 13.6 · **Est:** 0.5d

**Problem:** 13.6's trust page mentions vulnerability disclosure, but for a security product, a customer reporting "Parse missed a prompt injection" needs a defined response. An unhandled incident report destroys trust faster than any competitor.

**Deliverables:**
- Incident response runbook (`docs/incident-response.md`):
  - Triage SLA: severity classification (critical / high / medium / low)
  - Communication template for acknowledging, investigating, resolving
  - Post-mortem format (timeline, root cause, remediation, prevention)
  - ScreeningEvent evidence capture protocol for specific misses
- Customer-facing incident reporting process (email → `security@parsethis.ai`, auto-reply with ticket ID)
- Incident metrics tracked: time-to-acknowledge, time-to-resolve, recurrence rate

**Acceptance:**
- Runbook tested via tabletop exercise (dry-run scenario)
- Incident reporting email configured and tested
- Post-mortem template linked from trust page (13.6)

---

### Task 17.9: Claims Gate Dynamic Sweep (Quarterly Manual Review)
**Assignee:** Mongke · **Track:** E · **Depends on:** 13.7 · **Est:** 0 (criteria change)

**Problem:** The 13.7 CI grep catches hardcoded strings in SSR templates, but can't catch claims in dynamically generated content (blog markdown, email templates, social drafts, sales decks, comparison pages from 17.3).

**Deliverables:**
- Quarterly manual sweep of ALL customer-facing assets against `FEATURE_STATUS`:
  - Email templates (13.3, 17.6)
  - Sales/proposal templates (13.2)
  - Social media drafts (14.1 content pipeline)
  - Comparison pages (17.3) — verify competitor claims haven't drifted
  - Demo tenant copy (13.5, 17.2)
  - Trust page content (13.6)
- Sweep checklist with sign-off
- Results logged with any corrections made

**Acceptance:**
- Sweep checklist created and versioned
- First sweep completed (post-Phase 13 launch)
- Quarterly reminder cron set up

---

## 11. Phase 18: Demand Generation — Detailed Task Specs (Traffic Secrets Framework)

> **Origin:** Traffic Secrets by Russell Brunson (2020), mapped to Parse context (Aug 8, 2026).
> The GTM plan is a conversion machine — it knows how to close. Traffic Secrets provides the fuel — it knows how to fill the funnel. These 6 tasks implement the key frameworks the book identifies as foundational, adapted for a developer-API security product.

### Task 18.1: ★ Dream 100 List (Gatekeeper Mapping)
**Assignee:** Batu · **Track:** DG · **Depends on:** — · **Est:** 2d · **Blocks:** 18.2, 18.3

**Framework:** Russell Brunson's Dream 100 — not the people you sell to, but the **gatekeepers who already have your dream customers' attention**.

**Problem:** 14.5 builds a 50-target list of *sales prospects* (agencies to sell implementations to). That's not the Dream 100. The Dream 100 is the podcast hosts, newsletter authors, community founders, and conference organizers who already have the attention of the developers, CTOs, and agency owners we want to reach. Getting one Dream 100 member to promote you = instant access to their entire audience.

**Deliverables:**
- Master spreadsheet mapping **where Parse's dream customers congregate**:
  - 15+ AI/agent-security newsletters & blogs (e.g., AI Tinkerers, Latent Space, etc.)
  - 20+ podcasts where agency owners / CTOs listen (developer tools, AI deployment, security)
  - 15+ active communities (Discord, Slack, Reddit) focused on AI agents / dev tooling / compliance engineering
  - 10+ YouTube channels covering AI tools, agent development, security
  - 20+ influencers on X/Twitter who have the attention of our dream customer (AI builders, agency founders, security engineers)
  - 10+ conference/event organizers in AI agent / security space
- Each row: name, platform, audience size, contact method, relationship status (cold → warm → partnered), engagement notes
- Prioritize by audience overlap with Parse's dream customer profile
- Include "complement not compete" notes for each — how a partnership benefits THEM

**Acceptance:**
- 80+ entries with contact info and audience size estimates
- Top 20 prioritized by relevance and accessibility
- Document stored in brain private-lake for cross-reference with 18.2 (interview show) and 18.3 (shadow funnel)

---

### Task 18.3: ★ Shadow Funnel Capture Architecture
**Assignee:** Chagatai · **Track:** DG · **Depends on:** 18.1, 13.1 · **Est:** 2d

**Framework:** Traffic Secrets Secret #16 (Funnel Hub) + Mike & AJ's "Shadow Funnel" concept. When people see your content/ads, most don't click through immediately. Instead they open a new tab and **search for you on Google, look at your social profiles, read your blog, and check reviews**. This "shadow funnel" is where buying decisions actually happen.

**Problem:** Our landing page (13.1) captures direct visitors. Our comparison pages (17.3) capture some SEO traffic. But we have no architecture for the researcher who sees an X post, then Googles "parsethis.ai reviews," then checks the GitHub org, then reads blog posts before ever visiting the pricing page. This journey is invisible but it's where 60-80% of B2B buying decisions happen.

**Deliverables:**
- **SEO blog content ranking for dream keywords** (from 18.1 Dream 100 research):
  - "AI agent prompt injection protection" → blog post
  - "compliance for AI agents" → blog post
  - "prompt security API" → comparison/buying guide page (extends 17.3)
  - "how to secure Claude Code / OpenClaw agents" → blog post
  - 10+ keyword-targeted articles, each with CTA to scoping form or signup
- **Social proof architecture:**
  - GitHub org populated with real code, good README, stars (15.4 prerequisite)
  - X/Twitter profile with pinned thread explaining Parse in 60 seconds
  - LinkedIn company page with product updates
  - Product Hunt launch page (planned for GTM Phase 2)
- **Branded search landing pages:** dedicated page at `/about` and `/trust` (13.6) for people searching "parsethis.ai" or "parse for agents"
- **Retargeting pixel** infrastructure (on all pages, not just landing) — for when paid ads activate (16.1)
- **Skyscraper content:** at least one "ultimate guide to AI agent security" (2,000+ words, the best on the internet for the keyword) per Brunson/Brian Dean's technique

**Acceptance:**
- Google Search Console shows branded searches growing week-over-week (post 15.1 DNS)
- At least 5 keyword-targeted articles ranking in top 100 (baseline) within 30 days of indexing
- All social profiles populated with trust signals (case studies, testimonials, demos)
- Retargeting audience growing (tracked even before ads activate)

---

### Task 18.4: Dual-Messaging Framework (Pain + Pleasure)
**Assignee:** Chagatai · **Track:** DG · **Depends on:** 13.7 · **Est:** 1d

**Framework:** Traffic Secrets Secret #1 — dream customers are either "moving away from pain" or "moving toward pleasure." Different people respond to different directions. Your marketing must speak to both, but each individual message focuses on one.

**Problem:** The GTM plan positions Parse almost entirely around pain: "compliance blocked our agent," "client won't approve," "prompt injection risk." This resonates with engineers who've felt the pain but misses the ambition-driven buyer: the agency owner who wants to win bigger deals, the CTO who wants to ship faster than competitors.

**Deliverables:**
- **Messaging matrix** mapping pain vs. pleasure framings by persona:
  - **Agency Owner (Pleasure):** "Win enterprise deals your competitors can't" / "Deploy AI for clients without fear" / "Ship agents faster, close bigger contracts"
  - **Agency Engineer (Pain):** "Stop prompt injections before they reach your client" / "Don't be the one who shipped an agent that leaked data"
  - **Enterprise CTO (Pleasure):** "Deploy AI with confidence" / "Turn compliance from blocker to accelerator"
  - **Enterprise Security Lead (Pain):** "Can you list every AI agent with data access?" / "Can you stop one in 10 seconds?" (ties to 13.4 magnet checklist)
- **Application to copy surfaces:**
  - Landing page (13.1): dual headlines tested via A/B (14.4)
  - Nurture emails (13.3): alternate pain/pleasure angles across the sequence
  - Interview show (18.2): title/description uses pleasure framing; content addresses pain
  - Comparison pages (17.3): pleasure framing for differentiation
  - X/Twitter threads (14.1): pain hooks (higher engagement), pleasure payoffs
- **Hook/Story/Offer (HSO) framework** applied to all content:
  - Every blog post, email, thread starts with a **hook** (pattern interrupt)
  - Builds with a **story** (emotional narrative / case study)
  - Ends with a specific **offer** (next step CTA)

**Acceptance:**
- Messaging matrix documented and shared
- A/B test (14.4) configured to test pain vs. pleasure landing page headlines
- All new content passes HSO checklist before publishing

---

### Task 18.5: Value Ladder Rung — $47 Self-Serve Audit Product
**Assignee:** Kublai · **Track:** DG · **Depends on:** 7.1 · **Est:** 2d

**Framework:** DotCom Secrets value ladder. The current pricing jumps from **free → $3K implementation**. Brunson's value ladder requires a low-ticket step between free and high-ticket that qualifies buyers and generates early revenue.

**Problem:** A prospect who isn't ready for a $3K implementation has two options: use the free tier (no revenue, no qualification signal) or talk to sales (high friction). There's no self-serve paid step that qualifies intent and generates revenue while the prospect is still evaluating.

**Deliverables:**
- **$47 "Agent Security Audit" product:**
  - User inputs their agent's prompt surface (API endpoint, system prompt, or agent description)
  - Parse runs a comprehensive screening (prompt injection vectors, data exfiltration risks, compliance gaps)
  - Generates a branded PDF report: risk score, vulnerability breakdown, remediation checklist, compliance framework mapping
  - Report includes CTA: "Need help implementing these fixes? Book a scoping call" (feeds 13.1)
- **Stripe checkout** for one-time $47 payment (reuses existing billing infrastructure)
- **Automated delivery:** payment → audit runs → PDF generated → email delivery
- **Upsell path:** $47 audit → "Need help fixing these issues?" → $3K implementation (13.2)
- **Pricing page** (13.2) updated to show the full value ladder: Free → $47 Audit → $49/mo Pro → $199/mo Team → $999/mo Compliance → $3K–$15K Implementation

**Acceptance:**
- Product live at `/audit` with Stripe checkout
- First test purchase generates PDF report end-to-end
- Value ladder visually complete on pricing page
- Passes 13.7 claims gate (audit is a real product, not a decoy)

---

### Task 18.6: Affiliate / Referral Program Architecture
**Assignee:** Kublai · **Track:** DG · **Depends on:** 13.8 · **Est:** 1d

**Framework:** Traffic Secrets Secret #18 — "Your Affiliate Army." The wealthiest answer in the book to "what's the best way to get traffic?": "I rely on my own network of affiliates." Instead of doing all the marketing yourself, build a program where others promote for a commission.

**Problem:** The GTM plan has no affiliate or referral mechanism. Agencies that implement Parse for clients have no financial incentive to recommend Parse to other agencies. Consultants who discover Parse have no structured way to earn from referrals. The north-star metric ("partner closes a deal because Parse was in the stack") has no formal incentive behind it.

**Deliverables:**
- **Affiliate program design:**
  - 20% recurring commission on subscription revenue (Pro, Team, Compliance tiers)
  - 10% commission on implementation engagements ($3K–$15K → $300–$1,500 per deal)
  - Cookie window: 60 days (first-touch attribution)
  - Payout: monthly via Stripe Connect
- **Referral tracking:**
  - Affiliate dashboard: clicks, signups, conversions, pending payouts
  - Unique referral links per affiliate (e.g., `parsethis.ai?ref=agencyname`)
  - Integrates with 17.4 UTM tracking
- **Recruitment materials:**
  - Affiliate program page at `/affiliates`
  - Outreach template for Dream 100 members (18.1): "Become a certified Parse implementation partner"
  - Tier system: Bronze (1–5 referrals) → Silver (6–15) → Gold (16+) with co-marketing benefits
- **v1 implementation scope:** This task designs the program and builds the tracking infrastructure. Full launch is demand-gated (Phase 16.6 triggers formal referral mechanics).

**Acceptance:**
- Program terms documented and published at `/affiliates` (passes 13.7 claims gate)
- Referral link generation and tracking verified end-to-end
- First 3 Dream 100 members identified as launch affiliates (from 18.1)

---

## Appendix: Dependency Adjacency Matrix (Quick Reference)

For each high-criticality task, the number of tasks it **blocks** (downstream dependents):

### Compliance Tasks

| Task | Blocks Count | Criticality |
|------|-------------|-------------|
| ✅ 0.1 | 5 (first-level) / **41** (transitive) | 🔴 TOTAL BLOCKER — **DONE** |
| ✅ 1.1 | 8 (first-level) / **28** (transitive) | 🔴 TOTAL BLOCKER — **DONE** |
| ✅ 2.1 | 4 (first-level) / **22** (transitive) | 🔴 HIGH — **DONE** |
| ✅ 2.3 ★ | 7 (first-level) / **18** (transitive) | 🔴 HIGHEST LEVERAGE — **DONE** |
| 7.1 | 4 (first-level) / **11** (transitive) + **2 GTM** (13.5, 13.8) | 🟠 HIGH |
| 8.1 | 5 (first-level) / **8** (transitive) | 🟠 HIGH |
| 9.1 | 4 (first-level) / **7** (transitive) | 🟠 HIGH |
| 10.1 | 3 (first-level) / **5** (transitive) | 🟡 MEDIUM |
| 12.1 ✅ | 1 (first-level) / **1** (transitive) | 🟡 MEDIUM — **DONE** |

### GTM Tasks

| Task | Blocks Count | Criticality |
|------|-------------|-------------|
| 15.1 | 4 (first-level) — 13.1, 13.2, 15.4, 15.5 | 🟠 HIGH (week-1 operator gate) |
| 15.2 | 1 (first-level) — 13.3 | 🟡 MEDIUM (nurture gate) |
| 15.3 | 1 (first-level) — 7.3 | 🟡 MEDIUM (revenue gate) |
| 13.1 | 3 (first-level) — 13.7, 14.3, 14.4 | 🟠 HIGH (landing page gate) |
| 13.7 ★ | 1 (first-level) — 13.6 | 🟠 HIGH (claims gate — gates ALL public copy) |
| 13.4 | 2 (first-level) — 14.1, 14.2 | 🟡 MEDIUM (automation gate) |
| All others | 0–1 | 🟢 LOW |

---

*Generated from Parse Enterprise Agent Compliance Implementation Plan v2.1 + GTM Enablement Plan + GTM Enhancement Review + Traffic Secrets Framework Mapping*
*Unified Kanban Board v5.0 · August 8, 2026*
*73 tasks · 8 swimlanes · 7 milestone gates (M1–M4 + G1–G3) · 19 phases (0–18)*
