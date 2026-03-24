/* ── Lancor Search OS — app.js ────────────────────────────────────────────── */
/* Navigation controller, API utility, home overview                          */

'use strict';

// ── Firm name normalization (shared across modules) ───────────────────────────

function normalizeFirmName(name) {
  if (!name) return '';
  return name
    .replace(/\s*·\s*(Full-time|Part-time|Contract|Seasonal|Internship|Self-employed|Freelance)/gi, '')
    .replace(/\s*\(.*?\)\s*/g, '')  // strip parenthetical like (GCI)
    .trim()
    .toLowerCase();
}

function firmNamesMatch(a, b) {
  const na = normalizeFirmName(a);
  const nb = normalizeFirmName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Check if one contains the other (handles "Graham Partners" vs "Graham Partners LLC")
  if (na.length >= 4 && nb.length >= 4) {
    return na.includes(nb) || nb.includes(na);
  }
  return false;
}

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

// ── Navigation History ────────────────────────────────────────────────────────
let _navHistory = ['home'];
let _navIndex = 0;
let _navFromHistory = false;

function navGoHome() {
  navigateTo(null);
}
function navGoBack() {
  if (_navIndex > 0) {
    _navIndex--;
    _navFromHistory = true;
    const target = _navHistory[_navIndex];
    navigateTo(target === 'home' ? null : target);
  }
}
function navGoForward() {
  if (_navIndex < _navHistory.length - 1) {
    _navIndex++;
    _navFromHistory = true;
    const target = _navHistory[_navIndex];
    navigateTo(target === 'home' ? null : target);
  }
}

function navigateTo(module) {
  currentModule = module;

  // Track navigation history
  const entry = module || 'home';
  if (!_navFromHistory) {
    // Trim forward history and push new entry
    _navHistory = _navHistory.slice(0, _navIndex + 1);
    if (_navHistory[_navHistory.length - 1] !== entry) {
      _navHistory.push(entry);
      _navIndex = _navHistory.length - 1;
    }
  }
  _navFromHistory = false;

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
    case 'companies':
      if (typeof renderCompanies === 'function') renderCompanies();
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

// ── Candidate Profile Panel (slide-in from right) ─────────────────────────────

function closeCandidatePanel() {
  const panel = document.getElementById('candidate-panel-overlay');
  if (panel) panel.remove();
}

async function openCandidatePanel(candidateId) {
  closeCandidatePanel();
  // Try fetching by candidate_id first
  let candidate;
  try {
    candidate = await api('GET', '/candidates/' + encodeURIComponent(candidateId));
  } catch (e) {
    // If not found by ID, search by name
    try {
      const resp = await api('GET', '/candidates');
      candidate = (resp.candidates || []).find(c =>
        c.candidate_id === candidateId || c.name === candidateId
      );
    } catch (e2) { /* ignore */ }
  }
  if (!candidate) { alert('Candidate not found.'); return; }
  renderCandidatePanel(candidate);
}

function _escPanel(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCandidatePanel(c) {
  const overlay = document.createElement('div');
  overlay.id = 'candidate-panel-overlay';
  overlay.className = 'cand-panel-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCandidatePanel(); });

  const linkedinBtn = c.linkedin_url
    ? `<a href="${_escPanel(c.linkedin_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="color:#0077B5;display:inline-flex;align-items:center;gap:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> LinkedIn</a>`
    : '';

  const sectorPills = (c.sector_tags || []).map(t => {
    const labels = {'industrials':'Industrials','technology-software':'Technology','healthcare':'Healthcare','financial-services':'Financial Services','consumer':'Consumer','business-services':'Business Services','infrastructure-energy':'Infrastructure','life-sciences':'Life Sciences','media-entertainment':'Media','real-estate-proptech':'Real Estate','agriculture-fb':'Agriculture'};
    return `<span style="background:#EDE7F6;color:#5C2D91;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${labels[t]||t}</span>`;
  }).join('');

  const rating = c.quality_rating != null
    ? `<span style="color:#ff9800;font-size:14px">${'★'.repeat(c.quality_rating)}${'☆'.repeat(3-c.quality_rating)}</span>`
    : `<span style="color:#ccc;font-size:12px">Unrated</span>`;

  const workHistory = (c.work_history || []).map(w => {
    const isCurrent = (w.dates || '').toLowerCase().includes('present');
    return `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0;${isCurrent ? 'background:#f8fdf8;margin:0 -16px;padding-left:16px;padding-right:16px;' : ''}">
      <div style="width:6px;border-radius:3px;background:${isCurrent ? '#4caf50' : '#e0e0e0'};flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:13px;color:#1a1a1a">${_escPanel(w.title || '')}</div>
        <div style="font-size:12px;color:#5C2D91;margin-top:1px">${_escPanel(w.company || '')}</div>
        ${w.dates ? `<div style="font-size:11px;color:#999;margin-top:2px">${_escPanel(w.dates)}${w.duration ? ' · ' + _escPanel(w.duration) : ''}</div>` : ''}
        ${w.description ? `<div style="font-size:12px;color:#666;margin-top:4px;line-height:1.5">${_escPanel(w.description)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const searchHistory = (c.search_history || []).map(h =>
    `<div style="padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:12px">
      <span style="font-weight:600">${_escPanel(h.client_name || h.search_id)}</span>
      <span style="color:#888;margin-left:6px">Stage: ${_escPanel(h.stage_reached || '—')}</span>
      ${h.outcome ? `<span style="color:#888;margin-left:6px">· ${_escPanel(h.outcome)}</span>` : ''}
    </div>`
  ).join('') || '<div style="color:#bbb;font-size:12px">No search history</div>';

  const dqReasons = (c.dq_reasons || []).filter(d => d.reason).map(d =>
    `<div style="padding:4px 0;font-size:12px;color:#c62828">${_escPanel(d.reason)} <span style="color:#999">(${_escPanel(d.search_id)})</span></div>`
  ).join('');

  overlay.innerHTML = `
    <div class="cand-panel">
      <div class="cand-panel-header">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:1.2rem;font-weight:800;margin:0 0 2px;color:#1a1a1a">${_escPanel(c.name)}</h2>
          <div style="font-size:13px;color:#555">${_escPanel(c.current_title || '')}${c.current_firm ? ' @ ' + _escPanel(c.current_firm) : ''}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${_escPanel(c.home_location || c.location || '')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
          ${linkedinBtn}
          <button class="cand-panel-close" onclick="closeCandidatePanel()">&#10005;</button>
        </div>
      </div>

      <div class="cand-panel-body">
        <!-- Quick info -->
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">
          ${c.archetype ? `<span style="background:#f3e8ff;color:#7c3aed;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${_escPanel(c.archetype)}</span>` : ''}
          ${c.availability ? `<span style="background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${_escPanel(c.availability)}</span>` : ''}
          ${rating}
        </div>

        ${sectorPills ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px">${sectorPills}</div>` : ''}

        <!-- Details grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px;margin-bottom:20px;padding:12px;background:#f9f9f9;border-radius:8px">
          ${c.firm_size_tier ? `<div><span style="color:#888">Firm Size:</span> ${_escPanel(c.firm_size_tier)}</div>` : ''}
          ${c.company_revenue_tier ? `<div><span style="color:#888">Revenue Tier:</span> ${_escPanel(c.company_revenue_tier)}</div>` : ''}
          ${c.operator_background ? `<div><span style="color:#888">Background:</span> ${_escPanel(Array.isArray(c.operator_background) ? c.operator_background.join(', ') : c.operator_background)}</div>` : ''}
          ${c.owned_pl ? `<div><span style="color:#888">Owned P&L:</span> Yes</div>` : ''}
          ${c.last_contact_date ? `<div><span style="color:#888">Last Contact:</span> ${_escPanel(c.last_contact_date)}</div>` : ''}
          ${c.date_added ? `<div><span style="color:#888">Added:</span> ${_escPanel(c.date_added)}</div>` : ''}
        </div>

        <!-- Work History -->
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Work History (${(c.work_history||[]).length})</div>
          ${workHistory || '<div style="color:#bbb;font-size:12px">No work history available</div>'}
        </div>

        <!-- Search History -->
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Search History</div>
          ${searchHistory}
        </div>

        ${dqReasons ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">DQ Reasons</div>
          ${dqReasons}
        </div>` : ''}

        <!-- Notes -->
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Notes</div>
          <div style="font-size:12px;color:#444;white-space:pre-wrap;line-height:1.5">${_escPanel(c.notes || 'No notes')}</div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.addEventListener('keydown', _candidatePanelEsc);
}

function _candidatePanelEsc(e) {
  if (e.key === 'Escape') { closeCandidatePanel(); document.removeEventListener('keydown', _candidatePanelEsc); }
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
        <div class="stat-card clickable" onclick="navigateTo('companies')" title="View Company Pool">
          <div class="stat-card-icon">&#127970;</div>
          <div class="stat-card-value">${stats.totalCompanies || 0}</div>
          <div class="stat-card-label">Companies in Pool</div>
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
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">All modules complete &mdash; Session 7+ for iterations</span>
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
