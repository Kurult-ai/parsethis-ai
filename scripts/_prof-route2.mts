import "dotenv/config";
import { parsePrompt } from "../src/parse.js";
import { app } from "../src/app.js";
import { readFileSync } from "node:fs";
async function main() {
  const key = readFileSync("/tmp/lat2-key.txt", "utf8").trim();
  // warm
  await parsePrompt({ prompt: "hi", mode: "pattern-only" });
  const t0 = performance.now();
  await parsePrompt({ prompt: "hi", mode: "pattern-only" });
  console.log("parsePrompt direct:", (performance.now() - t0).toFixed(1), "ms");
  // Now time auth middleware alone by hitting keys/self through app:
  for (let i = 0; i < 2; i++) {
    const t1 = performance.now();
    const res = await app.request("/v1/keys/self", { headers: { Authorization: `Bearer ${key}` } });
    await res.json();
    console.log("keys/self via app:", (performance.now() - t1).toFixed(1), "ms →", res.status);
  }
  process.exit(0);
}
main();
