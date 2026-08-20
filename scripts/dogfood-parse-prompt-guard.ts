#!/usr/bin/env node
import { main, DogfoodStageError } from "../src/lib/dogfood-prompt-guard-command.js";

function safeText(value: unknown, max = 260): string {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/giu, "[redacted-url]")
    .replace(/\bpfa_(?:live|test)_[A-Za-z0-9._-]+\b/gu, "[redacted-api-key]")
    .replace(/\bpg_[a-z0-9]+\b/giu, "[redacted-session]")
    .replace(/\bref_[a-f0-9]+\b/giu, "[redacted-reference]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .slice(0, max);
}

main().catch((error) => {
  const message = error instanceof DogfoodStageError
    ? `parse-dogfood FAIL stage=${error.stage} detail=${safeText(error.message)}`
    : `parse-dogfood FAIL stage=runtime detail=${safeText((error as Error).message || error)}`;
  console.error(message);
  process.exit(1);
});
