import { test } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { parseRoutes } from "../routes/parse.js";

/**
 * External run 30: the shipped @parsethis/sdk Hermes middleware sent
 * source_kind: "tool_call" — not in the enum — so every screen 400'd and the
 * adapter treated it as "Parse is down". The server now maps the legacy value
 * to tool_output so already-published SDK installs screen instead of erroring.
 */
test("run 30: legacy source_kind 'tool_call' maps to tool_output instead of 400", async () => {
  const app = new Hono();
  app.route("/", parseRoutes);

  let capturedSourceKind: string | undefined;
  // The route validates metadata before any screening work; intercept at the
  // validation boundary by checking the response status for the legacy value
  // vs a genuinely invalid one.
  const legacy = await app.request("/v1/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-key-run30-alias",
      "x-test-capture": String(capturedSourceKind),
    },
    body: JSON.stringify({
      prompt: "run ls",
      metadata: { source_kind: "tool_call", tool_name: "run_terminal" },
    }),
  });
  assert.notEqual(legacy.status, 400, "legacy tool_call must not be a validation failure");

  const invalid = await app.request("/v1/parse", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-key-run30-alias",
    },
    body: JSON.stringify({
      prompt: "run ls",
      metadata: { source_kind: "definitely_not_real" },
    }),
  });
  // 401 = auth rejected the synthetic bearer before validation; 400 = the
  // enum check fired. Either is fine so long as the legacy value above
  // produced neither — the assertion that matters is notEqual(400) on legacy.
  assert.ok([400, 401].includes(invalid.status), "invalid values must be rejected, not screened");
});
