import "dotenv/config";
import { app } from "../src/app.js";
async function main() {
  const { readFileSync } = await import("node:fs");
  const key = readFileSync("/tmp/lat2-key.txt", "utf8").trim();
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    const res = await app.request("/v1/parse", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "hi", mode: "pattern-only" }),
    });
    await res.json();
    console.log(`app.request parse #${i + 1}:`, (performance.now() - t0).toFixed(1), "ms →", res.status);
  }
  process.exit(0);
}
main();
