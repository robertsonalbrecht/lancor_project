/* global api, escapeHtml, appAlert */
'use strict';

// ── Settings ───────────────────────────────────────────────────────────────

let _adminUsers = [];

async function renderSettings() {
  const content = document.getElementById('app-content');
  const user = window.CURRENT_USER;
  const isAdmin = user && user.role === 'admin';

  const accountCard = `
    <div class="settings-card">
      <h2>Account</h2>
      <div class="settings-kv">
        <div><span class="settings-k">Name</span><span class="settings-v">${user ? escapeHtml(user.firstName + ' ' + user.lastName) : '—'}</span></div>
        <div><span class="settings-k">Email</span><span class="settings-v">${user ? escapeHtml(user.email) : '—'}</span></div>
        <div><span class="settings-k">Role</span><span class="settings-v">${user ? escapeHtml(roleLabel(user.role)) : '—'}</span></div>
      </div>
      <div style="margin-top:14px">
        <button class="btn btn-primary" onclick="adminOpenChangePassword()">Change my password</button>
      </div>
    </div>
  `;

  const userMgmtCard = isAdmin ? `
    <div class="settings-card">
      <div class="admin-header" style="margin-bottom:16px">
        <h2 style="margin:0">User Management</h2>
        <button class="btn btn-primary" onclick="adminOpenNewUser()">+ New User</button>
      </div>
      <div id="admin-users-table"></div>
    </div>
  ` : '';

  content.innerHTML = `
    <div class="settings-page">
      <div class="settings-header"><h1>Settings</h1></div>
      ${accountCard}
      ${userMgmtCard}
    </div>
  `;

  if (isAdmin) await loadAdminUsers();
}

async function loadAdminUsers() {
  const container = document.getElementById('admin-users-table');
  container.innerHTML = '<div class="loading"><div class="spinner"></div> Loading users...</div>';
  try {
    const { users } = await api('GET', '/users');
    _adminUsers = users;
    renderAdminTable();
  } catch (err) {
    container.innerHTML = `<div class="error-banner">Failed to load users: ${escapeHtml(err.message)}</div>`;
  }
}

function renderAdminTable() {
  const container = document.getElementById('admin-users-table');
  if (_adminUsers.length === 0) {
    container.innerHTML = '<div class="empty-state">No users yet.</div>';
    return;
  }

  const rows = _adminUsers.map(renderAdminRow).join('');
  container.innerHTML = `
    <table class="admin-users-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Role</th>
          <th>Status</th>
          <th>Last login</th>
          <th>Searches</th>
          <th>Sessions</th>
          <th class="admin-actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderAdminRow(u) {
  const me = window.CURRENT_USER && window.CURRENT_USER.id === u.id;
  const roleOptions = ['admin', 'consultant', 'analyst'].map(r =>
    `<option value="${r}" ${r === u.role ? 'selected' : ''}>${escapeHtml(roleLabel(r))}</option>`
  ).join('');
  const statusClass = u.is_active ? 'pill pill-active' : 'pill pill-closed';
  const statusLabel = u.is_active ? 'Active' : 'Deactivated';
  const lastLogin = u.last_login_at ? formatDate(u.last_login_at) : 'Never';

  return `
    <tr data-user-id="${u.id}">
      <td>
        <div class="admin-user-cell">
          <span class="admin-initials">${escapeHtml(u.initials)}</span>
          <div>
            <div class="admin-name">${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)} ${me ? '<span class="admin-you">(you)</span>' : ''}</div>
            <div class="admin-email">${escapeHtml(u.email)}</div>
          </div>
        </div>
      </td>
      <td>
        <select class="form-control admin-role-select" onchange="adminChangeRole('${u.id}', this.value)">
          ${roleOptions}
        </select>
      </td>
      <td><span class="${statusClass}">${statusLabel}</span></td>
      <td>${escapeHtml(lastLogin)}</td>
      <td>${u.owned_searches}</td>
      <td>${u.active_sessions}</td>
      <td class="admin-actions-col">
        <button class="btn-icon" title="Reset password" onclick="adminResetPassword('${u.id}')">🔑</button>
        <button class="btn-icon" title="Revoke all sessions" onclick="adminRevokeSessions('${u.id}')" ${u.active_sessions === 0 ? 'disabled' : ''}>⎋</button>
        ${u.is_active
          ? `<button class="btn-icon" title="Deactivate" onclick="adminToggleActive('${u.id}', false)" ${me ? 'disabled' : ''}>🚫</button>`
          : `<button class="btn-icon" title="Reactivate" onclick="adminToggleActive('${u.id}', true)">✓</button>`}
      </td>
    </tr>
  `;
}

function roleLabel(r) {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

async function adminChangeRole(userId, newRole) {
  try {
    await api('PATCH', '/users/' + userId, { role: newRole });
    appAlert('Role updated.', { type: 'success' });
    await loadAdminUsers();
  } catch (err) {
    appAlert('Failed: ' + err.message, { type: 'error' });
    await loadAdminUsers();
  }
}

async function adminToggleActive(userId, makeActive) {
  const verb = makeActive ? 'reactivate' : 'deactivate';
  if (!confirm(`Are you sure you want to ${verb} this user?${!makeActive ? ' All their sessions will be revoked.' : ''}`)) return;
  try {
    await api('PATCH', '/users/' + userId, { is_active: makeActive });
    appAlert('User ' + (makeActive ? 'reactivated.' : 'deactivated.'), { type: 'success' });
    await loadAdminUsers();
  } catch (err) {
    appAlert('Failed: ' + err.message, { type: 'error' });
  }
}

async function adminRevokeSessions(userId) {
  if (!confirm('Revoke all active sessions for this user? They will be signed out immediately on all devices.')) return;
  try {
    const { revoked } = await api('POST', '/users/' + userId + '/revoke-sessions');
    appAlert(`Revoked ${revoked} session(s).`, { type: 'success' });
    await loadAdminUsers();
  } catch (err) {
    appAlert('Failed: ' + err.message, { type: 'error' });
  }
}

async function adminResetPassword(userId) {
  const pw = prompt('Enter a new password for this user (12+ chars, one upper, one lower, one digit):');
  if (!pw) return;
  try {
    await api('POST', '/users/' + userId + '/reset-password', { password: pw });
    appAlert('Password reset. All existing sessions for this user have been revoked — share the new password with them directly and ask them to rotate it.', { type: 'success' });
    await loadAdminUsers();
  } catch (err) {
    appAlert('Failed: ' + err.message, { type: 'error' });
  }
}

function adminOpenNewUser() {
  const wrap = document.createElement('div');
  wrap.className = 'admin-modal-backdrop';
  wrap.innerHTML = `
    <div class="admin-modal">
      <h2>Create User</h2>
      <form id="admin-new-user-form">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input id="nu-email" class="form-control" type="email" required>
        </div>
        <div class="form-group" style="display:flex;gap:12px">
          <div style="flex:1"><label class="form-label">First name</label><input id="nu-first" class="form-control" required></div>
          <div style="flex:1"><label class="form-label">Last name</label><input id="nu-last" class="form-control" required></div>
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <select id="nu-role" class="form-control">
            <option value="consultant" selected>Consultant</option>
            <option value="analyst">Analyst</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Initial password (12+, mixed case, digit)</label>
          <input id="nu-password" class="form-control" type="text" required>
          <div class="form-hint">Share this with the new user directly. They should change it on first login.</div>
        </div>
        <div id="nu-error" class="login-error"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button type="button" class="btn btn-ghost" onclick="this.closest('.admin-modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">Create</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  document.getElementById('admin-new-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('nu-error');
    errEl.textContent = '';
    const body = {
      email: document.getElementById('nu-email').value.trim(),
      first_name: document.getElementById('nu-first').value.trim(),
      last_name: document.getElementById('nu-last').value.trim(),
      role: document.getElementById('nu-role').value,
      password: document.getElementById('nu-password').value
    };
    try {
      await api('POST', '/users', body);
      wrap.remove();
      appAlert('User created.', { type: 'success' });
      await loadAdminUsers();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}

function adminOpenChangePassword() {
  const wrap = document.createElement('div');
  wrap.className = 'admin-modal-backdrop';
  wrap.innerHTML = `
    <div class="admin-modal">
      <h2>Change My Password</h2>
      <form id="admin-change-pw-form">
        <div class="form-group">
          <label class="form-label">Current password</label>
          <input id="cp-current" class="form-control" type="password" autocomplete="current-password" required>
        </div>
        <div class="form-group">
          <label class="form-label">New password</label>
          <input id="cp-next" class="form-control" type="password" autocomplete="new-password" required>
          <div class="form-hint">12+ characters, mixed case, at least one digit.</div>
        </div>
        <div id="cp-error" class="login-error"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">
          <button type="button" class="btn btn-ghost" onclick="this.closest('.admin-modal-backdrop').remove()">Cancel</button>
          <button type="submit" class="btn btn-primary">Change password</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  document.getElementById('admin-change-pw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('cp-error');
    errEl.textContent = '';
    try {
      await api('POST', '/auth/change-password', {
        current_password: document.getElementById('cp-current').value,
        new_password: document.getElementById('cp-next').value
      });
      wrap.remove();
      appAlert('Password changed. Other sessions have been signed out.', { type: 'success' });
    } catch (err) {
      errEl.textContent = err.message;
    }
  });
}
