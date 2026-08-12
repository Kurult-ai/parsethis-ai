import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const page = read("./my-agents.ts");
const publicRoutes = read("../routes/public.ts");

/**
 * The page exists because prospect run 8's engineer had nowhere to go. These
 * pin the properties that make it worth having rather than its exact markup.
 */
describe("my agents page", () => {
  it("is reachable by every role, including developer", () => {
    assert.match(
      publicRoutes,
      /publicRoutes\.get\("\/dashboard\/my-agents", authMiddleware\("evaluate"\)/,
      "no requireRole — this is the page for the role that can do nothing else",
    );
  });

  it("is where an in-org non-admin lands instead of raw problem+json", () => {
    assert.match(
      publicRoutes,
      /return c\.redirect\("\/dashboard\/my-agents", 302\)/,
      "/dashboard/org must send a person to their own page, not a JSON blob",
    );
  });

  it("shows refusals, not only registered-and-blocked tools", () => {
    // A refused deploy never reaches the registry. Resolving registered agents
    // alone would leave the panel empty at exactly the moment it is needed.
    assert.match(page, /listToolRefusals\(apiKeyId\)/);
    assert.match(page, /const seenTools = new Set/, "refusals must dedupe against registered tools");
  });

  it("drops a refusal once the tool is allowed again", () => {
    assert.match(
      page,
      /if \(now\.blocked\.length === 0\) continue;/,
      "an approved exception should clear the panel, not leave a ghost grievance",
    );
  });

  it("names who to ask", () => {
    assert.match(page, /role: "org_admin", revokedAt: null/, "the page must list real admins");
    assert.match(page, /endsWith\("\.invalid"\)/, "the sentinel address is not a person");
  });

  it("lets the reader file a request without leaving the page", () => {
    assert.match(page, /\/v1\/exception-requests/);
    assert.match(page, /CSRF_HEADER/, "a browser mutation must carry the CSRF token");
  });

  it("never writes on a GET", () => {
    for (const forbidden of ["prisma.organization.create", "prisma.agentRegistry.create", ".upsert("]) {
      assert.ok(!page.includes(forbidden), `${forbidden} — a dashboard GET must not write`);
    }
  });

  it("guards every read separately", () => {
    // A missing table renders an empty section, not a 500.
    const catches = page.match(/\} catch \{/g) ?? [];
    assert.ok(catches.length >= 5, `expected each read to be guarded, found ${catches.length}`);
  });

  it("says what an undeclared tool list means", () => {
    assert.match(
      page,
      /That is not the same as being allowed/,
      "declaring nothing is unanswerable, not clean",
    );
  });
});
