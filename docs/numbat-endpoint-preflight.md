# Numbat Agent Endpoint Preflight

`POST /v1/exposure/numbat-preflight` is a narrow, stateless Parse Exposure adapter for locally minimized Numbat findings. It returns a deterministic policy recommendation and receipt without storing findings or raw endpoint telemetry.

## Upstream contract and attribution

This adapter supports exactly Numbat binary/tag `v0.1.1` (request spelling `0.1.1`) at commit [`3d20d782d45001fd3bb200bc5690ce4b9ce0f12b`](https://github.com/perplexityai/numbat/tree/3d20d782d45001fd3bb200bc5690ce4b9ce0f12b), with finding and enforcement record schema `0.2.0`. Binary release, source commit, and record-schema version are separate pins.

Numbat is an upstream project. Parse is not Numbat, does not claim ownership of it, and does not imply endorsement by or affiliation with its maintainers.

## Boundary

1. Numbat observes and evaluates activity locally.
2. The dependency-free local adapter validates the complete closed upstream finding schema `0.2.0` before minimization. It also fully validates enforcement records before discarding them locally, removes all fields outside the minimized Parse profile, and emits JSON locally.
3. A caller may separately send that JSON to the authenticated Parse endpoint.
4. Parse returns `allow`, `warn`, `block`, or `review_required` as a **recommendation only**.

The adapter never uploads. Parse does not select Numbat's `deny`, does not run a local hook, and cannot observe whether a Numbat control response was delivered or honored by the host. Responses therefore say:

- `enforcement_state: recommendation_only`
- `numbat_deny_selection: not_evaluated_by_parse`
- `host_enforcement_state: not_observed_by_parse`
- `stored: false`

## Authentication and abuse limits

The Numbat endpoint requires `Authorization: Bearer <api-key>` with the existing `evaluate` scope. It uses the existing API-key rate limiter and does not accept x402 as an auth bypass. The dedicated endpoint has a 256 KiB body limit and accepts 1–100 findings. This does not change the existing free, unauthenticated Bumblebee-compatible `/v1/exposure/evaluate` and `/v1/exposure/ingest` contract.

## Closed request contract: `NumbatFindingBatchV1`

Top-level fields:

- `adapter_schema_version`: exactly `v1`
- `producer`: exactly `numbat`
- `numbat_version`: exactly `0.1.1`, the reviewed local Numbat binary version
- `numbat_record_schema_version`: exactly `0.2.0`
- `batch_id`: caller-supplied idempotency key matching `batch_[A-Za-z0-9][A-Za-z0-9_-]{5,95}`
- `endpoint_pseudonym`: optional opaque random value matching `install_[A-Za-z0-9]{8,64}`; it must not be derived from a hostname, user, UID, device ID, path, or stable path hash
- `findings`: 1–100 minimized findings
- `preflight_context`: intended action class, impact level, and requested agent privilege mode

Each finding contains only:

- `rule_id`
- `rule_version`
- `severity`: `info|low|medium|high|critical`
- `confidence`: `low|medium|high`
- `source_agent`: a Numbat record-schema `0.2.0` source-agent enum value
- `source_type`: `artifact|hook|otel`
- `observed_event_type`: a Numbat record-schema `0.2.0` observed-event enum value
- `local_minimization_confirmation`: exactly `true`

The request, finding, and preflight-context objects are closed. `rule_id` must be a dot-namespaced identifier, `rule_version` must be numeric dotted version text, and all identifiers reject secret/location patterns, identity-shaped segments, and 64-hex/path-hash segments. Unknown fields are not coerced into Bumblebee `package_exposure` findings.

See `examples/exposure/numbat-sanitized-batch-v1.json` for a synthetic sanitized example.

## Local adapter

Read NDJSON from stdin:

```bash
npm run adapt:numbat -- \
  --batch-id batch_2026_07_30_001 \
  --numbat-version 0.1.1 \
  --action-class command_execution \
  --impact-level high \
  --privilege-mode unattended \
  < local-numbat-findings.ndjson \
  > minimized-batch.json
```

Read a local file by adding `--file local-numbat-findings.ndjson`. Add `--endpoint-pseudonym install_randomOpaqueValue` only when the value is installation-scoped and non-identifying.

The standalone script uses only Node.js built-ins and prints only the minimized batch to stdout. Every raw finding is validated against the complete pinned `finding-record.schema.json`, including required, closed nested endpoint/evidence, format, enum, and array constraints, before any field is stripped. Standard findings streams may also contain `record_type=enforcement` receipts; those are validated against the complete pinned enforcement contract before being discarded locally. Scan summaries, diagnostics, events, and every other record class are rejected. Input is capped at 4 MiB before JSON parsing. On malformed NDJSON, unsupported schema/version, malformed accepted records, missing adapter-required fields, invalid options, an empty/oversized finding batch, or oversized input, it exits nonzero, emits a fixed `adapter_error:<code>` to stderr, and emits no batch. It does not make network requests.

## Fail-closed validation

The endpoint returns HTTP 400 with a stable `EndpointPreflightDecisionV1` carrying `decision: review_required` and `recommended_action: correct_payload_and_recheck` for:

- malformed JSON or wrong content type;
- wrong types or missing fields;
- unsupported adapter/record schema versions, any binary version other than `0.1.1`, or producer;
- unknown top-level, finding, or context fields;
- missing/invalid `rule_id`, invalid severity, or invalid enum values;
- empty or over-100 finding arrays;
- a body over 256 KiB;
- privacy-unsafe or secret-like identifiers.

Rejected payloads and values are never echoed. A rejection has `source_schema: unverified`, no matched rules, and no digest derived from rejected bytes.

## Data that must remain local

The endpoint excludes and rejects hostname, username, UID/device ID, raw or stable path hashes, run/finding/session/model/subagent IDs, commands, URLs, file/project/evidence paths, content previews, evidence refs/pointers, cited event IDs, transcripts, raw events, arbitrary metadata/free text, environment data, credentials, secrets, and source content.

This deliberately removes fields that are required or allowed in the upstream Numbat finding wire record. Run the adapter locally; never send a raw Numbat finding record directly to Parse.

## Deterministic policy

No LLM is used.

- critical → `block`
- high → `warn` by default
- high → `block` only when the context is high-impact, privileged, or unattended **and** a high finding belongs to a documented sequence/chain, exfiltration, privilege, or persistence rule category
- medium → `warn`
- low/info → `allow` with `recommended_action: proceed_with_note`

`findings_digest` sorts and de-duplicates canonical minimized findings, so finding order does not affect it. `receipt_id` is deterministic for the same batch ID, optional endpoint pseudonym, finding set, preflight context, and policy version. Replaying the same semantic request returns the same response. `recommendation_max_age_seconds: 300` is caller-side freshness guidance measured from receipt of the response; it is not a cryptographically anchored receipt expiry. Recheck immediately before action or after a local rescan. `source_schema: numbat/minimized-adapter-v1@record-0.2.0` identifies the minimized request profile and is not hosted proof of the original raw record.

## Limitations

- Stateless only; there is no database, transcript warehouse, raw-event ingestion, OTLP receiver, fleet dashboard, or endpoint agent.
- A Parse `block` is not proof of Numbat deny selection or host-honored enforcement.
- Hosted availability is not part of a local synchronous enforcement guarantee. Keep local enforcement fail-closed according to the endpoint harness's own policy.
- Support is pinned to Numbat record schema `0.2.0`; later wire versions fail closed until reviewed and explicitly supported.

## Bounded pilot and rollback

Start with one explicitly opted-in harness and a dedicated local findings file. Verify five paths before expansion: benign finding, malicious/high-risk finding, privacy rejection without echo, Parse outage while local policy remains authoritative, and local Numbat enforcement behavior independent of hosted Parse. Stop the pilot on any raw-field egress, unsupported-record acceptance, unstable decision/receipt, availability coupling to local enforcement, or unexpected host behavior.

Rollback requires no fleet mutation: stop adapter/API calls or disable the harness integration, preserve the local Numbat configuration and enforcement posture, and revert the Parse endpoint deployment if needed. Hosted Parse must never become the synchronous dependency for local deny behavior in this pilot.
