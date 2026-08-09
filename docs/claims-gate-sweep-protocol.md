# Claims Gate Dynamic Sweep — Quarterly Protocol

> **Task 17.9**
> 
> **Owner:** Mongke (reviewer role)
> **Frequency:** Quarterly + after any major feature release
> **Purpose:** Ensure all customer-facing assets make only substantiated claims.

## Scope

This sweep covers ALL customer-facing surfaces, not just repo-rendered pages:

| Surface | Location | Review Method |
|---------|----------|---------------|
| Website pages | src/pages/*.ts rendered via parsethis.ai | `npm run claims-lint && npm run brand-lint` |
| Documentation | docs/*.md | Manual review against FEATURE_STATUS |
| Nurture emails | src/lib/email.ts templates | Manual review |
| Comparison pages | /compare/* pages | Verify competitor claims are factual |
| GitHub README | github.com/Kurult-ai/parsethis-ai | Manual review |
| X/Twitter content | Account history | Review pinned + recent |
| Blog posts | content/blog/*.md | Manual review |
| API responses | /v1/discovery, /v1/pricing | Verify description accuracy |

## Sweep Checklist

### 1. Feature Status Verification
- [ ] Read `src/lib/product-facts.ts` FEATURE_STATUS
- [ ] Identify any features that moved from "building" to "shipped" — update marketing copy to remove "in development" qualifiers
- [ ] Identify any features that regressed — add qualifiers back

### 2. Banned Vocabulary Scan
- [ ] Run `npm run brand-lint` — must pass clean
- [ ] Search all docs for: "SOC 2 certified", "100% detection", "impossible to hack", "unbreakable", "military grade", "enterprise grade" (without context)
- [ ] Search emails for: "guaranteed", "zero false positives", "perfect detection"

### 3. Claims Lint
- [ ] Run `npm run claims-lint` — must pass clean
- [ ] For any feature marked "planned" or "building", verify marketing copy uses "in development" or "planned" qualifier

### 4. Competitor Comparison Accuracy
- [ ] Review all /compare/* pages
- [ ] Verify competitor pricing is current (check their websites)
- [ ] Verify competitor feature claims are accurate
- [ ] Remove any claims that can't be substantiated with public sources

### 5. External Surface Review
- [ ] GitHub README — claims match current feature status
- [ ] MCP registry listing — description accurate
- [ ] Any external directory listings (mcp.so, smithery.ai) — description accurate
- [ ] X/Twitter pinned post — claims still valid

## Sign-off

After each sweep, create a record:

```
## Claims Gate Sweep — [Date]
Reviewer: [name]
Surfaces checked: [list]
Issues found: [count]
Issues fixed: [count]
Outstanding: [list or "none"]
Sign-off: ✅ / ⚠️ (with conditions)
```

## Trigger-Based Sweeps

In addition to quarterly, run a sweep when:
- A new feature ships (before marketing copy goes live)
- A feature is deprecated
- Pricing changes
- A competitor publishes a comparison
- A customer reports an inaccuracy
