# Org Tool Governance Plan

Status: proposed (2026-08-11)

## Problem

Org admins cannot ban a class of tooling for their whole company. The motivating
case: a company forbids browser use in employees' AI agents. Parse should let an
admin write that rule once ("no browser tools, org-wide") and enforce it on every
agent, key, and request in the org — connectors, plugins, and MCP servers alike.

## What exists today, and why it is not enough

| Piece | Where | Gap |
|-------|-------|-----|
| Per-agent tool list `AgentRegistry.tools[]` | `prisma/schema.prisma` | Self-declared by whoever registers the agent. An employee can add `browser` to their own agent and pass every check. |
| `ScreeningPolicy.enforceToolAllowlist` | `src/routes/parse.ts:694-760` | Checks requested tools against the *agent's own* list. No org authority above it. |
| RBAC (`org_admin`, `requireRole`) | `src/lib/rbac.ts`, `src/routes/organizations.ts` | Ready to reuse; nothing tool-related sits behind it yet. |
| Policy audit trail | `PolicyRevision`, `src/lib/policy-revision.ts` | Ready to reuse. |
| Gateway proxy (OpenAI-compatible) | `src/routes/gateway.ts`, `src/lib/gateway/proxy-handler.ts` | Sees `tools` in chat/completions requests but does not filter them. |
| Approval matrix + approvals route | `ScreeningPolicy.approvalMatrix`, `src/routes/approvals.ts` | Ready to reuse for `require_approval` decisions. |

The missing layer is an **org-level tool policy** that the per-agent list can
never override, plus a **catalog** that maps the many names one capability hides
behind (`browser_use`, `playwright`, `computer_use`, `mcp__claude-in-chrome__*`)
onto one category an admin can ban with a single rule.

## Design

### 1. Data model (Prisma)

```prisma
/// Org-wide tool governance. One row per rule; highest priority match wins.
model OrgToolRule {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")
  // What the rule matches:
  //   kind = "category" → pattern is a catalog category slug (e.g. "browser")
  //   kind = "exact"    → pattern is a tool name (e.g. "playwright")
  //   kind = "prefix"   → pattern matched as prefix (e.g. "mcp__claude-in-chrome__")
  kind      String   @default("category")
  pattern   String
  // allow | require_approval | block
  action    String   @default("block")
  // Scope: null = whole org. Otherwise restrict to one agent, key, or role.
  // A scoped rule may only tighten the org-wide result, never loosen it.
  scopeType String?  @map("scope_type")   // agent | api_key | role
  scopeId   String?  @map("scope_id")
  priority  Int      @default(0)
  reason    String?
  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt      @map("updated_at")

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId, priority], name: "idx_org_tool_rules_org_priority")
  @@map("org_tool_rules")
}
```

Plus one field on `Organization`:

```prisma
  // "blocklist" (default): tools are allowed unless a rule blocks them.
  // "allowlist": tools are blocked unless a rule allows them.
  toolPolicyMode String @default("blocklist") @map("tool_policy_mode")
```

No new table for the catalog: it is code, not data. `src/lib/tool-catalog.ts`
ships a curated map of category → known tool names and prefixes:

```
browser        → browser, browser_use, playwright, puppeteer, selenium,
                 computer_use, computer, mcp__claude-in-chrome__*, web_navigate…
code_execution → code_interpreter, bash, shell, exec, sandbox…
email          → gmail, send_email, smtp, mcp__*gmail*…
filesystem     → read_file, write_file, fs, file_search…
payments       → stripe, payment, transfer, wallet…
messaging      → slack, discord, telegram, signal, sms…
cloud_storage  → gdrive, s3, dropbox, onedrive…
```

Curated in code means it ships with tests, updates by PR, and needs no
migration when a new MCP server gets popular. Matching is case-insensitive on a
normalized name (lowercase, separators collapsed).

### 2. Resolution engine — `src/lib/tool-policy.ts`

Pure functions, no I/O, fully unit-tested:

```
resolveToolDecision(tool, rules, mode, scope) → { action, matchedRule | null }
```

Semantics, in order:
1. Normalize the tool name; expand each rule via the catalog (a `category` rule
   matches every name and prefix in that category).
2. Collect matching rules for this tool within scope (org-wide rules plus rules
   scoped to this agent/key/role).
3. Highest `priority` wins; on a tie, the stricter action wins
   (`block` > `require_approval` > `allow`).
4. A scoped rule can tighten but never loosen: if any org-wide rule says
   `block`, the answer is `block` regardless of scoped `allow` rules. (Same
   principle as `DelegationChain`: a child may restrict, never expand.)
5. No rule matched: `allow` in blocklist mode, `block` in allowlist mode.

A second helper resolves a whole list at once for registration checks:
`resolveToolList(tools, …) → { allowed[], needsApproval[], blocked[] }`.

### 3. Enforcement points (defense in depth)

Enforce in three places so a rule holds no matter how the tool request arrives.
All three fail open on infrastructure errors (matching the existing
data-governance and allowlist checks) and log the failure.

**a. Registration time — `src/routes/agent-registry.ts` (POST/PUT `/v1/agents`).**
Registering or updating an agent whose `tools[]` contains an org-blocked tool
is rejected with a 422 that names the rule and the blocked tools. This closes
the self-declaration hole. Agents that already exist with now-banned tools are
not silently edited; they show as "in violation" in the dashboard and get
blocked at screening time.

**b. Screening time — `src/routes/parse.ts`, directly after the Task 8.2 block.**
The org check runs whenever the key belongs to an org — independent of
`enforceToolAllowlist`, because that flag governs the per-agent list, and an
org ban must hold even for keys that never opted in. Violations produce a
`tool_policy_violation` flag (severity 7, distinct from the per-agent
`tool_violation`) and follow the existing enforcement dial: monitor records,
warn annotates, block escalates the verdict exactly as the current code does.
`require_approval` produces an `approval_request` through the existing
approvals flow. The org's rules are cached in Redis (keyed by org, invalidated
on rule change) so screening does not gain a per-request Prisma query.

**c. Gateway — `src/lib/gateway/proxy-handler.ts`.**
The OpenAI-compatible proxy is where "your Claude can't have browser use"
becomes literal: chat/completions requests carry `tools` definitions. Before
forwarding, resolve each tool; blocked tools are stripped from the request (or
the whole request is refused, per the org's enforcement mode) and the removal
is recorded in the screening event and audit log. This enforces the ban even
when the agent framework never calls `/v1/parse` itself.

The MCP proxy (`src/routes/mcp-proxy.ts`) currently serves only Parse's own two
screening tools, so it needs no filter today. If Parse later ships a general
MCP forwarding proxy, it filters `tools/list` and `tools/call` with the same
resolver — note this in the ADR when that work starts.

### 4. API — new route `src/routes/tool-policy.ts`

All mutations require `requireRole("org_admin")`; reads allow
`security_analyst` and `auditor` too. Every mutation writes an `AuditEvent`
and a `PolicyRevision` snapshot (SIEM already forwards `policy_change` events).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/v1/org/tool-policy` | Mode + rules, resolved and ordered |
| PUT | `/v1/org/tool-policy` | Set `toolPolicyMode` |
| POST | `/v1/org/tool-policy/rules` | Add a rule |
| DELETE | `/v1/org/tool-policy/rules/:id` | Remove a rule |
| GET | `/v1/org/tool-policy/catalog` | Categories and the names they cover |
| POST | `/v1/org/tool-policy/test` | Dry run: "would agent X using tool Y pass?" — returns decision + matched rule, writes nothing |

The `test` endpoint matters for trust: an admin bans "browser," runs the test
against their real agents, and sees exactly what would break before enforcing.

### 5. Dashboard — `/dashboard/tools` (`src/pages/tool-governance-dashboard.ts`)

Mounted in `src/routes/public.ts` behind `authMiddleware("evaluate")`. Follows
the house dashboard rules: the GET is read-only, every DB read has its own
try/catch, counts come from `groupBy`/`count`, everything is scoped by `orgId`,
absent data renders as `—`. Four zones (Miller's law):

1. **Policy** — mode, rule list with action/scope/priority, who created each
   rule and when. Primary object; most visual weight.
2. **Observed tools** — distinct tool names seen across the org's registered
   agents and recent screening requests, each labeled with its resolved
   decision. This is where an admin discovers what to ban.
3. **Violations** — recent `tool_policy_violation` screening events: agent,
   tool, action taken. Monitor-mode rows show "would block."
4. **Exposure** — per-rule count of currently-registered agents whose `tools[]`
   would violate it.

Rule mutations post to the JSON API from small forms on the page. Because the
auth cookie is `SameSite=Lax`, these forms carry a CSRF token (new, small:
HMAC of session key + expiry, verified by the mutation endpoints when the
caller authenticated via cookie). Bearer-key API callers are unaffected.

### 6. Rollout inside a customer org

New rules default to `monitor`: the dashboard shows what would have been
blocked, nothing breaks. The admin reviews the violations feed, then flips the
org's enforcement to `block` (the existing dial). This mirrors the
`enforcementMode` counterfactual design already in screening and is the reason
adoption won't stall on fear of breaking agents.

## Phases

Each phase compiles and passes tests on its own.

**Phase 1 — engine and catalog (no behaviour change).**
Migration `011` (`OrgToolRule`, `toolPolicyMode`). `src/lib/tool-catalog.ts`
and `src/lib/tool-policy.ts` as pure modules, plus the Redis-cached
`src/lib/tool-policy-store.ts`. Tests cover precedence, tie-breaking,
scope-tightening, allowlist/blocklist defaults, and category expansion (the
browser category must catch `mcp__claude-in-chrome__navigate`).

**Phase 2 — API.**
`src/routes/tool-policy.ts` with RBAC, audit events, policy revisions, cache
invalidation, and the dry-run `test` endpoint.

**Phase 3 — enforcement.**
The resolver wired into agent registration (422 on blocked tools), screening
(`tool_policy_violation` through the dial, deliberately not gated on
`enforceToolAllowlist`), and the gateway proxy (strip under warn, strip and
refuse under block). Fail-open everywhere.

**Phase 4 — org policy ceiling.**
Migration `012` (`OrgPolicyDefault`), `src/lib/org-policy-ceiling.ts` (pure
tighten-only merge), `src/lib/org-policy-store.ts`, the clamp applied at the
three `c.set("policy")` branches in `src/auth.ts`, `/v1/org/policy-defaults`,
and a 422 from `PUT /v1/policy` when a locked field would be silently clamped.

**Phase 5 — org control panel.**
`/dashboard/org` with the four zones above, CSRF for cookie-authenticated
mutations, and a link from the compliance dashboard. This replaces the
standalone `/dashboard/tools` originally planned.

**Phase 6 — ship.**
Flip `FEATURE_STATUS` in `src/lib/product-facts.ts` in the same commit as any
marketing copy; `npm run claims-lint` and `npm run brand-lint` must pass.
Update `docs/compliance-guide.md` and `CLAUDE.md`.

Production is **not** deployed by pushing. Commit first, then
`launchctl kickstart -k gui/$(id -u)/com.kublai.parse-for-agents` and confirm
`/health` reports the new commit. Because the service runs from the working
directory rather than a build artifact, any uncommitted edit goes live the
moment it restarts for any reason — so the restart is a deliberate, separate
step, not part of the build.

### Migration note

No file in `prisma/migrations/` creates the `organizations` table — the
compliance layer was applied with `prisma db push`. Migrations `011` and `012`
therefore guard their foreign keys and `ALTER TABLE "organizations"` inside a
`DO $$` block that no-ops when the table is absent, so a database bootstrapped
purely from the migration files does not roll the whole file back. Both were
verified against a scratch Postgres in four cases: table absent, table added
later (the constraint then applies), repeat runs, and table present from the
start.

## Addendum: the org control panel (added 2026-08-11)

Tool rules alone do not give a manager a place to stand. Two further gaps,
confirmed against the code:

1. **There is no org control panel.** `src/routes/organizations.ts` exposes
   `/v1/orgs`, `/v1/orgs/:id/members` and `PUT /v1/orgs/:id/members/:keyId/role`,
   but no page renders them. Every dashboard in `src/pages/` is scoped to a
   single API key. A manager has no screen showing their people.
2. **Risk tolerance is per key, not per org.** `ScreeningPolicy` is unique on
   `(apiKeyId, environment)`. Each employee's key carries its own
   `autoBlockThreshold`, `enforcementMode` and `defaultMode`, and nothing stops
   an employee loosening their own. An org-wide tolerance cannot be expressed.

### Org policy ceiling

Add one model — org-wide defaults, with per-field locks:

```prisma
model OrgPolicyDefault {
  id             String   @id @default(cuid())
  orgId          String   @unique @map("org_id")
  // Same field names as ScreeningPolicy so the clamp is a field-wise merge.
  autoBlockThreshold Int?     @map("auto_block_threshold")
  enforcementMode    String?  @map("enforcement_mode")
  defaultMode        String?  @map("default_mode")
  screenUserInput        Boolean? @map("screen_user_input")
  screenToolOutputs      Boolean? @map("screen_tool_outputs")
  screenForwardedMessages Boolean? @map("screen_forwarded_messages")
  executeInSandbox       Boolean? @map("execute_in_sandbox")
  enforceToolAllowlist   Boolean? @map("enforce_tool_allowlist")
  bypassEnabled          Boolean? @map("bypass_enabled")
  /// Fields the member key may not override. Unlocked fields are seed values.
  lockedFields   String[] @default([]) @map("locked_fields")
  updatedBy      String   @map("updated_by")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt      @map("updated_at")

  org Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@map("org_policy_defaults")
}
```

**Enforcement is one clamp in one place.** `src/auth.ts:490-525` is the sole
point where the effective policy is built and published via `c.set("policy")`
— all three branches (Redis cache hit, DB read, error default). Insert
`applyOrgPolicyCeiling(policy, apiKeyId)` immediately before each `c.set`, and
every route that reads `c.get("policy")` inherits the org tolerance with no
further changes. Clamp semantics mirror the tool rules — **tighten only**:

- `autoBlockThreshold`: effective = `min(key, orgCeiling)` (lower blocks more).
- `enforcementMode`: effective = stricter of the two (`block` > `warn` > `monitor`).
- `defaultMode`: if the org sets `pattern-only`, the key cannot choose `full`.
- Boolean screening switches and `enforceToolAllowlist`: org `true` forces true.
- `bypassEnabled`: org `false` forces false.
- A field in `lockedFields` takes the org value outright; otherwise the tighten
  rule above applies.

Apply the ceiling **after** the per-key cache is read, not before it is written,
so an org policy change takes effect immediately instead of waiting out the
per-key cache TTL.

`PUT /v1/policy` additionally rejects (422) any attempt to set a locked field
looser than the org value, so employees get a clear error rather than a silent
clamp.

### Org control panel — `/dashboard/org`

This replaces the standalone `/dashboard/tools` from the phase list above; tool
rules become one zone of the control panel rather than their own page. Behind
`authMiddleware("evaluate")` + `requireRole("org_admin", "security_analyst",
"auditor")` — analysts and auditors read, only `org_admin` sees the controls.
Four zones:

1. **People** — org members (API keys, with owner email and last-used), their
   role, and the effective risk tolerance each one runs under. Role changes
   post to the existing `PUT /v1/orgs/:id/members/:keyId/role`.
2. **Agent privileges** — the tool rules: current mode, rule list, and the
   "add rule" control with the category picker (this is where "block browser
   use" is one click). Plus the dry-run result of each rule against the org's
   registered agents.
3. **Risk tolerance** — org defaults and the lock toggles, showing for each
   field the org value and how many member keys are currently clamped by it.
4. **Violations** — recent `tool_policy_violation` events and agents currently
   in violation of a rule.

Same house rules as every other dashboard: the GET never writes, each read has
its own try/catch, counts come from `groupBy`/`count`, everything is scoped by
`orgId`, absent data renders `—`. Mutations post to the JSON API with the CSRF
token from `src/lib/csrf.ts`.

**Members are API keys, not users.** `ApiKey.orgId` + `ApiKey.role` is the only
membership edge in the schema; `User` has no org relation. The control panel
therefore lists keys, labelled with `ownerEmail` where known. Real per-employee
identity (one person, several keys, SSO-provisioned) needs an `OrgMember` join
table and is deliberately **not** in this plan — it is the natural next step
once SSO provisioning (`SSOProvider`, already modelled) is wired to user
records.

## Open questions

1. **Default mode.** Blocklist-by-default is proposed (least surprise for
   existing orgs). Strict shops can flip to allowlist. Confirm.
2. **Catalog stewardship.** Curated in code, updated by PR. If customers need
   custom categories, add an org-defined category table later — the resolver
   already treats the catalog as an input, so this slots in without redesign.
3. **Per-employee identity.** See the note above: v1 governs API keys. An
   `OrgMember` table linking `User` to `Organization` is the follow-up.
