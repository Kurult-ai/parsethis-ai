import { describe, it } from "node:test";
import assert from "node:assert/strict";

const TEST_MASTER_KEY = "test-master-key-for-admin-tests";
process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || TEST_MASTER_KEY;

const { app } = await import("../app.js");
const adminHeaders = { Authorization: `Bearer ${process.env.MASTER_API_KEY}` };

describe("admin routes", () => {
  it("serves a public discovery document for agent admin clients", async () => {
    const res = await app.request("/.well-known/parse-admin.json");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, "Parse Agents Admin");
    assert.equal(body.auth.required_scope, "admin");
    assert.equal(body.action_endpoint.endsWith("/v1/admin/actions"), true);
  });

  it("serves the admin dashboard shell without database access", async () => {
    const res = await app.request("/admin");
    assert.equal(res.status, 200);
    assert.ok(res.headers.get("content-type")?.includes("text/html"));
    const html = await res.text();
    assert.ok(html.includes("Admin Console"));
    assert.ok(html.includes("Agent action console"));
    assert.ok(html.includes("GEO performance"));
    assert.ok(html.includes("/v1/admin/actions"));
  });

  it("requires admin auth for the detailed action manifest", async () => {
    const res = await app.request("/v1/admin/manifest");
    assert.equal(res.status, 401);
  });

  it("returns an agent-first action manifest to admin callers", async () => {
    const res = await app.request("/v1/admin/manifest", { headers: adminHeaders });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.service, "Parse Agents Admin");
    assert.equal(body.action_endpoint.endsWith("/v1/admin/actions"), true);
    const actions = body.actions.map((action: { name: string }) => action.name);
    assert.ok(actions.includes("admin.dashboard.snapshot"));
    assert.ok(actions.includes("admin.geo.metrics.read"));
    assert.ok(actions.includes("admin.geo.synthetic.record"));
    assert.ok(actions.includes("admin.api_key.create"));
    assert.ok(actions.includes("admin.screening_policy.upsert"));
  });
});
