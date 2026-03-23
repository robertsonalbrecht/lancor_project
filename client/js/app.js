/* ── Lancor Search OS — app.js ────────────────────────────────────────────── */
/* Navigation controller, API utility, home overview                          */

'use strict';

// ── API utility ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Date formatter ────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString + (isoString.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return isoString;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

let currentModule = null;

function navigateTo(module) {
  currentModule = module;

  // Update active nav link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.module === module);
  });

  const content = document.getElementById('app-content');

  switch (module) {
    case 'playbooks':
      if (typeof renderPlaybooks === 'function') renderPlaybooks();
      break;
    case 'searches':
      if (typeof renderSearches === 'function') renderSearches();
      break;
    case 'pool':
      if (typeof renderPool === 'function') renderPool();
      break;
    case 'templates':
      if (typeof renderTemplates === 'function') renderTemplates();
      break;
    case 'settings':
      content.innerHTML = `
        <div class="module-placeholder">
          <div class="empty-state-icon">&#9881;</div>
          <h2>Settings</h2>
          <p>Settings panel coming in a future session.</p>
        </div>`;
      break;
    default:
      loadHome();
  }
}

// ── Home Overview ─────────────────────────────────────────────────────────────

async function loadHome() {
  currentModule = null;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading...</div>`;

  try {
    const stats = await api('GET', '/stats');

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    content.innerHTML = `
      <div class="home-header">
        <div>
          <h1>Good ${getTimeOfDay()}, Robby.</h1>
          <p class="home-tagline">Lancor Search OS &mdash; Executive Recruiting Workflow</p>
        </div>
        <span class="home-date">${dateStr}</span>
      </div>

      <div class="stats-grid">
        <div class="stat-card clickable" onclick="navigateTo('searches')" title="View Active Searches">
          <div class="stat-card-icon">&#128269;</div>
          <div class="stat-card-value">${stats.activeSearches}</div>
          <div class="stat-card-label">Active Searches</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('pool')" title="View Candidate Pool">
          <div class="stat-card-icon">&#128100;</div>
          <div class="stat-card-value">${stats.totalCandidates}</div>
          <div class="stat-card-label">Total Candidates</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('playbooks')" title="View Sector Playbooks">
          <div class="stat-card-icon">&#128218;</div>
          <div class="stat-card-value">${stats.playbooksBuilt}</div>
          <div class="stat-card-label">Sector Playbooks Built</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('templates')" title="View Templates">
          <div class="stat-card-icon">&#128196;</div>
          <div class="stat-card-value">${stats.totalTemplates}</div>
          <div class="stat-card-label">Templates Saved</div>
        </div>
      </div>

      <div class="home-section">
        <h2>Quick Actions</h2>
        <div class="quick-actions">
          <button class="btn btn-primary" onclick="navigateTo('searches')">
            &#128269; View Active Searches
          </button>
          <button class="btn btn-secondary" onclick="navigateTo('playbooks')">
            &#128218; Build Sector Playbook
          </button>
          <button class="btn btn-secondary" onclick="navigateTo('pool')">
            &#128100; Candidate Pool
          </button>
          <button class="btn btn-ghost" onclick="navigateTo('templates')">
            &#128196; Search Templates
          </button>
        </div>
      </div>

      <div class="home-section">
        <h2>System Status</h2>
        <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">Server running on port ${window.location.port || 3000}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">Data files loaded</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#ff9800;display:inline-block;"></span>
            <span class="text-sm">Session 2&ndash;6 modules pending</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `
      <div class="error-banner">Failed to load home: ${err.message}</div>
      <div class="home-section">
        <h2>Lancor Search OS</h2>
        <p class="text-muted">Could not reach the API. Make sure the server is running.</p>
      </div>`;
  }
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadHome();
});
