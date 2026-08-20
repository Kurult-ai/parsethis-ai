# Demo: compromised package finding to Parse Exposure block verdict

1. A local read-only scanner matches `example-pkg@1.2.3` against a known-compromised catalog.
2. The scanner emits a findings-only NDJSON record.
3. Parse evaluates the sanitized finding through `/v1/exposure/evaluate`.
4. Parse returns `decision: block` and a receipt ID.
5. An agent preflight refuses sensitive actions until the endpoint scan is clean.

Example local test payload:

```bash
node scripts/smoke-exposure.mjs --base-url http://localhost:3000 --api-key "$PARSE_API_KEY"
```

Expected result:

```text
Parse Exposure smoke passed
```
