/**
 * The spec drifted because nothing compared it to the router.
 *
 * On 2026-08-12 `/openapi.json` carried 19 paths and not one org-scoped route,
 * while the landing page said governance is the product. A security lead read
 * the machine surfaces, concluded the control plane did not exist, and left.
 * The agent registry was missing too, though the docs described it.
 *
 * This test makes that impossible to repeat quietly: mount a route under /v1
 * without documenting it and the suite fails, naming the path.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { app } from "../app.js";

/**
 * The governance control plane — the routes a security lead comes looking for.
 *
 * This test guards THIS surface rather than the whole API. A blanket
 * every-route assertion fails on ~95 pre-existing undocumented routes
 * (admin, playground, receipts, policy packs, most of compliance), and a test
 * that fails for reasons nobody is fixing gets disabled, which is worse than a
 * narrower one that holds. Widening the spec to the rest of the API is real
 * work and its own change; this stops the specific regression that cost a sale.
 */
const GOVERNANCE_PREFIXES = ["/v1/orgs", "/v1/org/", "/v1/gateway", "/v1/compliance/", "/v1/coverage"];

/** Governance routes that are deliberately undocumented, each with the reason. */
const UNDOCUMENTED = new Set<string>([
  // Operator provisioning: needs admin scope, is not a customer surface.
  "/v1/orgs",
  "/v1/orgs/:id",
  // Second and third steps of the domain claim; the entry point documents the
  // whole flow including these, and three near-identical path entries in the
  // spec would obscure it rather than clarify.
  "/v1/orgs/:id/domains/:domain/verify",
  "/v1/orgs/:id/domains/:domain",
  // Single-framework view of /v1/compliance/framework-map, which is documented
  // and returns every framework. A second near-identical entry would obscure
  // the crosswalk rather than clarify it.
  "/v1/compliance/framework-map/:framework",
  // Older alias of /v1/coverage, kept for callers that already use it. The
  // documented path is /v1/coverage; publishing both invites new integrations
  // against the one we would rather retire.
  "/v1/compliance/coverage",
]);

/** Hono writes `:id`; OpenAPI writes `{id}`. */
function toSpecPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

describe("openapi.json covers the router", () => {
  it("documents every governance route the router exposes", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    const documented = new Set(Object.keys(spec.paths));

    const mounted = [
      ...new Set(
        (app.routes as Array<{ path: string; method: string }>)
          .filter((r) => r.method !== "ALL")
          .map((r) => r.path)
          .filter((path) => GOVERNANCE_PREFIXES.some((prefix) => path.startsWith(prefix))),
      ),
    ];

    assert.ok(mounted.length > 10, "expected the router to expose the governance surface");

    const missing = mounted
      .filter((path) => !UNDOCUMENTED.has(path))
      .filter((path) => !documented.has(toSpecPath(path)));

    assert.deepEqual(
      missing,
      [],
      `undocumented governance route(s): ${missing.join(", ")}. Add them to openapi.json in src/routes/discovery.ts, or to UNDOCUMENTED here with a reason.`,
    );
  });

  it("keeps the org control plane in the spec", async () => {
    // The specific regression that cost a sale: these are the routes a security
    // lead looks for, and their absence read as "the feature does not exist".
    const spec = await (await app.request("/openapi.json")).json();
    for (const path of [
      "/v1/orgs/bootstrap",
      "/v1/org/tool-policy",
      "/v1/org/tool-policy/rules",
      "/v1/org/policy-defaults",
      "/v1/compliance/policy-history",
      "/v1/gateway/configure",
    ]) {
      assert.ok(spec.paths[path], `openapi.json no longer documents ${path}`);
    }
  });

  it("is titled as the product describes itself", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    assert.match(spec.info.title, /governance/i);
  });

  it("stays valid OpenAPI 3.1 with an operationId on every operation", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    assert.equal(spec.openapi, "3.1.0");

    const seen = new Set<string>();
    for (const [path, item] of Object.entries(spec.paths as Record<string, Record<string, { operationId?: string }>>)) {
      for (const [method, op] of Object.entries(item)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        assert.ok(op.operationId, `${method.toUpperCase()} ${path} has no operationId`);
        assert.ok(!seen.has(op.operationId!), `duplicate operationId: ${op.operationId}`);
        seen.add(op.operationId!);
      }
    }
  });
});
