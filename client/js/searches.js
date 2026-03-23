/* ── Lancor Search OS — searches.js — Session 3 ──────────────────────────── */
/* Active Searches list, new search wizard, search detail, pipeline module    */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let currentSearchId = null;
let currentSearchData = null;
let currentTab = 'pipeline';
let pipelineFilters = { stage: 'all', owner: 'all', archetype: 'all', text: '' };

// ── Sector list (for wizard step 2) ──────────────────────────────────────────

const SECTORS = [
  { id: 'industrials',        label: 'Industrials' },
  { id: 'business-services',  label: 'Business Services' },
  { id: 'healthcare',         label: 'Healthcare' },
  { id: 'consumer',          label: 'Consumer' },
  { id: 'technology',         label: 'Technology' },
  { id: 'financial-services', label: 'Financial Services' },
  { id: 'energy',             label: 'Energy' },
  { id: 'real-estate',        label: 'Real Estate' },
  { id: 'media',              label: 'Media & Telecom' },
  { id: 'education',          label: 'Education' },
  { id: 'food-beverage',      label: 'Food & Beverage' },
  { id: 'logistics',          label: 'Logistics & Distribution' }
];

const LANCOR_TEAM_DEFAULT = [
  { initials: 'CC', full_name: 'Chris Conti',      role: 'Partner' },
  { initials: 'SM', full_name: 'Shannon Mace',      role: 'Consultant' },
  { initials: 'RA', full_name: 'Robby Albrecht',    role: 'Partner' },
  { initials: 'KC', full_name: 'Kelli Colacarro',   role: 'Consultant' },
  { initials: 'BD', full_name: 'Brett Dubin',       role: 'Consultant' },
  { initials: 'TO', full_name: 'Tim OToole',        role: 'Consultant' },
  { initials: 'TH', full_name: 'Trever Helwig',     role: 'Consultant' }
];

const STAGES = ['Pursuing', 'Outreach Sent', 'Scheduling', 'Qualifying', 'Hold', 'DQ', 'NI'];

const STAGE_COLORS = {
  'Pursuing':      { bg: '#eeeeee',  color: '#616161' },
  'Outreach Sent': { bg: '#f3e5f5',  color: '#7b1fa2' },
  'Scheduling':    { bg: '#fff3e0',  color: '#e65100' },
  'Qualifying':    { bg: '#e8f5e9',  color: '#2e7d32' },
  'Hold':          { bg: '#efebe9',  color: '#4e342e' },
  'DQ':            { bg: '#ffebee',  color: '#c62828' },
  'NI':            { bg: '#fffde7',  color: '#f57f17' }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function stagePillHTML(stage) {
  const c = STAGE_COLORS[stage] || { bg: '#eee', color: '#333' };
  return `<span class="stage-pill" style="background:${c.bg};color:${c.color}">${stage}</span>`;
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getPipelineStats(pipeline) {
  const counts = { Qualifying: 0, Scheduling: 0, Hold: 0, DQ: 0, NI: 0, Pursuing: 0, 'Outreach Sent': 0 };
  (pipeline || []).forEach(c => { if (counts[c.stage] !== undefined) counts[c.stage]++; });
  return counts;
}

function getLastUpdated(search) {
  if (search.weekly_updates && search.weekly_updates.length > 0) {
    const sorted = [...search.weekly_updates].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return sorted[0].date;
  }
  return search.date_opened;
}

// ── renderSearches — main entry point ────────────────────────────────────────

async function renderSearches() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading searches...</div>`;

  try {
    const data = await api('GET', '/searches');
    renderSearchList(data.searches || [], false);
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load searches: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchList(searches, includeArchived) {
  const content = document.getElementById('app-content');

  const active = searches.filter(s => s.status === 'active');
  const archived = searches.filter(s => s.status !== 'active');

  const cardsHTML = (active.length === 0)
    ? `<div class="empty-state">
         <div class="empty-state-icon">&#128269;</div>
         <p>No active searches yet.</p>
         <button class="btn btn-primary" style="margin-top:16px" onclick="renderNewSearchWizard()">+ New Search</button>
       </div>`
    : active.map(s => searchCardHTML(s)).join('');

  const archivedHTML = includeArchived && archived.length > 0
    ? `<div style="margin-top:28px">
         <h3 style="font-size:14px;color:#999;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Archived (${archived.length})</h3>
         ${archived.map(s => searchCardHTML(s)).join('')}
       </div>`
    : '';

  content.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
      <h2 style="font-size:1.5rem;font-weight:700">Active Searches</h2>
      <button class="btn btn-primary" onclick="renderNewSearchWizard()">+ New Search</button>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#666;cursor:pointer">
        <input type="checkbox" id="show-archived-toggle" ${includeArchived ? 'checked' : ''}
          onchange="toggleArchivedSearches(this.checked)">
        Show archived
      </label>
    </div>
    ${cardsHTML}
    ${archivedHTML}
  `;
}

function searchCardHTML(search) {
  const counts = getPipelineStats(search.pipeline);
  const lastUpdated = getLastUpdated(search);

  const qualCount     = counts.Qualifying;
  const schedCount    = counts.Scheduling;
  const holdCount     = counts.Hold;
  const dqNiCount     = counts.DQ + counts.NI;

  const pillsHTML = [
    qualCount  > 0 ? `<span class="stage-pill" style="background:#e8f5e9;color:#2e7d32">${qualCount} Qualifying</span>` : '',
    schedCount > 0 ? `<span class="stage-pill" style="background:#fff3e0;color:#e65100">${schedCount} Scheduling</span>` : '',
    holdCount  > 0 ? `<span class="stage-pill" style="background:#efebe9;color:#4e342e">${holdCount} Hold</span>` : '',
    dqNiCount  > 0 ? `<span class="stage-pill" style="background:#ffebee;color:#c62828">${dqNiCount} DQ/NI</span>` : ''
  ].filter(Boolean).join('');

  const statusBadge = search.status === 'active'
    ? `<span class="pill pill-active">Active</span>`
    : `<span class="pill pill-closed">Closed</span>`;

  return `
    <div class="search-card" onclick="renderSearchDetail('${escapeHtml(search.search_id)}')">
      <div class="search-card-header">
        <div>
          <div class="search-client-name">${escapeHtml(search.client_name)}</div>
          <div class="search-role">${escapeHtml(search.role_title || '')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          ${statusBadge}
        </div>
      </div>
      <div style="font-size:12px;color:#888;margin-top:8px">
        Opened ${formatDate(search.date_opened)} &nbsp;|&nbsp; Lead: ${escapeHtml(search.lead_recruiter || '—')}
        &nbsp;|&nbsp; Last updated: ${formatDate(lastUpdated)}
      </div>
      <div class="stage-counts">
        ${pillsHTML || '<span style="font-size:12px;color:#bbb">No candidates yet</span>'}
      </div>
    </div>
  `;
}

async function toggleArchivedSearches(includeArchived) {
  try {
    const url = includeArchived ? '/searches?include=closed' : '/searches';
    const data = await api('GET', url);
    renderSearchList(data.searches || [], includeArchived);
  } catch (err) {
    alert('Error loading searches: ' + err.message);
  }
}

// ── New Search Wizard ─────────────────────────────────────────────────────────

let wizardData = {};
let wizardStep = 1;

function renderNewSearchWizard() {
  wizardData = {
    client_name: '',
    role_title: '',
    lead_recruiter: 'Robby Albrecht',
    date_opened: new Date().toISOString().slice(0, 10),
    archetypes_requested: [],
    ideal_candidate_profile: '',
    sectors: [],
    client_contacts: [],
    lancor_team: JSON.parse(JSON.stringify(LANCOR_TEAM_DEFAULT))
  };
  wizardStep = 1;
  renderWizardStep();
}

function renderWizardStep() {
  const content = document.getElementById('app-content');

  const stepsHTML = [1, 2, 3].map(i => {
    let cls = 'wizard-step';
    if (i < wizardStep) cls += ' done';
    else if (i === wizardStep) cls += ' active';
    return `<div class="${cls}"></div>`;
  }).join('');

  let stepBody = '';

  if (wizardStep === 1) {
    stepBody = `
      <h3 style="font-size:15px;font-weight:700;margin-bottom:20px">Step 1 of 3 — Search Details</h3>
      <div class="form-group">
        <label class="form-label">Client Name <span style="color:red">*</span></label>
        <input class="form-control" id="wiz-client-name" value="${escapeHtml(wizardData.client_name)}" placeholder="e.g. Berkshire Partners">
      </div>
      <div class="form-group">
        <label class="form-label">Role Title <span style="color:red">*</span></label>
        <input class="form-control" id="wiz-role-title" value="${escapeHtml(wizardData.role_title)}" placeholder="e.g. Industrials Operating Partner">
      </div>
      <div class="form-group">
        <label class="form-label">Lead Recruiter</label>
        <input class="form-control" id="wiz-lead" value="${escapeHtml(wizardData.lead_recruiter)}">
      </div>
      <div class="form-group">
        <label class="form-label">Date Opened</label>
        <input class="form-control" type="date" id="wiz-date" value="${wizardData.date_opened}">
      </div>
      <div class="form-group">
        <label class="form-label">Archetypes Requested</label>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:6px">
          ${['PE Lateral','Industry Operator','Functional Expert'].map(a =>
            `<label style="display:flex;align-items:center;gap:6px;font-size:14px;cursor:pointer">
               <input type="checkbox" value="${a}" ${wizardData.archetypes_requested.includes(a) ? 'checked' : ''}
                 onchange="wizardToggleArchetype('${a}',this.checked)">
               ${a}
             </label>`
          ).join('')}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ideal Candidate Profile</label>
        <textarea class="form-control" id="wiz-profile" rows="4" placeholder="Describe the ideal candidate...">${escapeHtml(wizardData.ideal_candidate_profile)}</textarea>
      </div>
    `;
  } else if (wizardStep === 2) {
    stepBody = `
      <h3 style="font-size:15px;font-weight:700;margin-bottom:8px">Step 2 of 3 — Sectors</h3>
      <p style="font-size:13px;color:#777;margin-bottom:16px">Matching PE firms and companies from playbooks will auto-load into sourcing coverage.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
        ${SECTORS.map(s =>
          `<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;padding:8px;border:1px solid #e0e0e0;border-radius:6px;${wizardData.sectors.includes(s.id) ? 'background:#EDE7F6;border-color:#5C2D91;' : ''}">
             <input type="checkbox" value="${s.id}" ${wizardData.sectors.includes(s.id) ? 'checked' : ''}
               onchange="wizardToggleSector('${s.id}',this.checked)">
             ${s.label}
           </label>`
        ).join('')}
      </div>
    `;
  } else if (wizardStep === 3) {
    const contactsHTML = wizardData.client_contacts.length === 0
      ? '<p style="font-size:13px;color:#aaa;margin-bottom:12px">No contacts added yet.</p>'
      : wizardData.client_contacts.map((c, i) =>
          `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:6px;font-size:13px">
             <span><strong>${escapeHtml(c.name)}</strong>${c.title ? ' — ' + escapeHtml(c.title) : ''}</span>
             <button onclick="wizardRemoveContact(${i})" style="background:none;border:none;color:#ef5350;cursor:pointer;font-size:16px">&#215;</button>
           </div>`
        ).join('');

    const teamHTML = wizardData.lancor_team.map((m, i) =>
      `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:6px;font-size:13px">
         <span><strong>${escapeHtml(m.initials)}</strong> — ${escapeHtml(m.full_name)} (${escapeHtml(m.role)})</span>
         <button onclick="wizardRemoveTeamMember(${i})" style="background:none;border:none;color:#ef5350;cursor:pointer;font-size:16px">&#215;</button>
       </div>`
    ).join('');

    stepBody = `
      <h3 style="font-size:15px;font-weight:700;margin-bottom:20px">Step 3 of 3 — Contacts &amp; Team</h3>

      <div class="form-group">
        <label class="form-label">Client Contacts</label>
        <div id="wiz-contacts-list">${contactsHTML}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input class="form-control" id="wiz-contact-name" placeholder="Contact name" style="flex:1">
          <input class="form-control" id="wiz-contact-title" placeholder="Title" style="flex:1">
          <button class="btn btn-secondary btn-sm" onclick="wizardAddContact()">Add</button>
        </div>
      </div>

      <div class="form-group" style="margin-top:20px">
        <label class="form-label">Lancor Team</label>
        <div id="wiz-team-list">${teamHTML}</div>
      </div>
    `;
  }

  content.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button class="btn btn-ghost btn-sm" onclick="renderSearches()">&#8592; Back</button>
        <h2 style="font-size:1.3rem;font-weight:700">New Search</h2>
      </div>
      <div class="wizard-steps">${stepsHTML}</div>
      <div style="background:white;border:1px solid #e0e0e0;border-radius:12px;padding:28px">
        ${stepBody}
        <div class="wizard-nav">
          <button class="btn btn-ghost" onclick="${wizardStep > 1 ? 'wizardBack()' : 'renderSearches()'}">${wizardStep > 1 ? '&#8592; Back' : 'Cancel'}</button>
          <button class="btn btn-primary" onclick="${wizardStep < 3 ? 'wizardNext()' : 'wizardCreate()'}">
            ${wizardStep < 3 ? 'Next &#8594;' : 'Create Search'}
          </button>
        </div>
      </div>
    </div>
  `;
}

function wizardToggleArchetype(val, checked) {
  if (checked) { if (!wizardData.archetypes_requested.includes(val)) wizardData.archetypes_requested.push(val); }
  else { wizardData.archetypes_requested = wizardData.archetypes_requested.filter(a => a !== val); }
}

function wizardToggleSector(id, checked) {
  if (checked) { if (!wizardData.sectors.includes(id)) wizardData.sectors.push(id); }
  else { wizardData.sectors = wizardData.sectors.filter(s => s !== id); }
  // Re-render to update highlight
  renderWizardStep();
}

function wizardAddContact() {
  const name = document.getElementById('wiz-contact-name').value.trim();
  const title = document.getElementById('wiz-contact-title').value.trim();
  if (!name) return;
  wizardData.client_contacts.push({ name, title, display_in_matrix: true });
  renderWizardStep();
}

function wizardRemoveContact(idx) {
  wizardData.client_contacts.splice(idx, 1);
  renderWizardStep();
}

function wizardRemoveTeamMember(idx) {
  wizardData.lancor_team.splice(idx, 1);
  renderWizardStep();
}

function wizardBack() {
  wizardStep--;
  renderWizardStep();
}

function wizardNext() {
  // Collect current step data
  if (wizardStep === 1) {
    const clientName = document.getElementById('wiz-client-name').value.trim();
    const roleTitle = document.getElementById('wiz-role-title').value.trim();
    if (!clientName || !roleTitle) {
      alert('Client Name and Role Title are required.');
      return;
    }
    wizardData.client_name = clientName;
    wizardData.role_title = roleTitle;
    wizardData.lead_recruiter = document.getElementById('wiz-lead').value.trim() || 'Robby Albrecht';
    wizardData.date_opened = document.getElementById('wiz-date').value || new Date().toISOString().slice(0, 10);
    wizardData.ideal_candidate_profile = document.getElementById('wiz-profile').value.trim();
  }
  wizardStep++;
  renderWizardStep();
}

async function wizardCreate() {
  try {
    const slug = slugify(wizardData.client_name) + '-' + new Date().getFullYear();
    const payload = Object.assign({}, wizardData, {
      search_id: slug,
      status: 'active',
      pipeline: [],
      weekly_updates: [],
      sourcing_coverage: { pe_firms: [], companies: [] }
    });

    const created = await api('POST', '/searches', payload);
    currentSearchId = created.search_id;
    renderSearchDetail(created.search_id);
  } catch (err) {
    alert('Error creating search: ' + err.message);
  }
}

// ── renderSearchDetail ────────────────────────────────────────────────────────

async function renderSearchDetail(searchId) {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading...</div>`;

  try {
    const search = await api('GET', '/searches/' + searchId);
    currentSearchId = searchId;
    currentSearchData = search;
    renderSearchDetailView(search, currentTab);
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load search: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSearchDetailView(search, tab) {
  const content = document.getElementById('app-content');
  currentTab = tab;

  const statusBadge = search.status === 'active'
    ? `<span class="pill pill-active">Active</span>`
    : `<span class="pill pill-closed">Closed</span>`;

  const tabsHTML = ['Pipeline', 'Sourcing Coverage', 'Weekly Updates', 'Search Kit'].map(t => {
    const key = t.toLowerCase().replace(/ /g, '-');
    return `<div class="tab ${tab === key ? 'active' : ''}" onclick="switchSearchTab('${key}')">${t}</div>`;
  }).join('');

  let tabContent = '';
  try {
    if (tab === 'pipeline') {
      tabContent = renderPipelineTabHTML(search);
    } else if (tab === 'sourcing-coverage') {
      if (typeof renderCoverageTabHTML !== 'function') throw new Error('renderCoverageTabHTML not loaded — check coverage.js');
      tabContent = renderCoverageTabHTML(search);
    } else if (tab === 'weekly-updates') {
      tabContent = renderWeeklyUpdatesHTML(search);
    } else if (tab === 'search-kit') {
      tabContent = `<div id="search-kit-content"><div class="loading"><div class="spinner"></div> Loading...</div></div>`;
    }
  } catch (err) {
    console.error('renderSearchDetailView tab error [' + tab + ']:', err);
    tabContent = `<div class="error-banner" style="margin-top:16px">
      Error loading ${escapeHtml(tab)} tab: ${escapeHtml(err.message)}
    </div>`;
  }

  content.innerHTML = `
    <div style="max-width:1200px;margin:0 auto">
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <button class="btn btn-ghost btn-sm" onclick="renderSearches()" style="margin-bottom:10px">
            &#8592; Active Searches
          </button>
          <h1 style="font-size:1.6rem;font-weight:800;color:#1a1a1a;margin-bottom:4px">${escapeHtml(search.client_name)}</h1>
          <h2 style="font-size:1rem;font-weight:500;color:#555">${escapeHtml(search.role_title || '')}</h2>
          <div style="font-size:12px;color:#888;margin-top:6px">
            ${statusBadge}
            &nbsp; Opened ${formatDate(search.date_opened)} &nbsp;|&nbsp; Lead: ${escapeHtml(search.lead_recruiter || '—')}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm import-btn" onclick="openImportModal()">&#8679; Import Dashboard</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditSearchModal()">&#9998; Edit Search</button>
          ${search.status === 'active' ? `<button class="btn btn-ghost btn-sm" style="color:#c62828;border-color:#c62828" onclick="initiateCloseSearch('${search.search_id}')">&#10005; Close Search</button>` : ''}
        </div>
      </div>

      <!-- Tabs -->
      <div class="tab-bar">${tabsHTML}</div>

      <!-- Tab content -->
      <div id="tab-content">${tabContent}</div>
    </div>

    <!-- Quick add FAB (only show on pipeline tab) -->
    ${tab === 'pipeline' ? `<button class="fab-quick-add" onclick="openQuickAddModal()">+ Add Candidate</button>` : ''}
  `;

  // Attach filter listeners after render
  if (tab === 'pipeline') {
    attachPipelineFilterListeners();
  }
  if (tab === 'search-kit') {
    loadSearchKitTab(search);
  }
}

async function switchSearchTab(tab) {
  currentTab = tab;

  // Ensure we have search data — re-fetch if somehow missing
  if (!currentSearchData && currentSearchId) {
    try {
      currentSearchData = await api('GET', '/searches/' + currentSearchId);
    } catch (err) {
      document.getElementById('app-content').innerHTML =
        `<div class="error-banner">Failed to load search: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  if (!currentSearchData) return;

  try {
    renderSearchDetailView(currentSearchData, tab);
  } catch (err) {
    console.error('switchSearchTab render error:', err);
    const tabContent = document.getElementById('tab-content');
    if (tabContent) {
      tabContent.innerHTML = `<div class="error-banner" style="margin-top:16px">
        Error loading ${escapeHtml(tab)} tab: ${escapeHtml(err.message)}
      </div>`;
    }
  }
}

// ── Pipeline Tab ──────────────────────────────────────────────────────────────

function renderPipelineTabHTML(search) {
  const pipeline = search.pipeline || [];
  const counts = getPipelineStats(pipeline);

  // Metric row
  const metricsHTML = `
    <div class="pipeline-metrics">
      <div class="metric-pill" style="background:#e8f5e9;color:#2e7d32">${counts.Qualifying} Qualifying</div>
      <div class="metric-pill" style="background:#fff3e0;color:#e65100">${counts.Scheduling} Scheduling</div>
      <div class="metric-pill" style="background:#efebe9;color:#4e342e">${counts.Hold} Hold</div>
      <div class="metric-pill" style="background:#eeeeee;color:#616161">${counts.Pursuing + counts['Outreach Sent']} Pursuing / Outreach</div>
      <div class="metric-pill" style="background:#ffebee;color:#c62828">${counts.DQ + counts.NI} DQ / NI</div>
    </div>
  `;

  // Filter bar
  const ownerOptions = ['all', ...new Set((search.lancor_team || []).map(m => m.initials))];
  const filterBarHTML = `
    <div class="filter-bar" style="margin-bottom:16px">
      <select id="filter-stage" onchange="applyPipelineFilters()">
        <option value="all">All Stages</option>
        ${STAGES.map(s => `<option value="${s}" ${pipelineFilters.stage === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <select id="filter-owner" onchange="applyPipelineFilters()">
        ${ownerOptions.map(o => `<option value="${o}" ${pipelineFilters.owner === o ? 'selected' : ''}>${o === 'all' ? 'All Owners' : o}</option>`).join('')}
      </select>
      <select id="filter-archetype" onchange="applyPipelineFilters()">
        <option value="all">All Archetypes</option>
        <option value="PE Lateral">PE Lateral</option>
        <option value="Industry Operator">Industry Operator</option>
        <option value="Functional Expert">Functional Expert</option>
      </select>
      <input type="text" id="filter-text" placeholder="Search by name..." value="${escapeHtml(pipelineFilters.text)}" oninput="applyPipelineFilters()" style="min-width:160px">
    </div>
  `;

  // Apply current filters
  let filtered = applyFiltersToList(pipeline);

  // Active candidates table (Qualifying, Scheduling, Outreach Sent)
  const activeStages = ['Qualifying', 'Scheduling', 'Outreach Sent'];
  const activeCandidates = filtered.filter(c => activeStages.includes(c.stage));

  // Hold, Pursuing, DQ+NI sections
  const holdCandidates    = filtered.filter(c => c.stage === 'Hold');
  const pursuingCandidates = filtered.filter(c => c.stage === 'Pursuing');
  const dqNiCandidates    = filtered.filter(c => c.stage === 'DQ' || c.stage === 'NI');

  const contactHeaders = (search.client_contacts || [])
    .filter(c => c.display_in_matrix !== false)
    .map(c => `<th style="min-width:28px;text-align:center">${escapeHtml(c.name.charAt(0))}</th>`)
    .join('');

  const tableHTML = activeCandidates.length === 0
    ? `<p style="color:#aaa;font-size:13px;padding:20px 0">No active candidates match current filters.</p>`
    : `<div class="table-wrapper">
         <table class="pipeline-table" id="pipeline-main-table">
           <thead>
             <tr>
               <th>Candidate</th>
               <th>Stage</th>
               <th>
                 <div class="meeting-dots" style="gap:4px">
                   ${(search.client_contacts || []).filter(c => c.display_in_matrix !== false).map(c =>
                     `<span title="${escapeHtml(c.name)}" style="font-size:10px;color:#999;min-width:24px;text-align:center">${escapeHtml(c.name.charAt(0))}</span>`
                   ).join('')}
                 </div>
               </th>
               <th>Screener</th>
               <th>Assessment</th>
               <th>Next Step</th>
               <th>Owner / Date</th>
             </tr>
           </thead>
           <tbody>
             ${activeCandidates.map(c => pipelineRowHTML(c, search)).join('')}
           </tbody>
         </table>
       </div>`;

  // Hold section
  const holdHTML = buildCollapsibleSection(
    `On Hold (${holdCandidates.length})`,
    holdCandidates.length === 0
      ? '<p style="color:#aaa;font-size:13px">No candidates on hold.</p>'
      : `<table class="pipeline-table">
           <thead><tr><th>Candidate</th><th>Stage</th><th>Hold Reason</th><th>Next Step</th><th>Owner</th></tr></thead>
           <tbody>
             ${holdCandidates.map(c => `
               <tr>
                 <td><div class="candidate-name">${escapeHtml(c.name)}</div><div class="candidate-subtitle">${escapeHtml(c.current_title || '')} @ ${escapeHtml(c.current_firm || '')}</div></td>
                 <td>${stagePillHTML(c.stage)}</td>
                 <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="dq_reason">${escapeHtml(c.dq_reason || '—')}</td>
                 <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="next_step">${escapeHtml(c.next_step || '—')}</td>
                 <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="next_step_owner">${escapeHtml(c.next_step_owner || '—')}</td>
               </tr>`).join('')}
           </tbody>
         </table>`,
    holdCandidates.length < 3
  );

  // Pursuing section (card grid)
  const pursuingHTML = buildCollapsibleSection(
    `Pursuing (${pursuingCandidates.length})`,
    pursuingCandidates.length === 0
      ? '<p style="color:#aaa;font-size:13px">No candidates in pursuing stage.</p>'
      : `<div class="pursuing-grid">
           ${pursuingCandidates.map(c => `
             <div class="pursuing-card">
               <div class="pursuing-card-name">${escapeHtml(c.name)}</div>
               <div class="pursuing-card-sub">${escapeHtml(c.current_title || '')} @ ${escapeHtml(c.current_firm || '')}</div>
               <div class="pursuing-card-sub" style="margin-top:4px">${escapeHtml(c.location || '')}</div>
               <div style="margin-top:8px">${stagePillHTML(c.archetype || 'PE Lateral')}</div>
               <div style="margin-top:8px;font-size:11px;color:#aaa">Added ${formatDate(c.date_added)}</div>
               <button class="btn btn-sm btn-secondary" style="margin-top:10px;width:100%"
                 onclick="moveCandidateToOutreach('${escapeHtml(c.candidate_id)}')">
                 &#8594; Move to Active
               </button>
             </div>`).join('')}
         </div>`,
    true
  );

  // DQ/NI section
  const dqNiHTML = buildCollapsibleSection(
    `DQ / Not Interested (${dqNiCandidates.length})`,
    dqNiCandidates.length === 0
      ? '<p style="color:#aaa;font-size:13px">No DQ or NI candidates.</p>'
      : `<div>${dqNiCandidates.map(c => `
           <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px">
             <div style="flex:1">
               <span class="candidate-name">${escapeHtml(c.name)}</span>
               <span style="color:#aaa;margin-left:6px">${escapeHtml(c.current_title || '')} @ ${escapeHtml(c.current_firm || '')}</span>
             </div>
             ${stagePillHTML(c.stage)}
             <span style="color:#aaa;font-size:12px;flex:1">${escapeHtml(c.dq_reason || '—')}</span>
             <span style="color:#aaa;font-size:11px">${formatDate(c.date_added)}</span>
           </div>`).join('')}
         </div>`,
    true
  );

  return `
    ${metricsHTML}
    ${filterBarHTML}
    <div id="pipeline-table-container">${tableHTML}</div>
    ${holdHTML}
    ${pursuingHTML}
    ${dqNiHTML}
  `;
}

function buildCollapsibleSection(title, bodyHTML, startCollapsed) {
  const sectionId = 'section-' + slugify(title);
  return `
    <div class="collapsible-section">
      <div class="collapsible-header" onclick="toggleSection('${sectionId}')">
        <span>${escapeHtml(title)}</span>
        <span id="${sectionId}-arrow">${startCollapsed ? '&#9654;' : '&#9660;'}</span>
      </div>
      <div class="collapsible-body" id="${sectionId}" style="${startCollapsed ? 'display:none' : ''}">
        ${bodyHTML}
      </div>
    </div>
  `;
}

function toggleSection(id) {
  const body = document.getElementById(id);
  const arrow = document.getElementById(id + '-arrow');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? '' : 'none';
  if (arrow) arrow.innerHTML = isHidden ? '&#9660;' : '&#9654;';
}

function pipelineRowHTML(c, search) {
  const contacts = (search.client_contacts || []).filter(ct => ct.display_in_matrix !== false);
  const meetings = c.client_meetings || [];

  const meetingDotsHTML = contacts.map(ct => {
    const m = meetings.find(m => m.contact_name === ct.name) || { status: '—' };
    let dotClass = 'meeting-dot-none';
    if (m.status === 'Met') dotClass = 'meeting-dot-met';
    else if (m.status === 'Scheduled') dotClass = 'meeting-dot-scheduled';
    const initial = ct.name.charAt(0).toUpperCase();
    return `<div class="meeting-dot ${dotClass}" title="${escapeHtml(ct.name)}: ${escapeHtml(m.status)}"
      data-cid="${escapeHtml(c.candidate_id)}" data-contact="${escapeHtml(ct.name)}"
      onclick="cycleMeetingStatus('${escapeHtml(c.candidate_id)}','${escapeHtml(ct.name)}')">${initial}</div>`;
  }).join('');

  const linkedinLink = c.linkedin_url
    ? ` <a href="${escapeHtml(c.linkedin_url)}" target="_blank" title="LinkedIn" style="color:#0a66c2;font-size:11px;margin-left:4px">in</a>`
    : '';

  const stageCss = 'stage-' + (c.stage || 'Pursuing').replace(/ /g, '-');

  const screenerText = c.lancor_screener
    ? `${escapeHtml(c.lancor_screener)}${c.screen_date ? '<br><span style="font-size:10px;color:#aaa">' + formatDate(c.screen_date) + '</span>' : ''}`
    : '<span style="color:#bbb">—</span>';

  const ownerText = c.next_step_owner
    ? `${escapeHtml(c.next_step_owner)}${c.next_step_date ? '<br><span style="font-size:10px;color:#aaa">' + formatDate(c.next_step_date) + '</span>' : ''}`
    : '<span style="color:#bbb">—</span>';

  return `
    <tr data-cid="${escapeHtml(c.candidate_id)}">
      <td>
        <div class="candidate-name">${escapeHtml(c.name)}${linkedinLink}</div>
        <div class="candidate-subtitle">${escapeHtml(c.current_title || '')} @ ${escapeHtml(c.current_firm || '')}</div>
        ${c.location ? `<div class="candidate-subtitle">${escapeHtml(c.location)}</div>` : ''}
      </td>
      <td style="position:relative">
        <span class="stage-pill ${stageCss}" onclick="openStageDropdown(event,'${escapeHtml(c.candidate_id)}')"
          style="cursor:pointer">${escapeHtml(c.stage)}</span>
      </td>
      <td>
        <div class="meeting-dots">${meetingDotsHTML}</div>
      </td>
      <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="lancor_screener"
        onclick="startInlineEdit(this)">
        ${screenerText}
      </td>
      <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="lancor_assessment"
        onclick="startInlineEdit(this)" style="max-width:160px">
        ${c.lancor_assessment ? escapeHtml(c.lancor_assessment) : '<span style="color:#bbb">—</span>'}
      </td>
      <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="next_step"
        onclick="startInlineEdit(this)" style="max-width:180px">
        ${c.next_step ? escapeHtml(c.next_step) : '<span style="color:#bbb">—</span>'}
      </td>
      <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="next_step_owner"
        onclick="startInlineEdit(this)">
        ${ownerText}
      </td>
    </tr>
  `;
}

function attachPipelineFilterListeners() {
  // Listeners are inline via onchange/oninput attributes — no additional attachment needed.
  // Attach editable cell listeners for hold section
  document.querySelectorAll('.editable-cell').forEach(cell => {
    cell.addEventListener('click', function() { startInlineEdit(this); });
  });
}

function applyFiltersToList(pipeline) {
  return (pipeline || []).filter(c => {
    if (pipelineFilters.stage !== 'all' && c.stage !== pipelineFilters.stage) return false;
    if (pipelineFilters.owner !== 'all' && c.next_step_owner !== pipelineFilters.owner) return false;
    if (pipelineFilters.archetype !== 'all' && c.archetype !== pipelineFilters.archetype) return false;
    if (pipelineFilters.text) {
      const t = pipelineFilters.text.toLowerCase();
      if (!(c.name || '').toLowerCase().includes(t) &&
          !(c.current_firm || '').toLowerCase().includes(t) &&
          !(c.current_title || '').toLowerCase().includes(t)) return false;
    }
    return true;
  });
}

function applyPipelineFilters() {
  const stageEl = document.getElementById('filter-stage');
  const ownerEl = document.getElementById('filter-owner');
  const archEl  = document.getElementById('filter-archetype');
  const textEl  = document.getElementById('filter-text');

  pipelineFilters.stage    = stageEl ? stageEl.value : 'all';
  pipelineFilters.owner    = ownerEl ? ownerEl.value : 'all';
  pipelineFilters.archetype = archEl ? archEl.value : 'all';
  pipelineFilters.text     = textEl ? textEl.value.trim() : '';

  if (currentSearchData) {
    const container = document.getElementById('tab-content');
    if (container) {
      container.innerHTML = renderPipelineTabHTML(currentSearchData);
      attachPipelineFilterListeners();
    }
  }
}

// ── Stage Dropdown ────────────────────────────────────────────────────────────

function openStageDropdown(event, candidateId) {
  event.stopPropagation();
  closeAllDropdowns();

  const cell = event.target.closest('td');
  const popup = document.createElement('div');
  popup.className = 'stage-dropdown-popup';
  popup.id = 'stage-popup-' + candidateId;

  popup.innerHTML = STAGES.map(s => {
    const c = STAGE_COLORS[s] || { bg: '#eee', color: '#333' };
    return `<div class="stage-option" style="background:${c.bg};color:${c.color}"
      onclick="setStage('${candidateId}','${s}')">${s}</div>`;
  }).join('');

  cell.style.position = 'relative';
  cell.appendChild(popup);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeAllDropdowns, { once: true });
  }, 0);
}

function closeAllDropdowns() {
  document.querySelectorAll('.stage-dropdown-popup').forEach(el => el.remove());
}

async function setStage(candidateId, newStage) {
  closeAllDropdowns();

  if (!currentSearchData) return;

  const pipeline = currentSearchData.pipeline;
  const idx = pipeline.findIndex(c => c.candidate_id === candidateId);
  if (idx === -1) return;

  // Prompt for DQ reason
  if (newStage === 'DQ' || newStage === 'NI') {
    const reason = prompt(`Reason for ${newStage}:`);
    pipeline[idx].dq_reason = reason || '';
  }

  pipeline[idx].stage = newStage;

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { pipeline });
    currentSearchData.pipeline = updated.pipeline || pipeline;
    renderSearchDetailView(currentSearchData, 'pipeline');
  } catch (err) {
    alert('Error saving stage: ' + err.message);
  }
}

// ── Meeting dot cycling ───────────────────────────────────────────────────────

async function cycleMeetingStatus(candidateId, contactName) {
  if (!currentSearchData) return;
  const pipeline = currentSearchData.pipeline;
  const idx = pipeline.findIndex(c => c.candidate_id === candidateId);
  if (idx === -1) return;

  const meetings = pipeline[idx].client_meetings || [];
  const mIdx = meetings.findIndex(m => m.contact_name === contactName);

  const cycle = ['—', 'Met', 'Scheduled'];
  if (mIdx === -1) {
    meetings.push({ contact_name: contactName, status: 'Met', date: new Date().toISOString().slice(0, 10) });
  } else {
    const current = meetings[mIdx].status;
    const nextIdx = (cycle.indexOf(current) + 1) % cycle.length;
    meetings[mIdx].status = cycle[nextIdx];
    if (meetings[mIdx].status !== '—') {
      meetings[mIdx].date = new Date().toISOString().slice(0, 10);
    }
  }
  pipeline[idx].client_meetings = meetings;

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { pipeline });
    currentSearchData.pipeline = updated.pipeline || pipeline;
    renderSearchDetailView(currentSearchData, 'pipeline');
  } catch (err) {
    alert('Error saving meeting status: ' + err.message);
  }
}

// ── Move pursuing candidate to active ────────────────────────────────────────

async function moveCandidateToOutreach(candidateId) {
  await setStage(candidateId, 'Outreach Sent');
}

// ── Inline editing ────────────────────────────────────────────────────────────

let activeEditCell = null;

function startInlineEdit(cell) {
  if (activeEditCell === cell) return;
  if (activeEditCell) cancelInlineEdit();

  const cid   = cell.dataset.cid;
  const field = cell.dataset.field;
  if (!cid || !field) return;

  const pipeline = (currentSearchData || {}).pipeline || [];
  const candidate = pipeline.find(c => c.candidate_id === cid);
  const currentVal = candidate ? (candidate[field] || '') : '';

  activeEditCell = cell;
  cell.classList.add('inline-edit-active');

  const isLong = ['lancor_assessment', 'next_step', 'notes'].includes(field);

  if (isLong) {
    cell.innerHTML = `<textarea class="inline-text-editor" rows="3">${escapeHtml(currentVal)}</textarea>`;
  } else {
    cell.innerHTML = `<input class="inline-text-editor" value="${escapeHtml(currentVal)}">`;
  }

  const input = cell.querySelector('input, textarea');
  input.focus();
  input.addEventListener('blur', () => saveInlineEdit(cell, cid, field, input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cancelInlineEdit(); }
  });
}

function cancelInlineEdit() {
  if (!activeEditCell) return;
  activeEditCell.classList.remove('inline-edit-active');
  activeEditCell = null;
  // Re-render to restore
  if (currentSearchData) renderSearchDetailView(currentSearchData, 'pipeline');
}

async function saveInlineEdit(cell, cid, field, value) {
  if (!currentSearchData) return;
  activeEditCell = null;
  cell.classList.remove('inline-edit-active');

  const pipeline = currentSearchData.pipeline;
  const idx = pipeline.findIndex(c => c.candidate_id === cid);
  if (idx === -1) return;

  pipeline[idx][field] = value;

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { pipeline });
    currentSearchData.pipeline = updated.pipeline || pipeline;

    // Show brief saved indicator then re-render
    cell.innerHTML = `${escapeHtml(value || '—')} <span class="save-indicator">Saved &#10003;</span>`;
    setTimeout(() => {
      if (currentSearchData) renderSearchDetailView(currentSearchData, 'pipeline');
    }, 900);
  } catch (err) {
    alert('Error saving: ' + err.message);
    if (currentSearchData) renderSearchDetailView(currentSearchData, 'pipeline');
  }
}

// ── Weekly Updates Tab ────────────────────────────────────────────────────────

function renderWeeklyUpdatesHTML(search) {
  const updates = [...(search.weekly_updates || [])].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '')
  );

  const updatesHTML = updates.length === 0
    ? '<p style="color:#aaa;font-size:13px">No updates yet.</p>'
    : updates.map(u => `
        <div style="border-left:3px solid #5C2D91;padding-left:16px;margin-bottom:20px">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px">${formatDate(u.date)}</div>
          <div style="font-size:13px;color:#444;white-space:pre-wrap">${escapeHtml(u.notes || '')}</div>
        </div>`
      ).join('');

  const today = new Date().toISOString().slice(0, 10);

  return `
    <div style="max-width:720px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="font-size:15px;font-weight:700">Weekly Updates</h3>
        <button class="btn btn-primary btn-sm" onclick="showAddNoteForm()">+ Add Note</button>
      </div>
      <div id="add-note-form" style="display:none;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:20px">
        <div class="form-group">
          <label class="form-label">Date</label>
          <input class="form-control" type="date" id="note-date" value="${today}">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="note-text" rows="4" placeholder="Weekly update notes..."></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="saveWeeklyNote()">Save</button>
          <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-note-form').style.display='none'">Cancel</button>
        </div>
      </div>
      ${updatesHTML}

      <!-- Dashboard generator -->
      <div class="dashboard-section">
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#5C2D91">Client Dashboard</h3>
        <p style="font-size:13px;color:#666;margin-bottom:12px">Generate a client-facing HTML dashboard from the current pipeline state. Internal notes, assessments, and DQ reasons are automatically stripped.</p>
        <div id="dashboard-result-banner-placeholder"></div>
        <button id="generate-dashboard-btn" class="btn btn-primary" onclick="generateClientDashboard('${search.search_id}')">Generate Dashboard</button>
        <button class="btn btn-ghost btn-sm" style="margin-left:8px" onclick="previewDashboard('${search.search_id}')">Preview</button>
        <button class="btn btn-ghost btn-sm" onclick="printDashboard('${search.search_id}')">Print / PDF</button>
        <div style="margin-top:16px">
          <div style="font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Generated Dashboards</div>
          <div id="dashboard-history"></div>
        </div>
      </div>
    </div>
  `;
}

function showAddNoteForm() {
  const form = document.getElementById('add-note-form');
  if (form) form.style.display = '';
}

async function saveWeeklyNote() {
  const date = document.getElementById('note-date').value;
  const notes = document.getElementById('note-text').value.trim();
  if (!notes) { alert('Please enter notes.'); return; }

  if (!currentSearchData) return;

  const weekly_updates = [...(currentSearchData.weekly_updates || []), { date, notes }];

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { weekly_updates });
    currentSearchData.weekly_updates = updated.weekly_updates || weekly_updates;
    renderSearchDetailView(currentSearchData, 'weekly-updates');
  } catch (err) {
    alert('Error saving note: ' + err.message);
  }
}

// ── Quick Add Modal ───────────────────────────────────────────────────────────

function openQuickAddModal() {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay-s3';
  overlay.id = 'quick-add-overlay';

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:520px">
      <div class="modal-header-s3">
        <span class="modal-title-s3">Add Candidate</span>
        <button class="modal-close-s3" onclick="closeModal()">&#215;</button>
      </div>
      <div id="quick-add-warning"></div>

      <div class="form-group">
        <label class="form-label">Name <span style="color:red">*</span></label>
        <input class="form-control" id="qa-name" placeholder="Full name">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Current Title <span style="color:red">*</span></label>
          <input class="form-control" id="qa-title" placeholder="e.g. VP Operations">
        </div>
        <div class="form-group">
          <label class="form-label">Current Firm <span style="color:red">*</span></label>
          <input class="form-control" id="qa-firm" placeholder="e.g. Arsenal Capital">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Home Location <span style="color:red">*</span></label>
        <input class="form-control" id="qa-location" placeholder="City, State">
      </div>
      <div class="form-group">
        <label class="form-label">LinkedIn URL</label>
        <input class="form-control" id="qa-linkedin" placeholder="https://linkedin.com/in/...">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Archetype</label>
          <select class="form-control" id="qa-archetype">
            <option>PE Lateral</option>
            <option>Industry Operator</option>
            <option>Functional Expert</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Source</label>
          <select class="form-control" id="qa-source">
            <option>LinkedIn title search</option>
            <option>LinkedIn alumni</option>
            <option>PitchBook exit</option>
            <option>Referral</option>
            <option>All-star pool</option>
            <option>Inbound</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Initial Stage</label>
        <select class="form-control" id="qa-stage">
          ${STAGES.map(s => `<option ${s === 'Pursuing' ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="qa-notes" rows="3" placeholder="Optional notes..."></textarea>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitQuickAdd()">Add Candidate</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

async function submitQuickAdd() {
  const name     = document.getElementById('qa-name').value.trim();
  const title    = document.getElementById('qa-title').value.trim();
  const firm     = document.getElementById('qa-firm').value.trim();
  const location = document.getElementById('qa-location').value.trim();

  if (!name || !title || !firm || !location) {
    alert('Please fill in all required fields (Name, Title, Firm, Location).');
    return;
  }

  // Duplicate check
  const pipeline = (currentSearchData || {}).pipeline || [];
  const duplicate = pipeline.some(c =>
    (c.name || '').toLowerCase() === name.toLowerCase() &&
    (c.current_firm || '').toLowerCase() === firm.toLowerCase()
  );
  if (duplicate) {
    const warning = document.getElementById('quick-add-warning');
    if (warning) warning.innerHTML = `<div class="warning-banner">Warning: A candidate named <strong>${escapeHtml(name)}</strong> from <strong>${escapeHtml(firm)}</strong> already exists in this pipeline.</div>`;
  }

  const candidateId = slugify(name + '-' + firm).slice(0, 60) + '-' + Date.now();

  const payload = {
    candidate_id:     candidateId,
    name,
    current_title:    title,
    current_firm:     firm,
    home_location:    location,
    linkedin_url:     document.getElementById('qa-linkedin').value.trim(),
    archetype:        document.getElementById('qa-archetype').value,
    sector_tags:      (currentSearchData || {}).sectors || [],
    operator_background: [],
    quality_rating:   null,
    availability:     'Unknown',
    search_history:   [],
    dq_reasons:       [],
    last_contact_date: null,
    notes:            document.getElementById('qa-notes').value.trim(),
    date_added:       new Date().toISOString().slice(0, 10),
    added_from_search: currentSearchId,
    // Pipeline-specific fields
    search_id:        currentSearchId,
    source:           document.getElementById('qa-source').value,
    initial_stage:    document.getElementById('qa-stage').value
  };

  try {
    await api('POST', '/candidates', payload);
    closeModal();
    // Reload search data to get updated pipeline
    const updated = await api('GET', '/searches/' + currentSearchId);
    currentSearchData = updated;
    renderSearchDetailView(currentSearchData, 'pipeline');
  } catch (err) {
    alert('Error adding candidate: ' + err.message);
  }
}

function closeModal() {
  const overlay = document.getElementById('quick-add-overlay');
  if (overlay) overlay.remove();
  const importOverlay = document.getElementById('import-overlay');
  if (importOverlay) importOverlay.remove();
  const editOverlay = document.getElementById('edit-search-overlay');
  if (editOverlay) editOverlay.remove();
}

// ── Import Dashboard Modal ────────────────────────────────────────────────────

function openImportModal() {
  closeModal();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay-s3';
  overlay.id = 'import-overlay';

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:460px">
      <div class="modal-header-s3">
        <span class="modal-title-s3">Import HTML Dashboard</span>
        <button class="modal-close-s3" onclick="closeModal()">&#215;</button>
      </div>
      <p style="font-size:13px;color:#666;margin-bottom:16px">
        Select a Lancor client HTML dashboard file to import candidates into the pipeline.
      </p>
      <div class="form-group">
        <label class="form-label">HTML File</label>
        <input type="file" accept=".html,.htm" id="import-file" class="form-control">
      </div>
      <div id="import-result" style="margin-top:12px"></div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:16px">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitImport()">Import</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

function submitImport() {
  const fileInput = document.getElementById('import-file');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert('Please select an HTML file.');
    return;
  }

  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = async function(e) {
    const html_content = e.target.result;
    const resultDiv = document.getElementById('import-result');
    if (resultDiv) resultDiv.innerHTML = '<div class="loading" style="padding:8px"><div class="spinner"></div> Importing...</div>';

    try {
      const result = await api('POST', '/searches/' + currentSearchId + '/import-dashboard', { html_content });
      if (resultDiv) {
        resultDiv.innerHTML = `<div style="background:#e8f5e9;border:1px solid #a5d6a7;color:#2e7d32;padding:10px;border-radius:6px;font-size:13px">
          Imported ${result.imported} candidates — ${result.added_to_pipeline} added to pipeline.
        </div>`;
      }
      // Refresh search data
      const updated = await api('GET', '/searches/' + currentSearchId);
      currentSearchData = updated;
      setTimeout(() => {
        closeModal();
        renderSearchDetailView(currentSearchData, 'pipeline');
      }, 1800);
    } catch (err) {
      if (resultDiv) resultDiv.innerHTML = `<div class="error-banner">${escapeHtml(err.message)}</div>`;
    }
  };
  reader.readAsText(file);
}

// ── Edit Search Modal ─────────────────────────────────────────────────────────

function openEditSearchModal() {
  if (!currentSearchData) return;
  closeModal();

  const s = currentSearchData;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay-s3';
  overlay.id = 'edit-search-overlay';

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header-s3">
        <span class="modal-title-s3">Edit Search</span>
        <button class="modal-close-s3" onclick="closeModal()">&#215;</button>
      </div>
      <div class="form-group">
        <label class="form-label">Client Name</label>
        <input class="form-control" id="edit-client-name" value="${escapeHtml(s.client_name || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Role Title</label>
        <input class="form-control" id="edit-role-title" value="${escapeHtml(s.role_title || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Lead Recruiter</label>
        <input class="form-control" id="edit-lead" value="${escapeHtml(s.lead_recruiter || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-control" id="edit-status">
          <option value="active" ${s.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="closed" ${s.status === 'closed' ? 'selected' : ''}>Closed</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Ideal Candidate Profile</label>
        <textarea class="form-control" id="edit-profile" rows="4">${escapeHtml(s.ideal_candidate_profile || '')}</textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveEditSearch()">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

async function saveEditSearch() {
  const updates = {
    client_name:             document.getElementById('edit-client-name').value.trim(),
    role_title:              document.getElementById('edit-role-title').value.trim(),
    lead_recruiter:          document.getElementById('edit-lead').value.trim(),
    status:                  document.getElementById('edit-status').value,
    ideal_candidate_profile: document.getElementById('edit-profile').value.trim()
  };

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, updates);
    currentSearchData = Object.assign({}, currentSearchData, updated);
    closeModal();
    renderSearchDetailView(currentSearchData, currentTab);
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}

// ── Close Search + Debrief trigger ───────────────────────────────────────────

async function initiateCloseSearch(searchId) {
  if (!confirm('Close this search? You will be prompted to debrief the pipeline before archiving.')) return;
  try {
    // Close the search
    await api('PUT', '/searches/' + searchId + '/close', {});
    // Reload search data and trigger debrief via pool module
    const search = await api('GET', '/searches/' + searchId);
    // Navigate to candidate pool with debrief mode
    if (typeof openDebriefFlow === 'function') {
      navigateTo('pool');
      setTimeout(() => openDebriefFlow(search), 100);
    } else {
      navigateTo('searches');
      alert('Search closed. Open Candidate Pool to run the debrief.');
    }
  } catch (e) {
    alert('Error closing search: ' + e.message);
  }
}

// ── Search Kit Tab ────────────────────────────────────────────────────────────

const SECTOR_NAME_MAP = {
  'industrials':           'Industrials',
  'technology-software':   'Technology',
  'tech-enabled-services': 'Tech-Enabled Services',
  'healthcare':            'Healthcare',
  'financial-services':    'Financial Services',
  'consumer':              'Consumer',
  'business-services':     'Business Services',
  'infrastructure-energy': 'Infrastructure',
  'life-sciences':         'Life Sciences',
  'media-entertainment':   'Media',
  'real-estate-proptech':  'Real Estate',
  'agriculture-fb':        'Agriculture'
};

async function loadSearchKitTab(search) {
  const container = document.getElementById('search-kit-content');
  if (!container) return;
  try {
    const data = await api('GET', '/templates');
    container.innerHTML = renderSearchKitContent(search, data);
  } catch (err) {
    container.innerHTML = `<div class="error-banner">Failed to load templates: ${escapeHtml(err.message)}</div>`;
  }
}

function filterTemplatesForSearch(templates, search) {
  const searchSectorNames = (search.sectors || []).map(id => (SECTOR_NAME_MAP[id] || id).toLowerCase());
  const searchArchetypes  = (search.archetypes_requested || []).map(a => a.toLowerCase());

  return templates.filter(tpl => {
    const tplSector    = (tpl.sector    || '').trim().toLowerCase();
    const tplArchetype = (tpl.archetype || '').trim().toLowerCase();

    const sectorMatch    = !tplSector    || searchSectorNames.some(s => s.includes(tplSector) || tplSector.includes(s));
    const archetypeMatch = !tplArchetype || searchArchetypes.some(a => a.includes(tplArchetype) || tplArchetype.includes(a));

    return sectorMatch && archetypeMatch;
  });
}

function renderSearchKitContent(search, allTemplates) {
  const sectorLabels   = (search.sectors || []).map(id => SECTOR_NAME_MAP[id] || id).join(' · ');
  const archetypeLabel = (search.archetypes_requested || []).join(' · ');
  const contextLabel   = [sectorLabels, archetypeLabel].filter(Boolean).join(' · ') || 'All Templates';

  const SECTIONS = [
    { key: 'boolean_strings',         label: 'Boolean Strings',         typeKey: 'boolean'   },
    { key: 'outreach_messages',       label: 'Outreach Messages',       typeKey: 'outreach'  },
    { key: 'ideal_candidate_profiles',label: 'Ideal Candidate Profiles',typeKey: 'profile'   },
    { key: 'screen_question_guides',  label: 'Screen Question Guides',  typeKey: 'screen'    },
    { key: 'pitchbook_params',        label: 'PitchBook Parameters',    typeKey: 'pitchbook' }
  ];

  let sectionsHTML = '';
  SECTIONS.forEach(section => {
    const raw     = allTemplates[section.key] || [];
    const matched = filterTemplatesForSearch(raw, search);

    let bodyHTML;
    if (matched.length === 0) {
      bodyHTML = `<div class="search-kit-empty">No ${section.label.toLowerCase()} match this search's sector or archetype. <a href="#" onclick="navigateTo('templates');return false;">Open Templates Library →</a></div>`;
    } else {
      const rows = matched.map(tpl => {
        const safeId   = escapeHtml(tpl.id);
        const safeName = escapeHtml(tpl.name || '(Untitled)');
        const safeSector    = escapeHtml(tpl.sector    || '—');
        const safeArchetype = escapeHtml(tpl.archetype || '—');
        return `
          <tr>
            <td style="font-weight:600">${safeName}</td>
            <td style="color:#888">${safeSector}</td>
            <td style="color:#888">${safeArchetype}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-ghost btn-sm" onclick="openTemplateUseModal(${JSON.stringify(tpl).replace(/"/g, '&quot;')}, '${section.typeKey}', ${JSON.stringify(search).replace(/"/g, '&quot;')})">Use</button>
            </td>
          </tr>`;
      }).join('');
      bodyHTML = `
        <table class="search-kit-table">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:#999;padding:4px 10px">Name</th>
            <th style="text-align:left;font-size:11px;color:#999;padding:4px 10px">Sector</th>
            <th style="text-align:left;font-size:11px;color:#999;padding:4px 10px">Archetype</th>
            <th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    sectionsHTML += `
      <div class="search-kit-section">
        <div class="search-kit-section-header">${section.label} (${matched.length})</div>
        ${bodyHTML}
      </div>`;
  });

  const searchJson = JSON.stringify(search).replace(/"/g, '&quot;');
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:20px">
      <div class="search-kit-context-banner" style="margin-bottom:0;flex:1">Showing templates for: ${escapeHtml(contextLabel)}</div>
      <button class="btn btn-primary btn-sm" onclick="openBooleanBuilder(${searchJson})">&#128269; Build Boolean String</button>
    </div>
    ${sectionsHTML}
    <div style="margin-top:16px;font-size:13px;color:#888">
      <a href="#" onclick="navigateTo('templates');return false;" style="color:#5C2D91;font-weight:600">→ Open Templates Library</a>
    </div>`;
}

function openTemplateUseModal(template, templateType, search) {
  const role = search.role_title  || '{{role}}';
  const firm = search.client_name || '{{firm}}';

  function applyPlaceholders(str) {
    if (!str) return '';
    return str.replace(/\{\{role\}\}/gi, role).replace(/\{\{firm\}\}/gi, firm);
  }

  let previewHTML = '';
  let copyText    = '';

  if (templateType === 'boolean') {
    const filled = applyPlaceholders(template.query || '');
    copyText    = filled;
    previewHTML = `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;background:#f5f5f5;padding:16px;border-radius:8px;line-height:1.6">${escapeHtml(filled)}</pre>`;

  } else if (templateType === 'outreach') {
    const subject = applyPlaceholders(template.subject || '');
    const body    = applyPlaceholders(template.body    || '');
    copyText = (subject ? 'Subject: ' + subject + '\n\n' : '') + body;
    previewHTML = `
      ${subject ? `<div style="margin-bottom:12px"><strong>Subject:</strong> ${escapeHtml(subject)}</div>` : ''}
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:#f5f5f5;padding:16px;border-radius:8px;line-height:1.6">${escapeHtml(body)}</pre>`;

  } else if (templateType === 'profile') {
    const mustHaves    = (template.must_haves    || []).map(x => applyPlaceholders(x));
    const niceToHaves  = (template.nice_to_haves || []).map(x => applyPlaceholders(x));
    const redFlags     = (template.red_flags     || []).map(x => applyPlaceholders(x));
    copyText = 'Must-Haves:\n' + mustHaves.map(x => '• ' + x).join('\n')
             + '\n\nNice-to-Haves:\n' + niceToHaves.map(x => '• ' + x).join('\n')
             + '\n\nRed Flags:\n' + redFlags.map(x => '• ' + x).join('\n');
    const listHtml = (label, items) => `
      <div style="margin-bottom:14px">
        <strong>${label}</strong>
        <ul style="margin:6px 0 0 18px;line-height:1.7;font-size:13px">${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
      </div>`;
    previewHTML = listHtml('Must-Haves', mustHaves) + listHtml('Nice-to-Haves', niceToHaves) + listHtml('Red Flags', redFlags);

  } else if (templateType === 'screen') {
    const questions = (template.questions || []).map(x => applyPlaceholders(x));
    copyText    = questions.map((q, i) => (i + 1) + '. ' + q).join('\n');
    previewHTML = `<ol style="margin:0 0 0 18px;line-height:1.9;font-size:13px">${questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ol>`;

  } else if (templateType === 'pitchbook') {
    const fields = Object.entries(template).filter(([k]) => !['id','name','sector','archetype','created_at','updated_at'].includes(k));
    copyText    = fields.map(([k, v]) => k + ': ' + (Array.isArray(v) ? v.join(', ') : v)).join('\n');
    previewHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">` +
      fields.map(([k, v]) => `
        <tr>
          <td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;font-weight:600">${escapeHtml(k.replace(/_/g,' '))}</td>
          <td style="padding:6px 0">${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v || '—'))}</td>
        </tr>`).join('') +
      `</table>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'search-kit-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:640px;max-height:80vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0;font-size:1.1rem">${escapeHtml(template.name || '(Untitled)')}</h2>
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('search-kit-modal').remove()">&#10005;</button>
      </div>
      <div style="margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="kit-copy-btn" onclick="copySearchKitContent(${JSON.stringify(copyText).replace(/"/g, '&quot;')}, this)">&#128203; Copy</button>
        <span style="font-size:12px;color:#999;margin-left:10px">{{name}} placeholders left for you to fill in</span>
      </div>
      <div>${previewHTML}</div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function copySearchKitContent(text, btnEl) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btnEl.textContent;
    btnEl.textContent = 'Copied!';
    setTimeout(() => { btnEl.textContent = orig; }, 1800);
  }).catch(() => alert('Copy failed — please copy manually.'));
}

// ── Boolean String Builder ────────────────────────────────────────────────────

let _boolState = null;

const SECTOR_KW = {
  'industrials':           ['manufacturing', 'industrial services', 'distribution', 'supply chain', 'engineered products', 'PE-backed', 'portfolio company'],
  'technology-software':   ['SaaS', 'B2B software', 'enterprise software', 'cloud platform', 'PE-backed', 'portfolio company'],
  'tech-enabled-services': ['tech-enabled', 'technology services', 'managed services', 'PE-backed', 'portfolio company'],
  'healthcare':            ['healthcare services', 'healthcare IT', 'physician practice', 'PE-backed', 'portfolio company'],
  'financial-services':    ['financial services', 'asset management', 'wealth management', 'PE-backed'],
  'consumer':              ['consumer brands', 'omnichannel', 'DTC', 'retail', 'PE-backed', 'portfolio company'],
  'business-services':     ['business services', 'outsourcing', 'BPO', 'PE-backed', 'portfolio company'],
  'infrastructure-energy': ['infrastructure', 'energy', 'utilities', 'renewable energy', 'PE-backed'],
  'life-sciences':         ['life sciences', 'medical devices', 'diagnostics', 'biopharma', 'PE-backed'],
  'media-entertainment':   ['media', 'entertainment', 'digital media', 'content', 'PE-backed'],
  'real-estate-proptech':  ['real estate', 'proptech', 'commercial real estate', 'PE-backed'],
  'agriculture-fb':        ['agriculture', 'agribusiness', 'food and beverage', 'F&B', 'PE-backed']
};

function suggestTitleVariants(roleTitle) {
  if (!roleTitle) return [];
  const t = roleTitle.toLowerCase();
  const set = new Set([roleTitle]);

  if (/operating partner|portfolio operating/.test(t)) {
    ['Operating Partner', 'Portfolio Operating Partner', 'Operating Executive', 'Executive in Residence',
     'CEO', 'COO', 'President', 'Division President', 'Group President'].forEach(v => set.add(v));
  }
  if (/\bcoo\b|chief operating officer/.test(t)) {
    ['COO', 'Chief Operating Officer', 'VP Operations', 'SVP Operations', 'Head of Operations'].forEach(v => set.add(v));
  }
  if (/\bcfo\b|chief financial officer/.test(t)) {
    ['CFO', 'Chief Financial Officer', 'VP Finance', 'SVP Finance', 'Head of Finance'].forEach(v => set.add(v));
  }
  if (/\bceo\b|chief executive officer/.test(t)) {
    ['CEO', 'Chief Executive Officer', 'President', 'Managing Director', 'Executive Director'].forEach(v => set.add(v));
  }
  if (/\bcto\b|chief technology|chief technical/.test(t)) {
    ['CTO', 'Chief Technology Officer', 'VP Engineering', 'SVP Engineering', 'Head of Engineering'].forEach(v => set.add(v));
  }
  if (/\bcmo\b|chief marketing/.test(t)) {
    ['CMO', 'Chief Marketing Officer', 'VP Marketing', 'SVP Marketing', 'Head of Marketing'].forEach(v => set.add(v));
  }
  if (/\bchro\b|chief human resources|chief people/.test(t)) {
    ['CHRO', 'Chief People Officer', 'VP Human Resources', 'SVP Human Resources', 'Head of HR'].forEach(v => set.add(v));
  }
  if (/\bpresident\b/.test(t) && !/vice president/.test(t)) {
    ['President', 'CEO', 'Chief Executive Officer', 'Managing Director', 'Division President', 'Group President'].forEach(v => set.add(v));
  }
  if (/(vp|vice president).*(operations|operating)/.test(t)) {
    ['VP Operations', 'VP of Operations', 'SVP Operations', 'EVP Operations', 'COO'].forEach(v => set.add(v));
  }
  if (/(vp|vice president).*(financ|cfo)/.test(t)) {
    ['VP Finance', 'VP of Finance', 'SVP Finance', 'CFO'].forEach(v => set.add(v));
  }

  // If only the exact title matched (no pattern hit), add generic seniority variants
  if (set.size === 1) {
    const words = roleTitle.split(' ');
    const fn = words.slice(-1)[0]; // last word as function hint
    ['VP', 'SVP', 'EVP'].forEach(pre => set.add(`${pre} ${fn}`));
  }

  return [...set].slice(0, 8);
}

function openBooleanBuilder(search) {
  const titles    = suggestTitleVariants(search.role_title || '');
  const companies = [
    ...(search.sourcing_coverage?.pe_firms        || []).map(f => f.name).filter(Boolean),
    ...(search.sourcing_coverage?.target_companies || []).map(c => c.name).filter(Boolean)
  ].slice(0, 12);
  const keywords   = (search.sectors || []).flatMap(id => SECTOR_KW[id] || []).slice(0, 8);
  const exclusions = ['analyst', 'associate', 'intern', 'junior', 'coordinator', 'assistant'];

  _boolState = { titles, companies, keywords, exclusions };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'bool-builder-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:820px;max-height:90vh;overflow-y:auto;padding:0;border-radius:14px">
      <div style="background:linear-gradient(135deg,#5C2D91,#7b52a8);padding:20px 24px 18px;border-radius:14px 14px 0 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <h2 style="margin:0;font-size:1.05rem;font-weight:800;color:#fff;letter-spacing:-0.2px">&#128269; Boolean String Builder</h2>
            <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px">
              ${escapeHtml(search.client_name)} &mdash; ${escapeHtml(search.role_title || '')}
            </div>
          </div>
          <button onclick="document.getElementById('bool-builder-modal').remove()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">&#10005;</button>
        </div>
      </div>
      <div style="padding:20px 24px 24px">
      <div style="font-size:12px;color:#888;margin-bottom:16px;padding:10px 14px;background:#f9f6fd;border-radius:7px;border:1px solid #ede7f6">
        Click &#10005; on a tag to remove it &nbsp;&middot;&nbsp; Type + <kbd style="font-size:11px;background:#fff;padding:1px 5px;border-radius:3px;border:1px solid #ddd">Enter</kbd> to add your own &nbsp;&middot;&nbsp; Drag between sections coming soon
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        ${renderBoolBlock('titles',     'block-titles',     'Job Titles',  'OR &mdash; any of these titles will match')}
        ${renderBoolBlock('companies',  'block-companies',  'Companies',   'OR &mdash; candidates at any of these firms')}
        ${renderBoolBlock('keywords',   'block-keywords',   'Keywords',    'OR &mdash; background / industry keywords')}
        ${renderBoolBlock('exclusions', 'block-exclusions', 'Exclude',     'NOT &mdash; filter these terms out')}
      </div>

      <div style="margin:20px 0 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:11px;font-weight:800;color:#999;text-transform:uppercase;letter-spacing:0.8px">Generated Boolean String</div>
          <button class="btn btn-ghost btn-sm" id="bool-copy-btn" onclick="copyBooleanString(this)" style="font-size:12px">&#128203; Copy</button>
        </div>
        <pre id="bool-preview" style="white-space:pre-wrap;font-family:'Courier New',monospace;font-size:12.5px;background:#1e1e2e;color:#cdd6f4;padding:18px 20px;border-radius:10px;line-height:1.8;min-height:70px;margin:0;border:1.5px solid #2a2a3d"></pre>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;align-items:center;padding-top:12px;border-top:1px solid #f0f0f0">
        <span style="font-size:12px;color:#bbb;flex:1">Paste directly into LinkedIn Recruiter, LinkedIn Search, or PitchBook</span>
        <button class="btn btn-ghost" onclick="document.getElementById('bool-builder-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="saveBooleanToTemplates(${JSON.stringify(search).replace(/"/g, '&quot;')})">&#128190; Save to Templates</button>
      </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  updateBooleanPreview();
}

function renderBoolBlock(blockId, modClass, label, hint) {
  return `
    <div class="bool-block ${modClass}">
      <div class="bool-block-label">${label}</div>
      <div class="bool-block-hint">${hint}</div>
      <div class="bool-tag-input" id="tags-${blockId}" onclick="focusBoolInput('${blockId}')">
        <input class="bool-tag-raw" id="input-${blockId}" type="text" placeholder="Type &amp; press Enter..."
          onkeydown="handleBoolTagKey(event,'${blockId}')" />
      </div>
    </div>`;
}

function refreshBoolTags(blockId) {
  const container = document.getElementById('tags-' + blockId);
  if (!container) return;
  const input = container.querySelector('input');
  container.querySelectorAll('.bool-tag').forEach(el => el.remove());
  (_boolState[blockId] || []).forEach((tag, i) => {
    const pill = document.createElement('span');
    pill.className = 'bool-tag';
    pill.innerHTML = `${escapeHtml(tag)}<button type="button" onclick="removeBoolTag('${blockId}',${i})" title="Remove">&#10005;</button>`;
    container.insertBefore(pill, input);
  });
}

function handleBoolTagKey(e, blockId) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = e.target.value.trim().replace(/,$/, '');
    if (val) {
      _boolState[blockId].push(val);
      e.target.value = '';
      updateBooleanPreview();
    }
  }
}

function removeBoolTag(blockId, index) {
  _boolState[blockId].splice(index, 1);
  updateBooleanPreview();
}

function focusBoolInput(blockId) {
  document.getElementById('input-' + blockId)?.focus();
}

function updateBooleanPreview() {
  ['titles', 'companies', 'keywords', 'exclusions'].forEach(id => refreshBoolTags(id));
  const preview = document.getElementById('bool-preview');
  if (preview) preview.textContent = generateBooleanString(_boolState);
}

function generateBooleanString(state) {
  function quote(term) { return term.includes(' ') ? `"${term}"` : term; }
  function orGroup(arr) {
    const f = arr.map(quote);
    return f.length === 1 ? f[0] : `(${f.join(' OR ')})`;
  }

  const parts = [];
  if (state.titles.length)    parts.push(orGroup(state.titles));
  if (state.companies.length) parts.push(orGroup(state.companies));
  if (state.keywords.length)  parts.push(orGroup(state.keywords));

  let result = parts.join('\nAND ');

  if (state.exclusions.length) {
    const excStr = state.exclusions.map(quote).join(' OR ');
    const excGroup = state.exclusions.length > 1 ? `(${excStr})` : excStr;
    result += (result ? '\nNOT ' : 'NOT ') + excGroup;
  }

  return result || '(add tags above to build your string)';
}

function copyBooleanString(btnEl) {
  const text = document.getElementById('bool-preview')?.textContent || '';
  navigator.clipboard.writeText(text).then(() => {
    const orig = btnEl.innerHTML;
    btnEl.innerHTML = 'Copied!';
    setTimeout(() => { btnEl.innerHTML = orig; }, 1800);
  }).catch(() => alert('Copy failed — please copy manually.'));
}

async function saveBooleanToTemplates(search) {
  const query = document.getElementById('bool-preview')?.textContent || '';
  if (!query || query.startsWith('(add tags')) {
    alert('Please add some tags before saving.');
    return;
  }
  const name      = `${search.role_title || 'Role'} — Boolean String`;
  const sector    = (search.sectors || []).map(id => SECTOR_NAME_MAP[id] || id)[0] || '';
  const archetype = (search.archetypes_requested || [])[0] || '';
  try {
    await api('POST', '/templates/boolean', { name, query, sector, archetype });
    const btn = document.querySelector('#bool-builder-modal .btn-primary');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}
