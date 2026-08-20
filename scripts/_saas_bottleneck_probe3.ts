import "dotenv/config";
const BASE = "https://www.parsethis.ai";

async function req(method: string, path: string, opts: { headers?: Record<string,string>, body?: any } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: opts.headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = null; }
  return { status: res.status, ct: res.headers.get("content-type") || "", body, text };
}

function hit(text: string, re: RegExp) { return re.test(text); }

async function main() {
  // pages text signals
  for (const path of ["/get-started", "/docs/quickstart", "/docs/api", "/pricing", "/llms.txt", "/"]) {
    const r = await req("GET", path, { headers: { Accept: "text/html, text/markdown, */*" } });
    const t = r.text || "";
    console.log("PAGE", path, r.status, r.ct.split(";")[0], {
      len: t.length,
      signup_checkout: hit(t, /signup-checkout/i),
      billing_checkout: hit(t, /billing\/checkout/i),
      stripe_checkout_word: hit(t, /checkout\.stripe|Start Solo|Start Pro|\$12|Solo/i),
      keys_generate: hit(t, /keys\/generate|\/v1\/keys/i),
      x402: hit(t, /x402/i),
      install_parse: hit(t, /Install Parse/i),
      parse_endpoint: hit(t, /\/v1\/parse/i),
    });
  }

  // MCP initialize + tools/list + get_pricing if present
  const init = await req("POST", "/mcp", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0" } } },
  });
  console.log("mcp_init", init.status, init.body ? Object.keys(init.body) : init.text.slice(0,120));

  const tools = await req("POST", "/mcp", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const toolNames = (tools.body?.result?.tools || []).map((t: any) => t.name);
  console.log("mcp_tools", tools.status, toolNames);

  for (const name of ["get_pricing", "generate_key", "create_checkout", "billing_checkout", "screen_prompt", "get_started"]) {
    if (!toolNames.includes(name) && !toolNames.some((n: string) => n.includes(name))) continue;
    const call = await req("POST", "/mcp", {
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: {} } },
    });
    const content = call.body?.result?.content || call.body?.result || call.body;
    const s = JSON.stringify(content).slice(0, 600);
    console.log("mcp_call", name, call.status, s);
  }

  // openapi billing-related path search
  const oa = await req("GET", "/openapi.json");
  const paths = Object.keys(oa.body?.paths || {});
  console.log("openapi_billing_paths", paths.filter(p => /bill|checkout|key|price|portal|signup/i.test(p)));
  // check components/docs for stripe
  const oaText = JSON.stringify(oa.body || {}).slice(0, 200000);
  console.log("openapi_mentions", {
    stripe: /stripe/i.test(oaText),
    signup_checkout: /signup-checkout/i.test(oaText),
    solo: /solo/i.test(oaText),
    x402: /x402/i.test(oaText),
    checkout: /checkout/i.test(oaText),
  });

  // pricing page + v1/pricing already known disabled
  const pricingHtml = await req("GET", "/pricing");
  console.log("pricing_page", pricingHtml.status, {
    has_solo: /Solo|\$12/i.test(pricingHtml.text),
    has_signup: /signup-checkout|Start Solo|checkout/i.test(pricingHtml.text),
    has_x402: /x402/i.test(pricingHtml.text),
  });

  // status availability
  const st = await req("GET", "/status");
  console.log("status_summary", st.status, JSON.stringify(st.body).slice(0, 400));

  // check if free scopes block anything important via a key without parse? already saw parse works.
  // Confirm auth challenge body mentions keygen
  const unauth = await req("POST", "/v1/parse", { headers: { "content-type": "application/json" }, body: { prompt: "hi" } });
  console.log("unauth_parse_help", unauth.status, JSON.stringify(unauth.body).slice(0, 500));
}

main().catch(e => { console.error(String(e).slice(0,300)); process.exit(1); });
