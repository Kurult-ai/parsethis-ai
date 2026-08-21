import { writeFileSync } from "fs";
const html = await (await fetch("https://www.parsethis.ai/pricing")).text();
writeFileSync("/tmp/pricing.html", html);
// extract script blocks and checkout-related markup
const scripts = [...html.matchAll(/<script[\s\S]*?<\/script>/gi)].map((m) => m[0]);
console.log("scripts", scripts.length, "total html", html.length);
for (const [i, s] of scripts.entries()) {
  if (/checkout|keys\/generate|stripe|fetch\(|signup/i.test(s)) {
    console.log("SCRIPT", i, s.slice(0, 2500));
    console.log("---");
  }
}
// cards markup
const idx = html.indexOf("billing/checkout");
console.log("context around billing/checkout:");
for (let i = 0; i < html.length; i++) {
  if (html.startsWith("/v1/billing/checkout", i) || html.startsWith("billing/checkout", i)) {
    console.log(html.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, " "));
    console.log("====");
  }
}
console.log("context keys/generate");
for (let i = 0; i < html.length; i++) {
  if (html.startsWith("/v1/keys/generate", i)) {
    console.log(html.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, " "));
    console.log("====");
  }
}
