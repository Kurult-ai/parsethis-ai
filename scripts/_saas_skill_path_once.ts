import { config } from "dotenv";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
const master = process.env.MASTER_API_KEY!;
async function admin(action: string, params: any = {}) {
  const res = await fetch(BASE + "/v1/admin/actions", {
    method: "POST",
    headers: { Authorization: `Bearer ${master}`, "content-type": "application/json" },
    body: JSON.stringify({ action, params }),
  });
  return { status: res.status, body: await res.json() };
}
async function probe(path: string) {
  const res = await fetch(BASE + path, { redirect: "manual" });
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  return {
    path,
    status: res.status,
    ct: ct.slice(0, 60),
    loc: res.headers.get("location"),
    len: text.length,
    head: text.slice(0, 120).replace(/\n/g, "\\n"),
    has_keys_generate: /keys\/generate/i.test(text),
    has_signup_checkout: /signup-checkout/i.test(text),
    has_billing_checkout: /billing\/checkout/i.test(text),
    has_stripe: /stripe/i.test(text),
    has_x402: /x402/i.test(text),
    has_checkout_url: /checkout_url/i.test(text),
  };
}
async function main() {
  const out: any = { at: new Date().toISOString() };
  out.paths = [];
  for (const p of [
    "/skill",
    "/skill.md",
    "/skills/parse",
    "/.well-known/skill.md",
    "/install",
    "/get-started",
    "/llms.txt",
    "/mcp.json",
    "/docs/api",
    "/pricing",
    "/v1/pricing",
  ]) {
    out.paths.push(await probe(p));
  }
  // install script body commerce
  const install = await (await fetch(BASE + "/install")).text();
  out.install_lines = install.split(/\n/).slice(0, 40);
  out.install_skill_url = (install.match(/curl[^\\n]+/i) || [])[0];

  // match proposals about skill 404 / install
  const all: any[] = [];
  for (let o = 0; o < 800; o += 100) {
    const r = await admin("admin.improvement_proposal.list", { limit: 100, offset: o });
    const root = r.body?.result ?? r.body;
    const items = root?.improvement_proposals || [];
    if (!items.length) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  const open = all.filter((p) => !["rejected", "done", "implemented", "completed", "closed", "shipped"].includes(String(p.status || "").toLowerCase()));
  const re = /skill\.md|\/skill\b|install script|Install Parse|skill prompt/i;
  out.matches = open
    .filter((p) => re.test(String(p.title || "")) || re.test(String(p.idempotency_key || "")))
    .map((p) => ({ id: p.id, pri: p.priority, key: p.idempotency_key, title: String(p.title || "").slice(0, 120) }));

  // Count active Signup Keys via list if filter works
  const keys = await admin("admin.api_key.list", { limit: 100 });
  const items = (keys.body?.result ?? keys.body)?.api_keys || (keys.body?.result ?? keys.body)?.items || [];
  const arr = Array.isArray(items) ? items : [];
  out.key_list_n = arr.length;
  out.signup_keys_in_page = arr.filter((k: any) => /signup/i.test(String(k.name || ""))).length;
  out.active_signup = arr.filter((k: any) => /signup/i.test(String(k.name || "")) && k.status === "active").length;
  out.chat_scope_free = arr.filter((k: any) => Array.isArray(k.scopes) && k.scopes.includes("chat") && k.tier === "free" && k.status === "active").length;

  // action_hash missing sharper hold angle already?
  const holdRe = /action_hash|unknown_field.*hold|hold.*unknown_field|approve_url/i;
  out.hold_matches = open
    .filter((p) => holdRe.test(String(p.title || "")) || holdRe.test(String(p.idempotency_key || "")))
    .map((p) => ({ id: p.id, pri: p.priority, key: p.idempotency_key, title: String(p.title || "").slice(0, 120) }));

  // commerce discovery matches
  const comRe = /stripe.*live|agent-facing commerce|x402 only|openapi omits both|checkout_url|docs omit.*checkout|quickstart.*checkout/i;
  out.commerce_matches = open
    .filter((p) => comRe.test(String(p.title || "")) || comRe.test(String(p.idempotency_key || "")))
    .map((p) => ({ id: p.id, pri: p.priority, key: p.idempotency_key, title: String(p.title || "").slice(0, 120) }));

  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
