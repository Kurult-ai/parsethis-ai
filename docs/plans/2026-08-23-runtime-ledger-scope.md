# Scope: Parse Runtime Ledger — agent-side tool-call + file-access instrumentation

Date: 2026-08-23 · Status: SHIPPED core + dashboard + evidence pack + SIEM + MCP collector. Hook package local (not on npm — no @parsethis org). See 2026-08-23-icp-and-ledger.md

## The one-line version
A drop-in shim that captures every tool call and file access at the agent runtime and streams each into the existing hash-chained ComplianceReceipt ledger — turning "audit trail of what Parse screened" into "audit trail of what the agent did."

## What exists today (reused, not rebuilt)
- `ComplianceReceipt` (prisma): integrity_hash + chain_hash + seq_num — append-only, tamper-evident. Verification endpoint recomputes both.
- `SIEMConfig` + forwarder: CEF/JSON/LEEF → Splunk/Datadog/Elastic/Sentinel/webhook.
- `EvidencePack` (src/lib/compliance/evidence-pack.ts): SHA-256-sealed, shareable — same machinery as /attack reports.
- MCP gateway path (`/mcp`, mcp-proxy.ts): tool traffic routed through Parse is already screenable.
- Org tool-policy (`/v1/org/tool-policy`): allow/deny rules per tool category.

## The gap this closes
Parse sees only what flows through it. The security-review question "show me every file the agent touched and every tool it called" has no answer when the agent runs outside our gateway. Runtime Ledger instruments the agent side.

## Architecture (three surfaces, one ledger)

### 1. Claude Code hooks package — `@parsethis/agent-ledger` (the wedge)
- npm package: `npx parsethis-ledger install` writes `~/.claude/settings.json` hook config
- Hooks: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`
- Captures: tool name, args (redacted — see below), cwd, file paths touched (Read/Write/Edit/Bash path extraction), mtime/size on writes, session id, exit status
- Every event → `POST /v1/ledger/event` (batched, 500ms flush, offline queue to disk)
- Zero-prompt-text policy: same rule as ScreeningEvent — we log the PATH and the ACTION, never file CONTENTS or prompt text (hash of prompt only)

### 2. Ledger API + extension of the chain
- `POST /v1/ledger/event` (agent key): appends `LedgerEvent` row AND mints a ComplianceReceipt over it — same chain, so screening receipts and activity receipts interleave in one tamper-evident sequence
- `GET /v1/ledger/events?agent=&from=&to=&tool=&path=` — filtered query
- `GET /v1/ledger/export?format=cef|json|csv` — SIEM + evidence-pack shapes
- New `LedgerEvent` model: agentId, orgId, sessionId, kind (tool_call|file_read|file_write|file_delete|net_egress), tool, pathGlob (path with ~ and workspace-root normalization), argsDigest (SHA-256 of redacted args), outcome, durationMs, chained via receipt
- RLS by org; agent keys scoped to one agent id

### 3. Dashboard + evidence
- `/dashboard/ledger`: Miller-law zones — recent activity, per-agent tool mix, write destinations, egress targets, policy violations
- "Activity evidence pack" — one click: a stalled-deal CISO page listing every file touched + every tool called + every screen verdict, hash-chained, shareable URL. This is the artifact that answers the security review.

## Privacy + redaction rules (non-negotiable)
- Never store file contents, prompt text, or env values — paths and digests only
- Secrets scrubbed from args before digest (reuse redaction from sandbox-client)
- Path normalization: `~/` prefix, workspace-root relativization; option to glob-mask (e.g. `~/clients/**`)
- Per-org retention dial (7/30/90d) with chain-preserving deletion (receipts keep hash, event tombstoned — chain still verifies)

## Environments
- Claude Code first (hooks are native, settings.json is one file)
- Generic agents via OpenTelemetry semantic-convention adapter (`gen_ai.tool.*` attrs) — phase 2
- MCP-only shops already covered by the gateway; hooks add the file-access half

## Effort estimate
| Piece | Est |
|---|---|
| LedgerEvent model + chain extension + API | 1.5–2 d |
| Hooks package (install, capture, batching, offline queue) | 2–3 d |
| Redaction + normalization hardening + tests | 1 d |
| Dashboard + activity evidence pack | 1–1.5 d |
| Docs + llms.txt + integration guide | 0.5 d |
| **Total** | **6–8 days solo** |

Pricing hypothesis: included in Team $199 (it's the compliance unblock), metered by agents (not events) — 10 agents included, $10/agent/mo after. Free tier: 1 agent, 7-day retention — enough for the demo, not the deal.

## What we will NOT build
- No endpoint agent / daemon beyond the hooks (scope creep into EDR)
- No content capture, ever
- No blocking at the file layer (screening stays at prompt/tool-result layer; ledger is evidence, not enforcement) — enforcement stays in tool-policy + screening
- No kernel/system-wide file monitoring

## Kill criteria
- If ICP evidence says security reviews ask for screening evidence, not activity ledgers → kill
- If Claude Code native org audit (transcripts + manage) closes the gap by fall → narrow to the evidence-pack exporter only
- If prospect interviews rate it below MCP gateway priority → defer
