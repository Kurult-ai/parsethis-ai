import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Run 32/33 pins — week 1 trust batch.
 *
 * P0-1: the policy PUT/GET environment asymmetry that two independent
 * prospects read as "the write was dropped" (and the fix: PUT now says
 * where it landed + how to read it back; GET lists which environments
 * exist for the key).
 *
 * P2-1: the semantic-layer model switch is env-level; here we pin the
 * model-client pieces — provider pin map exists, is exact-match only,
 * and pins DeepSeek v4 flash to the live-verified DeepInfra endpoint.
 *
 * P2-5: blog card dates render as YYYY-MM-DD for both Date objects
 * (gray-matter parses unquoted YAML dates) and string dates.
 */
import { readFileSync } from "node:fs";

test("run32/33 P0-1: PUT response tells the caller which environment was written and how to read it back", async () => {
  const src = readFileSync("src/routes/policy.ts", "utf-8");
  assert.ok(src.includes("environment_written: environment"), "PUT must report environment_written");
  assert.ok(src.includes("readback: `GET /v1/policy?environment="), "PUT must include readback hint");
  assert.ok(src.includes("environments,"), "GET must return environments[] list");
});

test("run32/33 P2-1: provider pin map is exact-match and v4-flash pins to the verified endpoint", () => {
  const src = readFileSync("src/model-client.ts", "utf-8");
  assert.ok(src.includes('"deepseek/deepseek-v4-flash": { order: ["DeepInfra"]'), "v4-flash pin to DeepInfra");
  assert.ok(src.includes("allow_fallbacks: false"), "pins must not fall back");
  assert.ok(!/PINS\[model\.startsWith/.test(src), "pins are exact-match, not prefix");
});

test("run32/33 P2-1: analysis max_tokens capped at 300", () => {
  const src = readFileSync("src/model-client.ts", "utf-8");
  // The screening path (callLLMFull) is bounded; streamLLM (chat surface)
  // legitimately keeps 2048 for conversational replies.
  const callLLMBody = src.slice(src.indexOf("export async function callLLMFull"), src.indexOf("export async function* streamLLM") > 0 ? src.indexOf("export async function* streamLLM") : undefined);
  assert.ok(callLLMBody.includes("max_tokens: 300"), "callLLMFull generation bounded");
  assert.ok(!callLLMBody.includes("max_tokens: 2048"), "no uncapped screening body remains");
});

test("run32/33 P2-5: blog card date renders as YYYY-MM-DD from Date objects and strings", () => {
  const src = readFileSync("src/pages/landing.ts", "utf-8");
  assert.ok(src.includes("rawDate instanceof Date"), "Date-object normalization present");
  assert.ok(src.includes('toISOString().slice(0, 10)'), "Date → YYYY-MM-DD");
});

test("run32/33 P2-5: 'the n and the surface' fragment is gone from both pages", () => {
  const landing = readFileSync("src/pages/landing.ts", "utf-8");
  const pricing = readFileSync("src/pages/pricing.ts", "utf-8");
  assert.ok(!landing.includes("the n and the surface"), "landing copy repaired");
  assert.ok(!pricing.includes("the n and the surface"), "pricing copy repaired");
});

test("run33 correction: the 🐴 title emoji was the test browser's own mascot, not a site bug", () => {
  // Instrument note, not a product test: browser-use Chrome prefixes 🐴 on
  // every tab title (verified against example.com). The unified plan's
  // landing-polish item listed it in error; this pin exists so the runs log
  // correction is permanent. The raw GMT blog date (P2-5) was and is real.
  assert.ok(true);
});
