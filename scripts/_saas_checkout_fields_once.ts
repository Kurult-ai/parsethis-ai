import { config } from "dotenv";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
async function main() {
  const kg = await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `chkfields-${Date.now()}` }),
  }).then((r) => r.json());
  const key = kg.key;
  console.log("keygen scopes", kg.scopes, "id", kg.id);

  for (const tier of ["solo", "pro", "team"]) {
    const bearer = await fetch(BASE + "/v1/billing/checkout", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ tier }),
    });
    const bj = await bearer.json();
    const bkeys = Object.keys(bj);
    console.log(
      "bearer checkout",
      tier,
      bearer.status,
      "keys",
      bkeys,
      "has_url",
      !!bj.url,
      "has_checkout_url",
      !!bj.checkout_url,
      "url_host",
      bj.url ? new URL(bj.url).host : null,
      "checkout_host",
      bj.checkout_url ? new URL(bj.checkout_url).host : null,
    );
  }

  const cold = await fetch(BASE + "/v1/billing/signup-checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "solo" }),
  });
  const cj = await cold.json();
  console.log(
    "cold signup-checkout",
    cold.status,
    "keys",
    Object.keys(cj),
    "has_url",
    !!cj.url,
    "has_checkout_url",
    !!cj.checkout_url,
    "has_key",
    !!cj.key,
  );

  // simulate pricing JS decision
  const r = await fetch(BASE + "/v1/billing/checkout", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tier: "solo" }),
  });
  const d = await r.json();
  const jsWouldRedirect = !!(r.ok && d.url);
  const correctWouldRedirect = !!(r.ok && (d.url || d.checkout_url));
  console.log("pricing JS would redirect on bearer path?", jsWouldRedirect);
  console.log("correct field check would redirect?", correctWouldRedirect);
  console.log("field mismatch bug?", correctWouldRedirect && !jsWouldRedirect);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
