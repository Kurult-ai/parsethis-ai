# Long-Tail Nurture Expansion

> **Task 17.6**
>
> **Dependency:** Task 13.3 (5-email nurture sequence) — must be built first
> **Purpose:** After the initial 5-email sequence completes, keep non-converters engaged with ongoing value content until they're ready to buy.

## Strategy

The initial 5-email sequence runs over 7 days. Most prospects won't convert in week one. The long-tail expansion extends nurturing for **90 days** with bi-weekly touches, alternating between:

1. **Educational content** — teaches them something about agent security
2. **Product updates** — new features, new detection patterns, new compliance mappings
3. **Social proof** — usage stats, customer stories (when available)
4. **Soft CTA** — never aggressive, always useful

## Email Schedule (Days 8–90)

| Email | Day | Type | Subject | Content Focus |
|-------|-----|------|---------|---------------|
| 6 | 14 | Educational | "The 3 attack vectors your agent doesn't know about" | Indirect injection, tool poisoning, agent-to-agent |
| 7 | 21 | Product | "New: Parse now detects [pattern category]" | Latest detection addition |
| 8 | 28 | Social proof | "Parse screened X million prompts this month" | Detection stats from screening metrics |
| 9 | 35 | Educational | "OWASP LLM Top 10 — which controls do you have?" | Framework mapping walkthrough |
| 10 | 42 | Product | "Compliance dashboard walkthrough" | Dashboard feature spotlight |
| 11 | 49 | Educational | "What happens when your agent reads a malicious webpage" | Indirect injection deep-dive |
| 12 | 56 | Social proof | "How Parse's risk scoring works" | Technical transparency |
| 13 | 63 | Product | "Setting up SIEM forwarding in 5 minutes" | Compliance tier feature |
| 14 | 70 | Educational | "The difference between input screening and output screening" | Trust boundary education |
| 15 | 77 | Soft CTA | "Still using the free tier? Here's what you're missing" | Value comparison |
| 16 | 84 | Educational | "Agent-to-agent trust: Why delegation needs screening" | Trust verification |
| 17 | 90 | Final CTA | "Your 90-day Parse review" | Usage summary + upgrade push |

## Stop Conditions

- **Upgrade to any paid tier** → exit long-tail, enter expansion lifecycle (Task 17.7)
- **Unsubscribe** → immediate exit
- **Email bounce** → exit, mark inactive
- **No opens for 30 days** → reduce frequency to monthly
- **No opens for 60 days** → exit sequence

## Content Production

Each email should reference REAL data from the Parse system:

- **Detection stats:** Pull from screening-metrics endpoint
- **Pattern count:** Read from patterns/index.ts
- **Risk categories:** Read from product-facts.ts
- **Framework mappings:** Read from compliance-guide.md

**Rule:** No email goes out without a verified factual claim from the codebase.

## Technical Implementation

```typescript
// In src/lib/email.ts — extend nurture system

export async function processLongTailNurture(): Promise<{
  processed: number;
  sent: number;
  errors: string[];
}> {
  // 1. Scan Redis for nurture:{email}:stage > 5 (completed initial sequence)
  // 2. For each, check if next email is due based on signup date
  // 3. Generate email content (pull real stats from DB/Redis)
  // 4. Send via Resend
  // 5. Update stage in Redis
  // 6. Check stop conditions
}
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Long-tail open rate | > 20% |
| Long-tail click rate | > 5% |
| Long-tail → paid conversion | 5–10% over 90 days |
| Unsubscribe rate | < 2% |
| Revenue per email sent | $0.05+ |
