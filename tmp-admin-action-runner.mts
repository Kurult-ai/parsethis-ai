
import { app } from "./src/app.ts";

const action = process.env.PARSE_ADMIN_ACTION!;
const params = JSON.parse(process.env.PARSE_ADMIN_PARAMS || "{}");
const key = process.env.PARSE_ADMIN_KEY!;

const res = await app.request("/v1/admin/actions", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({ action, params }),
});
const text = await res.text();
let body: unknown;
try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 8000) }; }
console.log(JSON.stringify({ status: res.status, body }, null, 2));
