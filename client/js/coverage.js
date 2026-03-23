/* ── Lancor Search OS — coverage.js ─────────────────────────────────────────
   Session 4: Sourcing Coverage module
   All functions called from searches.js or via inline onclick handlers.
   renderCoverageTabHTML() returns an HTML string (no DOM manipulation).
   All mutation functions are async and manipulate DOM after saving.
   ──────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Module-level state ────────────────────────────────────────────────────────

let coverageSubTab = 'pe-firms'; // 'pe-firms' | 'companies'
let coverageFilters = {
  size_tier: 'all',
  revenue_tier: 'all',
  text: ''
};
let openAccordionId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function escCov(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getCoveragePct(entity, type) {
  if (entity.manual_complete) return { pct: 100, manual: true };
  const sizeMap = { 'Mega': 22, 'Large': 11, 'Middle Market': 6, 'Lower Middle Market': 3 };
  const revMap  = { 'Large Cap': 18, 'Upper Middle': 10, 'Middle Market': 5, 'Lower Middle': 2 };
  const expected = type === 'pe_firms'
    ? (entity.custom_roster_size || sizeMap[entity.size_tier] || 6)
    : (entity.custom_roster_size || revMap[entity.revenue_tier] || 5);
  const pct = Math.min(100, Math.round(((entity.roster || []).length / expected) * 100));
  return { pct, manual: false };
}

function coverageBar(pct, manual_complete) {
  let color, label;
  if (manual_complete) { color = '#5C2D91'; label = 'Manual Complete'; pct = 100; }
  else if (pct === 0)  { color = '#bdbdbd'; label = 'Unsearched'; }
  else if (pct <= 25)  { color = '#ef5350'; label = 'Low'; }
  else if (pct <= 55)  { color = '#ff9800'; label = 'Moderate'; }
  else if (pct <= 85)  { color = '#4caf50'; label = 'Good'; }
  else                 { color = '#009688'; label = 'High'; }
  return `<div class="coverage-bar-container">
    <div class="coverage-bar" style="width:120px">
      <div class="coverage-bar-fill" style="width:${pct}%;background:${color}"></div>
    </div>
    <span style="font-size:12px;color:#555;min-width:36px;display:inline-block">${pct}%</span>
    <span class="coverage-label" style="color:${color}">${label}</span>
  </div>`;
}

// Roster status options
const ROSTER_STATUSES = [
  'Identified', 'Outreach sent', 'Responded', 'In pipeline',
  'In pursuit', 'Placed', 'DQ this search', 'DQ permanent', 'NI', 'NI permanent'
];

function rosterStatusSelect(entityId, candidateId, currentStatus, searchId, type) {
  const opts = ROSTER_STATUSES.map(s =>
    `<option value="${escCov(s)}" ${s === currentStatus ? 'selected' : ''}>${escCov(s)}</option>`
  ).join('');
  return `<select class="roster-status-select" onchange="updateRosterPersonStatus('${escCov(searchId)}','${type}','${escCov(entityId)}','${escCov(candidateId)}',this.value)">${opts}</select>`;
}

function addPersonFormHTML(entityId, searchId, type) {
  const statusOpts = ROSTER_STATUSES.map(s =>
    `<option value="${escCov(s)}" ${s === 'Identified' ? 'selected' : ''}>${escCov(s)}</option>`
  ).join('');
  return `
  <div class="add-person-form" id="add-form-${escCov(entityId)}">
    <input type="text" id="add-name-${escCov(entityId)}" placeholder="Name (required)" />
    <input type="text" id="add-title-${escCov(entityId)}" placeholder="Title" />
    <input type="text" id="add-linkedin-${escCov(entityId)}" placeholder="LinkedIn URL" style="min-width:160px" />
    <select id="add-status-${escCov(entityId)}">${statusOpts}</select>
    <button class="btn btn-primary btn-sm" onclick="addRosterPerson('${escCov(searchId)}','${type}','${escCov(entityId)}')">Add</button>
  </div>`;
}

function overrideSectionHTML(entity, entityId, searchId, type) {
  const isManual = entity.manual_complete;
  const note = escCov(entity.manual_complete_note || '');
  return `
  <div class="override-section">
    <strong style="font-size:13px;display:block;margin-bottom:8px">Coverage Override</strong>
    <label class="override-section">
      <input type="radio" name="override-${escCov(entityId)}" value="auto" ${!isManual ? 'checked' : ''} />
      Auto (calculated)
    </label>
    <label class="override-section">
      <input type="radio" name="override-${escCov(entityId)}" value="manual" ${isManual ? 'checked' : ''} />
      Mark as Complete
    </label>
    <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="override-note-${escCov(entityId)}" value="${note}" placeholder="Note (optional)" style="padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;flex:1;min-width:160px" />
      <button class="btn btn-secondary btn-sm" onclick="saveCoverageOverride('${escCov(searchId)}','${type}','${escCov(entityId)}')">Save Override</button>
    </div>
  </div>`;
}

function rosterTableHTML(roster, entityId, searchId, type) {
  if (!roster || roster.length === 0) {
    return `<p style="font-size:13px;color:#888;margin-bottom:8px">No people on roster yet.</p>`;
  }
  const rows = roster.map(p => {
    const nameCell = p.linkedin_url
      ? `<a href="${escCov(p.linkedin_url)}" target="_blank" rel="noopener" style="color:#5C2D91">${escCov(p.name)}</a>`
      : escCov(p.name);
    return `<tr>
      <td>${nameCell}</td>
      <td>${escCov(p.title || '')}</td>
      <td>${rosterStatusSelect(entityId, p.candidate_id, p.roster_status, searchId, type)}</td>
      <td><button class="btn btn-ghost btn-sm" style="color:#c62828;padding:2px 6px;font-size:12px" onclick="removeRosterPerson('${escCov(searchId)}','${type}','${escCov(entityId)}','${escCov(p.candidate_id)}')">&#x2715;</button></td>
    </tr>`;
  }).join('');
  return `<table class="roster-table">
    <thead><tr><th>Name</th><th>Title</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function accordionHTML(entity, entityId, searchId, type) {
  const roster = entity.roster || [];
  const promoteSection = entity.search_specific
    ? `<div style="margin-top:12px">
        <button class="btn btn-secondary btn-sm promote-btn" onclick="promoteToPlaybook('${escCov(searchId)}','${type}','${escCov(entityId)}')">&#8593; Promote to Playbook</button>
        <span style="font-size:12px;color:#888;margin-left:8px">Remove the "Search Only" flag and add to the sector playbook.</span>
       </div>`
    : '';
  return `<tr class="accordion-tr" id="acc-${escCov(entityId)}">
    <td colspan="6">
      <div class="accordion-inner">
        <div id="roster-section-${escCov(entityId)}">
          ${rosterTableHTML(roster, entityId, searchId, type)}
        </div>
        <div style="margin-top:4px">
          <strong style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px">Add Person</strong>
          ${addPersonFormHTML(entityId, searchId, type)}
        </div>
        ${overrideSectionHTML(entity, entityId, searchId, type)}
        ${promoteSection}
      </div>
    </td>
  </tr>`;
}

// ── PE Firms table ────────────────────────────────────────────────────────────

function buildPEFirmsTableHTML(firms, searchId) {
  // Filter
  const filtered = firms.filter(f => {
    if (coverageFilters.size_tier !== 'all' && f.size_tier !== coverageFilters.size_tier) return false;
    if (coverageFilters.text) {
      const q = coverageFilters.text.toLowerCase();
      if (!(f.name || '').toLowerCase().includes(q) && !(f.hq || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sort: manual_complete last; within others, sort by pct ascending (Unsearched 0% first)
  filtered.sort((a, b) => {
    if (a.manual_complete && !b.manual_complete) return 1;
    if (!a.manual_complete && b.manual_complete) return -1;
    const pa = getCoveragePct(a, 'pe_firms').pct;
    const pb = getCoveragePct(b, 'pe_firms').pct;
    return pa - pb;
  });

  const filterBar = `
  <div class="filter-bar" id="coverage-filters" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <select id="cov-filter-size" onchange="applyCoverageFilters('${escCov(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      <option value="all" ${coverageFilters.size_tier === 'all' ? 'selected' : ''}>All Size Tiers</option>
      <option value="Mega" ${coverageFilters.size_tier === 'Mega' ? 'selected' : ''}>Mega</option>
      <option value="Large" ${coverageFilters.size_tier === 'Large' ? 'selected' : ''}>Large</option>
      <option value="Middle Market" ${coverageFilters.size_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
      <option value="Lower Middle Market" ${coverageFilters.size_tier === 'Lower Middle Market' ? 'selected' : ''}>Lower Middle Market</option>
    </select>
    <input type="text" id="cov-filter-text" value="${escCov(coverageFilters.text)}" placeholder="Search firm name..." oninput="applyCoverageFilters('${escCov(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;min-width:180px" />
    <span style="font-size:12px;color:#888">${filtered.length} firm${filtered.length !== 1 ? 's' : ''}</span>
  </div>`;

  if (filtered.length === 0) {
    return filterBar + `<div style="padding:32px;text-align:center;color:#888;font-size:14px">No PE firms loaded — use "Add PE Firm" below to get started.</div>`;
  }

  const rows = filtered.flatMap(f => {
    const { pct, manual } = getCoveragePct(f, 'pe_firms');
    const isOpen = openAccordionId === f.firm_id;
    const badge = f.search_specific
      ? `<span class="badge-search-specific" id="badge-${escCov(f.firm_id)}">Search Only</span>`
      : '';
    const firmRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escCov(f.firm_id)}" onclick="toggleCoverageAccordion('${escCov(searchId)}','pe_firms','${escCov(f.firm_id)}')">
      <td><strong>${escCov(f.name)}</strong></td>
      <td>${escCov(f.hq || '—')}</td>
      <td>${escCov(f.size_tier || '—')}</td>
      <td>${badge}</td>
      <td id="covbar-${escCov(f.firm_id)}">${coverageBar(pct, manual)}</td>
      <td>${escCov(f.why_target || '')}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(f, f.firm_id, searchId, 'pe_firms') : `<tr class="accordion-tr" id="acc-${escCov(f.firm_id)}" style="display:none"><td colspan="6"></td></tr>`;
    return [firmRow, accRow];
  });

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th>Firm Name</th>
      <th>HQ</th>
      <th>Size Tier</th>
      <th>Search-Specific</th>
      <th>Coverage</th>
      <th>Why Target</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

// ── Companies table ───────────────────────────────────────────────────────────

function buildCompaniesTableHTML(companies, searchId) {
  const filtered = companies.filter(c => {
    if (coverageFilters.revenue_tier !== 'all' && c.revenue_tier !== coverageFilters.revenue_tier) return false;
    if (coverageFilters.text) {
      const q = coverageFilters.text.toLowerCase();
      if (!(c.name || '').toLowerCase().includes(q) && !(c.hq || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (a.manual_complete && !b.manual_complete) return 1;
    if (!a.manual_complete && b.manual_complete) return -1;
    const pa = getCoveragePct(a, 'companies').pct;
    const pb = getCoveragePct(b, 'companies').pct;
    return pa - pb;
  });

  const filterBar = `
  <div class="filter-bar" id="coverage-filters" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <select id="cov-filter-rev" onchange="applyCoverageFilters('${escCov(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      <option value="all" ${coverageFilters.revenue_tier === 'all' ? 'selected' : ''}>All Revenue Tiers</option>
      <option value="Large Cap" ${coverageFilters.revenue_tier === 'Large Cap' ? 'selected' : ''}>Large Cap</option>
      <option value="Upper Middle" ${coverageFilters.revenue_tier === 'Upper Middle' ? 'selected' : ''}>Upper Middle</option>
      <option value="Middle Market" ${coverageFilters.revenue_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
      <option value="Lower Middle" ${coverageFilters.revenue_tier === 'Lower Middle' ? 'selected' : ''}>Lower Middle</option>
    </select>
    <input type="text" id="cov-filter-text" value="${escCov(coverageFilters.text)}" placeholder="Search company name..." oninput="applyCoverageFilters('${escCov(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;min-width:180px" />
    <span style="font-size:12px;color:#888">${filtered.length} compan${filtered.length !== 1 ? 'ies' : 'y'}</span>
  </div>`;

  if (filtered.length === 0) {
    return filterBar + `<div style="padding:32px;text-align:center;color:#888;font-size:14px">No target companies loaded — use "Add Target Company" below to get started.</div>`;
  }

  const rows = filtered.flatMap(c => {
    const { pct, manual } = getCoveragePct(c, 'companies');
    const isOpen = openAccordionId === c.company_id;
    const badge = c.search_specific
      ? `<span class="badge-search-specific" id="badge-${escCov(c.company_id)}">Search Only</span>`
      : '';
    const compRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escCov(c.company_id)}" onclick="toggleCoverageAccordion('${escCov(searchId)}','companies','${escCov(c.company_id)}')">
      <td><strong>${escCov(c.name)}</strong></td>
      <td>${escCov(c.hq || '—')}</td>
      <td>${escCov(c.revenue_tier || '—')}</td>
      <td>${badge}</td>
      <td id="covbar-${escCov(c.company_id)}">${coverageBar(pct, manual)}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(c, c.company_id, searchId, 'companies') : `<tr class="accordion-tr" id="acc-${escCov(c.company_id)}" style="display:none"><td colspan="5"></td></tr>`;
    return [compRow, accRow];
  });

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th>Company Name</th>
      <th>HQ</th>
      <th>Revenue Tier</th>
      <th>Search-Specific</th>
      <th>Coverage</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

// ── Main render entry point ───────────────────────────────────────────────────

function renderCoverageTabHTML(search) {
  // Reset state when tab first loads
  coverageSubTab = 'pe-firms';
  coverageFilters = { size_tier: 'all', revenue_tier: 'all', text: '' };
  openAccordionId = null;

  const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
  const firms = coverage.pe_firms || [];
  const companies = coverage.companies || [];
  const searchId = search.search_id;

  const tableHTML = buildPEFirmsTableHTML(firms, searchId);

  return `<div id="coverage-module">
  <!-- Sub-tab bar -->
  <div class="sub-tab-bar">
    <button class="sub-tab active" id="cov-tab-pe" onclick="switchCoverageTab('pe-firms','${escCov(searchId)}')">PE Firms (${firms.length})</button>
    <button class="sub-tab" id="cov-tab-companies" onclick="switchCoverageTab('companies','${escCov(searchId)}')">Target Companies (${companies.length})</button>
  </div>
  <!-- Filter bar + table (rendered together) -->
  <div id="coverage-table">
    ${tableHTML}
  </div>
  <!-- Add button row -->
  <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
    <button class="btn btn-secondary btn-sm" id="cov-add-btn" onclick="openAddFirmModal('${escCov(searchId)}')">+ Add PE Firm</button>
    <button class="btn btn-ghost btn-sm" onclick="loadCoverageFromPlaybook('${escCov(searchId)}')" title="Pull all firms/companies from selected sector playbooks into this search's coverage tracker">&#8627; Load from Playbook</button>
  </div>
</div>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

async function switchCoverageTab(tab, searchId) {
  coverageSubTab = tab;
  openAccordionId = null;
  // Reset text filter but preserve tier filter relevant to the tab
  coverageFilters.text = '';

  // Update button active states immediately
  const peBtn = document.getElementById('cov-tab-pe');
  const coBtn = document.getElementById('cov-tab-companies');
  const addBtn = document.getElementById('cov-add-btn');
  if (peBtn) peBtn.classList.toggle('active', tab === 'pe-firms');
  if (coBtn) coBtn.classList.toggle('active', tab === 'companies');

  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const firms = coverage.pe_firms || [];
    const companies = coverage.companies || [];

    const tableEl = document.getElementById('coverage-table');
    if (!tableEl) return;

    if (tab === 'pe-firms') {
      coverageFilters.revenue_tier = 'all';
      tableEl.innerHTML = buildPEFirmsTableHTML(firms, searchId);
      if (addBtn) { addBtn.textContent = '+ Add PE Firm'; addBtn.setAttribute('onclick', `openAddFirmModal('${escCov(searchId)}')`); }
      // Update sub-tab counts
      if (peBtn) peBtn.textContent = `PE Firms (${firms.length})`;
      if (coBtn) coBtn.textContent = `Target Companies (${companies.length})`;
    } else {
      coverageFilters.size_tier = 'all';
      tableEl.innerHTML = buildCompaniesTableHTML(companies, searchId);
      if (addBtn) { addBtn.textContent = '+ Add Target Company'; addBtn.setAttribute('onclick', `openAddCompanyModal('${escCov(searchId)}')`); }
      if (peBtn) peBtn.textContent = `PE Firms (${firms.length})`;
      if (coBtn) coBtn.textContent = `Target Companies (${companies.length})`;
    }
  } catch (e) {
    console.error('switchCoverageTab error:', e);
  }
}

// ── Accordion toggle ──────────────────────────────────────────────────────────

async function toggleCoverageAccordion(searchId, type, entityId) {
  if (openAccordionId === entityId) {
    // Close
    openAccordionId = null;
    const accEl = document.getElementById('acc-' + entityId);
    const rowEl = document.getElementById('row-' + entityId);
    if (accEl) accEl.style.display = 'none';
    if (rowEl) rowEl.classList.remove('open');
    return;
  }

  // Close any previously open accordion
  if (openAccordionId) {
    const prevAcc = document.getElementById('acc-' + openAccordionId);
    const prevRow = document.getElementById('row-' + openAccordionId);
    if (prevAcc) prevAcc.style.display = 'none';
    if (prevRow) prevRow.classList.remove('open');
  }

  openAccordionId = entityId;

  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? (coverage.pe_firms || []) : (coverage.companies || []);
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = list.find(e => e[idKey] === entityId);
    if (!entity) return;

    const accEl = document.getElementById('acc-' + entityId);
    const rowEl = document.getElementById('row-' + entityId);
    if (!accEl) return;

    // Build accordion content
    const inner = accordionHTML(entity, entityId, searchId, type);
    // Replace the placeholder tr with full content
    const tmp = document.createElement('tbody');
    tmp.innerHTML = inner;
    const newTr = tmp.querySelector('tr.accordion-tr');
    if (newTr) {
      accEl.parentNode.replaceChild(newTr, accEl);
    }
    if (rowEl) rowEl.classList.add('open');
  } catch (e) {
    console.error('toggleCoverageAccordion error:', e);
  }
}

// ── Filter application ────────────────────────────────────────────────────────

async function applyCoverageFilters(searchId) {
  // Read current filter values from DOM
  if (coverageSubTab === 'pe-firms') {
    const sizeEl = document.getElementById('cov-filter-size');
    if (sizeEl) coverageFilters.size_tier = sizeEl.value;
  } else {
    const revEl = document.getElementById('cov-filter-rev');
    if (revEl) coverageFilters.revenue_tier = revEl.value;
  }
  const textEl = document.getElementById('cov-filter-text');
  if (textEl) coverageFilters.text = textEl.value;

  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const tableEl = document.getElementById('coverage-table');
    if (!tableEl) return;

    if (coverageSubTab === 'pe-firms') {
      tableEl.innerHTML = buildPEFirmsTableHTML(coverage.pe_firms || [], searchId);
    } else {
      tableEl.innerHTML = buildCompaniesTableHTML(coverage.companies || [], searchId);
    }
  } catch (e) {
    console.error('applyCoverageFilters error:', e);
  }
}

// ── Roster mutations ──────────────────────────────────────────────────────────

async function updateRosterPersonStatus(searchId, type, entityId, candidateId, newStatus) {
  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    const person = (entity.roster || []).find(p => p.candidate_id === candidateId);
    if (!person) return;
    person.roster_status = newStatus;
    person.last_updated = todayISO();
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);
    // Re-render roster section only
    const rosterEl = document.getElementById('roster-section-' + entityId);
    if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type);
    // Update coverage bar
    refreshCoverageBar(entity, entityId, type);
  } catch (e) {
    console.error('updateRosterPersonStatus error:', e);
  }
}

async function removeRosterPerson(searchId, type, entityId, candidateId) {
  if (!confirm('Remove this person from the roster?')) return;
  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    entity.roster = (entity.roster || []).filter(p => p.candidate_id !== candidateId);
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);
    // Re-render roster section
    const rosterEl = document.getElementById('roster-section-' + entityId);
    if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type);
    // Update coverage bar
    refreshCoverageBar(entity, entityId, type);
  } catch (e) {
    console.error('removeRosterPerson error:', e);
  }
}

async function addRosterPerson(searchId, type, entityId) {
  const nameEl = document.getElementById('add-name-' + entityId);
  const titleEl = document.getElementById('add-title-' + entityId);
  const linkedinEl = document.getElementById('add-linkedin-' + entityId);
  const statusEl = document.getElementById('add-status-' + entityId);

  const name = (nameEl ? nameEl.value.trim() : '');
  if (!name) { alert('Name is required.'); return; }

  const title = titleEl ? titleEl.value.trim() : '';
  const linkedin_url = linkedinEl ? linkedinEl.value.trim() : '';
  const roster_status = statusEl ? statusEl.value : 'Identified';

  const candidate_id = slugify(name + '-' + entityId);

  const person = {
    candidate_id,
    name,
    title,
    linkedin_url,
    roster_status,
    last_updated: todayISO(),
    searches_appeared_in: [searchId]
  };

  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    if (!entity.roster) entity.roster = [];
    entity.roster.push(person);
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);
    // Re-render roster section
    const rosterEl = document.getElementById('roster-section-' + entityId);
    if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type);
    // Update coverage bar
    refreshCoverageBar(entity, entityId, type);
    // Clear form
    if (nameEl) nameEl.value = '';
    if (titleEl) titleEl.value = '';
    if (linkedinEl) linkedinEl.value = '';
    if (statusEl) statusEl.value = 'Identified';
  } catch (e) {
    console.error('addRosterPerson error:', e);
    alert('Error saving person: ' + e.message);
  }
}

async function saveCoverageOverride(searchId, type, entityId) {
  const radios = document.querySelectorAll(`input[name="override-${entityId}"]`);
  let overrideValue = 'auto';
  radios.forEach(r => { if (r.checked) overrideValue = r.value; });
  const noteEl = document.getElementById('override-note-' + entityId);
  const note = noteEl ? noteEl.value.trim() : '';

  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    entity.manual_complete = (overrideValue === 'manual');
    entity.manual_complete_note = note;
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);
    refreshCoverageBar(entity, entityId, type);
    // Visual confirmation
    const saveBtn = event && event.target ? event.target : null;
    if (saveBtn) { saveBtn.textContent = 'Saved!'; setTimeout(() => { saveBtn.textContent = 'Save Override'; }, 1500); }
  } catch (e) {
    console.error('saveCoverageOverride error:', e);
  }
}

// Helper: update the coverage bar cell in place (no full re-render)
function refreshCoverageBar(entity, entityId, type) {
  const barEl = document.getElementById('covbar-' + entityId);
  if (!barEl) return;
  const { pct, manual } = getCoveragePct(entity, type);
  barEl.innerHTML = coverageBar(pct, manual);
}

// ── Promote to playbook ───────────────────────────────────────────────────────

async function promoteToPlaybook(searchId, type, entityId) {
  if (!confirm('Promote this entry to the sector playbook? It will no longer be search-specific.')) return;
  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;

    // Get sector
    const sectorId = (search.sectors || [])[0];
    if (!sectorId) { alert('Search has no sector assigned. Cannot promote.'); return; }

    const playbooksData = await api('GET', '/playbooks');
    const sector = (playbooksData.sectors || []).find(s => s.sector_id === sectorId);
    if (!sector) { alert('Sector "' + sectorId + '" not found in playbooks.'); return; }

    if (type === 'pe_firms') {
      const pbFirms = sector.pe_firms || [];
      const alreadyExists = pbFirms.some(f => f.firm_id === entityId);
      if (!alreadyExists) {
        pbFirms.push({
          firm_id: entity.firm_id,
          name: entity.name,
          hq: entity.hq || '',
          size_tier: entity.size_tier || '',
          strategy: entity.strategy || '',
          sector_focus: entity.sector_focus || '',
          why_target: entity.why_target || '',
          roster: JSON.parse(JSON.stringify(entity.roster || []))
        });
        sector.pe_firms = pbFirms;
      }
    } else {
      const pbCos = sector.target_companies || [];
      const alreadyExists = pbCos.some(c => c.company_id === entityId);
      if (!alreadyExists) {
        pbCos.push({
          company_id: entity.company_id,
          name: entity.name,
          hq: entity.hq || '',
          revenue_tier: entity.revenue_tier || '',
          ownership_type: entity.ownership_type || '',
          why_target: entity.why_target || '',
          roster: JSON.parse(JSON.stringify(entity.roster || []))
        });
        sector.target_companies = pbCos;
      }
    }

    // Update playbook
    await api('PUT', '/playbooks/' + sectorId, sector);

    // Update search: clear search_specific flag
    entity.search_specific = false;
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);

    // Visual update
    const badgeEl = document.getElementById('badge-' + entityId);
    if (badgeEl) {
      badgeEl.className = 'badge-promoted';
      badgeEl.textContent = 'Promoted to Playbook';
    }
    // Hide promote button
    const accEl = document.getElementById('acc-' + entityId);
    if (accEl) {
      const promoteDiv = accEl.querySelector('.promote-btn');
      if (promoteDiv && promoteDiv.parentElement) promoteDiv.parentElement.style.display = 'none';
    }
  } catch (e) {
    console.error('promoteToPlaybook error:', e);
    alert('Error promoting to playbook: ' + e.message);
  }
}

// ── Add Firm modal ────────────────────────────────────────────────────────────

function openAddFirmModal(searchId) {
  const existing = document.getElementById('cov-add-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cov-add-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
  <div class="modal-box" style="max-width:520px">
    <div class="modal-header-s3">
      <span class="modal-title-s3">Add PE Firm</span>
      <button class="modal-close-s3" onclick="document.getElementById('cov-add-modal').remove()">&#x2715;</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:12px;color:#666;font-weight:600">Firm Name <span style="color:#ef5350">*</span></label>
        <input type="text" id="modal-firm-name" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. KKR" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">HQ</label>
          <input type="text" id="modal-firm-hq" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. New York, NY" />
        </div>
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Size Tier</label>
          <select id="modal-firm-size" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
            <option value="">— Select —</option>
            <option value="Mega">Mega</option>
            <option value="Large">Large</option>
            <option value="Middle Market">Middle Market</option>
            <option value="Lower Middle Market">Lower Middle Market</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Strategy</label>
          <input type="text" id="modal-firm-strategy" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. Buyout" />
        </div>
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Sector Focus</label>
          <input type="text" id="modal-firm-sector" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. Industrials" />
        </div>
      </div>
      <div>
        <label style="font-size:12px;color:#666;font-weight:600">Why Target</label>
        <textarea id="modal-firm-why" rows="2" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;resize:vertical" placeholder="Reason for targeting this firm..."></textarea>
      </div>
      <div>
        <label style="font-size:13px;cursor:pointer">
          <input type="checkbox" id="modal-firm-specific" checked style="margin-right:6px" />
          Search-specific (not in playbook)
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cov-add-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitAddFirm('${escCov(searchId)}')">Add Firm</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('modal-firm-name').focus();
}

async function submitAddFirm(searchId) {
  const name = (document.getElementById('modal-firm-name').value || '').trim();
  if (!name) { alert('Firm name is required.'); return; }
  const hq = (document.getElementById('modal-firm-hq').value || '').trim();
  const size_tier = document.getElementById('modal-firm-size').value;
  const strategy = (document.getElementById('modal-firm-strategy').value || '').trim();
  const sector_focus = (document.getElementById('modal-firm-sector').value || '').trim();
  const why_target = (document.getElementById('modal-firm-why').value || '').trim();
  const search_specific = document.getElementById('modal-firm-specific').checked;

  const firm_id = slugify(name);
  const newFirm = {
    firm_id,
    name,
    hq,
    size_tier,
    strategy,
    sector_focus,
    why_target,
    search_specific,
    manual_complete: false,
    manual_complete_note: '',
    roster: []
  };

  try {
    const search = await api('GET', '/searches/' + searchId);
    if (!search.sourcing_coverage) search.sourcing_coverage = { pe_firms: [], companies: [] };
    if (!search.sourcing_coverage.pe_firms) search.sourcing_coverage.pe_firms = [];
    search.sourcing_coverage.pe_firms.push(newFirm);
    await api('PUT', '/searches/' + searchId, search);
    document.getElementById('cov-add-modal').remove();
    // Re-render table
    const tableEl = document.getElementById('coverage-table');
    if (tableEl) tableEl.innerHTML = buildPEFirmsTableHTML(search.sourcing_coverage.pe_firms, searchId);
    // Update sub-tab count
    const peBtn = document.getElementById('cov-tab-pe');
    if (peBtn) peBtn.textContent = `PE Firms (${search.sourcing_coverage.pe_firms.length})`;
  } catch (e) {
    console.error('submitAddFirm error:', e);
    alert('Error adding firm: ' + e.message);
  }
}

// ── Add Company modal ─────────────────────────────────────────────────────────

function openAddCompanyModal(searchId) {
  const existing = document.getElementById('cov-add-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'cov-add-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
  <div class="modal-box" style="max-width:520px">
    <div class="modal-header-s3">
      <span class="modal-title-s3">Add Target Company</span>
      <button class="modal-close-s3" onclick="document.getElementById('cov-add-modal').remove()">&#x2715;</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      <div>
        <label style="font-size:12px;color:#666;font-weight:600">Company Name <span style="color:#ef5350">*</span></label>
        <input type="text" id="modal-co-name" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. Rexnord" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">HQ</label>
          <input type="text" id="modal-co-hq" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. Milwaukee, WI" />
        </div>
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Revenue Tier</label>
          <select id="modal-co-rev" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
            <option value="">— Select —</option>
            <option value="Large Cap">Large Cap</option>
            <option value="Upper Middle">Upper Middle</option>
            <option value="Middle Market">Middle Market</option>
            <option value="Lower Middle">Lower Middle</option>
          </select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Ownership Type</label>
          <input type="text" id="modal-co-ownership" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. Public, PE-backed" />
        </div>
        <div>
          <label style="font-size:12px;color:#666;font-weight:600">Roles to Target</label>
          <input type="text" id="modal-co-roles" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="e.g. VP Operations" />
        </div>
      </div>
      <div>
        <label style="font-size:12px;color:#666;font-weight:600">Why Target</label>
        <textarea id="modal-co-why" rows="2" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;resize:vertical" placeholder="Reason for targeting this company..."></textarea>
      </div>
      <div>
        <label style="font-size:13px;cursor:pointer">
          <input type="checkbox" id="modal-co-specific" checked style="margin-right:6px" />
          Search-specific (not in playbook)
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cov-add-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitAddCompany('${escCov(searchId)}')">Add Company</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('modal-co-name').focus();
}

async function submitAddCompany(searchId) {
  const name = (document.getElementById('modal-co-name').value || '').trim();
  if (!name) { alert('Company name is required.'); return; }
  const hq = (document.getElementById('modal-co-hq').value || '').trim();
  const revenue_tier = document.getElementById('modal-co-rev').value;
  const ownership_type = (document.getElementById('modal-co-ownership').value || '').trim();
  const roles_to_target = (document.getElementById('modal-co-roles').value || '').trim();
  const why_target = (document.getElementById('modal-co-why').value || '').trim();
  const search_specific = document.getElementById('modal-co-specific').checked;

  const company_id = slugify(name);
  const newCompany = {
    company_id,
    name,
    hq,
    revenue_tier,
    ownership_type,
    roles_to_target,
    why_target,
    search_specific,
    manual_complete: false,
    manual_complete_note: '',
    roster: []
  };

  try {
    const search = await api('GET', '/searches/' + searchId);
    if (!search.sourcing_coverage) search.sourcing_coverage = { pe_firms: [], companies: [] };
    if (!search.sourcing_coverage.companies) search.sourcing_coverage.companies = [];
    search.sourcing_coverage.companies.push(newCompany);
    await api('PUT', '/searches/' + searchId, search);
    document.getElementById('cov-add-modal').remove();
    // Re-render table
    const tableEl = document.getElementById('coverage-table');
    if (tableEl) tableEl.innerHTML = buildCompaniesTableHTML(search.sourcing_coverage.companies, searchId);
    // Update sub-tab count
    const coBtn = document.getElementById('cov-tab-companies');
    if (coBtn) coBtn.textContent = `Target Companies (${search.sourcing_coverage.companies.length})`;
  } catch (e) {
    console.error('submitAddCompany error:', e);
    alert('Error adding company: ' + e.message);
  }
}

// ── Load from Playbook ────────────────────────────────────────────────────────

async function loadCoverageFromPlaybook(searchId) {
  try {
    const search = await api('GET', '/searches/' + searchId);
    if (!search.sectors || search.sectors.length === 0) {
      alert('No sectors assigned to this search. Edit the search to add sectors first.');
      return;
    }

    const playbooks = await api('GET', '/playbooks');
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    let firmsAdded = 0, cosAdded = 0;

    search.sectors.forEach(sectorId => {
      const sector = playbooks.sectors.find(s => s.sector_id === sectorId);
      if (!sector) return;

      (sector.pe_firms || []).forEach(firm => {
        const exists = coverage.pe_firms.some(f => f.firm_id === firm.firm_id);
        if (!exists) {
          coverage.pe_firms.push({
            firm_id: firm.firm_id,
            name: firm.name,
            hq: firm.hq || '',
            size_tier: firm.size_tier || '',
            why_target: firm.why_target || '',
            search_specific: false,
            manual_complete: false,
            manual_complete_note: '',
            roster: JSON.parse(JSON.stringify(firm.roster || []))
          });
          firmsAdded++;
        }
      });

      (sector.target_companies || []).forEach(co => {
        const exists = coverage.companies.some(c => c.company_id === co.company_id);
        if (!exists) {
          coverage.companies.push({
            company_id: co.company_id,
            name: co.name,
            hq: co.hq || '',
            revenue_tier: co.revenue_tier || '',
            why_target: co.why_target || '',
            search_specific: false,
            manual_complete: false,
            manual_complete_note: '',
            roster: JSON.parse(JSON.stringify(co.roster || []))
          });
          cosAdded++;
        }
      });
    });

    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);

    // Re-render coverage module
    const tableEl = document.getElementById('coverage-table');
    const peBtn = document.getElementById('cov-tab-pe');
    const coBtn = document.getElementById('cov-tab-companies');
    if (tableEl) tableEl.innerHTML = buildPEFirmsTableHTML(coverage.pe_firms, searchId);
    if (peBtn) peBtn.textContent = `PE Firms (${coverage.pe_firms.length})`;
    if (coBtn) coBtn.textContent = `Target Companies (${coverage.companies.length})`;
    coverageSubTab = 'pe-firms';

    const msg = `Loaded ${firmsAdded} PE firm${firmsAdded !== 1 ? 's' : ''} and ${cosAdded} compan${cosAdded !== 1 ? 'ies' : 'y'} from playbook.`;
    const banner = document.createElement('div');
    banner.style.cssText = 'background:#e8f5e9;color:#2e7d32;border-radius:6px;padding:10px 16px;font-size:13px;font-weight:600;margin-bottom:12px';
    banner.textContent = '✓ ' + msg;
    const module = document.getElementById('coverage-module');
    if (module) module.insertBefore(banner, module.firstChild);
    setTimeout(() => banner.remove(), 4000);

  } catch (e) {
    console.error('loadCoverageFromPlaybook error:', e);
    alert('Error loading from playbook: ' + e.message);
  }
}
