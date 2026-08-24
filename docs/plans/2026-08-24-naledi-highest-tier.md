# Run 47 — Naledi Moyo highest-tier (Team)

Date: 2026-08-24 · Packet: `~/reports/parse-prospect/naledi-moyo-highest-tier-improve.md`. Live line is `render-deploy` via launchd, not GitHub `main`.

## Shipped

- C2: PHI-shaped record nouns (`roster`, `MRN`, clinic `chart`) in `EXFIL_DATA_TERMS` only with an export/send verb and a URL. Pattern-only block; `action_floor: block` (severity 9).
- C3: HTML comments that conceal `cc`/`send`/`export` + email/URL (severity 8). Classic ignore/override comments unchanged.
- B2: `SAFETY_BYPASS_MODE` requires a safety-system collocate. Bare "cancel rule" is not `FUZZY_OVERRIDE`. C4 stays on `intent.new_authority_assertion`.
- Named environments persist (`[a-z0-9._-]`); invalid `X-Parse-Environment` 400s on policy. Screening still fail-opens a garbage header to production.
- Calculator still prices Team at 80k. SIEM/evidence from Pro on `/trust`, Q26, CC4, docs. Ceiling lock on Team/Pro + checkout success. Enterprise checkout 503 with contact. HIPAA is a dated no.

## Not in this ship

Inbox H1 rewrite, Compliance Stripe checkout, `GET /v1/keys/self`, lexical fits for B1/B3/C1, staging `llm:failed`.

## Pins

`src/__tests__/run47-naledi.test.ts`, `run47-naledi-env.test.ts`, `run47-naledi-surfaces.test.ts`.
