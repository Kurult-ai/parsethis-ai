# How Parse Gets a Penetration Test

> Not a code plan. A procurement and preparation runbook, so the next person
> (or the CEO) can act on it without re-deriving the landscape. Written
> 2026-08-17. The trigger is commercial: run 13 established that a Team+ or
> Compliance reviewer stalls exactly where a "no pen test performed" row sits,
> and the honest fix is to perform one, not to reword the row.

## What a pen test is, for Parse specifically

A penetration test is a time-boxed engagement where an outside firm attacks the
live system under a signed scope agreement and delivers a report: findings
ranked by severity, reproduction steps, and a remediation list, plus an
attestation letter you can hand a customer's security reviewer. For Parse the
attack surface is small and unusually well-defined:

- The public API on `www.parsethis.ai` (`/v1/parse`, `/v1/screen-output`,
  `/v1/agent/trust/verify`, `/v1/analyze`, the billing and org-governance
  routes, the hosted `/mcp` endpoint).
- The auth model (bearer keys, the `parse_admin_key` cookie, x402 payment path,
  CSRF on the dashboard forms).
- The org-governance controls (the tool-policy / ceiling / gateway custody
  logic, the `POST /v1/orgs/bootstrap` self-provision guard).
- The infrastructure boundary (the cloudflared tunnel today; whatever hosts the
  first paying customer — the standing decision is a Vercel-class platform).

Two things Parse is NOT asking for and should not pay for yet: a full red-team
(objective-based, multi-week, social-engineering-inclusive) or a SOC 2 audit
(that is a separate, longer track already marked "in progress, Q1 2027"). What
closes the row is a **focused application + API penetration test**, sometimes
sold as a "web app + API pentest" or "AppSec assessment".

## The three procurement routes, cheapest first

### Route A — a fixed-scope boutique AppSec firm (recommended first)

For a surface this size, a two-to-three-person boutique doing a one-to-two week
web-app + API test is the right instrument. Expect a report, a remediation
retest included or cheaply added, and a letter of attestation. This is the
cheapest route that produces the document a reviewer will accept.

- **What to ask for in the RFP:** "Grey-box web application and REST API
  penetration test of a single-tenant TypeScript/Hono API and its SSR
  dashboards, ~15 documented endpoints, bearer + cookie + x402 auth, one
  Postgres, one Redis. OWASP ASVS L1/L2 and OWASP API Security Top 10 as the
  standard. Deliverables: findings report with CVSS, reproduction steps, an
  executive summary, one remediation retest, and a signed attestation letter we
  may share with our own customers under NDA."
- **What makes Parse cheap to test** (say this in the RFP — it lowers quotes):
  single operator, no multi-tenant blast radius, the whole API is documented in
  `openapi.json`, and there is a staging environment. A firm quotes by
  estimated days; a well-scoped small surface is a short engagement.
- **How to find them:** the CREST directory (crest-approved.org) lists
  accredited firms by region; a customer's own security team will often name
  the firm they trust, and being tested by a name the *buyer* already trusts is
  worth more than a cheaper unknown. Ask the first serious enterprise prospect
  who their vendors use.

### Route B — a pentest-as-a-service platform

Platforms (the "PTaaS" category) pair a scoped manual test with a portal that
hosts the report and a shareable, always-current attestation page — which is
itself the artifact a reviewer wants, because it is dated and verifiable rather
than a PDF that could be stale. Slightly more expensive than a one-off boutique
engagement, but the live attestation page and the built-in retest workflow map
directly onto how Parse already thinks about trust surfaces (one fact, one
source, dated). Good fit if the plan is to test annually.

### Route C — a bug-bounty / researcher marketplace

A time-boxed private bounty finds real bugs cheaply, but it does **not** produce
an attestation letter, and "we ran a bounty" does not close a questionnaire row
the way "we had a scoped pentest by <firm>, report dated <date>, findings
remediated and retested" does. Useful as continuous coverage *after* the first
formal test, not as the thing that closes the row.

## Sequence (do these in order)

1. **Wait for the infra move, or scope around it.** The pentest should hit the
   architecture a customer will actually use. The standing decision is to move
   to a Vercel-class platform at the first paying customer. Either test after
   that move, or explicitly scope the current cloudflared/Mac-Mini setup and
   plan a delta retest post-migration. Do not pay to test an architecture you
   are about to replace.
2. **Freeze a staging target that mirrors production.** A firm needs a stable
   URL, test credentials at each role (free key, org_admin, developer), and a
   throwaway org. `.env.staging` already exists; give them a keyset, not the
   master key.
3. **Prepare the evidence pack you already have.** Hand them `openapi.json`, the
   architecture notes in `CLAUDE.md`, the org-governance model, and the threat
   model the prospect runs have been building — twenty runs of adversarial
   findings is a gift to a tester and shortens the engagement.
4. **Get 3 quotes** using the RFP language above. Expect them to vary widely;
   the deciding factor is whether the firm's attestation is one your buyers will
   recognise, not the lowest number.
5. **Run it, remediate, retest.** The remediation retest is the part that
   produces "findings remediated and verified" — always include it.
6. **Publish the dated absence until then, the dated result after.** Today the
   honest line is "No independent penetration test has been performed" (it
   closes a row; an unverifiable "yes" costs the rows around it — run 13's
   lesson). The day the report lands, flip `SECURITY_FACTS` / the vendor
   questionnaire module to "Penetration test: <firm>, <date>, findings
   remediated and retested," rendered once and everywhere, and add the
   attestation letter to the trust package as a gated download.

## What it is worth

The row it closes is not one row. Run 13 measured a fourth-party reviewer
failing 9 of 15 approval-blockers without finding a single real security
defect — the failures were unanswerable claims and missing attestations. A
dated pentest with a named firm converts the single most-cited of those blockers
into a pass, and does it in the voice of the company that exists. It is the
cheapest enterprise-unlock on the board that is not SOC 2.
