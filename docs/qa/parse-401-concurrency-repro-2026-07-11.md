# Parse QA Note: Same-Key Concurrency Returns Unexpected 401

Date: 2026-07-11
Target: `https://www.parsethis.ai`
Severity: beta warning / launch blocker for broad concurrency claims

## Summary

A fresh self-service API key can return intermittent `401 auth.invalid_key` under same-key concurrent `/v1/parse` traffic. The expected behavior after the free-tier limit is exhausted is `429 rate_limit.exceeded`, not `401 Invalid API key`.

This issue reproduces the earlier smoke-test anomaly and means Parse should not claim open-launch or hundreds-concurrent readiness until fixed or conclusively explained.

## Reproduction

1. Generate a fresh key via `POST /v1/keys/generate`.
2. Immediately send 40 simultaneous `POST /v1/parse` requests using the same bearer key.
3. Payload uses the documented `prompt` field.
4. Redact key material from all logs.

Observed status counts:

```json
{
  "200": 10,
  "401": 6,
  "429": 24
}
```

Expected:

```json
{
  "200": 10,
  "429": 30
}
```

or equivalent all-valid-key behavior where rate-limit exhaustion produces `429`, never `401`.

## Sample 401 request IDs

```text
c4c1e7aa-b5aa-4244-a564-01891283d23a
66497511-2fcc-4cba-b515-53cd51184390
03d847dd-a8af-47ec-b50a-25d0a03a898d
cf33c7cb-76fe-4e9e-b8d8-2f1124167b77
db87b16e-13f8-474f-8f25-360829609d9b
3a96b1b6-3dfd-4fe5-b0ef-4dbe0ea8f30a
```

401 response shape:

```json
{
  "type": "about:blank",
  "title": "Invalid API key",
  "status": 401,
  "detail": "The provided API key is invalid.",
  "instance": "/v1/parse",
  "code": "auth.invalid_key",
  "retryable": false
}
```

429 response shape is healthy and actionable:

```json
{
  "type": "about:blank",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Rate limit exceeded. Retry after 60 seconds.",
  "instance": "/v1/parse",
  "code": "rate_limit.exceeded",
  "retryable": true,
  "retry_after_seconds": 60,
  "limit": 10
}
```

## Source-path hypothesis

Relevant code paths:

- `src/auth.ts`
  - calls `validateApiKeyFromService(keyStr)`
  - if it returns `null`, converts that to permanent-looking `401 Invalid API key`
  - only thrown exceptions become `503 Authentication service unavailable`
  - rate limiting happens after successful validation
- `src/api-key-service.ts`
  - checks Redis API-key cache by prefix
  - checks Redis fallback record by prefix
  - then does DB lookup by key prefix with `KEYGEN_DB_FALLBACK_TIMEOUT_MS` defaulting to `1500`
  - if DB lookup times out / returns timeout sentinel, returns `null`
  - if Redis fallback is enabled, caught DB errors also return `null`
- `src/result-store.ts`
  - API-key cache has no explicit timeout wrapper; cache miss/connection miss returns `null`

Likely class of bug:

> transient key-lookup/cache/DB fallback miss is collapsed into `null`, and auth reports it as `401 auth.invalid_key` instead of `503 auth temporarily unavailable` or falling back to a reliably persisted/cached fresh-key record.

This is especially visible with newly generated self-service keys under simultaneous first-use pressure.

## Recommended fix direction

1. Separate validation outcomes:
   - invalid key
   - revoked/expired key
   - validation service unavailable / timeout
   - fallback cache unavailable
2. Do not return `null` for lookup timeouts when the key format is valid and the validation backend is unavailable.
3. Convert transient validation uncertainty to `503` with `retryable: true`, not `401`.
4. Consider caching the newly created key record synchronously before returning keygen success, or ensuring Redis fallback/DB persistence is read-after-write consistent for immediate concurrent first use.
5. Add a regression test that simulates valid-format key + validation timeout and asserts `503`, not `401`.

## Launch impact

Controlled beta can continue with warning if testers are told to report request IDs.

Do not claim:

- hundreds-concurrent active users,
- open self-service launch readiness,
- stable same-key burst behavior,

until this is fixed or disproven with production logs.
