import { app } from './src/app.ts';
const action = process.env.PARSE_ADMIN_ACTION!;
const params = JSON.parse(process.env.PARSE_ADMIN_PARAMS || '{}');
const key = process.env.PARSE_ADMIN_KEY!;
const res = await app.request('/v1/admin/actions', {
  method: 'POST',
  headers: { Authorization: "Bearer " + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action, params }),
});
const body: any = await res.json();
console.log(JSON.stringify(body, null, 2).slice(0, 5000));
