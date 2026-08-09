import { CONTACT_EMAIL } from "../lib/constants.js";
import { renderPage } from "../lib/html-template.js";
import { organizationSchema } from "../lib/schema.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderSupportPage(baseUrl: string, state: "idle" | "success" | "error" = "idle", message?: string): string {
  const noticeMessage = escapeHtml(message || (state === "success"
    ? "Support request received. We'll review it and follow up by email if a response is needed."
    : "We could not accept that request. Check the required fields and try again."));
  const notice = state === "success"
    ? `<div class="support-notice success" role="status">${noticeMessage}</div>`
    : state === "error"
      ? `<div class="support-notice error" role="alert">${noticeMessage}</div>`
      : "";

  const content = `
<section class="hero">
  <p class="eyebrow">Support</p>
  <h1>Contact Parse support</h1>
  <p class="lead">Use this form for billing, API, account, or security-sensitive support questions. Do not paste full API keys, passwords, payment card details, or other secrets.</p>
</section>

${notice}

<div class="support-grid">
  <form class="support-form" method="post" action="/support">
    <input type="text" name="company_website" tabindex="-1" autocomplete="off" class="support-hp" aria-hidden="true">

    <label>
      Name
      <input type="text" name="name" autocomplete="name" maxlength="120" placeholder="Your name">
    </label>

    <label>
      Email <span aria-hidden="true">*</span>
      <input type="email" name="email" autocomplete="email" maxlength="320" required placeholder="you@example.com">
    </label>

    <label>
      Category
      <select name="category">
        <option value="support">General support</option>
        <option value="billing">Billing</option>
        <option value="api">API / integration</option>
        <option value="account">Account</option>
        <option value="security">Security</option>
      </select>
    </label>

    <label>
      API key prefix or hint
      <input type="text" name="api_key_hint" maxlength="80" placeholder="pfa_live_abc… (prefix only)">
    </label>

    <label>
      Subject
      <input type="text" name="subject" maxlength="200" placeholder="Short summary">
    </label>

    <label>
      Message <span aria-hidden="true">*</span>
      <textarea name="message" rows="8" maxlength="5000" required placeholder="Describe the issue, expected behavior, request id, timestamps, and safe identifiers. Full secrets are redacted before storage."></textarea>
    </label>

    <button type="submit" class="btn btn-primary">Send support request</button>
  </form>

  <aside class="support-aside">
    <h2>Before you send</h2>
    <ul>
      <li>Never include full API keys or passwords.</li>
      <li>Messages are treated as untrusted inbound text and are not executed.</li>
      <li>Submitting a request does not create an SLA, auto-reply commitment, or new privacy/security policy commitment.</li>
      <li>You can also email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</li>
    </ul>
    <h2>Agent endpoint</h2>
    <p>Agents can submit JSON to <code>POST /v1/support/tickets</code> with <code>email</code>, <code>message</code>, optional <code>name</code>, <code>subject</code>, <code>category</code>, and <code>api_key_hint</code>.</p>
  </aside>
</div>
`;

  return renderPage({
    title: "Support",
    description: "Contact Parse support for API, billing, account, and security-sensitive support questions.",
    path: "/support",
    content,
    baseUrl,
    jsonLd: [organizationSchema(baseUrl)],
    lastUpdated: "2026-05-26",
    headExtra: `<style>
      .support-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:28px;align-items:start;margin-top:28px}
      .support-form,.support-aside,.support-notice{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:24px;box-shadow:0 12px 32px rgba(16,24,40,.05)}
      .support-form label{display:block;font-weight:700;color:var(--text);margin-bottom:16px}
      .support-form input,.support-form select,.support-form textarea{width:100%;margin-top:7px;border:1px solid var(--border);border-radius:10px;background:var(--input);color:var(--text);padding:11px 12px;font:inherit;font-weight:500}
      .support-form textarea{resize:vertical;line-height:1.5}
      .support-hp{position:absolute!important;left:-10000px!important;width:1px!important;height:1px!important;opacity:0!important}
      .support-notice{margin:18px 0}.support-notice.success{border-color:rgba(61,220,132,.4);background:var(--green-dim);color:var(--green)}.support-notice.error{border-color:rgba(255,93,93,.4);background:var(--destructive-dim);color:var(--destructive)}
      .support-aside h2{font-size:18px;margin:0 0 10px}.support-aside h2+ul{margin-bottom:22px}.support-aside li{margin:0 0 10px;color:var(--text-dim)}
      @media(max-width:860px){.support-grid{grid-template-columns:1fr}.support-aside{order:-1}}
    </style>`,
  });
}
