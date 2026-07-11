# Parse QA Note: Controlled-Beta 10-Minute Bounded Load/Soak

Date: 2026-07-11
Target: `https://www.parsethis.ai`
Profile: conservative controlled-beta pattern-only screening smoke, not an open-launch load test

## Summary

A 10-minute bounded soak against `/v1/parse` passed with no unexpected failures when traffic stayed below per-key free-tier limits and used multiple freshly generated beta keys.

This supports controlled-beta confidence for modest, rate-limited pattern-only screening traffic. It does **not** prove open-launch or hundreds-concurrent readiness.

## Test profile

```json
{
  "duration_seconds": 609,
  "target_keys": 5,
  "keys_obtained": 5,
  "per_key_target_rpm": 8,
  "max_observed_concurrency": 10,
  "total_requests": 445
}
```

## Result

```json
{
  "status_counts": {
    "200": 445
  },
  "unexpected_failure_count": 0,
  "verdict": "PASS_BOUNDED_SOAK"
}
```

Latency:

```json
{
  "min": 1119,
  "p50": 3072,
  "p90": 4054,
  "p95": 4376,
  "max": 5990
}
```

## Interpretation

Positive evidence:

- Keygen obtained 5/5 free beta keys.
- Sustained 10-minute traffic below per-key rate limits completed successfully.
- No `401`, `429`, `5xx`, or network failures during the bounded soak.
- Pattern-only screening remained functional across 445 requests.

Limits of this evidence:

- This was not a k6/Artillery production load test.
- Max observed concurrency was 10, not hundreds.
- The test intentionally avoided exhausting per-key limits.
- It does not cover paid x402 flows, full LLM/sandbox-heavy analysis, DB/Redis saturation, provider degradation, or autoscaling limits.

## Launch impact

Controlled beta remains plausible with guardrails:

- first 5–10 trusted testers,
- invite/pre-provisioned or carefully rate-limited keygen,
- mostly pattern-only screening,
- explicit `429` handling,
- continued monitoring for intermittent `401` under same-key bursts.

Open launch / hundreds-concurrent active users remains **not proven**.
