---
plan_manifest:
  version: "1.0"
  created_by: "horde-plan"
  plan_name: "Iris Mbeki org-governance remediation"
  total_phases: 11
  total_tasks: 41
  phases:
    - id: "0"
      name: "Safety rails and baseline"
      task_count: 3
      parallelizable: false
      gate_depth: "STANDARD"
    - id: "1"
      name: "Truth fixes"
      task_count: 5
      parallelizable: true
      gate_depth: "LIGHT"
    - id: "2"
      name: "The door"
      task_count: 4
      parallelizable: false
      gate_depth: "STANDARD"
    - id: "3"
      name: "Identity foundation"
      task_count: 5
      parallelizable: false
      gate_depth: "DEEP"
    - id: "4"
      name: "Domain-bound organizations"
      task_count: 4
      parallelizable: false
      gate_depth: "DEEP"
    - id: "5"
      name: "Membership lifecycle"
      task_count: 4
      parallelizable: true
      gate_depth: "STANDARD"
    - id: "6"
      name: "Audit visibility"
      task_count: 2
      parallelizable: true
      gate_depth: "LIGHT"
    - id: "7"
      name: "Per-org gateway and secret custody"
      task_count: 6
      parallelizable: false
      gate_depth: "DEEP"
    - id: "8"
      name: "Declaration-gap visibility"
      task_count: 3
      parallelizable: true
      gate_depth: "LIGHT"
    - id: "9"
      name: "Discovery surfaces"
      task_count: 4
      parallelizable: true
      gate_depth: "STANDARD"
    - id: "10"
      name: "Re-walk verification"
      task_count: 1
      parallelizable: false
      gate_depth: "NONE"
  task_transfer:
    mode: "transfer"
    task_ids: ["1","2","3","4","5","6","7","8","9","10","11"]
---

# Iris Mbeki org-governance remediation

> **Status:** Executed 2026-08-12 on branch `fix/org-governance-remediation`. All 21 journey
> rows verified on staging; 274 tests passing across 17 files. Not yet deployed.
> **Created:** 2026-08-12
> **Source:** `~/reports/parse-prospect/2026-08-12-iris-mbeki-org-governance.html` (prospect run 7)
> **Phases:** 11 · **Tasks:** 41

## Context

Prospect run 7 pointed a security-engineer persona at the org control plane instead of the
detection engine. The control itself held up: one `category: browser` rule blocked twelve
tool names, a developer could not write a rule at all, a scoped `allow` at priority 999 lost
to the org block, and the auditor view omitted mutation controls from the HTML rather than
disabling them. The persona still walked, and scored Parse 2.4 against 3.4 for the free
alternative they already run.

They walked for three reasons, and this plan exists to remove all three:

1. **They could not find the feature.** `openapi.json` carries 19 paths and no org endpoints.
   `llms.txt` never mentions organizations. The docs "Govern" section lists seven endpoint
   groups, none of them tool policy, and describes `/v1/policy` as "policy for your key" —
   the exact thing the persona says is not a control. Tool policy is not among the landing
   page's six named controls. Buying the $199 Team plan returned a 403 byte-identical to the
   free tier's.
2. **They broke it in three calls.** `POST /v1/keys/generate` needs no authentication, that
   key bootstraps its own organization, and that organization registers an agent declaring
   `playwright`. The victim admin cannot see the escape, cannot list organizations, and
   cannot reclaim the key.
3. **They could not prove anything to an auditor.** `GET /v1/compliance/policy-history`
   returns `{"revisions":[]}` for every organization that has ever existed, while the
   revisions sit correctly in the database.

Research for this plan found the root cause under items 2 and 3 of the report's
recommendation list, which the walkthrough could not reach. Parse has a complete account
system — `User` with `email` and `emailVerifiedAt`, sessions, `/signup`, `/login`,
`/account`, password reset — and key issuance never uses it. Every self-service key hangs
off one shared user, `self-service@internal.invalid`. Production bears this out: **0 of 4
users have a verified email, and every user created through real signup holds 0 keys.**

That single gap produces the bypass (nothing binds a key to a person, so nothing can stop a
person minting another key), the offboarding dead end (the panel cannot name who owns a
key), and the placeholder email column the panel honestly apologises for. Fixing it once
fixes all three.

**Intended outcome:** all eleven recommendations closed, and every row of the report's
journey table reading `delight`. Appendix A maps each row to the task that flips it.

### Decisions taken before planning

| Question | Decision | Consequence |
|---|---|---|
| How far to take identity | **Verified account required to bootstrap only** | Keyless `/v1/keys/generate` is untouched — the 413 ms no-account onboarding three prior runs praised survives. Only creating an organization requires a verified person. |
| Which tier gets governance | **Free on every tier, stated on every card** | No entitlement checks. Copy-only work in Phase 9. Differentiation stays on volume, SIEM and evidence packs. |
| The gateway | **Build it per-org in this plan** | Reverses the recorded C17 decision not to persist provider keys. Phase 7 builds real secret custody and updates that decision in `CLAUDE.md` in the same change. |

### The C17 reversal, stated plainly

`CLAUDE.md` records a deliberate choice: the gateway "avoids persistent key custody — the
C17 blast radius is minimized by not persisting provider keys to disk/database". Phase 7
reverses it, because the gateway is the only enforcement point that does not depend on an
agent honestly declaring its own tools, and it is currently unreachable by any customer.

Two conditions make the reversal defensible, and both are tasks in Phase 7:

- Provider credentials are encrypted at rest with a dedicated key, never returned by any
  read route, and redacted in logs.
- `CLAUDE.md` is updated in the same commit. A codebase whose own architecture note
  contradicts its code is the same defect class as the `/trust` page claiming RBAC roles
  that do not exist.

Phase 7 also found a live instance of that defect class: `SIEMConfig.authHeader` carries the
schema comment "stored encrypted at rest", and `siem-forwarder.ts` reads it straight into an
HTTP header with no decryption. It is plaintext today. The same crypto helper retrofits it.

## Phase 0: Safety rails and baseline
**Duration**: 30-45 minutes
**Dependencies**: None
**Parallelizable**: No

Production serves from this working directory. `CLAUDE.md`: "any uncommitted edit in this
repo goes live the moment the service restarts for any reason." Every phase below is built
and verified on staging first, and committed before any restart.

### Task 0.1: Confirm the staging loop works end to end
**Dependencies**: None

```bash
cd ~/parse-for-agents-live
./scripts/staging-down.sh
yes y | ./scripts/staging-reset.sh    # interactive read -p; piping through tail aborts it silently
./scripts/staging-up.sh
curl -s http://localhost:3005/health | jq -r .deployment.commit
# Expected: a commit hash, and no "[migrate] startup migration failed" in the log
tail -5 /var/folders/*/T/parse-staging/app.log
```

**Acceptance Criteria:**
- [ ] `/health` returns 200 with a commit hash
- [ ] App log shows no migration failure
- [ ] `POST /v1/orgs/bootstrap` on :3005 returns 201, not 503

### Task 0.2: Capture the baseline the plan must not regress
**Dependencies**: Task 0.1

```bash
for f in src/lib/tool-policy.test.ts src/lib/org-policy-ceiling.test.ts \
         src/routes/organizations.test.ts src/routes/org-policy.test.ts \
         src/routes/tool-policy.test.ts src/routes/agent-registry-tool-policy.test.ts \
         src/pages/org-control-panel.test.ts src/lib/gateway/tool-filter.test.ts; do
  timeout 60 npx tsx --test "$f" || echo "PROBLEM: $f"
done
npm run typecheck && npm run brand-lint && npm run claims-lint
```

`npm test` hangs on `src/__tests__/keygen-local.test.ts` (Redis retries forever) — use the
per-file loop above, as `CLAUDE.md` instructs.

**Acceptance Criteria:**
- [ ] All eight governance test files pass before any change
- [ ] `typecheck`, `brand-lint`, `claims-lint` pass
- [ ] Baseline recorded so a later failure is attributable

### Task 0.3: Write the failing tests first
**Dependencies**: Task 0.2

Add one failing test per confirmed defect, before the fix. Each becomes the acceptance
check for its task.

```ts
// src/routes/compliance.test.ts
test("policy-history returns revisions for the caller's org, not the caller's key id", async () => {
  // seed: org + 1 PolicyRevision row for that org
  // expect: GET /v1/compliance/policy-history returns 1 revision
});

// src/routes/org-policy.test.ts
test("camelCase lockedFields is rejected, not silently dropped", async () => {
  // PUT /v1/org/policy-defaults { autoBlockThreshold: 5, lockedFields: [...] }
  // expect: 400 naming locked_fields — today this is 200 with locked_fields: []
});

// src/routes/policy.test.ts
test("a clamped write reports the effective value, not the requested one", async () => {
  // org ceiling threshold 5, unlocked; PUT /v1/policy { autoBlockThreshold: 9 }
  // expect: response autoBlockThreshold === 5 and org_clamped names the field
});

// src/routes/organizations.test.ts
test("an anonymous self-service key cannot bootstrap an organization", async () => {
  // expect: 403 with a verify-your-email next step
});
```

**Files:**
- Create: `src/routes/compliance.test.ts`
- Modify: `src/routes/org-policy.test.ts`, `src/routes/policy.test.ts`, `src/routes/organizations.test.ts`

**Acceptance Criteria:**
- [ ] Four new tests exist and **fail** for the documented reason
- [ ] No production code changed yet

### Exit Criteria Phase 0
- [ ] Staging responds 201 to `POST /v1/orgs/bootstrap`
- [ ] Eight existing governance test files pass
- [ ] Four new tests fail with the expected messages

## Phase 1: Truth fixes
**Duration**: 2-3 hours
**Dependencies**: Phase 0
**Parallelizable**: Yes (Tasks 1.1-1.5 touch different files)

Five independent defects where the product does the right thing and reports something else.
Every one is small, and every one is load-bearing for a security review. Ship this phase on
its own if nothing else lands.

### Task 1.1: Scope policy history to the organization (rec 2)
**Dependencies**: None

`src/routes/compliance.ts:611` reads `const orgId = apiKey.id;` and then queries
`WHERE org_id = ${orgId}`. Those two values are never equal, so every organization's history
is empty. `resolveOrgIdForCoverage` is **already imported in this file** at line 30 and is
what the very next handler uses.

```ts
// src/routes/compliance.ts — GET /v1/compliance/policy-history
- const orgId = apiKey.id;
+ const orgId = await resolveOrgIdForCoverage(apiKey.id);
+ if (!orgId) {
+   return c.json({ revisions: [], note: "This key does not belong to an organization." });
+ }
```

Also correct the catch block. It currently returns
`{ revisions: [], note: "Policy revision table not yet migrated." }` for **any** thrown
error, which explains a broken query away as a missing feature — an empty audit trail with a
reassuring caption is how a missing control passes review.

```ts
  } catch (err) {
-   return c.json({ revisions: [], note: "Policy revision table not yet migrated." });
+   console.error("[compliance] policy-history query failed:", (err as Error).message);
+   return serviceDependencyProblem(c, err);   // 503, retryable — same as every other route
  }
```

**Files:**
- Modify: `src/routes/compliance.ts`

**Acceptance Criteria:**
- [ ] Test from Task 0.3 passes
- [ ] After two rule changes, `GET /v1/compliance/policy-history` returns 2 revisions with `change_reason` and `diff`
- [ ] A forced query failure returns 503, not an empty list

### Task 1.2: Reject unknown keys on the ceiling write (rec 5)
**Dependencies**: None

`validateCeilingInput` in `src/routes/org-policy.ts:133` reads `input.locked_fields`. The
value fields beside it are camelCase (`autoBlockThreshold`, `enforcementMode`). Sending the
natural guess `lockedFields` returns 200 with `locked_fields: []` — the administrator
believes the ceiling is locked and it is not.

Accept the alias and reject anything else, so no future casing trap can open silently.

```ts
// src/routes/org-policy.ts — in validateCeilingInput, before reading fields
const KNOWN_FIELDS = new Set([...CEILING_FIELDS, "locked_fields", "lockedFields"]);
const unknown = Object.keys(input).filter((k) => !KNOWN_FIELDS.has(k));
if (unknown.length > 0) {
  return invalid(
    `Unknown field(s): ${unknown.join(", ")}. Valid fields: ${[...KNOWN_FIELDS].join(", ")}`,
    ErrorCode.VALIDATION_INVALID_INPUT,
  );
}

// accept the camelCase alias rather than dropping it
const lockedRaw = input.locked_fields ?? input.lockedFields;
```

**Files:**
- Modify: `src/routes/org-policy.ts`

**Acceptance Criteria:**
- [ ] Test from Task 0.3 passes
- [ ] `lockedFields` sets the lock and the response echoes it in `locked_fields`
- [ ] A typo such as `lockedField` returns 400 naming the valid fields
- [ ] `PUT /v1/policy` from an employee then returns the existing 422 with `locked_fields` and `org_values`

### Task 1.3: Make a clamped write tell the truth (rec 6)
**Dependencies**: None

A field the ceiling tightens but does not lock is stored as written, and `PUT /v1/policy`
returns the stored value. The employee sees `autoBlockThreshold: 9, enforcementMode: monitor`
and builds on it; reads return 5 and block. Both helpers needed already exist and are
exported from `src/lib/org-policy-ceiling.ts`: `applyOrgPolicyCeiling` (used by `auth.ts` at
lines 506/533/537) and `clampedFields` (already imported by `policy.ts` at line 10).

```ts
// src/routes/policy.ts — at the success return of PUT /v1/policy
const clamped = ceiling ? clampedFields(saved, ceiling) : [];
return c.json({
  ...(ceiling ? applyOrgPolicyCeiling(saved, ceiling) : saved),
  ...(clamped.length > 0 && {
    org_clamped: {
      fields: clamped,
      org_values: Object.fromEntries(clamped.map((f) => [f, (ceiling as Record<string, unknown>)[f]])),
      detail: "Your organization's ceiling is stricter than the value you sent. The effective policy is shown above.",
    },
  }),
});
```

Same class of defect in `src/routes/organizations.ts:435-442`: claiming a key that belongs to
another org returns `200 {"claimed": 0, "message": "No keys needed claiming (all already
belong to this org or not found)"}`. Correctly refused, reported as a no-op. Separate the two
cases and refuse explicitly.

```ts
// src/routes/organizations.ts — POST /v1/orgs/:id/claim-keys
const requested = await prisma.apiKey.findMany({
  where: { id: { in: body.keyIds } },
  select: { id: true, orgId: true },
});
const foreign = requested.filter((k) => k.orgId && k.orgId !== orgId);
if (foreign.length > 0) {
  return problem(c, {
    status: 409,
    title: "Key belongs to another organization",
    detail: `${foreign.length} key(s) already belong to a different organization. Only an admin-scoped caller may migrate a key between organizations.`,
    code: ErrorCode.VALIDATION_INVALID_INPUT,
    retryable: false,
    conflicting_key_ids: foreign.map((k) => k.id),
  });
}
```

**Files:**
- Modify: `src/routes/policy.ts`, `src/routes/organizations.ts`

**Acceptance Criteria:**
- [ ] Test from Task 0.3 passes
- [ ] Clamped `PUT /v1/policy` returns the effective value plus `org_clamped`
- [ ] Claiming a foreign key returns 409 naming the key ids, not `claimed: 0`
- [ ] Claiming an unclaimed key still returns 200 and claims it

### Task 1.4: Correct the trust page (rec 10)
**Dependencies**: None

`src/pages/trust-page.ts` states RBAC roles in two places, including the pre-answered
security-questionnaire response a customer's reviewer reads into their assessment. All four
names are wrong. The real roles are in `src/lib/rbac.ts:21`.

```ts
// src/pages/trust-page.ts:192
- <li>Roles: admin, owner, member, viewer</li>
+ <li>Roles: org_admin, security_analyst, auditor, developer</li>

// src/pages/trust-page.ts:381
- <p class="a">Yes. RBAC with defined roles (admin, owner, member, viewer). Access enforced at route level via middleware.</p>
+ <p class="a">Yes. RBAC with defined roles (org_admin, security_analyst, auditor, developer). Access is enforced at route level by middleware, and org-scoped routes additionally refuse callers outside the organization.</p>

// src/pages/trust-page.ts:202 — Auth0 is claimed and unsupported; WorkOS is supported and unlisted
- <li>Google, Microsoft, Okta, Auth0, custom OIDC</li>
+ <li>Okta, Microsoft Entra ID, Google Workspace, WorkOS</li>
```

Supported providers are the four in `src/lib/sso/sso-provider.ts:20`.

**Files:**
- Modify: `src/pages/trust-page.ts`

**Acceptance Criteria:**
- [ ] `curl -s https://.../trust | grep -c "admin, owner, member, viewer"` returns 0
- [ ] Both role listings match `VALID_ROLES` in `src/lib/rbac.ts`
- [ ] SSO list matches `ProviderType` exactly
- [ ] `npm run claims-lint` passes

### Task 1.5: Add a role-name drift test
**Dependencies**: Task 1.4

The trust page drifted because nothing tied its prose to the code. Bind them.

```ts
// src/pages/trust-page.test.ts
import { VALID_ROLES } from "../lib/rbac.js";
test("trust page lists exactly the roles the code implements", () => {
  const html = renderTrustPage("https://example.test");
  for (const role of VALID_ROLES) assert.ok(html.includes(role), `missing ${role}`);
  for (const stale of ["owner", "member", "viewer"]) {
    assert.ok(!new RegExp(`Roles:[^<]*\\b${stale}\\b`).test(html), `stale role ${stale}`);
  }
});
```

**Files:**
- Create: `src/pages/trust-page.test.ts`

**Acceptance Criteria:**
- [ ] Test passes now and fails if a role is renamed in `rbac.ts` without updating the page

### Exit Criteria Phase 1
- [ ] All four Task 0.3 tests pass
- [ ] `GET /v1/compliance/policy-history` returns real revisions on staging
- [ ] `lockedFields` and `locked_fields` both lock; an unknown field 400s
- [ ] A clamped `PUT /v1/policy` response shows the effective value
- [ ] `/trust` role names match `src/lib/rbac.ts`
- [ ] Eight baseline test files still pass

## Phase 2: The door
**Duration**: 2-3 hours
**Dependencies**: Phase 0
**Parallelizable**: No

The exit moment. A paying customer opened `/dashboard/org` and got a raw 403 that named the
roles it required and no way to obtain one. `POST /v1/orgs/bootstrap` works and returns in
133 ms — nothing in the product says so.

### Task 2.1: Serve a get-started state instead of a bare 403 (rec 3)
**Dependencies**: None

`src/routes/public.ts:935` chains `requireRole("org_admin", "security_analyst", "auditor")`
in front of the panel, so an org-less key never reaches a handler. Branch before the guard.

`CLAUDE.md` is explicit that a GET rendering a dashboard must never write. The page offers;
the existing `POST /v1/orgs/bootstrap` creates.

```ts
// src/routes/public.ts — replace the requireRole chain on /dashboard/org
publicRoutes.get("/dashboard/org", authMiddleware("evaluate"), async (c) => {
  const apiKey = c.get("apiKey");
  const orgId = await resolveOrgIdForCoverage(apiKey.id);
  if (!orgId) {
    // No organization yet — offer to create one. Read-only: the form POSTs to the API route.
    return c.html(renderOrgGetStartedPage(getBaseUrl(c), apiKey.id, apiKey.name));
  }
  if (!hasRole(apiKey, "org_admin", "security_analyst", "auditor")) {
    return problem(c, { /* existing 403, now only for a real in-org role mismatch */ });
  }
  return c.html(await renderOrgControlPanelPage(...));
});
```

The page states what an organization gives them, in the persona's terms: one rule bans a
capability under every name, a developer cannot write an exception, and every change is
receipted. It carries a name field, a mode chooser (Task 2.3), and a CSRF token issued by
`issueCsrfToken` exactly as the panel does at `org-control-panel.ts:408`.

**Files:**
- Create: `src/pages/org-get-started.ts`
- Modify: `src/routes/public.ts`

**Acceptance Criteria:**
- [ ] An org-less key opening `/dashboard/org` gets 200 and an HTML page, not JSON
- [ ] Submitting the form creates the org and redirects to the populated panel
- [ ] A key already in an org with the wrong role still gets the 403
- [ ] The GET writes nothing — verified by `POLICY_REVISION` count unchanged after 5 loads

### Task 2.2: Give the role 403 a next step (rec 3)
**Dependencies**: None

Any other route can still emit the bare 403. `requireRole` in `src/lib/rbac.ts:139` returns
`required_roles` and `current_role` and no remedy. `auth.ts:209` already establishes the
`_help` pattern for the 401.

```ts
// src/lib/rbac.ts — in requireRole's problem() call
+ _help: {
+   no_organization: {
+     detail: "If this key belongs to no organization, create one and become its org_admin.",
+     method: "POST",
+     url: "/v1/orgs/bootstrap",
+     body: { name: "string (required)", tool_policy_mode: "blocklist | allowlist (optional)" },
+   },
+   in_organization: "If your key is already in an organization, ask an org_admin to change your role: PUT /v1/orgs/:id/members/:keyId/role",
+   dashboard: "/dashboard/org",
+ },
```

**Files:**
- Modify: `src/lib/rbac.ts`

**Acceptance Criteria:**
- [ ] The 403 body names `POST /v1/orgs/bootstrap`
- [ ] Existing `required_roles` and `current_role` fields are unchanged
- [ ] Existing rbac tests still pass

### Task 2.3: Let bootstrap choose its own mode and say what it chose (rec 11)
**Dependencies**: None

An organization is created to stop something, and its first state is "every tool is allowed".
Keep `blocklist` as the default for compatibility, but make the choice available and make the
response state the consequence rather than leaving the caller to infer it.

```ts
// src/routes/organizations.ts — POST /v1/orgs/bootstrap
const mode = body.tool_policy_mode ?? "blocklist";
if (mode !== "blocklist" && mode !== "allowlist") {
  return problem(c, { status: 400, title: "Validation failure",
    detail: 'tool_policy_mode must be "blocklist" or "allowlist"', ... });
}
// ...create with toolPolicyMode: mode, then:
return c.json({
  ...org,
  role: "org_admin",
  tool_policy: {
    mode,
    meaning: mode === "blocklist"
      ? "Every tool is allowed until a rule blocks it. Add your first rule at POST /v1/org/tool-policy/rules, or switch with PUT /v1/org/tool-policy."
      : "Every tool is blocked until a rule allows it. No agent in this org may use any tool until you add an allow rule.",
  },
  next_steps: [
    { step: "Ban a capability under every name it ships with",
      method: "POST", url: "/v1/org/tool-policy/rules",
      body: { kind: "category", pattern: "browser", action: "block" } },
    { step: "Dry-run the ban against the names your teams use",
      method: "POST", url: "/v1/org/tool-policy/test" },
    { step: "Set a risk ceiling your members cannot loosen",
      method: "PUT", url: "/v1/org/policy-defaults" },
  ],
}, 201);
```

**Files:**
- Modify: `src/routes/organizations.ts`

**Acceptance Criteria:**
- [ ] `{"tool_policy_mode":"allowlist"}` creates an allowlist org
- [ ] Omitting the field still yields `blocklist`
- [ ] An invalid value returns 400
- [ ] The 201 body carries `tool_policy.meaning` and three `next_steps`

### Task 2.4: Point the new key at the control plane (journey row 6)
**Dependencies**: Task 2.3

The signup row scored "fine". The key generation response already carries an honest expiry
note; add the one pointer that turns a key into a control plane.

```ts
// src/routes/public.ts — POST /v1/keys/generate success body
+ governance: {
+   detail: "This key belongs to no organization. Create one to govern which tools your agents may use.",
+   create_org: { method: "POST", url: "/v1/orgs/bootstrap" },
+   dashboard: "/dashboard/org",
+ },
```

**Files:**
- Modify: `src/routes/public.ts`

**Acceptance Criteria:**
- [ ] The 201 from `POST /v1/keys/generate` names `/v1/orgs/bootstrap`
- [ ] Latency is unchanged — no new database read on this path
- [ ] `src/__tests__/keygen-failure-taxonomy.test.ts` still passes

### Exit Criteria Phase 2
- [ ] A stranger with a fresh key reaches a working org panel without reading any guide
- [ ] `/dashboard/org` never returns raw JSON to an org-less key
- [ ] Every role 403 names `POST /v1/orgs/bootstrap`
- [ ] Bootstrap accepts and explains `tool_policy_mode`

## Phase 3: Identity foundation
**Duration**: 3-4 hours
**Dependencies**: Phase 0
**Parallelizable**: No (schema then routes then pages)

The root cause. `User` exists with `email` and `emailVerifiedAt`; key issuance never uses it.
Production has 0 verified emails and every real signup user holds 0 keys.

### Task 3.1: Attach session-authenticated key generation to the real user
**Dependencies**: None

`POST /v1/keys/generate` (`src/routes/public.ts:2701`) always calls `createApiKey`, which
passes `SELF_SERVICE_USER_ID` (`src/auth.ts:553`). The account dashboard's Create Key button
posts to that same endpoint (`src/pages/account-dashboard.ts:223`) while the page lists
`apiKey.findMany({ where: { userId: user.id } })` — so **a key created from the account
dashboard never appears in the account dashboard.** This is a live bug, and it is the same
missing edge the bypass exploits.

Keep the anonymous path byte-identical. Add a branch: if the request carries a valid session
cookie, attribute the key to that user.

```ts
// src/routes/public.ts — POST /v1/keys/generate, at key creation
const sessionUser = await getSessionUserOptional(c);   // returns null when no cookie
const ownerId = sessionUser?.id ?? SELF_SERVICE_USER_ID;
const key = await createApiKey(name, ["analyze","evaluate","chat"], expiresAt, undefined, ownerId);
```

`createApiKey` in `src/auth.ts:553` gains an optional `ownerId` defaulting to
`SELF_SERVICE_USER_ID`, so every existing caller is unaffected.

**Files:**
- Modify: `src/routes/public.ts`, `src/auth.ts`

**Acceptance Criteria:**
- [ ] Anonymous `POST /v1/keys/generate` still returns 201 with no account, unchanged shape plus Task 2.4's block
- [ ] The same call with a session cookie creates a key whose `userId` is the session user
- [ ] A key created from `/account` now appears in the `/account` key list after reload
- [ ] Rate limiting, the global cap and the Redis fallback path are untouched

### Task 3.2: Fix account key revocation
**Dependencies**: Task 3.1

`account-dashboard.ts:261` calls `DELETE /v1/keys/:id`, which requires `admin` scope
(`src/routes/keys.ts:119`) and is sent with no Authorization header. It fails for every user.

```ts
// src/routes/public.ts — new session-scoped route
publicRoutes.delete("/account/keys/:id", sessionMiddleware, async (c) => {
  const user = getSessionUserFromContext(c);
  const id = c.req.param("id")!;
  const key = await prisma.apiKey.findUnique({ where: { id }, select: { userId: true } });
  if (!key || key.userId !== user.id) {
    return problem(c, { status: 404, title: "Not found", detail: "Key not found on this account.", ... });
  }
  await deleteApiKey(id);
  auditLog({ action: "account_key_revoked", apiKeyId: id, detail: `Revoked by user ${user.id}` });
  return c.json({ revoked: true, id });
});
```

Point the dashboard at it.

**Files:**
- Modify: `src/routes/public.ts`, `src/pages/account-dashboard.ts`

**Acceptance Criteria:**
- [ ] Revoke from `/account` succeeds and the key 401s afterwards
- [ ] A user cannot revoke a key belonging to another user (404, not 403 — no existence leak)
- [ ] The action is audit-logged

### Task 3.3: Ship email verification
**Dependencies**: Task 3.1

`User.emailVerifiedAt` exists and nothing sets it. Follow the `PasswordReset` model already
in `prisma/schema.prisma:27` — same token-hash shape, same expiry pattern, same mailer
(`src/lib/email.ts`).

```prisma
model EmailVerification {
  id        String   @id @default(cuid())
  userId    String   @map("user_id")
  tokenHash String   @unique @map("token_hash")
  expiresAt DateTime @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime @default(now()) @map("created_at")
  user      User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@map("email_verifications")
}
```

Routes: `POST /auth/verify/send` (session-scoped, rate-limited), `GET /auth/verify/:token`
(sets `emailVerifiedAt`, redirects to `/account`). Signup sends the mail automatically.
Staging has no `RESEND_API_KEY` by design — log the link there and assert on the log.

**Files:**
- Modify: `prisma/schema.prisma`, `src/routes/public.ts`
- Create: `prisma/migrations/0NN_email_verifications.sql`, `src/lib/email-verification.ts`

**Acceptance Criteria:**
- [ ] Signup creates a verification token and sends (or logs) the link
- [ ] Visiting a valid link sets `emailVerifiedAt` and marks the token used
- [ ] An expired, used or unknown token returns 400 and does not verify
- [ ] Resend is rate-limited per user

### Task 3.4: Show the real owner on the org panel
**Dependencies**: Task 3.1

The People zone shows `self-service@internal.invalid` for every self-service key. Once keys
carry a real `userId`, show it — and label the anonymous ones as what they are rather than
printing a fake address.

```ts
// src/pages/org-control-panel.ts — People zone, owner column
const owner = key.user.id === SELF_SERVICE_USER_ID
  ? '<span class="ocp-muted">anonymous key — no account</span>'
  : escapeHtml(key.user.email) + (key.user.emailVerifiedAt ? "" : ' <span class="ocp-warn">unverified</span>');
```

**Files:**
- Modify: `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] A key owned by a real account shows that account's email
- [ ] An anonymous key shows "anonymous key — no account", never a placeholder address
- [ ] Unverified emails are marked
- [ ] `src/pages/org-control-panel.test.ts` passes

### Task 3.5: Backfill guidance for existing keys
**Dependencies**: Task 3.3

49 production keys belong to `legacy@parsethis.ai` and 15 to `self-service`. They keep
working — nothing in this plan revokes or re-owns a key. Document the position and give
existing holders a route in.

```ts
// POST /account/keys/adopt  { key: "pfa_live_..." }  — session-scoped
// Re-owns an anonymous key to the calling account after verifying the key hash.
// Refuses any key already owned by a different real user, and any key already in an org.
```

**Files:**
- Modify: `src/routes/public.ts`, `src/pages/account-dashboard.ts`

**Acceptance Criteria:**
- [ ] An anonymous key can be adopted by a verified account
- [ ] A key owned by another real user is refused (409)
- [ ] A key already in an organization is refused with the org named
- [ ] Existing keys keep authenticating throughout

### Exit Criteria Phase 3
- [ ] A signed-in user's generated keys appear on `/account` and can be revoked there
- [ ] `emailVerifiedAt` is set by a real verification link
- [ ] Anonymous `POST /v1/keys/generate` is unchanged in latency and shape
- [ ] The panel never prints `self-service@internal.invalid`

## Phase 4: Domain-bound organizations
**Duration**: 3-4 hours
**Dependencies**: Phase 3
**Parallelizable**: No

Closes the bypass. Three unauthenticated calls stood up a rival organization that the real
admin could not see, reclaim, or list.

### Task 4.1: Require a verified person to create an organization (rec 1)
**Dependencies**: Phase 3

`checkBootstrapEligibility` in `src/routes/organizations.ts:252` is pure and unit-tested.
Extend its input rather than inlining the rule at the call site.

```ts
// src/lib/org-bootstrap-eligibility.ts
export function checkBootstrapEligibility(
  key: { id: string; orgId: string | null } | null,
  user: { id: string; email: string; emailVerifiedAt: Date | null } | null,
  claimedDomains: Map<string, { orgId: string; orgName: string }>,
): BootstrapGate {
  if (!key) return { ok: false, reason: "no_record" };
  if (key.orgId) return { ok: false, reason: "already_in_org", orgId: key.orgId };
  if (!user || user.id === SELF_SERVICE_USER_ID) return { ok: false, reason: "anonymous_key" };
  if (!user.emailVerifiedAt) return { ok: false, reason: "unverified_email" };
  const domain = user.email.split("@")[1]?.toLowerCase();
  const claimed = domain ? claimedDomains.get(domain) : undefined;
  if (claimed) return { ok: false, reason: "domain_claimed", orgId: claimed.orgId, orgName: claimed.orgName };
  return { ok: true };
}
```

Each refusal gets its own 403 with a real next step — "verify your email", "your domain
belongs to *Meridian Health Claims*; ask an org_admin there to claim your key".

**Files:**
- Create: `src/lib/org-bootstrap-eligibility.ts`, `src/lib/org-bootstrap-eligibility.test.ts`
- Modify: `src/routes/organizations.ts`

**Acceptance Criteria:**
- [ ] An anonymous key gets 403 `anonymous_key` naming `/signup`
- [ ] A verified user with an unclaimed domain still bootstraps in one call
- [ ] An unverified user gets 403 naming the resend endpoint
- [ ] Unit tests cover all five branches

### Task 4.2: Let an organization claim its domains
**Dependencies**: Task 4.1

```prisma
model Organization {
  // ...
  verifiedDomains String[] @default([]) @map("verified_domains")
}
```

Verification by DNS TXT record — `parse-verify=<token>` on `_parse-challenge.<domain>` —
so no one can claim `gmail.com`. Reject public mail domains outright from a denylist.

Routes: `POST /v1/orgs/:id/domains` (org_admin, returns the challenge),
`POST /v1/orgs/:id/domains/:domain/verify` (checks DNS, adds to `verifiedDomains`),
`DELETE /v1/orgs/:id/domains/:domain`.

**Files:**
- Modify: `prisma/schema.prisma`, `src/routes/organizations.ts`
- Create: `prisma/migrations/0NN_org_verified_domains.sql`, `src/lib/org-domains.ts`

**Acceptance Criteria:**
- [ ] A domain is only added after the TXT record resolves
- [ ] Public mail domains are refused with the list named
- [ ] A domain already verified by another org returns 409
- [ ] Removing a domain re-opens bootstrap for that domain

### Task 4.3: Surface unaffiliated keys on the admin's own domain
**Dependencies**: Task 4.2

The bypass was invisible. Give the admin the view that ends that.

```ts
// GET /v1/orgs/:id/claimable  → keys whose owner's verified email is in this org's domains
//                               and whose orgId is null
```

Render as a People-zone sub-panel: "3 keys on meridian.example belong to no organization",
each with a Claim button wired to the existing `POST /v1/orgs/:id/claim-keys`.

**Files:**
- Modify: `src/routes/organizations.ts`, `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] A verified user on a claimed domain generating a key appears in the list within one page load
- [ ] Claiming from the panel moves the key and it disappears from the list
- [ ] Keys on other domains never appear
- [ ] An auditor sees the list read-only, with no Claim control in the HTML

### Task 4.4: Re-run the bypass, expect it to fail
**Dependencies**: Task 4.3

```bash
# 1. anonymous key — still works, by design
curl -sX POST :3005/v1/keys/generate -d '{"name":"dilan-personal"}'   # Expected: 201
# 2. bootstrap from it — now refused
curl -sX POST :3005/v1/orgs/bootstrap -H "Authorization: Bearer $NEW" -d '{"name":"Shadow"}'
# Expected: 403, reason anonymous_key, next step /signup
# 3. sign up on the governed domain, verify, retry
# Expected: 403 domain_claimed, naming Meridian Health Claims
# 4. the admin sees the key
curl -s :3005/v1/orgs/$ORG/claimable -H "Authorization: Bearer $ADMIN"   # Expected: the key
```

**Acceptance Criteria:**
- [ ] All four steps produce the expected results
- [ ] The report's three-call sequence no longer produces a governed-tool agent
- [ ] Keyless key generation still returns 201 in under 500 ms

### Exit Criteria Phase 4
- [ ] The documented bypass fails at step 2
- [ ] An employee on a claimed domain cannot form a rival organization
- [ ] Their key is visible and claimable by the real admin
- [ ] Anonymous key generation is unchanged

## Phase 5: Membership lifecycle
**Duration**: 2-3 hours
**Dependencies**: Phase 3
**Parallelizable**: Yes (5.1/5.2 API, 5.3/5.4 panel)

"How do I offboard Dilan on Monday?" has no answer today: no member-delete route (404),
`DELETE /v1/keys/:id` needs admin scope (403), and role demotion leaves the key working.

### Task 5.1: Remove a member (rec 4)
**Dependencies**: None

```ts
// src/routes/organizations.ts
organizationRoutes.delete(
  "/v1/orgs/:id/members/:keyId",
  authMiddleware("evaluate"),
  requireRole("org_admin"),
  requireCsrf(),
  async (c) => {
    // denyIfNotOwnOrg, then:
    //   mode=revoke (default) → set revokedAt, clear orgId, invalidate cache
    //   mode=release          → clear orgId only, key keeps working ungoverned
    // Refuse removing the last org_admin, and refuse self-removal (mirrors the
    // existing self-demotion guard at organizations.ts:652).
  },
);
```

Revoke is the default because offboarding means the key stops working. `release` exists for
a contractor whose key should survive outside the org.

**Files:**
- Modify: `src/routes/organizations.ts`

**Acceptance Criteria:**
- [ ] Removing a member revokes the key; it 401s on the next call
- [ ] `?mode=release` clears `orgId` and the key keeps working
- [ ] Removing the last org_admin returns 409
- [ ] Self-removal returns 409
- [ ] The change is audit-logged and appears in policy history

### Task 5.2: Offboard a person, not a key
**Dependencies**: Task 5.1

The panel's own honest note says one employee holding three keys appears three times. Now
that keys carry a real `userId`, act on the person.

```ts
// DELETE /v1/orgs/:id/members/by-user/:userId  → revokes every key that user holds in this org
```

**Files:**
- Modify: `src/routes/organizations.ts`

**Acceptance Criteria:**
- [ ] One call revokes all three of a user's keys in that org
- [ ] Keys the user holds in another org are untouched
- [ ] The response lists exactly which keys were revoked

### Task 5.3: Wire member controls into the panel
**Dependencies**: Task 5.1

The panel wires no member mutations, so an admin who does not read the API guide has a page
that displays their organization and cannot administer it. The CSRF-aware `fetch` wrapper
already exists at `org-control-panel.ts:955-970`; follow the pattern the rule and ceiling
controls already use.

Add per-row role select and Remove button — rendered **only** for `org_admin`, absent from
the HTML for analysts and auditors, matching the existing zone-2 and zone-3 behaviour that
the report singled out as correct.

**Files:**
- Modify: `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] An org_admin can change a role and remove a member from the panel
- [ ] `grep -c "ocp-member-remove"` on the auditor render returns 0
- [ ] Removing the last org_admin is refused with the 409 message shown inline
- [ ] `src/pages/org-control-panel.test.ts` covers the auditor absence case

### Task 5.4: Group the People zone by person
**Dependencies**: Task 3.4, Task 5.2

Group rows under the owning account, with the anonymous keys in their own group. Keep the
honest note, updated to say identity now exists and how it is derived.

**Files:**
- Modify: `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] Three keys held by one user render as one group of three
- [ ] Each group offers "Offboard this person"
- [ ] Anonymous keys group separately and are labelled

### Exit Criteria Phase 5
- [ ] An admin can offboard a person in one action from the panel
- [ ] Revoked keys 401 immediately
- [ ] Auditors see no mutation controls in the HTML
- [ ] Every membership change is audit-logged

## Phase 6: Audit visibility
**Duration**: 1 hour
**Dependencies**: Phase 1
**Parallelizable**: Yes

The revisions exist and are correct. Phase 1 made them readable by API; this makes them
readable by the person who has to show them to an auditor.

### Task 6.1: Add a policy-history zone to the panel
**Dependencies**: Task 1.1

A fifth zone, after Violations: version, what changed, who changed it, when, and the reason
string the admin typed. Follow the existing per-zone `try/catch` convention so a degraded
database renders an empty section rather than a 500, and render absent data as `—`.

**Files:**
- Modify: `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] Six policy changes render as six rows, newest first
- [ ] Each row shows before/after for the changed field
- [ ] A database failure renders "no data yet", not a 500
- [ ] Auditors can read the zone

### Task 6.2: Export the history with the evidence pack
**Dependencies**: Task 6.1

The control narrative needs it in the pack, not just on screen. Add policy revisions to the
existing compliance export.

**Files:**
- Modify: `src/routes/compliance.ts`, `src/lib/compliance/*`

**Acceptance Criteria:**
- [ ] The evidence export contains a policy-change section with before/after
- [ ] An org with no changes exports an empty section, not an error

### Exit Criteria Phase 6
- [ ] An org_admin can show who changed a rule, when, and what it was before, from the panel
- [ ] The same evidence appears in the export

## Phase 7: Per-org gateway and secret custody
**Duration**: 5-7 hours
**Dependencies**: Phase 4
**Parallelizable**: No

The gateway is the only enforcement point that does not depend on an agent honestly declaring
its own tools, and no customer can reach it: `configure` requires `admin` scope, and the
config is a process-global singleton (`src/lib/gateway/proxy-handler.ts:116`).

This phase reverses the recorded C17 decision. Task 7.6 updates that decision in `CLAUDE.md`;
do not consider the phase complete without it.

### Task 7.1: Build a secret-at-rest helper
**Dependencies**: None

No encryption helper exists anywhere in the codebase. Build one, once.

```ts
// src/lib/secret-box.ts — AES-256-GCM, key from PARSE_SECRET_KEY (32 bytes, base64)
export function sealSecret(plaintext: string): string;    // returns "v1.<iv>.<tag>.<ciphertext>"
export function openSecret(sealed: string): string;
export function isSealed(value: string): boolean;         // for migration of plaintext rows
```

Fail closed at boot: if `PARSE_SECRET_KEY` is absent, routes that store secrets return 503
with a clear operator message rather than writing plaintext.

**Files:**
- Create: `src/lib/secret-box.ts`, `src/lib/secret-box.test.ts`
- Modify: `src/index.ts` (startup check)

**Acceptance Criteria:**
- [ ] Round-trip returns the original for ASCII and Unicode
- [ ] A tampered ciphertext or tag throws, never returns plaintext
- [ ] Two seals of the same input differ (random IV)
- [ ] Missing key → secret-writing routes 503 with an operator message

### Task 7.2: Retrofit the SIEM auth header
**Dependencies**: Task 7.1

`SIEMConfig.authHeader` carries the schema comment "stored encrypted at rest";
`siem-forwarder.ts:201-210` reads it straight into an HTTP header. It is plaintext. That is
the same defect class as the `/trust` role names — a document asserting a control that does
not exist.

Seal on write, open on use, and migrate existing rows with `isSealed`. The list route already
redacts correctly (`compliance.ts:329`) — leave it.

**Files:**
- Modify: `src/routes/compliance.ts`, `src/lib/compliance/siem-forwarder.ts`, `prisma/schema.prisma` (comment)
- Create: `prisma/migrations/0NN_seal_siem_auth_headers.sql`

**Acceptance Criteria:**
- [ ] New configs store a `v1.` sealed value
- [ ] Existing plaintext rows keep working and are sealed on next write
- [ ] Forwarding still authenticates against a test endpoint
- [ ] The schema comment matches reality

### Task 7.3: Make gateway config per-organization
**Dependencies**: Task 7.1

```prisma
model GatewayConfig {
  id             String   @id @default(cuid())
  orgId          String   @unique @map("org_id")
  upstreamUrl    String   @map("upstream_url")
  sealedApiKey   String   @map("sealed_api_key")   // secret-box; never returned by any read
  model          String?
  active         Boolean  @default(true)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt      @map("updated_at")
  org            Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  @@map("gateway_configs")
}
```

Replace the module-global in `proxy-handler.ts:116` with a Redis-cached per-org lookup,
following the fail-open convention the tool-policy and ceiling stores already use — except
here, **fail closed**: no config means no proxy, not an unfiltered proxy.

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/gateway/proxy-handler.ts`, `src/routes/gateway.ts`
- Create: `prisma/migrations/0NN_gateway_configs.sql`, `src/lib/gateway/config-store.ts`

**Acceptance Criteria:**
- [ ] Two orgs hold different upstreams simultaneously without interference
- [ ] No read route ever returns the provider key — only `api_key_configured: true`
- [ ] A missing config returns 503 for that org only
- [ ] `src/lib/gateway/tool-filter.test.ts` passes unchanged

### Task 7.4: Open the gateway to org_admin (rec 9)
**Dependencies**: Task 7.3

```ts
// src/routes/gateway.ts — replace the admin-scope check
- if (!apiKey.scopes.includes("admin")) return problem(c, { status: 403, ... });
+ // org_admin configures their own org's gateway; admin scope still provisions for others
```

Guard with `requireRole("org_admin")` and `requireCsrf()`, and scope every write through
`denyIfNotOwnOrg`.

**Files:**
- Modify: `src/routes/gateway.ts`

**Acceptance Criteria:**
- [ ] An org_admin configures a gateway without admin scope
- [ ] A developer gets 403; an auditor gets 403
- [ ] An org_admin cannot configure another org's gateway
- [ ] The 503 from the proxy names a route the caller may actually call

### Task 7.5: Prove the gateway closes the declaration gap
**Dependencies**: Task 7.4

The whole point: the gateway reads tools off the wire, so declaring nothing does not help.

```bash
curl -sX POST :3005/v1/gateway/chat/completions -H "Authorization: Bearer $DEV" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}],
       "tools":[{"type":"function","function":{"name":"playwright"}}]}'
# Expected: the playwright tool stripped (blocklist) or the request refused (block)
```

**Files:**
- Create: `src/lib/gateway/org-enforcement.test.ts`

**Acceptance Criteria:**
- [ ] A blocked tool in the request's `tools` array is stripped or refused per the rule's action
- [ ] The removal is recorded as a `tool_policy_violation` event visible in the panel
- [ ] A tool the org allows passes through untouched

### Task 7.6: Update the C17 decision in CLAUDE.md
**Dependencies**: Task 7.5

Rewrite the gateway paragraph in `~/parse-for-agents-live/CLAUDE.md`: the gateway now
persists provider credentials per organization, sealed with `src/lib/secret-box.ts`, and the
blast radius is managed by encryption at rest, no-read-back, and per-org scoping rather than
by not storing them. Record why the trade changed — the gateway was unreachable, so the
enforcement point that does not rely on self-declaration did not exist for customers.

**Files:**
- Modify: `~/parse-for-agents-live/CLAUDE.md`

**Acceptance Criteria:**
- [ ] `CLAUDE.md` no longer claims the gateway avoids persistent key custody
- [ ] The new paragraph names `secret-box.ts` and `PARSE_SECRET_KEY`
- [ ] Committed in the same commit as Task 7.3

### Exit Criteria Phase 7
- [ ] An org_admin configures a gateway and a blocked tool is stripped from a live request
- [ ] No route returns a stored provider key
- [ ] SIEM auth headers are sealed and forwarding still works
- [ ] `CLAUDE.md` matches the code

## Phase 8: Declaration-gap visibility
**Duration**: 1-2 hours
**Dependencies**: Phase 0
**Parallelizable**: Yes

Even with the gateway shipped, direct `/v1/parse` callers still self-declare. Today a request
from an agent that declares nothing returns `0/safe/allow` with no tool-policy field at all,
so nothing records that the question was unanswerable.

### Task 8.1: Say what screening actually reads
**Dependencies**: None

Add to the docs Govern section and the org panel, in the persona's terms: screening-time
enforcement reads `metadata.tool_permissions` or `body.tools`; the registry 422 and the
gateway are the gates that do not depend on the agent's cooperation.

**Files:**
- Modify: `src/routes/public.ts` (docs), `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] `/docs` states the three enforcement points and what each covers
- [ ] `npm run claims-lint` passes

### Task 8.2: Make the undeclared case visible on every response
**Dependencies**: None

```ts
// src/routes/parse.ts — org governance block, on every org-scoped response
tool_policy: {
  declared: declaredTools.length,
  evaluated: declaredTools.length > 0,
  violations: violations,          // existing field, unchanged
  ...(declaredTools.length === 0 && {
    note: "This request declared no tools, so org tool rules could not be applied to it. Declare tools via metadata.tool_permissions, or route through the org gateway.",
  }),
}
```

**Files:**
- Modify: `src/routes/parse.ts`

**Acceptance Criteria:**
- [ ] A request declaring nothing carries `tool_policy.evaluated: false` and the note
- [ ] A request declaring a blocked tool still returns 7/critical/block with `tool_policy_violations`
- [ ] Keys outside an org see no new field
- [ ] Latency is unchanged — no extra query

### Task 8.3: Warn on agents that declare nothing
**Dependencies**: Task 8.2

In the panel's Agent privileges zone: "4 of 11 registered agents declare no tools — org rules
cannot decide for them." Link to the gateway setup from Phase 7.

**Files:**
- Modify: `src/pages/org-control-panel.ts`

**Acceptance Criteria:**
- [ ] The count matches `AgentRegistry` rows with an empty `tools` array
- [ ] Zero such agents renders no warning
- [ ] The warning links to gateway configuration

### Exit Criteria Phase 8
- [ ] An admin can tell, from the panel and from any response, when tool rules were not applied
- [ ] The docs state which enforcement point covers which case

## Phase 9: Discovery surfaces
**Duration**: 3-4 hours
**Dependencies**: Phase 2, Phase 4, Phase 5, Phase 7
**Parallelizable**: Yes (9.1-9.4 are separate files)

Runs last so the spec describes the finished API. This is the phase that stops the next Iris
from concluding the feature does not exist.

### Task 9.1: Put the org API in the machine surfaces (rec 7)
**Dependencies**: None

`discoveryRoutes.get("/openapi.json")` at `src/routes/discovery.ts:410` hand-authors 19
paths. None is org-scoped — and `/v1/agents`, which the docs do describe, is missing too.

Add: `/v1/orgs/bootstrap`, `/v1/orgs/{id}`, `/v1/orgs/{id}/members`,
`/v1/orgs/{id}/members/{keyId}` (incl. DELETE), `/v1/orgs/{id}/members/{keyId}/role`,
`/v1/orgs/{id}/claim-keys`, `/v1/orgs/{id}/claimable`, `/v1/orgs/{id}/domains`,
`/v1/org/tool-policy`, `/v1/org/tool-policy/rules`, `/v1/org/tool-policy/rules/{id}`,
`/v1/org/tool-policy/test`, `/v1/org/tool-policy/catalog`, `/v1/org/policy-defaults`,
`/v1/compliance/policy-history`, `/v1/gateway/configure`, plus the agent registry group.

Retitle the spec. "Parse Prompt Protection API" undersells a product whose own homepage says
governance is the product.

```ts
- title: "Parse Prompt Protection API",
+ title: "Parse Agent Governance & Compliance API",
```

Add the same to `/llms.txt` (`discovery.ts:221`): a Task Router line for governance, and
Public Facts entries for org tool rules and the policy ceiling.

**Files:**
- Modify: `src/routes/discovery.ts`

**Acceptance Criteria:**
- [ ] `curl -s /openapi.json | jq '.paths | keys | length'` returns at least 35
- [ ] Every org route in `src/routes/organizations.ts`, `tool-policy.ts` and `org-policy.ts` appears
- [ ] `/llms.txt` mentions organizations, tool policy and bootstrap
- [ ] The spec parses as valid OpenAPI 3.1

### Task 9.2: Add a spec-coverage test
**Dependencies**: Task 9.1

The spec drifted because nothing compared it to the router. Bind them, so this cannot recur.

```ts
// src/routes/discovery-openapi-coverage.test.ts
test("every mounted /v1 route appears in openapi.json", () => {
  const mounted = collectRoutes(app).filter((r) => r.path.startsWith("/v1/"));
  const documented = new Set(Object.keys(spec.paths));
  const missing = mounted.filter((r) => !documented.has(toSpecPath(r.path)));
  assert.deepEqual(missing, [], `undocumented: ${missing.map((r) => r.path).join(", ")}`);
});
```

**Files:**
- Create: `src/routes/discovery-openapi-coverage.test.ts`

**Acceptance Criteria:**
- [ ] The test passes after 9.1
- [ ] Adding a route without documenting it fails the test
- [ ] An explicit allowlist covers deliberately-undocumented internal routes

### Task 9.3: Add tool policy to the docs and the landing page (rec 7)
**Dependencies**: None

The docs Govern table at `src/routes/public.ts:1117-1160` lists seven endpoint groups and no
tool policy, and calls `/v1/policy` "Screening policy for your key" — the exact thing the
persona says is not a control. Add four rows and qualify that one.

```html
<tr><td><code>GET/PUT /v1/org/tool-policy</code></td>
    <td>Which connectors, plugins and MCP servers your agents may use. One rule on a capability category bans every name it ships under. Scoped rules may tighten the org result, never loosen it.</td></tr>
<tr><td><code>POST /v1/org/tool-policy/rules</code></td>
    <td>Add a rule by category, exact name, or name prefix. Dry-run any tool name against your rules with <code>POST /v1/org/tool-policy/test</code>.</td></tr>
<tr><td><code>GET/PUT /v1/org/policy-defaults</code></td>
    <td>Org-wide risk tolerance. Locked fields cannot be loosened by a member key — the write returns 422, not a silent clamp.</td></tr>
<tr><td><code>POST /v1/orgs/bootstrap</code></td>
    <td>Create your organization and become its <code>org_admin</code>.</td></tr>
```

And on the landing page (`src/pages/landing.ts:536-544`), the six controls become seven —
tool policy first, because it is the only one that answers "a developer cannot turn it off",
which is the whole sale.

```html
<div class="gcard"><div class="tag">TOOL POLICY</div><h3>Ban a capability, not a name</h3>
<p>One rule on <code>browser</code> covers browser_use, playwright, computer_use and every MCP name they hide behind. A team lead cannot write themselves an exception.</p></div>
```

Update the section subtitle from "Six controls" to "Seven controls".

**Files:**
- Modify: `src/routes/public.ts`, `src/pages/landing.ts`

**Acceptance Criteria:**
- [ ] The docs Govern table lists the org endpoints
- [ ] `/v1/policy` is described as per-key **and** points at the org ceiling above it
- [ ] The landing page shows seven controls, tool policy among them
- [ ] `npm run brand-lint` and `npm run claims-lint` pass

### Task 9.4: Answer the tier question on every pricing card (rec 8)
**Dependencies**: None

Org governance is tier-independent, and no card says so. Per the decision above it stays free
on every tier — say it plainly, on every card, including Free.

```ts
// src/pages/pricing.ts — one line on every plan card
<li style="...">Org governance: tool rules, roles, audit trail — every tier</li>
```

Add a short paragraph under the grid explaining that governance is not the upsell: volume,
SIEM forwarding and evidence packs are.

Also set `Organization.planTier` from the owner key's tier at bootstrap so the field stops
reading `free` for a Team customer, and keep it in step on subscription change.

**Files:**
- Modify: `src/pages/pricing.ts`, `src/routes/organizations.ts`, `src/routes/billing.ts`

**Acceptance Criteria:**
- [ ] Every pricing card names org governance
- [ ] An org created by a Team key reads `planTier: "team"`
- [ ] A subscription change updates the org's tier
- [ ] `npm run brand-lint` passes

### Exit Criteria Phase 9
- [ ] `openapi.json` documents every mounted `/v1` route, and a test enforces it
- [ ] Docs, landing and pricing all name tool policy
- [ ] A stranger reading only the public surfaces learns the control plane exists

## Phase 10: Re-walk verification
**Duration**: 1-2 hours
**Dependencies**: Phase 1-9
**Parallelizable**: No

### Task 10.1: Re-run the run-7 walkthrough and confirm every row reads delight
**Dependencies**: All phases

Walk Appendix A top to bottom on staging, then re-check the production-only rows against
production after deploy. The run is complete when all 21 rows read delight and the bypass
fails at step 2.

```bash
# The five that decide it
curl -s :3005/dashboard/org -H "Authorization: Bearer $FRESH"        # Expected: HTML, not JSON
curl -sX POST :3005/v1/orgs/bootstrap -H "Authorization: Bearer $ANON" -d '{"name":"x"}'  # Expected: 403 anonymous_key
curl -s :3005/v1/compliance/policy-history -H "Authorization: Bearer $ADMIN" | jq '.revisions | length'  # Expected: > 0
curl -sX DELETE :3005/v1/orgs/$ORG/members/$KEY -H "Authorization: Bearer $ADMIN"          # Expected: 200, key then 401s
curl -sX PUT :3005/v1/org/policy-defaults -H "Authorization: Bearer $ADMIN" \
  -d '{"autoBlockThreshold":5,"lockedFields":["autoBlockThreshold"]}' | jq .locked_fields   # Expected: ["autoBlockThreshold"]
```

**Acceptance Criteria:**
- [ ] All 21 journey rows in Appendix A read delight
- [ ] All 11 recommendations in Appendix B are closed
- [ ] The three-call bypass fails
- [ ] Full governance test sweep passes, plus `typecheck`, `brand-lint`, `claims-lint`
- [ ] Keyless key generation still returns 201 in under 500 ms

### Exit Criteria Phase 10
- [ ] Appendix A is fully green
- [ ] No regression in the eight baseline test files
- [ ] Changes committed before any production restart

## Dependency graph

```
Phase 0 (Safety rails)
    ├── Phase 1 (Truth fixes) ─────────────┐ gate: LIGHT
    │       └── Phase 6 (Audit visibility) │ gate: LIGHT
    ├── Phase 2 (The door) ────────────────┤ gate: STANDARD
    ├── Phase 8 (Declaration visibility) ──┤ gate: LIGHT
    └── Phase 3 (Identity) ────────────────┤ gate: DEEP
            ├── Phase 4 (Domain binding) ──┤ gate: DEEP
            │       └── Phase 7 (Gateway) ─┤ gate: DEEP
            └── Phase 5 (Membership) ──────┤ gate: STANDARD
                                           │
                        Phase 9 (Discovery) ┘ gate: STANDARD
                                │
                        Phase 10 (Re-walk)   gate: NONE
```

Phases 1, 2 and 8 are independently shippable. Phase 1 alone closes three of the five
findings that block a security review, and touches no schema.

### Appendix A: Journey rows → the task that flips them

Six rows already read delight and must not regress. Fifteen must flip.

| # | Journey row | Now | Flipped by |
|---|---|---|---|
| 1 | Landing 10-second read | delight | protect |
| 2 | The six controls | friction | 9.3 — seven controls, tool policy first |
| 3 | Docs → Govern | exit-risk | 9.3 — four org rows in the table |
| 4 | Machine surfaces | exit-risk | 9.1, 9.2 — spec + llms.txt + coverage test |
| 5 | Pricing | friction | 9.4 — org governance on every card |
| 6 | Sign up | fine | 2.4, 3.1 — key names the next step, attaches to the account |
| 7 | `/dashboard/org`, free key | exit-risk | 2.1 — get-started page |
| 8 | Bought Team | delight | protect |
| 9 | `/dashboard/org`, paid key | exit-risk | 2.1, 9.4 — door plus "every tier" |
| 10 | The undocumented door | friction | 2.2, 9.1 — 403 `_help` and the spec |
| 11 | One rule, twelve names | delight | protect |
| 12 | The exception test | delight | protect |
| 13 | The declaration gap | friction | 8.1, 8.2, 7.5 — stated, surfaced, closed |
| 14 | The gateway | exit-risk | 7.4 — reachable by org_admin |
| 15 | The ceiling lock | exit-risk | 1.2 — alias accepted, unknown field 400s |
| 16 | The employee loosens it | exit-risk | 1.3 — effective value plus `org_clamped` |
| 17 | Lock set correctly | delight | protect |
| 18 | Roles | delight | protect |
| 19 | Bypass, ten minutes | exit-risk | 4.1, 4.2, 4.3 — verified person, claimed domain, visible key |
| 20 | Audit trail | exit-risk | 1.1, 6.1 — one-line scoping fix, panel zone |
| 21 | Offboarding | exit-risk | 5.1, 5.2, 5.3 — remove a key, a person, from the panel |

### Appendix B: The eleven recommendations → phases

| # | Recommendation | Phase / tasks |
|---|---|---|
| 1 | Stop an anonymous key standing up an organization | 3.1, 3.3, 4.1, 4.2, 4.3 |
| 2 | Fix org scoping on policy history; surface it; fix the misleading note | 1.1, 6.1, 6.2 |
| 3 | Turn the 403 into a door | 2.1, 2.2 |
| 4 | Ship member removal; populate owner email | 3.4, 5.1, 5.2, 5.3, 5.4 |
| 5 | Reject unknown keys on the ceiling write | 1.2 |
| 6 | Make clamped writes explicit; refuse foreign claims | 1.3 |
| 7 | Put tool policy in the shop window | 9.1, 9.2, 9.3 |
| 8 | Answer the tier question on the pricing page | 9.4 |
| 9 | State what screening reads; give customers the gateway | 7.1–7.6, 8.1, 8.2, 8.3 |
| 10 | Correct the trust page | 1.4, 1.5 |
| 11 | Make the tool-policy mode a decision at bootstrap | 2.3 |

### Appendix C: Architecture decision record

> **Decision:** Bind keys to real accounts, gate organization creation on a verified person,
> and let an organization claim its email domains. Do not touch anonymous key generation.
> **Status:** Approved by the product owner, 2026-08-12.
> **Deliberation:** Single-session analysis, not a golden-horde team — this session is
> configured not to dispatch subagents. Recorded so the confidence is read accurately.
> **Confidence:** High on the diagnosis (production data confirms it), medium on the domain
> mechanism (DNS TXT verification is conventional but untried here).

**Context.** The report's three most serious findings — the three-call bypass, the
offboarding dead end, and the placeholder owner email — look like three bugs. Research for
this plan found one cause. Parse has `User`, `emailVerifiedAt`, sessions, `/signup`,
`/login`, `/account` and password reset, and key issuance never uses any of it: every
self-service key is owned by a single shared user. Production confirms it — 0 of 4 users have
a verified email, and every user created by real signup holds 0 keys.

**Decision.** Keep `POST /v1/keys/generate` anonymous. Require a verified account only to
create an organization. Let an organization prove ownership of its email domains, which then
(a) refuses a rival bootstrap from that domain and (b) surfaces unaffiliated keys on it as
claimable.

**Rationale.** Creating a governance boundary is the privileged act; getting a key is not.
Three prior prospect runs named the 413 ms keyless onboarding as the product's best first
impression, and it is what makes the agent-native and x402 stories work. Gating it would trade
a proven strength for the same security the narrower gate provides.

**Alternatives considered.**

| Alternative | Why not |
|---|---|
| Verified account for every key | Kills keyless onboarding; breaks agent-native provisioning, `/llms.txt`, `/skill` and x402 |
| Paid tier gates bootstrap | Does not stop the bypass — an employee with a corporate card still escapes — and paywalls the control plane |
| Do not close it; detect instead | Fails the buyer's stated deal-breaker; the headline finding stands |

**Consequences.**
- Anonymous keys keep working, and can be adopted into an account later (Task 3.5).
- An employee on a claimed domain cannot form a rival organization, and their key is visible.
- An employee using a personal address still gets their own organization. That is not
  reachable by tool policy and never will be — it is a coverage problem, which is why Task
  8.3 surfaces agents that declare no tools and why coverage attestation matters.
- Two live account-dashboard bugs are fixed on the way: keys created there never appeared
  there, and the revoke button could never have worked.

**Dissenting view, recorded.** Phase 7 reverses the C17 decision not to persist provider
keys. The safer alternative was to document the declaration gap and scope the gateway
separately. The product owner chose to build it, on the reasoning that an enforcement point
no customer can reach is not an enforcement point. Task 7.1 and Task 7.6 are the conditions
that make it defensible: real encryption at rest, no read-back, and the architecture note
corrected in the same commit.

### Appendix D: Verification

**Per phase.** Run the phase's exit criteria on staging, then the eight baseline test files:

```bash
cd ~/parse-for-agents-live
for f in src/lib/tool-policy.test.ts src/lib/org-policy-ceiling.test.ts \
         src/routes/organizations.test.ts src/routes/org-policy.test.ts \
         src/routes/tool-policy.test.ts src/routes/agent-registry-tool-policy.test.ts \
         src/pages/org-control-panel.test.ts src/lib/gateway/tool-filter.test.ts; do
  timeout 60 npx tsx --test "$f" || echo "PROBLEM: $f"
done
npm run typecheck && npm run brand-lint && npm run claims-lint
```

**End to end**, on staging, as a three-role cast (this is what run 7 did and what Task 10.1
repeats):

```bash
./scripts/staging-down.sh && yes y | ./scripts/staging-reset.sh && ./scripts/staging-up.sh
# 3 keys → sign up + verify the admin → bootstrap → claim + demote → rules → ceiling →
# bypass attempts → audit read → offboard
```

**Deployment.** Production serves from this working directory and any uncommitted edit goes
live on the next restart. Commit each phase before restarting:

```bash
git add -A && git commit -m "..."       # per phase
launchctl kickstart -k gui/$(id -u)/com.kublai.parse-for-agents
curl -s https://www.parsethis.ai/health | jq -r .deployment.commit
```

**Rollback.** Phases 1, 2, 6, 8 and 9 are code-only — revert the commit and restart. Phases
3, 4, 5 and 7 add schema; each migration is additive (new tables, new nullable columns, new
array column with a default), so a revert of application code leaves the columns unused and
harmless. No migration in this plan drops or rewrites an existing column.

**The single riskiest change** is Task 4.1: a bug there locks every customer out of creating
an organization. Ship it behind `ORG_BOOTSTRAP_REQUIRE_VERIFIED_EMAIL` (default off), turn it
on in staging, re-run Task 4.4, then enable in production.

## Approval

- [ ] Plan Output Contract validated — heading levels, exit criteria, task content, manifest
- [ ] Root-cause diagnosis accepted (identity gap under recs 1, 2 and 4)
- [ ] Three pre-planning decisions accepted, including the C17 reversal
- [ ] Phase order and gate depths acceptable
