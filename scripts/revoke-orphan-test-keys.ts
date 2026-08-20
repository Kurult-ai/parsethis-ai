import { getPrisma } from "../src/db.js";
import { revokeApiKey } from "../src/api-key-service.js";

const NAMES = [
  "run40-aggregate-battery-TEST",
  "prospect-eval-TEST-w2softenable",
  "prospect-eval-TEST-maya",
  "prospect-eval-TEST-sdk400",
  "hint-probe-TEST",
];

async function main() {
  const p = getPrisma();
  for (const name of NAMES) {
    const keys = await p.apiKey.findMany({ where: { name, revokedAt: null } });
    for (const k of keys) {
      await revokeApiKey(k.id);
      console.log(`revoked ${k.id} (${name})`);
    }
  }
  // verify: none left
  const left = await p.apiKey.findMany({
    where: { revokedAt: null, name: { contains: "TEST" } },
    select: { id: true, name: true },
  });
  console.log("remaining unrevoked TEST keys:", JSON.stringify(left));
  await p.$disconnect();
}
main();
