import { config } from "dotenv";
config({ path: ".env" });
const BASE = "https://www.parsethis.ai";
function scrub(v: any, d = 0): any {
  if (d > 8) return "[depth]";
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => scrub(x, d + 1));
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (/key|token|secret|authorization|password/i.test(k) && typeof val === "string") {
        const s = val as string;
        o[k] = s.length > 8 ? s.slice(0, 4) + "...len=" + s.length : "[redacted]";
      } else o[k] = scrub(val, d + 1);
    }
    return o;
  }
  if (typeof v === "string" && /^pfa_/.test(v) && v.length > 12) return v.slice(0, 8) + "...";
  return v;
}
async function raw(method: string, path: string, body?: any, headers: any = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let b: any = null; try { b = JSON.parse(text); } catch {}
  return { status: res.status, ct: res.headers.get("content-type"), body: b, head: b ? undefined : text.slice(0, 200) };
}
async function main() {
  const free = await raw("POST", "/v1/keys/generate", { name: `elon-free-${Date.now()}` });
  const fk = free.body?.key as string;
  const fAuth = { Authorization: `Bearer ${fk}` };
  const freeChat = await raw("POST", "/v1/chat", { messages: [{ role: "user", content: "What does Parse do in one sentence?" }] }, fAuth);
  const freeSelf = await raw("GET", "/v1/keys", undefined, fAuth); // maybe admin only
  // parse openapi doesn't give scopes on key; try a parse and policy
  const freePolicy = await raw("GET", "/v1/policy", undefined, fAuth);

  const sc = await raw("POST", "/v1/billing/signup-checkout", { tier: "solo" });
  const sk = sc.body?.key as string;
  const sAuth = { Authorization: `Bearer ${sk}` };
  const sChat = await raw("POST", "/v1/chat", { messages: [{ role: "user", content: "What does Parse do in one sentence?" }] }, sAuth);
  const sParse = await raw("POST", "/v1/parse", { prompt: "hello from unpaid signup key" }, sAuth);
  const sUsage = await raw("GET", "/v1/billing/usage", undefined, sAuth);
  const sPolicy = await raw("GET", "/v1/policy", undefined, sAuth);
  // try to read scopes via master admin list? skip secrets
  // compare with free key chat
  // also check evaluate with proper body from docs
  const sEval = await raw("POST", "/v1/evaluate", {
    prompt: "hi",
    model: "openai/gpt-4o-mini",
    test_cases: [{ input: "hi", expected: "hi" }],
    evaluators: ["safety"],
  }, sAuth);
  const fEval = await raw("POST", "/v1/evaluate", {
    prompt: "hi",
    model: "openai/gpt-4o-mini",
    test_cases: [{ input: "hi", expected: "hi" }],
    evaluators: ["safety"],
  }, fAuth);

  // revoke both
  const fRev = await raw("DELETE", "/v1/keys/self", undefined, fAuth);
  const sRev = await raw("DELETE", "/v1/keys/self", undefined, sAuth);

  const out = scrub({
    at: new Date().toISOString(),
    free: {
      keygen: { status: free.status, scopes: free.body?.scopes, note: free.body?.scopes_note },
      chat: { status: freeChat.status, code: freeChat.body?.code, detail: freeChat.body?.detail, keys: freeChat.body && Object.keys(freeChat.body).slice(0,20), suggested: freeChat.body?.suggested_action, message: typeof freeChat.body?.message === 'string' ? freeChat.body.message.slice(0,160) : freeChat.body?.choices?.[0]?.message?.content?.slice?.(0,160) },
      policy_tier: freePolicy.body?.tier,
      eval: { status: fEval.status, code: fEval.body?.code, detail: fEval.body?.detail, keys: fEval.body && Object.keys(fEval.body).slice(0,20), usage: fEval.body?.usage, total_cost: fEval.body?.total_cost },
      revoke: fRev.status,
    },
    signup: {
      checkout: { status: sc.status, has_url: !!sc.body?.checkout_url, has_key: !!sk, id: sc.body?.id, expires_at: sc.body?.expires_at },
      chat: { status: sChat.status, code: sChat.body?.code, detail: sChat.body?.detail, keys: sChat.body && Object.keys(sChat.body).slice(0,25), preview: JSON.stringify(sChat.body).slice(0,300) },
      parse: { status: sParse.status, suggested: sParse.body?.suggested_action, score: sParse.body?.risk_score },
      usage: sUsage.body,
      policy_tier: sPolicy.body?.tier,
      eval: { status: sEval.status, code: sEval.body?.code, detail: sEval.body?.detail, keys: sEval.body && Object.keys(sEval.body).slice(0,25), usage: sEval.body?.usage, total_cost: sEval.body?.total_cost, preview: JSON.stringify(sEval.body).slice(0,400) },
      revoke: sRev.status,
    },
  });
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(String(e).slice(0,400)); process.exit(1); });
