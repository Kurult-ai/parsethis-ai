# Open-launch evidence plan

Parse currently has controlled-beta evidence. Open launch is a separate claim and needs sustained live evidence before public messaging says broad/high-concurrency readiness.

This document defines the evidence packet to collect before changing `open_launch` from `NOT_PROVEN`.

## What this does and does not prove

| Evidence | Supports | Does not prove |
|---|---|---|
| `npm run beta:sentinel` | bounded controlled-beta liveness and critical endpoint health | open launch, high concurrency, or p99 stability |
| 40-request same-key repro | no fresh-key false `401` under one burst; expected `429` plan-limit behavior | sustained traffic stability |
| sustained multi-key load evidence | stronger readiness signal for broader launch | infinite scale or security correctness |

## Required preconditions

- [ ] GitHub `main` is green or any CI blocker is documented as non-code infrastructure.
- [ ] `/health` reports the intended deployment commit.
- [ ] `npm run typecheck` passes locally.
- [ ] `npm run test` passes locally.
- [ ] `npm run beta:sentinel` returns `PASS`.
- [ ] At least 2-5 non-production-critical Parse keys are available for the test, or operator explicitly accepts a generated-key short run.

## Sustained-load runner

Use:

```bash
PARSE_API_KEYS="pfa_live_key1,pfa_live_key2" \
node scripts/open-launch-load-evidence.mjs \
  --duration-seconds=1800 \
  --concurrency=8 \
  --interval-ms=250 \
  --out "docs/qa/open-launch-load-$(date -u +%Y%m%dT%H%M%SZ).json"
```

Dry-run the shape first:

```bash
node scripts/open-launch-load-evidence.mjs --dry-run --duration-seconds=1800 --concurrency=8 --interval-ms=250
```

For a short operator-approved smoke with a generated key:

```bash
node scripts/open-launch-load-evidence.mjs \
  --allow-keygen \
  --duration-seconds=60 \
  --concurrency=2 \
  --interval-ms=250 \
  --out "docs/qa/open-launch-short-smoke-$(date -u +%Y%m%dT%H%M%SZ).json"
```

The runner mixes:

- `POST /v1/parse`
- `POST /v1/screen-output`
- `POST /v1/agent/trust/verify`

It treats `200` and expected `429` as non-fatal and exits nonzero on unexpected `401`, `5xx`, or network errors.

## Suggested launch gates

| Gate | Minimum target before open-launch claim |
|---|---|
| Duration | 30-60 minutes sustained |
| Keys | 2-5 keys, not one hot key only |
| Endpoints | `/v1/parse`, `/v1/screen-output`, `/v1/agent/trust/verify` mixed |
| Unexpected 401 | `0` |
| Unexpected 5xx/network | `0`, or root-caused with a fix and rerun |
| 429 behavior | Only where plan/key limits are intentionally exceeded |
| Latency | p95/p99 recorded and acceptable for the intended beta tier |
| Post-run Sentinel | `PASS` |
| Docs | report stored under `docs/qa/` with commit, timestamp, command shape, and caveats |

## Report template

````md
# Open-launch load evidence — YYYY-MM-DD

- Commit: `<health deployment.commit>`
- Base URL: `https://www.parsethis.ai`
- Duration: `N minutes`
- Concurrency: `N`
- Keys: `N`, redacted
- Runner: `scripts/open-launch-load-evidence.mjs`
- Local gates: `npm run typecheck`, `npm run test`, `npm run beta:sentinel`

## Result

```json
<paste summary JSON, not raw keys>
```

## Decision

- Controlled beta: `READY` / `PAUSE`
- Open launch: `READY` / `NOT_PROVEN` / `BLOCKED`

## Caveats

- Note dependency incidents, CI infrastructure blockers, expected rate limits, or any operator interventions.
````

## Current status

As of this document, open launch remains **NOT_PROVEN** until the sustained-load evidence packet above is collected and reviewed. Controlled beta may proceed when Sentinel remains green and support capacity exists.
