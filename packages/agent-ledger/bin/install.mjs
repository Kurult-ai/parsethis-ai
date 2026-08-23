#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const settingsPath = join(homedir(), ".claude", "settings.json");
const hookPath = join(dirname(fileURLToPath(import.meta.url)), "..", "hook.cjs");

const hookCmd = `node ${hookPath}`;
const matcher = { matcher: "", hooks: [{ type: "command", command: hookCmd }] };

function loadSettings() {
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8"));
}

const cmd = process.argv[2] || "install";
if (cmd !== "install") {
  console.error("usage: parsethis-ledger install");
  process.exit(1);
}

const settings = loadSettings();
settings.hooks = settings.hooks || {};
for (const name of ["PreToolUse", "PostToolUse", "Stop"]) {
  const list = Array.isArray(settings.hooks[name]) ? settings.hooks[name] : [];
  const filtered = list.filter((h) => !JSON.stringify(h).includes("agent-ledger/hook"));
  filtered.push(matcher);
  settings.hooks[name] = filtered;
}
mkdirSync(dirname(settingsPath), { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
console.log(`Wrote Claude Code hooks → ${settingsPath}`);
console.log("Set PARSE_API_KEY (and optional PARSE_AGENT_ID / PARSE_LEDGER_URL) in the environment.");
console.log("Hooks send paths + digests only. They never block the agent if Parse is down.");
