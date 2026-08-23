#!/usr/bin/env node
/**
 * Claude Code hook: read stdin JSON, POST a redacted ledger event.
 * Never sends file contents or prompt text.
 */
const endpoint = process.env.PARSE_LEDGER_URL || "https://www.parsethis.ai/v1/ledger/event";
const key = process.env.PARSE_API_KEY || "";
const agentId = process.env.PARSE_AGENT_ID || "claude-code";

function digest(s) {
  return require("node:crypto").createHash("sha256").update(s).digest("hex");
}

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw || !key) process.exit(0);
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const tool = payload.tool_name || payload.toolName || "";
  const input = payload.tool_input || payload.input || {};
  const path =
    input.file_path || input.path || (Array.isArray(input.paths) ? input.paths[0] : "") || "";
  const kind = /write|edit/i.test(tool) ? "file_write" : /read/i.test(tool) ? "file_read" : "tool_call";
  const body = {
    agent_id: agentId,
    session_id: payload.session_id || payload.sessionId || "unknown",
    kind,
    tool: String(tool).slice(0, 80),
    path_glob: String(path).slice(0, 512),
    args_digest: digest(JSON.stringify({ tool, keys: Object.keys(input || {}) })),
    outcome: payload.tool_response?.interrupted ? "interrupted" : "ok",
    source: "claude-code-hooks",
  };
  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
  } catch {
    // offline: fail open — ledger must never block the agent
  }
}

main();
