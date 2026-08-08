import { app } from './src/app.ts';
import { readFileSync, existsSync } from 'node:fs';

function loadKey(): string | undefined {
  if (process.env.PARSE_ADMIN_KEY || process.env.MASTER_API_KEY) {
    return process.env.PARSE_ADMIN_KEY || process.env.MASTER_API_KEY;
  }
  for (const p of [
    '/Users/kublai/.hermes/secrets/parse-kublai-admin-key.json',
    '/Users/kublai/.hermes/secrets/parse-d-kurult-team-key.json',
  ]) {
    if (existsSync(p)) {
      try {
        const k = JSON.parse(readFileSync(p, 'utf8')).key;
        if (k) return k;
      } catch {}
    }
  }
  return undefined;
}

const key = loadKey();
if (!key) {
  console.log(JSON.stringify({ error: 'no_admin_key' }));
  process.exit(2);
}

async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request('/v1/admin/actions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const list = await act('admin.improvement_proposal.list', { limit: 50 });
const props = (list.body?.improvement_proposals || list.body?.result?.improvement_proposals || []) as any[];
const compact = props.map((p) => ({
  id: p.id,
  status: p.status,
  priority: p.priority,
  category: p.category,
  risk: p.risk_level || p.riskLevel,
  source: p.source,
  key: p.idempotency_key || p.idempotencyKey,
  title: String(p.title || '').slice(0, 180),
  created: p.created_at || p.createdAt,
}));

const revoke = await act('admin.api_key.revoke', {
  api_key_id: 'cmshn1ldb04za0pqllfz2l7v2',
  reason: 'hourly saas loop probe cleanup; temporary named keygen smoke key',
});

console.log(JSON.stringify({
  list_status: list.status,
  err: list.body?.error || list.body?.title || list.body?.detail || null,
  total: list.body?.total ?? list.body?.result?.total ?? compact.length,
  statuses: compact.reduce((a: Record<string, number>, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {} as Record<string, number>),
  openish: compact.filter(p => ['proposed','approved','revision_requested','deferred'].includes(String(p.status))),
  all: compact,
  revoke_status: revoke.status,
  revoke_summary: {
    title: revoke.body?.title || null,
    detail: revoke.body?.detail || null,
    id: revoke.body?.api_key?.id || revoke.body?.result?.api_key?.id || null,
    status: revoke.body?.api_key?.status || revoke.body?.result?.api_key?.status || revoke.body?.result?.status || null,
  },
}, null, 2));
