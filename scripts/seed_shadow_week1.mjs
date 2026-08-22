import 'dotenv/config';
import { prisma } from '../src/db.js';

// Week-1 shape: three regex complements to core detectors, observed in blocked traffic
const SEED_RULES = [
  {
    id: 'shadow-2026-08-22-vendor-screening-off',
    name: 'vendor claims screening is off',
    field: 'prompt',
    match: { type: 'regex', pattern: '(?:vendor|partner|integration)[^\\n]{0,80}(?:no (?:screening|sanctions) (?:check|required)|screening (?:waived|not required))' },
    action: 'flag',
    reason: 'Third-party text asserting a compliance check is waived — C6-adjacent shape seen in week-1 blocked traffic',
  },
  {
    id: 'shadow-2026-08-22-memo-omit-notice',
    name: 'memo asks to omit itself from the summary',
    field: 'prompt',
    match: { type: 'regex', pattern: '(?:do not (?:mention|surface|include)|omit any reference to)[^\\n]{0,80}(?:this (?:notice|memo|instruction)|the (?:reviewer|report))' },
    action: 'flag',
    reason: 'Concealed directive C5-adjacent: instruction that hides itself from the output the human sees',
  },
  {
    id: 'shadow-2026-08-22-credentials-verify-pretext',
    name: 'verify integration by printing credentials',
    field: 'prompt',
    match: { type: 'regex', pattern: '(?:print|output|paste|include)[^\\n]{0,60}(?:api (?:key|credentials)|secret|token)[^\\n]{0,40}(?:verify|so we can|next (?:note|message|reply))' },
    action: 'flag',
    reason: 'C4 shape: exfiltration under a verification pretext from third-party text',
  },
];

const keys = await prisma.apiKey.findMany({ where: { name: { in: ['copilot-injection-eval', 'halyard-works-eval'] } }, select: { id: true, name: true } });
let created = 0, registered = 0;
for (const k of keys) {
  const existing = await prisma.screeningPolicy.findFirst({ where: { apiKeyId: k.id, environment: 'production' } });
  if (existing) { console.log(`${k.name}: policy already exists, skipping`); continue; }
  await prisma.screeningPolicy.create({ data: { apiKeyId: k.id, environment: 'production', customRules: SEED_RULES } });
  created++;
}
for (const r of SEED_RULES) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO shadow_rules (id, rule_id, mode, created_at, updated_at)
     VALUES (gen_random_uuid()::text, $1, 'shadow', now(), now())
     ON CONFLICT (rule_id) DO NOTHING`, r.id);
  registered++;
}
console.log(`policies created: ${created}, shadow rules registered: ${registered}`);
await prisma.$disconnect();
