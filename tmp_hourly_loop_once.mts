import { app } from './src/app.ts';
const key = process.env.PARSE_ADMIN_KEY!;
async function act(action: string, params: Record<string, unknown> = {}) {
  const res = await app.request('/v1/admin/actions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

const list = await act('admin.improvement_proposal.list', { limit: 30 });
const props = (list.body?.improvement_proposals || list.body?.result?.improvement_proposals || []) as any[];
const compact = props.map((p) => ({
  id: p.id,
  status: p.status,
  priority: p.priority,
  key: p.idempotency_key || p.idempotencyKey,
  title: String(p.title || '').slice(0, 140),
}));

// revoke hourly smoke key created during probe if present
const revoke = await act('admin.api_key.revoke', {
  api_key_id: 'cmsh2voma04o30pqlvcgshyiv',
  reason: 'hourly saas loop probe cleanup; temporary smoke key',
});

const snap = await act('admin.dashboard.snapshot', { limit: 5 });
const summary = snap.body?.summary || snap.body?.result?.summary || null;
const keys = (snap.body?.api_keys || snap.body?.result?.api_keys || []) as any[];

console.log(JSON.stringify({
  list_status: list.status,
  total: list.body?.total ?? list.body?.result?.total ?? compact.length,
  top5: compact.slice(0, 5),
  statuses: compact.reduce((a: Record<string, number>, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {}),
  revoke_status: revoke.status,
  revoke_body: {
    error: revoke.body?.error || revoke.body?.message || null,
    ok: !revoke.body?.error,
    keys: Object.keys(revoke.body || {}),
    id: revoke.body?.api_key?.id || revoke.body?.result?.api_key?.id || revoke.body?.id || null,
    status: revoke.body?.api_key?.status || revoke.body?.result?.api_key?.status || null,
  },
  summary,
  listed_key_ids: keys.map((k) => k.id),
}, null, 2));
