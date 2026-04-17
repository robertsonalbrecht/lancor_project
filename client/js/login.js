'use strict';

(() => {
  const form = document.getElementById('login-form');
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        errEl.textContent = data.error || `Sign-in failed (${res.status})`;
        btn.disabled = false;
        btn.textContent = 'Sign in';
        return;
      }
      // Redirect to where the user was trying to go, or home.
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get('redirect') || '/';
      window.location.href = redirect;
    } catch (err) {
      errEl.textContent = 'Network error. Try again.';
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
})();
