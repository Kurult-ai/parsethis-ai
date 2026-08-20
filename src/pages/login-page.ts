import { renderPage } from "../lib/html-template.js";

export function renderLoginPage(baseUrl: string, error?: string): string {
  const errorHtml = error
    ? `<div style="background:var(--destructive-dim);color:var(--destructive);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:14px;">${escapeHtml(error)}</div>`
    : "";

  const content = `
    <div style="min-height:60vh;display:flex;justify-content:center;align-items:center;padding:48px 24px;">
      <div class="card" style="max-width:440px;width:100%;">
        <h1 style="font-size:1.75em;margin-bottom:8px;">Log In</h1>
        <p class="answer-capsule" style="margin-bottom:24px;">Access your Parse account dashboard.</p>

        ${errorHtml}

        <div id="error-msg" style="display:none;background:var(--destructive-dim);color:var(--destructive);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:14px;"></div>

        <form id="login-form" style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <label for="email" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Email</label>
            <input type="email" id="email" name="email" autocomplete="email" required placeholder="you@example.com"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label for="password" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Password</label>
            <input type="password" id="password" name="password" autocomplete="current-password" required placeholder="Your password"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:4px;" id="login-btn">Log In</button>
        </form>

        <div style="margin-top:20px;font-size:13px;color:var(--text-dim);text-align:center;display:flex;flex-direction:column;gap:8px;">
          <p>Don't have an account? <a href="/signup">Sign up</a></p>
          <p><a href="/forgot-password">Forgot password?</a></p>
        </div>
      </div>
    </div>

    <script>
      document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('login-btn');
        const errEl = document.getElementById('error-msg');
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Logging in...';

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        try {
          const res = await fetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const data = await res.json();
          if (res.ok) {
            window.location.href = data.redirect || '/account';
          } else {
            errEl.textContent = data.error || 'Login failed';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Log In';
          }
        } catch (err) {
          errEl.textContent = 'Network error: ' + err.message;
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Log In';
        }
      });
    </script>
  `;

  return renderPage({
    title: "Log In",
    description: "Log in to your Parse account.",
    path: "/login",
    content,
    baseUrl,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
