/* ── Lancor Search OS — Sector Playbooks Module (Session 2) ─────────────── */
'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_ROSTER_DEFAULTS = {
  'Mega': 22,
  'Large': 11,
  'Middle Market': 6,
  'Lower Middle Market': 3
};

const REVENUE_ROSTER_DEFAULTS = {
  'Large Cap': 18,
  'Upper Middle': 10,
  'Middle Market': 5,
  'Lower Middle': 2
};

const ROSTER_STATUSES = [
  'Identified',
  'Outreach sent',
  'Responded',
  'In pipeline',
  'In pursuit',
  'Placed',
  'DQ this search',
  'DQ permanent',
  'NI',
  'NI permanent'
];

const COVERAGE_BANDS = [
  { min: 0,   max: 0,   cls: 'unsearched', label: 'Unsearched',      color: '#9e9e9e' },
  { min: 1,   max: 25,  cls: 'low',        label: 'Low',             color: '#ef5350' },
  { min: 26,  max: 55,  cls: 'moderate',   label: 'Moderate',        color: '#ff9800' },
  { min: 56,  max: 85,  cls: 'good',       label: 'Good',            color: '#4caf50' },
  { min: 86,  max: 999, cls: 'high',       label: 'High',            color: '#009688' }
];

// ── State ─────────────────────────────────────────────────────────────────────

let _currentSector = null;        // full sector object in memory
let _currentFirmId = null;        // firm_id when viewing firm detail page
let _rosterTitles  = [             // persisted title options for the roster add forms
  'Operating Partner','Managing Partner','Managing Advisor','Managing Director',
  'Operating Executive','Partner','Principal','Senior Director','Director',
  'Senior Vice President','Manager','Vice President','Senior Associate','Associate','Analyst'
];
let _activeTab = 'pe-firms';      // 'pe-firms' | 'target-companies' | 'allstar'
let _openAccordionId = null;      // company_id currently expanded (companies tab only)
let _addFirmFormOpen = false;
let _addCompanyFormOpen = false;

// Filter state
let _firmFilters = { sizeTier: 'All', strategy: 'All', sectorFocus: 'All', search: '' };
let _companyFilters = { revenueTier: 'All', ownershipType: 'All', search: '' };
let _allstarFilters = { archetype: 'All', rating: 'All', availability: 'All', search: '' };

// ── Coverage Helpers ──────────────────────────────────────────────────────────

function getCoverageInfo(entity, isCompany) {
  // Manual complete overrides everything
  if (entity.roster_completeness === 'manual-complete') {
    return { pct: 100, cls: 'complete', label: 'Manual Complete', color: '#6B2D5B', fillWidth: 100 };
  }
  const defaults = isCompany ? REVENUE_ROSTER_DEFAULTS : TIER_ROSTER_DEFAULTS;
  const rosterSize = entity.custom_roster_size != null
    ? entity.custom_roster_size
    : (isCompany ? defaults[entity.revenue_tier] : defaults[entity.size_tier]) || entity.expected_roster_size || 1;

  const roster = entity.roster || [];
  const pct = rosterSize > 0 ? Math.min(100, Math.round(roster.length / rosterSize * 100)) : 0;

  for (const band of COVERAGE_BANDS) {
    if (pct >= band.min && pct <= band.max) {
      return { pct, cls: band.cls, label: band.label, color: band.color, fillWidth: pct };
    }
  }
  return { pct, cls: 'high', label: 'High', color: '#009688', fillWidth: Math.min(pct, 100) };
}

function coverageBarHTML(cov) {
  return `
    <div class="coverage-bar-container">
      <div class="coverage-bar">
        <div class="coverage-bar-fill" style="width:${cov.fillWidth}%;background:${cov.color};"></div>
      </div>
      <span class="coverage-pct-label" style="color:${cov.color};">${cov.pct}%</span>
      <span class="badge-coverage badge-${cov.cls}">${cov.label}</span>
    </div>`;
}

// ── Build-status badge HTML ───────────────────────────────────────────────────

function buildStatusBadge(status) {
  if (status === 'built')   return '<span class="pill pill-active">Built</span>';
  if (status === 'partial') return '<span class="pill pill-partial">Partial</span>';
  return '<span class="pill pill-pending">Not yet built</span>';
}

// ── Pill helpers ──────────────────────────────────────────────────────────────

function sizeTierPill(tier) {
  const map = {
    'Mega': 'tier-mega',
    'Large': 'tier-large',
    'Middle Market': 'tier-mid',
    'Lower Middle Market': 'tier-small'
  };
  return `<span class="tier-badge ${map[tier] || 'tier-micro'}">${tier}</span>`;
}

function genericPill(text, colorClass) {
  return `<span class="pill ${colorClass || ''}" style="background:#F3E8EF;color:#6B2D5B;border:1px solid #ce93d8;">${text}</span>`;
}

// ── Entity type badge ─────────────────────────────────────────────────────────

function entityTypeBadge(entityType) {
  const cfg = {
    'Growth Equity Firm':         { label: 'Growth Equity',    bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    'Venture Capital Firm':       { label: 'Venture',          bg: '#F3E8EF', color: '#6B2D5B', border: '#ce93d8' },
    'Credit / Distressed Firm':   { label: 'Credit / Distressed', bg: '#ffebee', color: '#c62828', border: '#ef9a9a' },
    'Asset Manager with PE Wing': { label: 'Multi-Strategy',   bg: '#fff8e1', color: '#e65100', border: '#ffcc80' },
    'PE Division of Larger Firm': { label: 'PE Division',      bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    'Infrastructure Fund':        { label: 'Infrastructure',   bg: '#e0f2f1', color: '#00695c', border: '#80cbc4' },
    'Impact / ESG Fund':          { label: 'Impact / ESG',     bg: '#f1f8e9', color: '#33691e', border: '#aed581' },
    'Family Office':              { label: 'Family Office',    bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' },
    'Secondary Fund':             { label: 'Secondary',        bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' },
    'Real Estate Fund':           { label: 'Real Estate',      bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' },
    'Fund of Funds':              { label: 'Fund of Funds',    bg: '#f5f5f5', color: '#616161', border: '#bdbdbd' },
  };
  // "Dedicated PE Firm" gets no badge (majority case)
  if (!entityType || entityType === 'Dedicated PE Firm') return '';
  const c = cfg[entityType];
  if (!c) return '';
  return `<span style="display:inline-block;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;background:${c.bg};color:${c.color};border:1px solid ${c.border};margin-left:5px;vertical-align:middle;">${c.label}</span>`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Persist to API ────────────────────────────────────────────────────────────

async function saveSector(sector) {
  try {
    const updated = await api('PUT', `/playbooks/${sector.sector_id}`, sector);
    _currentSector = updated;
    return updated;
  } catch (err) {
    appAlert('Save failed: ' + err.message, { type: 'error' });
    throw err;
  }
}

// ── Cross-module navigation from Company Pool ─────────────────────────────────

async function openFirmInPlaybook(firmId, sectorId) {
  // Update nav state without triggering full renderPlaybooks re-render
  currentModule = 'playbooks';
  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.module === 'playbooks');
  });
  // Load the sector and open the firm detail directly
  await renderSectorDetail(sectorId);
  _renderFirmDetail(firmId);
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

async function renderPlaybooks() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading playbooks…</div>`;

  try {
    const data = await api('GET', '/playbooks/summary');
    _rosterTitles = data.roster_titles || [];
    const sectors = data.sectors || [];
    renderSectorGrid(sectors);
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load playbooks: ${err.message}</div>`;
  }
}

// ── SECTOR GRID ───────────────────────────────────────────────────────────────

function renderSectorGrid(sectors) {
  const content = document.getElementById('app-content');
  const cards = sectors.map(s => {
    const peFirmCount = s.pe_firm_count != null ? s.pe_firm_count : (s.pe_firms || []).length;
    const companyCount = s.target_company_count != null ? s.target_company_count : (s.target_companies || []).length;
    const allstarCount = (s.allstar_pool || []).length;
    return `
      <div class="sector-card" onclick="renderSectorDetail('${s.sector_id}')">
        <div class="sector-card-header">
          <span class="sector-card-name">${s.sector_name}</span>
          ${buildStatusBadge(s.build_status)}
        </div>
        <div class="sector-stats">
          <span class="sector-stat"><strong>${peFirmCount}</strong> PE Firms</span>
          <span class="sector-stat"><strong>${companyCount}</strong> Companies</span>
          <span class="sector-stat"><strong>${allstarCount}</strong> All-Stars</span>
        </div>
      </div>`;
  }).join('');

  content.innerHTML = `
    <div class="page-header">
      <h1>Sector Playbooks</h1>
      <p class="page-subtitle">12 sectors tracked — click any card to open the playbook</p>
    </div>
    <div class="sector-grid">${cards}</div>`;
}

// ── SECTOR DETAIL ─────────────────────────────────────────────────────────────

async function renderSectorDetail(sectorId) {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading…</div>`;

  // Reset state for new sector
  _activeTab = 'pe-firms';
  _openAccordionId = null;
  _addFirmFormOpen = false;
  _addCompanyFormOpen = false;
  _firmFilters = { sizeTier: 'All', strategy: 'All', sectorFocus: 'All', search: '' };
  _companyFilters = { revenueTier: 'All', ownershipType: 'All', search: '' };
  _allstarFilters = { archetype: 'All', rating: 'All', availability: 'All', search: '' };

  try {
    const sector = await api('GET', `/playbooks/${sectorId}`);
    _currentSector = sector;
    _paintSectorDetail();
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load sector: ${err.message}</div>`;
  }
}

function _paintSectorDetail() {
  const s = _currentSector;
  const content = document.getElementById('app-content');

  // Build All-Star Playbook section
  const topFirms = (s.top_pe_firms || []).map(id => (s.pe_firms || []).find(f => f.firm_id === id)).filter(Boolean);
  const topCompanies = (s.top_companies || []).map(id => (s.target_companies || []).find(c => c.company_id === id)).filter(Boolean);

  const topFirmsHTML = topFirms.length === 0
    ? `<p style="color:#aaa;font-size:13px;padding:12px 0">No top firms ranked yet.</p>`
    : topFirms.map((f, i) => {
        const cov = getCoverageInfo(f);
        const sizePill = f.size_tier ? `<span style="background:#F3E8EF;color:#6B2D5B;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">${escapeHtml(f.size_tier)}</span>` : '';
        const tagBadge = f.is_specialist
          ? `<span style="background:#fff8e1;color:#f57f17;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700">&#9733; Specialist</span>`
          : '';
        return `<div draggable="true" data-id="${escapeHtml(f.firm_id)}" data-type="pe"
          ondragstart="_topDragStart(event)" ondragover="_topDragOver(event)" ondrop="_topDrop(event)" ondragend="_topDragEnd(event)"
          style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid #f0f0f0;transition:background 0.15s;cursor:grab" onmouseover="this.style.background='#faf6f9'" onmouseout="this.style.background=''">
          <span style="color:#ccc;font-size:10px;cursor:grab;user-select:none">&#9776;</span>
          <span style="font-weight:700;color:#999;width:20px;text-align:right;font-size:11px">${i + 1}</span>
          <span style="font-weight:600;font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" onclick="_openFirmDetail('${escapeHtml(f.firm_id)}')">${escapeHtml(f.name)}</span>
          ${sizePill} ${tagBadge}
          <span style="font-size:11px;color:#888;width:36px;text-align:right">${cov.pct}%</span>
          <button onclick="event.stopPropagation();_removeFromTopList('pe','${escapeHtml(f.firm_id)}')" title="Remove" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:14px;padding:0 4px;line-height:1" onmouseover="this.style.color='#c62828'" onmouseout="this.style.color='#ccc'">&#10005;</button>
        </div>`;
      }).join('');

  const topCompaniesHTML = topCompanies.length === 0
    ? `<p style="color:#aaa;font-size:13px;padding:12px 0">No top companies yet.</p>`
    : topCompanies.map((c, i) => {
        return `<div draggable="true" data-id="${escapeHtml(c.company_id)}" data-type="company"
          ondragstart="_topDragStart(event)" ondragover="_topDragOver(event)" ondrop="_topDrop(event)" ondragend="_topDragEnd(event)"
          style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #f0f0f0;transition:background 0.15s;cursor:grab" onmouseover="this.style.background='#faf6f9'" onmouseout="this.style.background=''">
          <span style="color:#ccc;font-size:10px;cursor:grab;user-select:none">&#9776;</span>
          <span style="font-weight:700;color:#999;width:20px;text-align:right;font-size:11px">${i + 1}</span>
          <span style="font-weight:600;font-size:13px;flex:1">${escapeHtml(c.name)}</span>
          <span style="color:#666;font-size:11px">${escapeHtml(c.hq || '')}</span>
          <span style="color:#888;font-size:11px">${escapeHtml(c.revenue_tier || '')}</span>
          <button onclick="event.stopPropagation();_removeFromTopList('company','${escapeHtml(c.company_id)}')" title="Remove" style="background:none;border:none;color:#ccc;cursor:pointer;font-size:14px;padding:0 4px;line-height:1" onmouseover="this.style.color='#c62828'" onmouseout="this.style.color='#ccc'">&#10005;</button>
        </div>`;
      }).join('');

  content.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
      <button class="btn btn-ghost btn-sm" onclick="renderPlaybooks()">&#8592; Sector Playbooks</button>
      <div style="flex:1;">
        <h1 style="display:inline;margin-right:12px;">${escapeHtml(s.sector_name)}</h1>
        ${buildStatusBadge(s.build_status)}
        <span class="text-muted text-sm" style="margin-left:12px;">Updated ${formatDate(s.last_updated)}</span>
      </div>
    </div>

    <!-- All-Star Playbook -->
    <div style="margin-bottom:24px;border:2px solid #F3E8EF;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#6B2D5B,#8B4D7B);padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
        <h2 style="margin:0;color:#fff;font-size:16px;font-weight:700">All-Star Playbook</h2>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="color:rgba(255,255,255,0.7);font-size:12px">Top firms and companies to prioritize for search kickoffs</span>
          <button onclick="_addPlaybookToSearch('${escapeHtml(s.sector_id)}')" class="btn btn-ghost btn-sm" style="color:#fff;border-color:rgba(255,255,255,0.3);font-size:11px;white-space:nowrap">Add to Search &rarr;</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
        <div style="border-right:1px solid #f0f0f0">
          <div style="padding:8px 12px;background:#faf6f9;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #F3E8EF">
            <span style="font-weight:700;font-size:12px;color:#6B2D5B;text-transform:uppercase;letter-spacing:0.5px">Top ${topFirms.length} PE Firms</span>
            <button onclick="_showAddToTopList('pe')" class="btn btn-ghost" style="font-size:11px;padding:2px 8px;color:#6B2D5B">+ Add Firm</button>
          </div>
          <div id="allstar-add-pe" style="display:none;padding:8px 12px;background:#faf8ff;border-bottom:1px solid #F3E8EF">
            <div style="display:flex;gap:6px">
              <input id="allstar-pe-search" type="text" placeholder="Search PE firms..." style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:12px" oninput="_filterAddToTopList('pe')">
            </div>
            <div id="allstar-pe-results" style="max-height:200px;overflow-y:auto;margin-top:6px"></div>
          </div>
          <div style="max-height:500px;overflow-y:auto">${topFirmsHTML}</div>
        </div>
        <div>
          <div style="padding:8px 12px;background:#faf6f9;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #F3E8EF">
            <span style="font-weight:700;font-size:12px;color:#6B2D5B;text-transform:uppercase;letter-spacing:0.5px">Top ${topCompanies.length} Companies</span>
            <button onclick="_showAddToTopList('company')" class="btn btn-ghost" style="font-size:11px;padding:2px 8px;color:#6B2D5B">+ Add Company</button>
          </div>
          <div id="allstar-add-company" style="display:none;padding:8px 12px;background:#faf8ff;border-bottom:1px solid #F3E8EF">
            <div style="display:flex;gap:6px">
              <input id="allstar-company-search" type="text" placeholder="Search companies..." style="flex:1;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font-size:12px" oninput="_filterAddToTopList('company')">
            </div>
            <div id="allstar-company-results" style="max-height:200px;overflow-y:auto;margin-top:6px"></div>
          </div>
          <div style="max-height:500px;overflow-y:auto">${topCompaniesHTML}</div>
        </div>
      </div>
    </div>

    <div class="sub-tab-bar" id="sub-tab-bar">
      <button class="sub-tab ${_activeTab === 'pe-firms' ? 'active' : ''}"
              onclick="_switchTab('pe-firms')">PE Firms (${(s.pe_firms||[]).length})</button>
      <button class="sub-tab ${_activeTab === 'target-companies' ? 'active' : ''}"
              onclick="_switchTab('target-companies')">Target Companies (${(s.target_companies||[]).length})</button>
      <button class="sub-tab ${_activeTab === 'allstar' ? 'active' : ''}"
              onclick="_switchTab('allstar')">All-Star Pool (${(s.allstar_pool||[]).length})</button>
    </div>

    <div id="tab-content"></div>`;

  _renderActiveTab();
}

// ── All-Star Playbook drag-to-reorder ────────────────────────────────────────

let _topDragId = null;
let _topDragType = null;

function _topDragStart(event) {
  const row = event.target.closest('[data-id]');
  if (!row) return;
  _topDragId = row.dataset.id;
  _topDragType = row.dataset.type;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', _topDragId);
  row.style.opacity = '0.4';
}

function _topDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const row = event.target.closest('[data-id]');
  if (row && row.dataset.type === _topDragType) {
    row.style.borderTop = '2px solid #6B2D5B';
  }
}

function _topDrop(event) {
  event.preventDefault();
  const targetRow = event.target.closest('[data-id]');
  if (!targetRow || !_topDragId || targetRow.dataset.type !== _topDragType) return;

  const targetId = targetRow.dataset.id;
  if (targetId === _topDragId) return;

  const s = _currentSector;
  if (!s) return;

  const list = _topDragType === 'pe' ? (s.top_pe_firms || []) : (s.top_companies || []);
  const fromIdx = list.indexOf(_topDragId);
  const toIdx = list.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  // Move item from fromIdx to toIdx
  list.splice(fromIdx, 1);
  list.splice(toIdx, 0, _topDragId);

  // Save and re-render
  const payload = _topDragType === 'pe'
    ? { top_pe_firms: list }
    : { top_companies: list };
  api('PUT', '/playbooks/' + s.sector_id, payload).then(() => {
    _paintSectorDetail();
  }).catch(err => appAlert('Error saving: ' + err.message, { type: 'error' }));
}

function _topDragEnd(event) {
  _topDragId = null;
  _topDragType = null;
  // Clean up all drag styles
  document.querySelectorAll('[data-id]').forEach(el => {
    el.style.opacity = '';
    el.style.borderTop = '';
  });
}

// ── All-Star Playbook add/remove ─────────────────────────────────────────────

function _showAddToTopList(type) {
  const panel = document.getElementById('allstar-add-' + type);
  if (!panel) return;
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : '';
  if (!isVisible) {
    const input = document.getElementById('allstar-' + type + '-search');
    if (input) { input.value = ''; input.focus(); }
    _filterAddToTopList(type);
  }
}

function _filterAddToTopList(type) {
  const s = _currentSector;
  if (!s) return;
  const input = document.getElementById('allstar-' + type + '-search');
  const resultsEl = document.getElementById('allstar-' + type + '-results');
  if (!input || !resultsEl) return;
  const query = (input.value || '').toLowerCase().trim();

  if (type === 'pe') {
    const topIds = new Set(s.top_pe_firms || []);
    let candidates = (s.pe_firms || []).filter(f => !topIds.has(f.firm_id));
    if (query) candidates = candidates.filter(f => (f.name || '').toLowerCase().includes(query));
    candidates = candidates.slice(0, 15);
    resultsEl.innerHTML = candidates.length === 0
      ? `<div style="color:#aaa;font-size:12px;padding:6px 0">${query ? 'No matching firms' : 'Type to search...'}</div>`
      : candidates.map(f => {
          const sizePill = f.size_tier ? `<span style="background:#F3E8EF;color:#6B2D5B;padding:1px 5px;border-radius:6px;font-size:9px;font-weight:600">${escapeHtml(f.size_tier)}</span>` : '';
          return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:background 0.1s" onmouseover="this.style.background='#F3E8EF'" onmouseout="this.style.background=''" onclick="_addToTopList('pe','${escapeHtml(f.firm_id)}')">
            <span style="color:#6B2D5B;font-weight:700;font-size:14px">+</span>
            <span style="flex:1;font-weight:500">${escapeHtml(f.name)}</span>
            ${sizePill}
            <span style="color:#999;font-size:11px">${escapeHtml(f.hq || '')}</span>
          </div>`;
        }).join('');
  } else {
    const topIds = new Set(s.top_companies || []);
    let candidates = (s.target_companies || []).filter(c => !topIds.has(c.company_id));
    if (query) candidates = candidates.filter(c => (c.name || '').toLowerCase().includes(query));
    candidates = candidates.slice(0, 15);
    resultsEl.innerHTML = candidates.length === 0
      ? `<div style="color:#aaa;font-size:12px;padding:6px 0">${query ? 'No matching companies' : 'Type to search...'}</div>`
      : candidates.map(c => {
          return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:background 0.1s" onmouseover="this.style.background='#F3E8EF'" onmouseout="this.style.background=''" onclick="_addToTopList('company','${escapeHtml(c.company_id)}')">
            <span style="color:#6B2D5B;font-weight:700;font-size:14px">+</span>
            <span style="flex:1;font-weight:500">${escapeHtml(c.name)}</span>
            <span style="color:#999;font-size:11px">${escapeHtml(c.hq || '')}</span>
            <span style="color:#888;font-size:11px">${escapeHtml(c.revenue_tier || '')}</span>
          </div>`;
        }).join('');
  }
}

async function _addPlaybookToSearch(sectorId) {
  // Show a picker of active searches to add the Top 25 to
  try {
    const resp = await api('GET', '/searches');
    const activeSearches = (resp.searches || []).filter(s => s.status === 'active');

    if (activeSearches.length === 0) {
      appAlert('No active searches. Create a search first.', { type: 'info' });
      return;
    }

    const options = activeSearches.map(s => `${s.client_name} — ${s.role_title}`);
    const choice = await appPrompt(
      'Add Top 25 playbook to which search?\n\n' +
      activeSearches.map((s, i) => `${i + 1}. ${s.client_name} — ${s.role_title}`).join('\n') +
      '\n\nEnter number:'
    );
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= activeSearches.length) { appAlert('Invalid selection.', { type: 'warning' }); return; }

    const searchId = activeSearches[idx].search_id;
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const sector = _currentSector;

    let addedFirms = 0;
    let addedCompanies = 0;

    // Add top PE firms
    for (const firmId of (sector.top_pe_firms || [])) {
      const firm = (sector.pe_firms || []).find(f => f.firm_id === firmId);
      if (!firm) continue;
      const exists = coverage.pe_firms.some(f => f.firm_id === firm.firm_id || f.name.toLowerCase() === firm.name.toLowerCase());
      if (exists) continue;
      coverage.pe_firms.push({
        firm_id: firm.firm_id, name: firm.name, hq: firm.hq || '', size_tier: firm.size_tier || '',
        manual_complete: false, manual_complete_note: '',
        roster: JSON.parse(JSON.stringify(firm.roster || []))
      });
      addedFirms++;
    }

    // Add top companies
    for (const coId of (sector.top_companies || [])) {
      const co = (sector.target_companies || []).find(c => c.company_id === coId);
      if (!co) continue;
      const exists = coverage.companies.some(c => c.company_id === co.company_id || c.name.toLowerCase() === co.name.toLowerCase());
      if (exists) continue;
      coverage.companies.push({
        company_id: co.company_id, name: co.name, hq: co.hq || '', revenue_tier: co.revenue_tier || '',
        manual_complete: false, manual_complete_note: '', roster: []
      });
      addedCompanies++;
    }

    await api('PUT', '/searches/' + searchId, { sourcing_coverage: coverage });
    appAlert('Added ' + addedFirms + ' PE firms and ' + addedCompanies + ' companies to "' + activeSearches[idx].client_name + '".', { type: 'success' });
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function _addToTopList(type, id) {
  const s = _currentSector;
  if (!s) return;

  if (type === 'pe') {
    if (!s.top_pe_firms) s.top_pe_firms = [];
    if (s.top_pe_firms.includes(id)) return;
    s.top_pe_firms.push(id);
  } else {
    if (!s.top_companies) s.top_companies = [];
    if (s.top_companies.includes(id)) return;
    s.top_companies.push(id);
  }

  try {
    const payload = type === 'pe'
      ? { top_pe_firms: s.top_pe_firms }
      : { top_companies: s.top_companies };
    await api('PUT', '/playbooks/' + s.sector_id, payload);
    _paintSectorDetail();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

async function _removeFromTopList(type, id) {
  const s = _currentSector;
  if (!s) return;

  if (type === 'pe') {
    s.top_pe_firms = (s.top_pe_firms || []).filter(fid => fid !== id);
  } else {
    s.top_companies = (s.top_companies || []).filter(cid => cid !== id);
  }

  try {
    const payload = type === 'pe'
      ? { top_pe_firms: s.top_pe_firms }
      : { top_companies: s.top_companies };
    await api('PUT', '/playbooks/' + s.sector_id, payload);
    _paintSectorDetail();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

function _switchTab(tab) {
  _activeTab = tab;
  _openAccordionId = null;
  // Update tab bar active classes
  document.querySelectorAll('.sub-tab').forEach(btn => btn.classList.remove('active'));
  const tabs = document.querySelectorAll('.sub-tab');
  const tabMap = ['pe-firms', 'target-companies', 'allstar'];
  tabs.forEach((btn, i) => {
    if (tabMap[i] === tab) btn.classList.add('active');
  });
  _renderActiveTab();
}

function _renderActiveTab() {
  if (_activeTab === 'pe-firms')          _renderPeFirmsTab();
  else if (_activeTab === 'target-companies') _renderCompaniesTab();
  else                                     _renderAllstarTab();
}

// ── PE FIRMS TAB ──────────────────────────────────────────────────────────────

function _renderPeFirmsTab() {
  const container = document.getElementById('tab-content');
  const s = _currentSector;

  // Filter
  let firms = (s.pe_firms || []).filter(f => {
    if (_firmFilters.sizeTier !== 'All' && f.size_tier !== _firmFilters.sizeTier) return false;
    if (_firmFilters.strategy !== 'All' && f.strategy !== _firmFilters.strategy) return false;
    if (_firmFilters.sectorFocus !== 'All' && f.sector_focus !== _firmFilters.sectorFocus) return false;
    if (_firmFilters.search) {
      const q = _firmFilters.search.toLowerCase();
      if (!f.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort: manual-complete last, then by coverage % ascending
  firms.sort((a, b) => {
    const aCov = getCoverageInfo(a, false);
    const bCov = getCoverageInfo(b, false);
    const aIsManual = a.roster_completeness === 'manual-complete' ? 1 : 0;
    const bIsManual = b.roster_completeness === 'manual-complete' ? 1 : 0;
    if (aIsManual !== bIsManual) return aIsManual - bIsManual;
    return aCov.pct - bCov.pct;
  });

  const filterHTML = `
    <div class="filter-bar" id="firm-filter-bar">
      <span class="filter-label">Filter:</span>
      <select id="f-size" onchange="_firmFilterChanged()">
        <option value="All">All Sizes</option>
        <option value="Mega">Mega</option>
        <option value="Large">Large</option>
        <option value="Middle Market">Middle Market</option>
        <option value="Lower Middle Market">Lower Middle Market</option>
      </select>
      <select id="f-strategy" onchange="_firmFilterChanged()">
        <option value="All">All Strategies</option>
        <option value="Buyout">Buyout</option>
        <option value="Growth Equity">Growth Equity</option>
        <option value="Distressed">Distressed</option>
        <option value="Turnaround">Turnaround</option>
        <option value="Multi-Strategy">Multi-Strategy</option>
      </select>
      <select id="f-focus" onchange="_firmFilterChanged()">
        <option value="All">All Focus</option>
        <option value="Primary">Primary</option>
        <option value="Significant">Significant</option>
        <option value="Opportunistic">Opportunistic</option>
      </select>
      <input type="text" id="f-search" placeholder="Search firm name…"
             oninput="_firmFilterChanged()" style="flex:1;min-width:160px;" />
    </div>`;

  let tableRows = '';
  if (firms.length === 0) {
    tableRows = `<tr><td colspan="7" class="empty-state" style="padding:32px;text-align:center;color:#757575;">No firms match the current filters.</td></tr>`;
  } else {
    firms.forEach(f => {
      const cov = getCoverageInfo(f, false);
      const whyTrunc = truncate(f.why_target, 80);
      const websiteIcon = f.website_url
        ? ` <a href="${f.website_url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener"
               onclick="event.stopPropagation()"
               title="Visit website" style="color:#6B2D5B;font-size:11px;margin-left:4px;text-decoration:none;">&#127760;</a>`
        : '';
      tableRows += `
        <tr class="firm-row" style="cursor:pointer;" onclick="_renderFirmDetail('${f.firm_id}')">
          <td><strong>${f.name}</strong>${entityTypeBadge(f.entity_type)}${f.is_specialist ? ' <span style="background:#fff8e1;color:#f57f17;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700">&#9733; Specialist</span>' : ''}${websiteIcon}</td>
          <td>${f.hq || '—'}</td>
          <td>${sizeTierPill(f.size_tier)}</td>
          <td>${f.strategy ? genericPill(f.strategy) : '—'}</td>
          <td>${f.sector_focus ? genericPill(f.sector_focus) : '—'}</td>
          <td>${coverageBarHTML(cov)}</td>
          <td title="${(f.why_target || '').replace(/"/g, '&quot;')}" style="max-width:200px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${whyTrunc}</td>
        </tr>`;
    });
  }

  const addFirmFormHTML = _addFirmFormOpen ? _buildAddFirmForm() : `
    <div style="padding:12px 0 0;">
      <button class="btn btn-secondary btn-sm" onclick="_openAddFirmForm()">+ Add PE Firm</button>
    </div>`;

  container.innerHTML = `
    ${filterHTML}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Firm Name</th>
            <th>HQ</th>
            <th>Size Tier</th>
            <th>Strategy</th>
            <th>Sector Focus</th>
            <th style="min-width:220px;">Coverage</th>
            <th>Why Target</th>
          </tr>
        </thead>
        <tbody id="firms-tbody">${tableRows}</tbody>
      </table>
    </div>
    <div id="add-firm-form-container">${addFirmFormHTML}</div>`;

  // Restore filter values from state
  _restoreFirmFilters();
}

function _restoreFirmFilters() {
  const sz = document.getElementById('f-size');
  const st = document.getElementById('f-strategy');
  const fo = document.getElementById('f-focus');
  const sr = document.getElementById('f-search');
  if (sz) sz.value = _firmFilters.sizeTier;
  if (st) st.value = _firmFilters.strategy;
  if (fo) fo.value = _firmFilters.sectorFocus;
  if (sr) sr.value = _firmFilters.search;
}

function _firmFilterChanged() {
  _firmFilters.sizeTier    = document.getElementById('f-size').value;
  _firmFilters.strategy    = document.getElementById('f-strategy').value;
  _firmFilters.sectorFocus = document.getElementById('f-focus').value;
  _firmFilters.search      = document.getElementById('f-search').value;
  _openAccordionId = null;
  _renderPeFirmsTab();
}

function _toggleFirmAccordion(firmId) {
  _openAccordionId = (_openAccordionId === firmId) ? null : firmId;
  _renderPeFirmsTab();
}

// ── FIRM DETAIL PAGE ──────────────────────────────────────────────────────────

function _renderFirmDetail(firmId) {
  _currentFirmId = firmId;
  const firm = (_currentSector.pe_firms || []).find(f => f.firm_id === firmId);
  if (!firm) return;
  const s = _currentSector;
  const content = document.getElementById('app-content');
  const cov = getCoverageInfo(firm, false);
  const roster = firm.roster || [];

  // Roster table rows
  let rosterHTML;
  if (roster.length === 0) {
    rosterHTML = `<p style="color:#888;font-size:13px;padding:8px 0 16px;">No candidates on roster yet.</p>`;
  } else {
    const rows = roster.map((c, idx) => {
      const nameLink = c.candidate_id
        ? `<span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${(c.candidate_id||'').replace(/'/g,'\\\'')}')">${c.name}</span>`
        : c.name;
      const nameCell = c.linkedin_url
        ? `${nameLink} <a href="${c.linkedin_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0077B5;margin-left:4px;font-size:11px">in</a>`
        : nameLink;
      const statusOpts = ROSTER_STATUSES.map(st =>
        `<option value="${st}" ${c.roster_status === st ? 'selected' : ''}>${st}</option>`
      ).join('');
      const _pipeBtn = `<button onclick="event.stopPropagation();openAddToPipelineModal({candidate_id:'${(c.candidate_id||'').replace(/'/g,"\\'")}',name:'${(c.name||'').replace(/'/g,"\\'")}',current_title:'${(c.title||'').replace(/'/g,"\\'")}',current_firm:'',location:'',linkedin_url:'${(c.linkedin_url||'').replace(/'/g,"\\'")}',archetype:''},{source:'All-star pool'})" title="Add to Pipeline" style="background:#6B2D5B;color:#fff;border:none;width:24px;height:24px;border-radius:5px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">&#8594;</button>`;
      return `<tr>
        <td>${nameCell}</td>
        <td style="color:#555">${c.title || ''}</td>
        <td><select class="form-control" style="padding:3px 6px;font-size:12px;"
              onchange="_updateCandidateStatus('${firmId}',${idx},this.value,false)">${statusOpts}</select></td>
        <td style="white-space:nowrap">${_pipeBtn} <button class="btn btn-ghost btn-sm" style="color:#c62828;padding:2px 6px;"
              onclick="_removeCandidate('${firmId}',${idx},false)">&#10005;</button></td>
      </tr>`;
    }).join('');
    rosterHTML = `<table class="roster-table" style="margin-bottom:16px;">
      <thead><tr><th>Name</th><th>Title</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const isManual = firm.roster_completeness === 'manual-complete';
  const expectedSize = firm.custom_roster_size || firm.expected_roster_size || TIER_ROSTER_DEFAULTS[firm.size_tier] || 6;

  content.innerHTML = `
    <div style="max-width:1100px;margin:0 auto">

      <!-- Breadcrumb -->
      <div style="margin-bottom:20px">
        <button class="btn btn-ghost btn-sm" onclick="renderSectorDetail('${s.sector_id}')" style="margin-bottom:12px">
          &#8592; ${s.sector_name} Playbook
        </button>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:1.7rem;font-weight:800;margin:0 0 8px">${firm.name}</h1>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="color:#666;font-size:14px">&#128205; ${firm.hq || '—'}</span>
              ${sizeTierPill(firm.size_tier)}
              ${firm.strategy ? genericPill(firm.strategy) : ''}
              ${firm.sector_focus ? genericPill(firm.sector_focus) : ''}
              ${entityTypeBadge(firm.entity_type)}
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${firm.website_url
              ? `<a href="${firm.website_url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener"
                    class="btn btn-secondary btn-sm" style="text-decoration:none">&#127760; Visit Website</a>`
              : ''}
            <button class="btn btn-ghost btn-sm" onclick="_toggleFirmEditPanel('${firmId}')">&#9998; Edit Firm</button>
          </div>
        </div>
      </div>

      <!-- Edit panel (hidden by default) -->
      <div id="firm-edit-panel" style="display:none;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 16px;font-size:14px;font-weight:700">Edit Firm Info</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <label class="form-label">Firm Name</label>
            <input class="form-control" id="ef-name" value="${(firm.name||'').replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="form-label">HQ</label>
            <input class="form-control" id="ef-hq" value="${(firm.hq||'').replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="form-label">Website URL</label>
            <input class="form-control" id="ef-website" placeholder="https://www.example.com" value="${(firm.website_url||'').replace(/"/g,'&quot;')}">
          </div>
          <div>
            <label class="form-label">Size Tier</label>
            <select class="form-control" id="ef-size">
              ${['Mega','Large','Middle Market','Lower Middle Market'].map(t =>
                `<option value="${t}" ${firm.size_tier===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Strategy</label>
            <select class="form-control" id="ef-strategy">
              ${['Buyout','Growth Equity','Distressed','Turnaround','Multi-Strategy'].map(t =>
                `<option value="${t}" ${firm.strategy===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="form-label">Sector Focus</label>
            <select class="form-control" id="ef-focus">
              ${['Primary','Significant','Opportunistic'].map(t =>
                `<option value="${t}" ${firm.sector_focus===t?'selected':''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-bottom:12px">
          <label class="form-label">Why Target</label>
          <textarea class="form-control" id="ef-why" rows="3">${firm.why_target||''}</textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="_saveFirmEdits('${firmId}')">Save Changes</button>
          <button class="btn btn-ghost btn-sm" onclick="_toggleFirmEditPanel('${firmId}')">Cancel</button>
        </div>
      </div>

      <!-- Why Target -->
      ${firm.why_target ? `
      <div style="background:#f9f7ff;border-left:3px solid #6B2D5B;border-radius:0 6px 6px 0;padding:12px 16px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;color:#6B2D5B;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Why Target</div>
        <p style="font-size:13px;color:#333;margin:0;line-height:1.6">${firm.why_target}</p>
      </div>` : ''}

      <!-- Roster card -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
          <div>
            <h2 style="font-size:15px;font-weight:700;margin:0">${firm.name} Roster</h2>
            <span style="font-size:12px;color:#888">${roster.length} / ${expectedSize} identified</span>
          </div>
          <div>${coverageBarHTML(cov)}</div>
        </div>

        ${rosterHTML}

        <!-- Add person form -->
        <div style="border-top:1px solid #f0f0f0;padding-top:16px;margin-top:4px">
          <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Add Person to Roster</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:end">
            <div>
              <label class="form-label">Name *</label>
              <input type="text" id="ap-name-${firmId}" class="form-control" placeholder="Full name">
            </div>
            <div>
              <label class="form-label">Title *</label>
              ${_buildTitleSelect('ap-', firmId)}
            </div>
            <div>
              <label class="form-label">LinkedIn URL</label>
              <input type="text" id="ap-li-${firmId}" class="form-control" placeholder="https://linkedin.com/in/…">
            </div>
            <div>
              <label class="form-label">Status</label>
              <select id="ap-status-${firmId}" class="form-control">
                ${ROSTER_STATUSES.map(st => `<option value="${st}" ${st==='Identified'?'selected':''}>${st}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" onclick="_addPersonToFirm('${firmId}')">Add to Roster</button>
        </div>
      </div>

      <!-- Coverage Override -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
        <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">Coverage Override</div>
        <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="radio" name="override-${firmId}" value="auto" ${!isManual?'checked':''}
                   onchange="_handleCoverageOverride('${firmId}','auto',false)"> Auto (calculated)
          </label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px">
            <input type="radio" name="override-${firmId}" value="manual-complete" ${isManual?'checked':''}
                   onchange="_handleCoverageOverride('${firmId}','manual-complete',false)"> Mark as Complete
          </label>
          ${isManual ? `
          <input type="text" id="override-note-${firmId}" class="form-control"
                 style="max-width:260px;font-size:12px" placeholder="Note (optional)"
                 value="${(firm.manual_complete_note||'').replace(/"/g,'&quot;')}">
          <button class="btn btn-secondary btn-sm" onclick="_saveOverrideNote('${firmId}',false)">Save Note</button>` : ''}
        </div>
      </div>

    </div>`;
}

function _toggleFirmEditPanel(firmId) {
  const panel = document.getElementById('firm-edit-panel');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

async function _saveFirmEdits(firmId) {
  const firm = (_currentSector.pe_firms || []).find(f => f.firm_id === firmId);
  if (!firm) return;
  firm.name        = document.getElementById('ef-name').value.trim() || firm.name;
  firm.hq          = document.getElementById('ef-hq').value.trim();
  firm.website_url = document.getElementById('ef-website').value.trim();
  firm.size_tier   = document.getElementById('ef-size').value;
  firm.strategy    = document.getElementById('ef-strategy').value;
  firm.sector_focus = document.getElementById('ef-focus').value;
  firm.why_target  = document.getElementById('ef-why').value.trim();
  await saveSector(_currentSector);
  _renderFirmDetail(firmId);
}

// ── FIRM ACCORDION ────────────────────────────────────────────────────────────

function _buildFirmAccordion(firm) {
  const roster = firm.roster || [];
  const isManual = firm.roster_completeness === 'manual-complete';
  const cov = getCoverageInfo(firm, false);

  let rosterHTML = '';
  if (roster.length === 0) {
    rosterHTML = `<p class="text-muted text-sm" style="margin:8px 0 12px;">No candidates in roster yet.</p>`;
  } else {
    const rows = roster.map((c, idx) => {
      const _nl = c.candidate_id ? `<span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${(c.candidate_id||'').replace(/'/g,'\\\'')}')">${c.name}</span>` : c.name;
      const nameCell = c.linkedin_url
        ? `${_nl} <a href="${c.linkedin_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0077B5;margin-left:4px;font-size:11px">in</a>`
        : _nl;
      const statusOpts = ROSTER_STATUSES.map(s =>
        `<option value="${s}" ${c.roster_status === s ? 'selected' : ''}>${s}</option>`
      ).join('');
      return `
        <tr>
          <td>${nameCell}</td>
          <td>${c.title}</td>
          <td>
            <select class="form-control" style="padding:3px 6px;font-size:0.8rem;"
                    onchange="_updateCandidateStatus('${firm.firm_id}', ${idx}, this.value, false)">
              ${statusOpts}
            </select>
          </td>
          <td style="white-space:nowrap">
            <button onclick="event.stopPropagation();openAddToPipelineModal({candidate_id:'${(c.candidate_id||'').replace(/'/g,"\\'")}',name:'${(c.name||'').replace(/'/g,"\\'")}',current_title:'${(c.title||'').replace(/'/g,"\\'")}',current_firm:'',location:'',linkedin_url:'${(c.linkedin_url||'').replace(/'/g,"\\'")}',archetype:''},{source:'All-star pool'})" title="Add to Pipeline" style="background:#6B2D5B;color:#fff;border:none;width:24px;height:24px;border-radius:5px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">&#8594;</button>
            <button class="btn btn-danger btn-sm" style="padding:3px 8px;"
                    onclick="_removeCandidate('${firm.firm_id}', ${idx}, false)">&#10005;</button>
          </td>
        </tr>`;
    }).join('');
    rosterHTML = `
      <table class="roster-table" style="margin-bottom:12px;">
        <thead>
          <tr><th>Name</th><th>Title</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const overrideHTML = `
    <div class="override-section" style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
      <strong style="font-size:0.85rem;">Coverage Override</strong>
      <div style="display:flex;gap:16px;margin-top:8px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;">
          <input type="radio" name="override-${firm.firm_id}" value="auto"
                 ${!isManual ? 'checked' : ''}
                 onchange="_handleCoverageOverride('${firm.firm_id}', 'auto', false)"> Auto
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;">
          <input type="radio" name="override-${firm.firm_id}" value="manual-complete"
                 ${isManual ? 'checked' : ''}
                 onchange="_handleCoverageOverride('${firm.firm_id}', 'manual-complete', false)"> Mark as Complete
        </label>
        ${isManual ? `
          <input type="text" id="override-note-${firm.firm_id}"
                 class="form-control" style="max-width:300px;font-size:0.85rem;"
                 placeholder="Note (optional)"
                 value="${(firm.manual_complete_note || '').replace(/"/g, '&quot;')}">
          <button class="btn btn-primary btn-sm"
                  onclick="_saveOverrideNote('${firm.firm_id}', false)">Save Note</button>
        ` : ''}
      </div>
    </div>`;

  const addPersonHTML = `
    <div class="add-person-form" style="margin-top:12px;">
      <strong style="font-size:0.85rem;">Add Person to Roster</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:8px;align-items:end;flex-wrap:wrap;">
        <div>
          <label class="form-label" style="margin-bottom:4px;">Name *</label>
          <input type="text" id="ap-name-${firm.firm_id}" class="form-control" placeholder="Full name" />
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">Title *</label>
          <input type="text" id="ap-title-${firm.firm_id}" class="form-control" placeholder="Title" />
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">LinkedIn URL</label>
          <input type="text" id="ap-li-${firm.firm_id}" class="form-control" placeholder="https://linkedin.com/in/…" />
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">Status</label>
          <select id="ap-status-${firm.firm_id}" class="form-control">
            ${ROSTER_STATUSES.map(s => `<option value="${s}" ${s === 'Identified' ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:8px;"
              onclick="_addPersonToFirm('${firm.firm_id}')">Add to Roster</button>
    </div>`;

  return `
    <div style="padding:4px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong>${firm.name} Roster</strong>
        <span class="text-muted text-sm">${(roster.length)} / ${firm.custom_roster_size || firm.expected_roster_size} identified</span>
      </div>
      ${rosterHTML}
      ${addPersonHTML}
      ${overrideHTML}
    </div>`;
}

// ── FIRM ROSTER MUTATIONS ────────────────────────────────────────────────────

function _buildTitleSelect(idPrefix, entityId) {
  const opts = _rosterTitles.map(t =>
    `<option value="${t.replace(/"/g,'&quot;')}">${t}</option>`
  ).join('');
  return `
    <select id="${idPrefix}title-sel-${entityId}" class="form-control"
            onchange="_onTitleSelectChange('${idPrefix}','${entityId}')">
      <option value="">— Select Title —</option>
      ${opts}
      <option value="__new__">+ Add new title…</option>
    </select>
    <input type="text" id="${idPrefix}title-new-${entityId}" class="form-control"
           placeholder="Enter new title" style="display:none;margin-top:4px;">`;
}

function _onTitleSelectChange(idPrefix, entityId) {
  const sel = document.getElementById(`${idPrefix}title-sel-${entityId}`);
  const inp = document.getElementById(`${idPrefix}title-new-${entityId}`);
  if (!sel || !inp) return;
  inp.style.display = sel.value === '__new__' ? '' : 'none';
  if (sel.value === '__new__') inp.focus();
}

function _getTitleValue(idPrefix, entityId) {
  const sel = document.getElementById(`${idPrefix}title-sel-${entityId}`);
  if (!sel) return '';
  if (sel.value === '__new__') {
    const inp = document.getElementById(`${idPrefix}title-new-${entityId}`);
    return inp ? inp.value.trim() : '';
  }
  return sel.value;
}

async function _saveNewTitleIfNeeded(idPrefix, entityId) {
  const sel = document.getElementById(`${idPrefix}title-sel-${entityId}`);
  if (!sel || sel.value !== '__new__') return;
  const inp = document.getElementById(`${idPrefix}title-new-${entityId}`);
  const newTitle = inp ? inp.value.trim() : '';
  if (!newTitle || _rosterTitles.includes(newTitle)) return;
  _rosterTitles.push(newTitle);
  try {
    await api('PATCH', '/playbooks', { roster_titles: _rosterTitles });
  } catch (e) {
    console.warn('Could not save new title to database:', e.message);
  }
}

async function _addPersonToFirm(firmId) {
  const name   = document.getElementById(`ap-name-${firmId}`).value.trim();
  const title  = _getTitleValue('ap-', firmId);
  const li     = document.getElementById(`ap-li-${firmId}`).value.trim();
  const status = document.getElementById(`ap-status-${firmId}`).value;

  if (!name || !title) {
    appAlert('Name and Title are required.', { type: 'warning' });
    return;
  }

  await _saveNewTitleIfNeeded('ap-', firmId);

  const s = _currentSector;
  const firm = s.pe_firms.find(f => f.firm_id === firmId);
  if (!firm) return;

  const candidateId = firmId + '-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
  firm.roster.push({
    candidate_id: candidateId,
    name,
    title,
    linkedin_url: li,
    roster_status: status,
    last_updated: new Date().toISOString().slice(0, 10),
    searches_appeared_in: []
  });

  await saveSector(s);
  _renderFirmDetail(firmId);
}

async function _updateCandidateStatus(firmId, idx, newStatus, isCompany) {
  const s = _currentSector;
  const arr = isCompany ? s.target_companies : s.pe_firms;
  const entity = isCompany
    ? arr.find(c => c.company_id === firmId)
    : arr.find(f => f.firm_id === firmId);
  if (!entity) return;
  entity.roster[idx].roster_status = newStatus;
  entity.roster[idx].last_updated = new Date().toISOString().slice(0, 10);
  await saveSector(s);
  // No full re-render needed — just save; the dropdown already shows the new value
}

async function _removeCandidate(entityId, idx, isCompany) {
  if (!(await appConfirm('Remove this person from the roster?'))) return;
  const s = _currentSector;
  const arr = isCompany ? s.target_companies : s.pe_firms;
  const entity = isCompany
    ? arr.find(c => c.company_id === entityId)
    : arr.find(f => f.firm_id === entityId);
  if (!entity) return;
  entity.roster.splice(idx, 1);
  await saveSector(s);
  isCompany ? _renderCompaniesTab() : _renderPeFirmsTab();
}

async function _handleCoverageOverride(entityId, value, isCompany) {
  const s = _currentSector;
  const arr = isCompany ? s.target_companies : s.pe_firms;
  const entity = isCompany
    ? arr.find(c => c.company_id === entityId)
    : arr.find(f => f.firm_id === entityId);
  if (!entity) return;
  entity.roster_completeness = value;
  if (value === 'auto') entity.manual_complete_note = '';
  await saveSector(s);
  isCompany ? _renderCompaniesTab() : _renderPeFirmsTab();
}

async function _saveOverrideNote(entityId, isCompany) {
  const noteEl = document.getElementById(`override-note-${entityId}`);
  if (!noteEl) return;
  const s = _currentSector;
  const arr = isCompany ? s.target_companies : s.pe_firms;
  const entity = isCompany
    ? arr.find(c => c.company_id === entityId)
    : arr.find(f => f.firm_id === entityId);
  if (!entity) return;
  entity.manual_complete_note = noteEl.value.trim();
  await saveSector(s);
  // No re-render needed — note saved silently
}

// ── ADD FIRM FORM ────────────────────────────────────────────────────────────

function _openAddFirmForm() {
  _addFirmFormOpen = true;
  const container = document.getElementById('add-firm-form-container');
  if (container) container.innerHTML = _buildAddFirmForm();
}

function _closeAddFirmForm() {
  _addFirmFormOpen = false;
  const container = document.getElementById('add-firm-form-container');
  if (container) container.innerHTML = `
    <div style="padding:12px 0 0;">
      <button class="btn btn-secondary btn-sm" onclick="_openAddFirmForm()">+ Add PE Firm</button>
    </div>`;
}

function _buildAddFirmForm() {
  return `
    <div class="add-firm-form" style="margin-top:16px;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px;">
      <h3 style="margin-bottom:16px;font-size:1rem;">Add New PE Firm</h3>

      <!-- Import from Company Pool -->
      <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e0e0e0;">
        <label class="form-label">Import from Company Pool <span style="font-weight:400;color:#aaa">(optional — pre-fills fields below)</span></label>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="text" id="nf-pool-search" class="form-control" placeholder="Search PE firms in pool…"
                 oninput="_onPoolSearchInput(this.value)" autocomplete="off" style="flex:1" />
          <button class="btn btn-ghost btn-sm" type="button" onclick="_clearPoolImport()">Clear</button>
        </div>
        <div id="nf-pool-results" style="display:none;border:1px solid #ddd;border-top:none;border-radius:0 0 4px 4px;max-height:200px;overflow-y:auto;background:#fff;position:relative;z-index:10;"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label class="form-label">Firm Name *</label>
          <input type="text" id="nf-name" class="form-control" placeholder="Firm name" />
        </div>
        <div>
          <label class="form-label">HQ (City, State) *</label>
          <input type="text" id="nf-hq" class="form-control" placeholder="New York, NY" />
        </div>
        <div>
          <label class="form-label">Size Tier *</label>
          <select id="nf-size" class="form-control">
            <option value="Mega">Mega</option>
            <option value="Large">Large</option>
            <option value="Middle Market" selected>Middle Market</option>
            <option value="Lower Middle Market">Lower Middle Market</option>
          </select>
        </div>
        <div>
          <label class="form-label">Strategy *</label>
          <select id="nf-strategy" class="form-control">
            <option value="Buyout" selected>Buyout</option>
            <option value="Growth Equity">Growth Equity</option>
            <option value="Distressed">Distressed</option>
            <option value="Turnaround">Turnaround</option>
            <option value="Multi-Strategy">Multi-Strategy</option>
          </select>
        </div>
        <div>
          <label class="form-label">Sector Focus *</label>
          <select id="nf-focus" class="form-control">
            <option value="Primary" selected>Primary</option>
            <option value="Significant">Significant</option>
            <option value="Opportunistic">Opportunistic</option>
          </select>
        </div>
        <div>
          <label class="form-label">Custom Roster Size</label>
          <input type="number" id="nf-custom-roster" class="form-control" placeholder="Leave blank for tier default" min="1" />
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">Website URL</label>
        <input type="text" id="nf-website" class="form-control" placeholder="https://www.example.com" />
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">Why Target</label>
        <textarea id="nf-why" class="form-control" rows="2" placeholder="Why this firm is relevant…"></textarea>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-primary btn-sm" onclick="_submitAddFirm()">Add Firm</button>
        <button class="btn btn-ghost btn-sm" onclick="_closeAddFirmForm()">Cancel</button>
      </div>
    </div>`;
}

// ── Company Pool import helpers ───────────────────────────────────────────────

let _poolSearchTimer = null;

function _onPoolSearchInput(query) {
  clearTimeout(_poolSearchTimer);
  const resultsEl = document.getElementById('nf-pool-results');
  if (!query || query.length < 2) {
    if (resultsEl) resultsEl.style.display = 'none';
    return;
  }
  _poolSearchTimer = setTimeout(async () => {
    try {
      const data = await api('GET', '/companies?type=PE+Firm&text=' + encodeURIComponent(query));
      const companies = (data.companies || []).slice(0, 10);
      if (!resultsEl) return;
      if (!companies.length) {
        resultsEl.style.display = 'none';
        return;
      }
      resultsEl.innerHTML = companies.map(c => `
        <div class="pool-import-result-item" onclick="_selectPoolFirm('${c.company_id.replace(/'/g, "\\'")}')">
          <div style="font-weight:600">${c.name}</div>
          <div style="font-size:11px;color:#888">${c.hq || ''}${c.size_tier ? ' &bull; ' + c.size_tier : ''}${c.strategy ? ' &bull; ' + c.strategy : ''}</div>
        </div>
      `).join('');
      resultsEl.style.display = 'block';
    } catch (e) { /* silently ignore */ }
  }, 150);
}

async function _selectPoolFirm(companyId) {
  try {
    const c = await api('GET', '/companies/' + companyId);
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    setVal('nf-name',     c.name);
    setVal('nf-hq',       c.hq);
    setVal('nf-size',     c.size_tier);
    setVal('nf-strategy', c.strategy);
    setVal('nf-website',  c.website_url);
    const searchInput = document.getElementById('nf-pool-search');
    if (searchInput) searchInput.value = c.name;
    const resultsEl = document.getElementById('nf-pool-results');
    if (resultsEl) resultsEl.style.display = 'none';
  } catch (e) { /* silently ignore */ }
}

function _clearPoolImport() {
  const searchInput = document.getElementById('nf-pool-search');
  const resultsEl   = document.getElementById('nf-pool-results');
  if (searchInput) searchInput.value = '';
  if (resultsEl)   resultsEl.style.display = 'none';
}

async function _submitAddFirm() {
  const name     = document.getElementById('nf-name').value.trim();
  const hq       = document.getElementById('nf-hq').value.trim();
  const sizeTier = document.getElementById('nf-size').value;
  const strategy = document.getElementById('nf-strategy').value;
  const focus    = document.getElementById('nf-focus').value;
  const why        = document.getElementById('nf-why').value.trim();
  const website    = document.getElementById('nf-website').value.trim();
  const customRaw  = document.getElementById('nf-custom-roster').value.trim();
  const customRoster = customRaw ? parseInt(customRaw, 10) : undefined;

  if (!name || !hq) {
    appAlert('Firm Name and HQ are required.', { type: 'warning' });
    return;
  }

  const s = _currentSector;
  const firmId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const expectedRosterSize = TIER_ROSTER_DEFAULTS[sizeTier] || 6;

  const newFirm = {
    firm_id: firmId,
    name,
    hq,
    size_tier: sizeTier,
    strategy,
    sector_focus: focus,
    why_target: why,
    website_url: website,
    expected_roster_size: expectedRosterSize,
    roster: [],
    roster_completeness: 'auto'
  };
  if (customRoster && !isNaN(customRoster)) {
    newFirm.custom_roster_size = customRoster;
  }

  s.pe_firms.push(newFirm);
  _addFirmFormOpen = false;
  await saveSector(s);
  _renderPeFirmsTab();
}

// ── TARGET COMPANIES TAB ──────────────────────────────────────────────────────

function _renderCompaniesTab() {
  const container = document.getElementById('tab-content');
  const s = _currentSector;

  let companies = (s.target_companies || []).filter(c => {
    if (_companyFilters.revenueTier !== 'All' && c.revenue_tier !== _companyFilters.revenueTier) return false;
    if (_companyFilters.ownershipType !== 'All' && c.ownership_type !== _companyFilters.ownershipType) return false;
    if (_companyFilters.search) {
      const q = _companyFilters.search.toLowerCase();
      if (!c.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort: manual-complete last, then by coverage % ascending
  companies.sort((a, b) => {
    const aCov = getCoverageInfo(a, true);
    const bCov = getCoverageInfo(b, true);
    const aIsManual = a.roster_completeness === 'manual-complete' ? 1 : 0;
    const bIsManual = b.roster_completeness === 'manual-complete' ? 1 : 0;
    if (aIsManual !== bIsManual) return aIsManual - bIsManual;
    return aCov.pct - bCov.pct;
  });

  const filterHTML = `
    <div class="filter-bar" id="company-filter-bar">
      <span class="filter-label">Filter:</span>
      <select id="c-revenue" onchange="_companyFilterChanged()">
        <option value="All">All Revenue Tiers</option>
        <option value="Large Cap">Large Cap</option>
        <option value="Upper Middle">Upper Middle</option>
        <option value="Middle Market">Middle Market</option>
        <option value="Lower Middle">Lower Middle</option>
      </select>
      <select id="c-ownership" onchange="_companyFilterChanged()">
        <option value="All">All Ownership Types</option>
        <option value="Public">Public</option>
        <option value="PE-Backed">PE-Backed</option>
        <option value="Family-Owned">Family-Owned</option>
        <option value="Recently Exited">Recently Exited</option>
      </select>
      <input type="text" id="c-search" placeholder="Search company name…"
             oninput="_companyFilterChanged()" style="flex:1;min-width:160px;" />
    </div>`;

  let tableRows = '';
  if (companies.length === 0) {
    tableRows = `<tr><td colspan="6" class="empty-state" style="padding:32px;text-align:center;color:#757575;">No companies match the current filters.</td></tr>`;
  } else {
    companies.forEach(c => {
      const cov = getCoverageInfo(c, true);
      const isOpen = _openAccordionId === c.company_id;
      tableRows += `
        <tr class="company-row ${isOpen ? 'row-open' : ''}"
            style="cursor:pointer;"
            onclick="_toggleCompanyAccordion('${c.company_id}')">
          <td><strong>${c.name}</strong></td>
          <td>${c.hq}</td>
          <td>${genericPill(c.revenue_tier)}</td>
          <td>${genericPill(c.ownership_type)}</td>
          <td style="font-size:0.82rem;color:#555;">${c.roles_to_target || ''}</td>
          <td>${coverageBarHTML(cov)}</td>
        </tr>`;
      if (isOpen) {
        tableRows += `<tr class="accordion-tr"><td colspan="6" class="accordion-row" id="accordion-${c.company_id}">${_buildCompanyAccordion(c)}</td></tr>`;
      }
    });
  }

  const addCompanyFormHTML = _addCompanyFormOpen ? _buildAddCompanyForm() : `
    <div style="padding:12px 0 0;">
      <button class="btn btn-secondary btn-sm" onclick="_openAddCompanyForm()">+ Add Target Company</button>
    </div>`;

  container.innerHTML = `
    ${filterHTML}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Company Name</th>
            <th>HQ</th>
            <th>Revenue Tier</th>
            <th>Ownership</th>
            <th>Roles to Target</th>
            <th style="min-width:220px;">Coverage</th>
          </tr>
        </thead>
        <tbody id="companies-tbody">${tableRows}</tbody>
      </table>
    </div>
    <div id="add-company-form-container">${addCompanyFormHTML}</div>`;

  // Restore filter values
  const rv = document.getElementById('c-revenue');
  const ow = document.getElementById('c-ownership');
  const sr = document.getElementById('c-search');
  if (rv) rv.value = _companyFilters.revenueTier;
  if (ow) ow.value = _companyFilters.ownershipType;
  if (sr) sr.value = _companyFilters.search;
}

function _companyFilterChanged() {
  _companyFilters.revenueTier    = document.getElementById('c-revenue').value;
  _companyFilters.ownershipType  = document.getElementById('c-ownership').value;
  _companyFilters.search         = document.getElementById('c-search').value;
  _openAccordionId = null;
  _renderCompaniesTab();
}

function _toggleCompanyAccordion(companyId) {
  _openAccordionId = (_openAccordionId === companyId) ? null : companyId;
  _renderCompaniesTab();
}

// ── COMPANY ACCORDION ─────────────────────────────────────────────────────────

function _buildCompanyAccordion(company) {
  const roster = company.roster || [];
  const isManual = company.roster_completeness === 'manual-complete';

  let rosterHTML = '';
  if (roster.length === 0) {
    rosterHTML = `<p class="text-muted text-sm" style="margin:8px 0 12px;">No candidates in roster yet.</p>`;
  } else {
    const rows = roster.map((c, idx) => {
      const _nl = c.candidate_id ? `<span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${(c.candidate_id||'').replace(/'/g,'\\\'')}')">${c.name}</span>` : c.name;
      const nameCell = c.linkedin_url
        ? `${_nl} <a href="${c.linkedin_url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0077B5;margin-left:4px;font-size:11px">in</a>`
        : _nl;
      const statusOpts = ROSTER_STATUSES.map(s =>
        `<option value="${s}" ${c.roster_status === s ? 'selected' : ''}>${s}</option>`
      ).join('');
      return `
        <tr>
          <td>${nameCell}</td>
          <td>${c.title}</td>
          <td>
            <select class="form-control" style="padding:3px 6px;font-size:0.8rem;"
                    onchange="_updateCandidateStatus('${company.company_id}', ${idx}, this.value, true)">
              ${statusOpts}
            </select>
          </td>
          <td style="white-space:nowrap">
            <button onclick="event.stopPropagation();openAddToPipelineModal({candidate_id:'${(c.candidate_id||'').replace(/'/g,"\\'")}',name:'${(c.name||'').replace(/'/g,"\\'")}',current_title:'${(c.title||'').replace(/'/g,"\\'")}',current_firm:'',location:'',linkedin_url:'${(c.linkedin_url||'').replace(/'/g,"\\'")}',archetype:''},{source:'All-star pool'})" title="Add to Pipeline" style="background:#6B2D5B;color:#fff;border:none;width:24px;height:24px;border-radius:5px;cursor:pointer;font-size:12px;display:inline-flex;align-items:center;justify-content:center">&#8594;</button>
            <button class="btn btn-danger btn-sm" style="padding:3px 8px;"
                    onclick="_removeCandidate('${company.company_id}', ${idx}, true)">&#10005;</button>
          </td>
        </tr>`;
    }).join('');
    rosterHTML = `
      <table class="roster-table" style="margin-bottom:12px;">
        <thead>
          <tr><th>Name</th><th>Title</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  const overrideHTML = `
    <div class="override-section" style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
      <strong style="font-size:0.85rem;">Coverage Override</strong>
      <div style="display:flex;gap:16px;margin-top:8px;align-items:center;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;">
          <input type="radio" name="override-${company.company_id}" value="auto"
                 ${!isManual ? 'checked' : ''}
                 onchange="_handleCoverageOverride('${company.company_id}', 'auto', true)"> Auto
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;">
          <input type="radio" name="override-${company.company_id}" value="manual-complete"
                 ${isManual ? 'checked' : ''}
                 onchange="_handleCoverageOverride('${company.company_id}', 'manual-complete', true)"> Mark as Complete
        </label>
        ${isManual ? `
          <input type="text" id="override-note-${company.company_id}"
                 class="form-control" style="max-width:300px;font-size:0.85rem;"
                 placeholder="Note (optional)"
                 value="${(company.manual_complete_note || '').replace(/"/g, '&quot;')}">
          <button class="btn btn-primary btn-sm"
                  onclick="_saveOverrideNote('${company.company_id}', true)">Save Note</button>
        ` : ''}
      </div>
    </div>`;

  const addPersonHTML = `
    <div class="add-person-form" style="margin-top:12px;">
      <strong style="font-size:0.85rem;">Add Person to Roster</strong>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;margin-top:8px;align-items:end;flex-wrap:wrap;">
        <div>
          <label class="form-label" style="margin-bottom:4px;">Name *</label>
          <input type="text" id="apc-name-${company.company_id}" class="form-control" placeholder="Full name" />
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">Title *</label>
          ${_buildTitleSelect('apc-', company.company_id)}
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">LinkedIn URL</label>
          <input type="text" id="apc-li-${company.company_id}" class="form-control" placeholder="https://linkedin.com/in/…" />
        </div>
        <div>
          <label class="form-label" style="margin-bottom:4px;">Status</label>
          <select id="apc-status-${company.company_id}" class="form-control">
            ${ROSTER_STATUSES.map(s => `<option value="${s}" ${s === 'Identified' ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <button class="btn btn-primary btn-sm" style="margin-top:8px;"
              onclick="_addPersonToCompany('${company.company_id}')">Add to Roster</button>
    </div>`;

  return `
    <div style="padding:4px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <strong>${company.name} Roster</strong>
        <span class="text-muted text-sm">${roster.length} / ${company.custom_roster_size || company.expected_roster_size} identified</span>
      </div>
      ${rosterHTML}
      ${addPersonHTML}
      ${overrideHTML}
    </div>`;
}

async function _addPersonToCompany(companyId) {
  const name   = document.getElementById(`apc-name-${companyId}`).value.trim();
  const title  = _getTitleValue('apc-', companyId);
  const li     = document.getElementById(`apc-li-${companyId}`).value.trim();
  const status = document.getElementById(`apc-status-${companyId}`).value;

  if (!name || !title) {
    appAlert('Name and Title are required.', { type: 'warning' });
    return;
  }

  await _saveNewTitleIfNeeded('apc-', companyId);

  const s = _currentSector;
  const company = s.target_companies.find(c => c.company_id === companyId);
  if (!company) return;

  const candidateId = companyId + '-' + name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
  company.roster.push({
    candidate_id: candidateId,
    name,
    title,
    linkedin_url: li,
    roster_status: status,
    last_updated: new Date().toISOString().slice(0, 10),
    searches_appeared_in: []
  });

  await saveSector(s);
  _renderCompaniesTab();
}

// ── ADD COMPANY FORM ──────────────────────────────────────────────────────────

function _openAddCompanyForm() {
  _addCompanyFormOpen = true;
  const container = document.getElementById('add-company-form-container');
  if (container) container.innerHTML = _buildAddCompanyForm();
}

function _closeAddCompanyForm() {
  _addCompanyFormOpen = false;
  const container = document.getElementById('add-company-form-container');
  if (container) container.innerHTML = `
    <div style="padding:12px 0 0;">
      <button class="btn btn-secondary btn-sm" onclick="_openAddCompanyForm()">+ Add Target Company</button>
    </div>`;
}

function _buildAddCompanyForm() {
  return `
    <div class="add-firm-form" style="margin-top:16px;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:20px;">
      <h3 style="margin-bottom:16px;font-size:1rem;">Add New Target Company</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
        <div>
          <label class="form-label">Company Name *</label>
          <input type="text" id="nc-name" class="form-control" placeholder="Company name" />
        </div>
        <div>
          <label class="form-label">HQ (City, State) *</label>
          <input type="text" id="nc-hq" class="form-control" placeholder="Cleveland, OH" />
        </div>
        <div>
          <label class="form-label">Revenue Tier *</label>
          <select id="nc-revenue" class="form-control">
            <option value="Large Cap">Large Cap</option>
            <option value="Upper Middle">Upper Middle</option>
            <option value="Middle Market" selected>Middle Market</option>
            <option value="Lower Middle">Lower Middle</option>
          </select>
        </div>
        <div>
          <label class="form-label">Ownership Type *</label>
          <select id="nc-ownership" class="form-control">
            <option value="Public">Public</option>
            <option value="PE-Backed" selected>PE-Backed</option>
            <option value="Family-Owned">Family-Owned</option>
            <option value="Recently Exited">Recently Exited</option>
          </select>
        </div>
        <div>
          <label class="form-label">Roles to Target</label>
          <input type="text" id="nc-roles" class="form-control" placeholder="CEO, COO, President" />
        </div>
        <div>
          <label class="form-label">Custom Roster Size</label>
          <input type="number" id="nc-custom-roster" class="form-control" placeholder="Leave blank for tier default" min="1" />
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label class="form-label">Why Target</label>
        <textarea id="nc-why" class="form-control" rows="2" placeholder="Why this company is relevant…"></textarea>
      </div>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-primary btn-sm" onclick="_submitAddCompany()">Add Company</button>
        <button class="btn btn-ghost btn-sm" onclick="_closeAddCompanyForm()">Cancel</button>
      </div>
    </div>`;
}

async function _submitAddCompany() {
  const name          = document.getElementById('nc-name').value.trim();
  const hq            = document.getElementById('nc-hq').value.trim();
  const revenueTier   = document.getElementById('nc-revenue').value;
  const ownershipType = document.getElementById('nc-ownership').value;
  const roles         = document.getElementById('nc-roles').value.trim();
  const why           = document.getElementById('nc-why').value.trim();
  const customRaw     = document.getElementById('nc-custom-roster').value.trim();
  const customRoster  = customRaw ? parseInt(customRaw, 10) : undefined;

  if (!name || !hq) {
    appAlert('Company Name and HQ are required.', { type: 'warning' });
    return;
  }

  const s = _currentSector;
  const companyId = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const expectedRosterSize = REVENUE_ROSTER_DEFAULTS[revenueTier] || 5;

  const newCompany = {
    company_id: companyId,
    name,
    hq,
    revenue_tier: revenueTier,
    ownership_type: ownershipType,
    roles_to_target: roles,
    why_target: why,
    expected_roster_size: expectedRosterSize,
    roster: [],
    roster_completeness: 'auto'
  };
  if (customRoster && !isNaN(customRoster)) {
    newCompany.custom_roster_size = customRoster;
  }

  s.target_companies.push(newCompany);
  _addCompanyFormOpen = false;
  await saveSector(s);
  _renderCompaniesTab();
}

// ── ALL-STAR TAB ──────────────────────────────────────────────────────────────

async function _renderAllstarTab() {
  const container = document.getElementById('tab-content');
  const s = _currentSector;
  const pool = s.allstar_pool || [];

  if (pool.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:60px 20px;text-align:center;background:#fff;border:1px solid #e0e0e0;border-radius:8px;">
        <div class="empty-state-icon">&#11088;</div>
        <p style="margin-top:12px;color:#757575;font-size:0.95rem;">
          No all-stars added yet. Candidates are promoted here at search close.
        </p>
      </div>`;
    return;
  }

  // Load candidate details
  container.innerHTML = `<div class="loading"><div class="spinner"></div> Loading candidates…</div>`;

  let allCandidates = [];
  try {
    const data = await api('GET', '/candidates');
    allCandidates = data.candidates || [];
  } catch (e) {
    // Candidate pool may be empty; proceed with IDs only
  }

  const poolCandidates = pool.map(id => {
    const match = allCandidates.find(c => c.candidate_id === id);
    return match || { candidate_id: id, name: id, _missing: true };
  });

  // Apply filters
  let filtered = poolCandidates.filter(c => {
    if (_allstarFilters.archetype !== 'All' && c.archetype !== _allstarFilters.archetype) return false;
    if (_allstarFilters.rating !== 'All') {
      const stars = _allstarFilters.rating.replace(/★/g, '').length;
      if (c.rating !== stars) return false;
    }
    if (_allstarFilters.availability !== 'All' && c.availability !== _allstarFilters.availability) return false;
    if (_allstarFilters.search) {
      const q = _allstarFilters.search.toLowerCase();
      const name = (c.name || '').toLowerCase();
      const role = (c.current_role || c.title || '').toLowerCase();
      if (!name.includes(q) && !role.includes(q)) return false;
    }
    return true;
  });

  const filterHTML = `
    <div class="filter-bar">
      <span class="filter-label">Filter:</span>
      <select id="as-archetype" onchange="_allstarFilterChanged()">
        <option value="All">All Archetypes</option>
        <option value="PE Lateral">PE Lateral</option>
        <option value="Industry Operator">Industry Operator</option>
        <option value="Functional Expert">Functional Expert</option>
      </select>
      <select id="as-rating" onchange="_allstarFilterChanged()">
        <option value="All">All Ratings</option>
        <option value="★★★">★★★</option>
        <option value="★★">★★</option>
        <option value="★">★</option>
      </select>
      <select id="as-avail" onchange="_allstarFilterChanged()">
        <option value="All">All Availability</option>
        <option value="Open">Open</option>
        <option value="Passive">Passive</option>
        <option value="Unknown">Unknown</option>
        <option value="Not Interested">Not Interested</option>
        <option value="Placed">Placed</option>
      </select>
      <input type="text" id="as-search" placeholder="Search candidates…"
             oninput="_allstarFilterChanged()" style="flex:1;min-width:160px;" />
    </div>`;

  let tableRows = '';
  if (filtered.length === 0) {
    tableRows = `<tr><td colspan="7" style="padding:32px;text-align:center;color:#757575;">No candidates match the current filters.</td></tr>`;
  } else {
    filtered.forEach(c => {
      const stars = c.rating ? '★'.repeat(c.rating) + '☆'.repeat(Math.max(0, 3 - c.rating)) : '—';
      const name = c.linkedin_url
        ? `<a href="${c.linkedin_url}" target="_blank" rel="noopener">${c.name}</a>`
        : (c.name || c.candidate_id);
      const avail = c.availability || '—';
      const availColor = avail === 'Open' ? '#4caf50' : avail === 'Passive' ? '#ff9800' : '#9e9e9e';
      tableRows += `
        <tr style="cursor:pointer;" onclick="_openAllstarDetail('${c.candidate_id}')">
          <td>${name}</td>
          <td>${c.location || c.hq || '—'}</td>
          <td>${c.current_role || c.title || '—'}</td>
          <td>${c.archetype ? genericPill(c.archetype) : '—'}</td>
          <td style="font-size:1rem;letter-spacing:1px;">${stars}</td>
          <td><span style="color:${availColor};font-weight:600;font-size:0.85rem;">${avail}</span></td>
          <td>${formatDate(c.last_contact || c.last_updated)}</td>
        </tr>`;
    });
  }

  container.innerHTML = `
    ${filterHTML}
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Location</th>
            <th>Current Role</th>
            <th>Archetype</th>
            <th>Rating</th>
            <th>Availability</th>
            <th>Last Contact</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;

  // Restore filters
  const ael = document.getElementById('as-archetype');
  const rel = document.getElementById('as-rating');
  const vel = document.getElementById('as-avail');
  const sel = document.getElementById('as-search');
  if (ael) ael.value = _allstarFilters.archetype;
  if (rel) rel.value = _allstarFilters.rating;
  if (vel) vel.value = _allstarFilters.availability;
  if (sel) sel.value = _allstarFilters.search;
}

function _allstarFilterChanged() {
  _allstarFilters.archetype    = document.getElementById('as-archetype').value;
  _allstarFilters.rating       = document.getElementById('as-rating').value;
  _allstarFilters.availability = document.getElementById('as-avail').value;
  _allstarFilters.search       = document.getElementById('as-search').value;
  _renderAllstarTab();
}

function _openAllstarDetail(candidateId) {
  // Fetch candidate and show modal
  api('GET', '/candidates').then(data => {
    const candidates = data.candidates || [];
    const c = candidates.find(x => x.candidate_id === candidateId);
    if (!c) {
      appAlert('Candidate details not found.', { type: 'warning' });
      return;
    }
    _showCandidateModal(c);
  }).catch(() => appAlert('Could not load candidate details.', { type: 'error' }));
}

function _showCandidateModal(c) {
  const existing = document.getElementById('allstar-modal');
  if (existing) existing.remove();

  const fields = [
    ['Name', c.name],
    ['Current Role', c.current_role || c.title],
    ['Location', c.location || c.hq],
    ['Archetype', c.archetype],
    ['Rating', c.rating ? '★'.repeat(c.rating) : '—'],
    ['Availability', c.availability],
    ['LinkedIn', c.linkedin_url ? `<a href="${c.linkedin_url}" target="_blank">${c.linkedin_url}</a>` : '—'],
    ['Last Contact', formatDate(c.last_contact || c.last_updated)],
    ['Notes', c.notes || '—']
  ].filter(([, v]) => v).map(([label, val]) => `
    <div style="margin-bottom:12px;">
      <span class="form-label">${label}</span>
      <div style="font-size:0.9rem;color:#212121;">${val}</div>
    </div>`).join('');

  const modal = document.createElement('div');
  modal.id = 'allstar-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-header">
        <span class="modal-title">${c.name || 'Candidate Detail'}</span>
        <button class="modal-close" onclick="document.getElementById('allstar-modal').remove()">&#10005;</button>
      </div>
      <div class="modal-body">${fields}</div>
    </div>`;

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);
}
