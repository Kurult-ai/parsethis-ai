import { renderLandingPage } from "../src/pages/landing.js";
const html = renderLandingPage("https://www.parsethis.ai");
const blocks = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
let checked = 0, bad = 0;
for (const [, attrs, body] of blocks) {
  if (/src=/.test(attrs)) continue;
  const type = /type=["']([^"']+)["']/.exec(attrs)?.[1] ?? "text/javascript";
  if (type.includes("json")) { JSON.parse(body); continue; }   // JSON-LD: must be valid JSON
  checked++;
  try { new Function(body); } catch (e) { bad++; console.log(`JS BLOCK SYNTAX ERROR: ${(e as Error).message}`); }
}
console.log(`executable JS blocks checked: ${checked}, broken: ${bad}`);
console.log(`JSON-LD blocks valid: yes`);
console.log(`demo CTA present: ${html.includes('href="/demo"')}`);
