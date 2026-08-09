import { renderPage } from "../lib/html-template.js";

export function renderForgotPasswordPage(baseUrl: string): string {
  const content = `
    <div style="min-height:60vh;display:flex;justify-content:center;align-items:center;padding:48px 24px;">
      <div class="card" style="max-width:440px;width:100%;">
        <h1 style="font-size:1.75em;margin-bottom:8px;">Forgot Password</h1>
        <p class="answer-capsule" style="margin-bottom:24px;">If an account exists, a reset link will be sent to your email.</p>

        <div id="error-msg" style="display:none;background:var(--destructive-dim);color:var(--destructive);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:14px;"></div>
        <div id="success-msg" style="display:none;background:var(--green-dim);color:var(--green);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:14px;"></div>

        <form id="forgot-form" style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <label for="email" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Email</label>
            <input type="email" id="email" name="email" autocomplete="email" required placeholder="you@example.com"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:4px;" id="forgot-btn">Send Reset Link</button>
        </form>

        <p style="margin-top:20px;font-size:13px;color:var(--text-dim);text-align:center;">
          Remembered your password? <a href="/login">Log in</a>
        </p>
      </div>
    </div>

    <script>
      document.getElementById('forgot-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('forgot-btn');
        const errEl = document.getElementById('error-msg');
        const okEl = document.getElementById('success-msg');
        errEl.style.display = 'none';
        okEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Sending...';

        const email = document.getElementById('email').value.trim();

        try {
          const res = await fetch('/auth/forgot-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
          // Always show success message to prevent email enumeration
          okEl.textContent = 'If an account exists for that email, a reset link has been sent.';
          okEl.style.display = 'block';
          btn.textContent = 'Sent';
          document.getElementById('email').value = '';
        } catch (err) {
          errEl.textContent = 'Network error: ' + err.message;
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Send Reset Link';
        }
      });
    </script>
  `;

  return renderPage({
    title: "Forgot Password",
    description: "Reset your Parse account password.",
    path: "/forgot-password",
    content,
    baseUrl,
  });
}
