import { renderPage } from "../lib/html-template.js";

export function renderSignupPage(baseUrl: string): string {
  const content = `
    <div style="min-height:60vh;display:flex;justify-content:center;align-items:center;padding:48px 24px;">
      <div class="card" style="max-width:440px;width:100%;">
        <h1 style="font-size:1.75em;margin-bottom:8px;">Create Account</h1>
        <p class="answer-capsule" style="margin-bottom:24px;">Sign up to manage your API keys and subscription.</p>

        <div id="error-msg" style="display:none;background:var(--destructive-dim);color:var(--destructive);padding:10px 14px;border-radius:var(--radius);margin-bottom:16px;font-size:14px;"></div>

        <form id="signup-form" style="display:flex;flex-direction:column;gap:16px;">
          <div>
            <label for="name" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Name <span style="color:var(--text-soft);">(optional)</span></label>
            <input type="text" id="name" name="name" autocomplete="name" placeholder="Your name"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label for="email" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Email</label>
            <input type="email" id="email" name="email" autocomplete="email" required placeholder="you@example.com"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label for="password" style="display:block;font-size:13px;color:var(--text-dim);margin-bottom:6px;">Password</label>
            <input type="password" id="password" name="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters"
              style="width:100%;padding:10px 14px;border-radius:var(--radius);border:1px solid var(--border2);background:var(--input);color:var(--text);font-size:14px;box-sizing:border-box;">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;margin-top:4px;" id="signup-btn">Create Account</button>
        </form>

        <p style="margin-top:20px;font-size:13px;color:var(--text-dim);text-align:center;">
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>

    <script>
      document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('signup-btn');
        const errEl = document.getElementById('error-msg');
        errEl.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Creating...';

        const name = document.getElementById('name').value.trim();
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        try {
          const res = await fetch('/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name: name || undefined }),
          });
          const data = await res.json();
          if (res.ok) {
            window.location.href = data.redirect || '/account';
          } else {
            errEl.textContent = data.error || 'Signup failed';
            errEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Create Account';
          }
        } catch (err) {
          errEl.textContent = 'Network error: ' + err.message;
          errEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      });
    </script>
  `;

  return renderPage({
    title: "Sign Up",
    description: "Create a Parse account to manage your API keys and subscription.",
    path: "/signup",
    content,
    baseUrl,
  });
}
