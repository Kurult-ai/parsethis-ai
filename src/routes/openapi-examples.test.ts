import { after, test } from "node:test";
import assert from "node:assert/strict";

process.env.MASTER_API_KEY = process.env.MASTER_API_KEY || "test-master-key-for-openapi-examples";

const { app } = await import("../app.js");
const { closeQueue } = await import("../queue.js");
const { disconnectRedis } = await import("../redis.js");
const { disconnectDb } = await import("../db.js");

after(async () => {
  await closeQueue();
  await disconnectRedis();
  await disconnectDb();
});

// Rows whose example payload is explicitly an attack the endpoint should catch.
// Keyed by endpoint path; value is a matcher on the example object. Run 20's P0:
// the /v1/screen-output example — a system-prompt leak — scored 0/safe/allow on
// the endpoint that illustrates it. An example that demonstrates an attack must
// never be scored safe by its own endpoint.
const ATTACK_EXAMPLES: Record<string, (ex: any) => boolean> = {
  "/v1/screen-output": (ex) => typeof ex.output === "string" && /system prompt/i.test(ex.output),
  "/v1/parse": (ex) => typeof ex.prompt === "string" && /ignore (all )?previous/i.test(ex.prompt ?? ""),
};

test("openapi attack examples are not scored safe by their own endpoint", async () => {
  const specRes = await app.request("/openapi.json");
  assert.equal(specRes.status, 200);
  const spec = await specRes.json();
  const failures: string[] = [];
  let checked = 0;
  for (const [path, methods] of Object.entries<any>(spec.paths)) {
    const matcher = ATTACK_EXAMPLES[path];
    if (!matcher) continue;
    const ex = methods.post?.requestBody?.content?.["application/json"]?.example;
    if (!ex || !matcher(ex)) continue;
    checked++;
    const res = await app.request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.MASTER_API_KEY}`,
      },
      body: JSON.stringify(ex),
    });
    assert.equal(res.status, 200, `${path}: expected 200, got ${res.status}`);
    const j = await res.json();
    if (j.verdict === "safe" || j.suggested_action === "allow") {
      failures.push(`${path}: example scored ${j.risk_score}/${j.verdict}/${j.suggested_action}`);
    }
  }
  assert.ok(checked >= 2, `expected to find both attack examples in the spec, found ${checked}`);
  assert.equal(failures.length, 0, `attack examples scored safe:\n${failures.join("\n")}`);
});
