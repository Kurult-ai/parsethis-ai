import { writeFileSync } from "fs";
const BASE = "https://www.parsethis.ai";
async function main() {
  const out: any = { at: new Date().toISOString() };
  const [llms, skill, openapi, pricing, mcp, install, quickstart, getStarted] = await Promise.all([
    fetch(BASE + "/llms.txt").then((r) => r.text()),
    fetch(BASE + "/skill").then((r) => r.text()),
    fetch(BASE + "/openapi.json").then((r) => r.json()),
    fetch(BASE + "/v1/pricing").then((r) => r.json()),
    fetch(BASE + "/mcp.json").then((r) => r.json()),
    fetch(BASE + "/install").then((r) => r.text()),
    fetch(BASE + "/docs/quickstart").then((r) => r.text()),
    fetch(BASE + "/get-started").then((r) => r.text()),
  ]);
  const paths = Object.keys(openapi.paths || {});
  function hits(text: string) {
    return {
      signup_checkout: /signup-checkout/i.test(text),
      billing_checkout: /billing\/checkout/i.test(text),
      stripe: /stripe/i.test(text),
      solo_12: /\$12|solo/i.test(text),
      pro_49: /\$49|\bpro\b/i.test(text),
      x402: /x402/i.test(text),
      x402_enabled_false: /enabled:\s*false|not configured/i.test(text),
      keys_generate: /keys\/generate/i.test(text),
      mailto: /mailto:/i.test(text),
    };
  }
  out.llms = hits(llms);
  out.skill = hits(skill);
  out.install = hits(install);
  out.quickstart = hits(quickstart);
  out.get_started = hits(getStarted);
  out.openapi_billing_paths = paths.filter((p) => /billing|checkout|portal|usage/i.test(p));
  out.openapi_path_count = paths.length;
  out.pricing_keys = Object.keys(pricing);
  out.pricing_enabled = pricing.enabled;
  out.pricing_has_stripe_tiers = !!(pricing.stripe || pricing.subscriptions || pricing.plans || pricing.tiers);
  out.pricing_mentions = {
    solo: JSON.stringify(pricing).toLowerCase().includes("solo"),
    stripe: JSON.stringify(pricing).toLowerCase().includes("stripe"),
    checkout: JSON.stringify(pricing).toLowerCase().includes("checkout"),
  };
  out.mcp_instructions_hits = hits(String(mcp.instructions || "") + JSON.stringify(mcp));
  // extract llms lines about pay/billing/x402/key
  out.llms_pay_lines = llms.split("\n").filter((l) => /x402|billing|checkout|stripe|solo|\$12|pay|pricing|subscription/i.test(l)).slice(0, 40);
  out.skill_pay_lines = skill.split("\n").filter((l) => /x402|billing|checkout|stripe|solo|\$12|pay|pricing|subscription/i.test(l)).slice(0, 40);
  // health commit
  out.commit = (await fetch(BASE + "/health").then((r) => r.json())).deployment?.commit;
  writeFileSync("/tmp/saas_discovery_stripe.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
