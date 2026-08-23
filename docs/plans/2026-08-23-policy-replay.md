# Policy-replay appendix — shipped 2026-08-23

Given session S + today’s dashboard allowlist, emit rows that **would have been refused**.

- Pure function: `src/lib/compliance/policy-replay.ts`
- API: `GET /v1/ledger/sessions/:id/replay`
- Sample: `/ledger/sample` appendix
- Evidence pack: `policyReplay`

Not EDR. Not a control. Digest-only rows are `unverifiable`, never an invented deny.
