# Image-in-prompt + unauthorized connectors

Date: 2026-08-23 · Shipped

## Admin can

1. `PUT /v1/org/image-policy` `{ "mode": "deny" | "whitelist" | "allow" }`
   - `deny`: any detected image in the prompt is refused (gateway 403 / parse block).
   - `whitelist`: every image must declare a source path (`metadata.image_sources` or `path` on the content part) that matches an **allow** File ACL rule. Undeclared JPEG bytes are unauthorized. Raw base64 has no directory.
   - File ACL allow rule example: `POST /v1/org/file-acl` `{ "path_pattern": "/approved-share/**", "action": "allow" }`
   - Dry-run: `POST /v1/org/image-policy/test`

2. `POST /v1/org/tool-policy/presets` `{ "preset": "block-claude-chrome" }`
   - Writes a prefix block on `mcp__claude-in-chrome__`.
   - Enforced on the gateway (tools array on the wire) and on `/v1/parse` if the agent declares the tool.
   - **Does not uninstall the Chrome extension.** Claude.ai in a browser never hits Parse.

## Tier

Org governance, every plan including Free. Evidence packs of the refusals: Pro+.

## Honest limit

Employees using claude.ai + Claude-in-Chrome without the Parse gateway are outside the product. That is Anthropic org admin / Chrome Enterprise / MDM.
