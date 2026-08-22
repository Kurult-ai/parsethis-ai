# Per-File ACL — Design & Build Plan
**Date:** 2026-08-22 · **Status:** Approved for build ("Go") · **Repo:** `~/parse-for-agents-live`

## Problem

An org admin can grant an agent access to a `filesystem` DataSource, but the grant covers the entire volume. "This agent may read `contracts/` but not `payroll/`" requires two registered sources; there is no path granularity, and no enforcement that observes actual file operations — only caller-declared `metadata.data_sources`.

Simultaneously, the gateway (`/v1/gateway/chat/completions`) reads the `tools` array off the wire but not tool-call **arguments**, so file paths inside tool calls are unobserved.

## Design (two tiers, one schema)

### Tier 1 — Path-scoped sources (caller-declared, ships the admin surface)
- `DataSource.pathPattern: String?` — glob-style pattern (`contracts/**`, `payroll/*.csv`) scoped to that source. Multiple patterns per source are separate DataSources or a `pathPatterns` list; v1 uses a single pattern per source, comma-separated entries allowed.
- `/v1/parse` path: when `metadata.data_sources` entries carry paths (string entries with `/` separators or `{sourceId, path}` objects), `checkDataAccess` matches path against the granted source's pattern before conceding access.
- Enforcement dial unchanged (monitor / warn / block). `data_access_violation` flag shape unchanged.

### Tier 2 — Gateway-observed file ops (strong tier; declaration-free)
- New `FileAclRule` model: org-scoped, `pathPattern` (glob), `action` (allow | require_approval | block), `priority`, `comment`.
- Gateway proxy handler: after tool-policy filter, inspect **tool-call arguments** for path-like values (keys named `path`, `file_path`, `filePath`, `filename`, `file`, `url` where local) in both the request `tools` array (definitions) and — the load-bearing surface — **assistant `tool_calls` in conversation history and streaming delta tool-call arguments**. The v1 surface is conversation-history tool calls + the request's own tool definitions; streaming delta accumulation ships in v1 only for the non-streaming path.

**v1 scope decision:** the non-streaming path inspects (a) tool definitions' parameter defaults and (b) the last assistant tool_call arguments present in the `messages` history. The streaming path logs file ACL decisions only for tool definitions and history (same rule set), not accumulated deltas.

- Decision semantics: highest-priority matching rule wins; no match → allow (fail-open, consistent with egress rules).
- Mode semantics: `monitor` → flag only; `warn` → flag + warning header; `block` → strip/annotated refusal (403 for the whole request when the offending tool_call is the request's own declared intention — v1: whole-request 403 with structured problem detail listing the denied paths).
- Audit: flags category `file_acl_violation`, detail carries rule id, path, pattern, action. ScreeningEvent unchanged shape; flags flow into the existing evidence-pack pipeline (new category flows automatically).

### Skip rate (coverage) — existing, unchanged
`100 − coverage_pct` from `/v1/coverage` (gateway denominator). Per-file ACL v1 does not add new coverage surface; gateway adoption IS the skip-rate story.

## Migration `026_file_acl_rules.sql`

```sql
-- Tier 1: path patterns on data sources
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS path_pattern TEXT;

-- Tier 2: org file ACL rules
CREATE TABLE IF NOT EXISTS file_acl_rules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    path_pattern TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'block',
    priority INT NOT NULL DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
    CONSTRAINT fk_file_acl_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_file_acl_rules_org ON file_acl_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_file_acl_rules_org_priority ON file_acl_rules(org_id, priority);
```

## Prisma models

`DataSource.pathPattern String? @map("path_pattern")`; new `FileAclRule`.

## Route surface

- `POST/GET/DELETE /v1/org/file-acl` (+ `:id`) — org_admin for mutations; reads for security_analyst/auditor/developer (mirror tool-policy role matrix).
- `GET /v1/org/file-acl/test` — dry-run a path against the ruleset (admin/analyst).

## Tests

1. Glob matcher: exact, `*`, `**`, leading-slash anchoring, no traverse above root, comma-separated patterns.
2. Tier 1: path-scoped grant allows `contracts/a.md`, denies `payroll/x.csv` via parse path (unit-level on checkDataAccess with fake prisma).
3. Tier 2 gateway: history tool_call touching blocked path → 403 in block mode; monitor mode forwards untouched + flag; allow rule wins over block at equal priority (lowest priority value = highest precedence per egress convention: priority ASC = first match wins).
4. No rules configured → everything allowed (fail-open).
5. Flags recorded into screening result → visible in evidence pack query surface.

## Out of scope (v1)

- Streaming delta tool-call accumulation (streaming path inspects definitions + history only).
- deny-by-default org mode.
- Per-rule classification ceilings (classification rides on DataSource, not FileAclRule).
- Agent-grant × FileAclRule intersection (v1: FileAclRules are org-wide; grants remain source-level).

## Acceptance

- Migration applies idempotently; `prisma validate` + `generate` clean.
- All new tests pass; full suite's pre-existing 18 failures unchanged.
- Live verify on :3001: configure rule, send gateway chat request whose history contains a blocked-path tool_call, observe 403 + flag; monitor mode shows flag without refusal.
- Local commit only, no push.
