# Parse Exposure Privacy Model

Parse Exposure is findings-only by default. It is designed so a local scanner can do the sensitive endpoint inspection while Parse receives only minimized exposure evidence.

## Default accepted data

- scanner name/version/profile
- exposure severity
- catalog ID/name
- ecosystem
- package or component name
- version
- source type, such as `pnpm-lockfile`
- confidence
- compact evidence text, such as `exact name+version match`
- source file basename, when provided
- project path hash, when provided

## Rejected by default

Parse rejects payloads containing raw or secret-bearing fields such as:

- `env`
- `environment`
- `secrets`
- `credentials`
- raw MCP config
- raw lockfile content
- source code
- bearer tokens
- private keys
- common API-key/token shapes
- connection strings

## Path handling

If `source_file` is present, Parse keeps only the basename. If `project_path` is present, Parse stores only a SHA-256 digest. Full local paths are not returned in the sanitized finding.

## Retention

Phase 1 returns stateless receipt IDs and digests. Persistent receipt storage is a later opt-in feature and must store only sanitized payloads.
