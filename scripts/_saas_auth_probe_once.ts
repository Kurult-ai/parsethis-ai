import "dotenv/config";
import fs from "fs";
import { app } from "../src/app.ts";

function red(s: string) {
  if (!s) return "missing";
  return `len=${s.length} pref=${s.slice(0,4)}…`;
}

async function tryKey(label: string, key: string) {
  if (!key) {
    console.log(label, "skip");
    return;
  }
  for (const action of ["admin.dashboard.snapshot", "admin.improvement_proposal.list"] as const) {
    const res = await app.request("/v1/admin/actions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, params: action.includes("list") ? { limit: 5 } : {} }),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    console.log(label, action, res.status, body.code || body.title || body.error || Object.keys(body).slice(0, 8).join(","));
  }
  try {
    const res = await fetch("https://www.parsethis.ai/v1/admin/actions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin.dashboard.snapshot", params: {} }),
    });
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
    console.log(label, "prod.snapshot", res.status, body.code || body.title || Object.keys(body).slice(0, 8).join(","));
  } catch (e: any) {
    console.log(label, "prod.snapshot err", String(e).slice(0, 120));
  }
}

async function main() {
  const master = process.env.MASTER_API_KEY || "";
  const secretPath = "/Users/kublai/.hermes/secrets/parse-kublai-admin-key.json";
  let fileKey = "";
  try {
    fileKey = JSON.parse(fs.readFileSync(secretPath, "utf8")).key || "";
  } catch {}
  console.log(
    JSON.stringify({
      master: red(master),
      fileKey: red(fileKey),
      same: !!(master && fileKey && master === fileKey),
      db: process.env.DATABASE_URL ? "set" : "missing",
      redis: process.env.REDIS_URL ? "set" : "missing",
    }),
  );
  await tryKey("master", master);
  if (fileKey && fileKey !== master) await tryKey("file", fileKey);
}

main().catch((e) => {
  console.error("FATAL", String(e).slice(0, 400));
  process.exit(1);
});
