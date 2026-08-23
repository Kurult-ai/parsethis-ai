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
async function main() {
  const all: any[] = [];
  for (let o = 0; o < 800; o += 100) {
    const r = await admin("admin.improvement_proposal.list", { limit: 100, offset: o });
    const items = (r.body?.result ?? r.body)?.improvement_proposals || [];
    if (!items.length) break;
    all.push(...items);
    if (items.length < 100) break;
  }
  const open = all.filter((p) => !["rejected", "done", "implemented", "completed", "closed", "shipped"].includes(String(p.status || "").toLowerCase()));
  const re = /deep_screening|deep screening|quota.*llm_failed|llm_failed.*quota|remaining.*llm|burns? deep|deep.*used/i;
  const matches = open
    .filter((p) => re.test(String(p.title || "")) || re.test(String(p.idempotency_key || "")) || re.test(JSON.stringify(p.evidence || {}).slice(0, 800)))
    .map((p) => ({ key: p.idempotency_key, title: String(p.title).slice(0, 130), pri: p.priority }));

  // live: two full-mode calls, watch deep_screening used climb under llm_failed
  const kg = await (await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `elon-deep-${Date.now()}` }),
  })).json();
  const key = kg.key;
  const auth = { Authorization: `Bearer ${key}` };
  const calls = [];
  for (let i = 0; i < 3; i++) {
    const r = await fetch(BASE + "/v1/parse", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ prompt: `benign status check ${i} ${Date.now()}`, mode: "full" }),
    });
    const b = await r.json();
    calls.push({
      status: r.status,
      degraded: b.degraded,
      reason: b.degraded_reason,
      layers: b.layers,
      method: b.analysis_method,
      deep: b.deep_screening,
      score: b.risk_score,
      action: b.suggested_action,
    });
  }
  // pattern-only should not burn?
  const po = await fetch(BASE + "/v1/parse", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ prompt: "benign pattern only", mode: "pattern-only" }),
  });
  const pob = await po.json();
  calls.push({
    label: "pattern-only",
    status: po.status,
    degraded: pob.degraded,
    reason: pob.degraded_reason,
    layers: pob.layers,
    method: pob.analysis_method,
    deep: pob.deep_screening,
  });

  await fetch(BASE + "/v1/keys/self", { method: "DELETE", headers: auth }).catch(() => {});

  // also check chat 403 upgrade path - any checkout in body?
  const kg2 = await (await fetch(BASE + "/v1/keys/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `elon-chat403-${Date.now()}` }),
  })).json();
  const chat = await fetch(BASE + "/v1/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${kg2.key}`, "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
  });
  const chatBody = await chat.json();
  await fetch(BASE + "/v1/keys/self", { method: "DELETE", headers: { Authorization: `Bearer ${kg2.key}` } }).catch(() => {});

  console.log(JSON.stringify({ matches, calls, chat403: { status: chat.status, body: chatBody } }, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
