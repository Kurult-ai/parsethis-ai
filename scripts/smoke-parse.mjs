#!/usr/bin/env node

const baseUrl = (process.env.PARSE_BASE_URL || "https://www.parsethis.ai").replace(/\/$/, "");
// x402 is a deployment choice, not a health property. This used to default to
// "required" for any non-localhost host, so the smoke asserted enabled === true
// against a deployment that sets X402_ENABLED=false on purpose — and CI has
// been red on it. Set PARSE_SMOKE_REQUIRE_X402=true where x402 is expected to
// be live; otherwise the check below verifies coherence rather than presence.
const requireX402 = process.env.PARSE_SMOKE_REQUIRE_X402 === "true";
const apiKey = process.env.PARSE_SMOKE_API_KEY || process.env.PARSE_API_KEY || "";

async function readJson(path, init) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON status=${res.status} body=${text.slice(0, 160)}`);
  }
  return { path, status: res.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = [];

const health = await readJson("/health");
assert(health.status === 200, `/health status ${health.status}`);
assert(health.json?.status === "ok", `/health status body ${health.json?.status}`);
checks.push({ path: health.path, status: health.status, ok: true, commit: health.json?.deployment?.commit || "unknown" });

const version = await readJson("/version");
assert(version.status === 200, `/version status ${version.status}`);
assert(version.json?.deployment, "/version missing deployment metadata");
checks.push({ path: version.path, status: version.status, ok: true, commit: version.json.deployment.commit || "unknown" });

const pricing = await readJson("/v1/pricing");
assert(pricing.status === 200, `/v1/pricing status ${pricing.status}`);
assert(!requireX402 || pricing.json?.enabled === true, "/v1/pricing enabled is not true (PARSE_SMOKE_REQUIRE_X402=true)");
// Whether or not x402 is switched on, the endpoint must not advertise a
// half-configured payment path: enabled with no payTo would take money nowhere.
if (pricing.json?.enabled === true) {
  assert(
    pricing.json?.payTo && pricing.json.payTo !== "not_configured",
    "/v1/pricing is enabled but payTo is not configured",
  );
  assert(
    pricing.json?.facilitator && pricing.json.facilitator !== "not_configured",
    "/v1/pricing is enabled but facilitator is not configured",
  );
}
checks.push({
  path: pricing.path,
  status: pricing.status,
  ok: true,
  x402_enabled: pricing.json?.enabled === true,
  network: pricing.json?.network_name || pricing.json?.network,
});

const openapi = await readJson("/openapi.json");
assert(openapi.status === 200, `/openapi.json status ${openapi.status}`);
const paths = openapi.json?.paths || {};
for (const required of ["/health", "/version", "/v1/parse", "/v1/screen-output", "/v1/pricing"]) {
  assert(required in paths, `/openapi.json missing ${required}`);
}
checks.push({ path: openapi.path, status: openapi.status, ok: true, paths: Object.keys(paths).length });

if (apiKey) {
  const screen = await readJson("/v1/screen-output", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ text: "Parse smoke check: deployment health verification." }),
  });
  assert(screen.status === 200, `/v1/screen-output authenticated status ${screen.status}`);
  checks.push({ path: screen.path, status: screen.status, ok: true, authenticated: true });
} else {
  const unauth = await readJson("/v1/screen-output", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Parse smoke check: unauthenticated payment/auth boundary." }),
  });
  assert([401, 402].includes(unauth.status), `/v1/screen-output unauth status ${unauth.status}; expected 401/402 without key`);
  checks.push({ path: unauth.path, status: unauth.status, ok: true, authenticated: false });
}

console.log(JSON.stringify({ ok: true, baseUrl, checks }, null, 2));
