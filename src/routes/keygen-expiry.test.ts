import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RETENTION } from "../lib/retention-facts.js";
import { selfServiceKeyExpiryNote, selfServiceKeyExpiresAt } from "../lib/self-service-key-copy.js";

describe("keygen expiry note agrees with expires_at", () => {
  it("the number in the note equals RETENTION.selfServiceKeyExpiryDays", () => {
    const note = selfServiceKeyExpiryNote();
    const match = /expires after (\d+) idle days/.exec(note);
    assert.ok(match, `note has no idle-day count: ${note}`);
    assert.equal(Number(match[1]), RETENTION.selfServiceKeyExpiryDays);
  });

  it("the day-count implied by expires_at matches the same constant", () => {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const expires = selfServiceKeyExpiresAt(now);
    const days = (expires.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    assert.equal(days, RETENTION.selfServiceKeyExpiryDays);
  });

  it("the keygen handler renders the note from the constant, not a hardcoded 30", () => {
    const src = readFileSync(fileURLToPath(new URL("./public.ts", import.meta.url)), "utf8");
    assert.match(src, /selfServiceKeyExpiryNote\(/);
    assert.doesNotMatch(
      src,
      /expires after 30 idle days/,
      "the handler still hardcodes 30 idle days",
    );
  });

  // Run 22 item 6 fixed the handler but not the surfaces around it. Three pages
  // still said 30 while the constant said 90, and the 401 challenge every
  // unauthenticated agent receives shipped the literal characters
  // "${RETENTION.selfServiceKeyExpiryDays}" because the string used plain
  // quotes. These two tests cover the copy wherever it lives, not one handler.
  it("no source file hardcodes an idle-day count", () => {
    for (const [file, src] of sourceFiles()) {
      const hit = /(\d+)\s+idle days/.exec(src);
      assert.equal(
        hit,
        null,
        `${file} hardcodes "${hit?.[0]}" — render it from RETENTION.selfServiceKeyExpiryDays instead`,
      );
    }
  });

  it("every interpolation of the constant sits inside a template literal", () => {
    const EXPR = "${RETENTION.selfServiceKeyExpiryDays}";
    for (const [file, src] of sourceFiles()) {
      // A template literal may span many lines, so the backtick that opens it is
      // usually not on the same line as the interpolation. Parity of the backticks
      // before the occurrence tells us whether we are inside one.
      for (let at = src.indexOf(EXPR); at !== -1; at = src.indexOf(EXPR, at + 1)) {
        const open = (src.slice(0, at).match(/`/g) ?? []).length % 2 === 1;
        const line = src.slice(0, at).split("\n").length;
        assert.ok(
          open,
          `${file}:${line} puts ${EXPR} in a quoted string, so it is emitted literally`,
        );
      }
    }
  });
});

/** Every .ts file under src/, excluding tests, which quote these patterns on purpose. */
function sourceFiles(): Array<[string, string]> {
  const root = fileURLToPath(new URL("..", import.meta.url));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [`src/${f}`, readFileSync(join(root, f), "utf8")] as [string, string]);
}
