/* ── Lancor Search OS — searches.js — Session 3 ──────────────────────────── */
/* Active Searches list, new search wizard, search detail, pipeline module    */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let currentSearchId = null;
let currentSearchData = null;
let currentTab = 'pipeline';
let pipelineFilters = { stage: 'all', archetype: 'all', text: '' };

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

const DEFAULT_PIPELINE_STAGES = [
  { name: 'Pursuing',      color_bg: '#eeeeee', color_text: '#616161' },
  { name: 'Outreach Sent', color_bg: '#f3e5f5', color_text: '#7b1fa2' },
  { name: 'Scheduling',    color_bg: '#fff3e0', color_text: '#e65100' },
  { name: 'Interviewing',  color_bg: '#e3f2fd', color_text: '#1565c0' },
  { name: 'Qualifying',    color_bg: '#e8f5e9', color_text: '#2e7d32' },
  { name: 'Hold',          color_bg: '#efebe9', color_text: '#4e342e' },
  { name: 'DQ',            color_bg: '#ffebee', color_text: '#c62828' },
  { name: 'NI',            color_bg: '#fffde7', color_text: '#f57f17' }
];

function getSearchStages(search) {
  return (search && search.pipeline_stages) || DEFAULT_PIPELINE_STAGES;
}

function getStageColor(search, stageName) {
  const s = getSearchStages(search).find(st => st.name === stageName);
  return s ? { bg: s.color_bg, color: s.color_text } : { bg: '#eee', color: '#333' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stagePillHTML(stage, search) {
  const c = getStageColor(search, stage);
  return `<span class="stage-pill" style="background:${c.bg};color:${c.color}">${escapeHtml(stage)}</span>`;
}

function getPipelineStats(pipeline, search) {
  const stages = getSearchStages(search);
  const counts = {};
  stages.forEach(s => { counts[s.name] = 0; });
  (pipeline || []).forEach(c => {
    if (counts[c.stage] !== undefined) counts[c.stage]++;
    else counts[c.stage] = (counts[c.stage] || 0) + 1;
  });
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
  const counts = getPipelineStats(search.pipeline, search);
  const lastUpdated = getLastUpdated(search);

  const stages = getSearchStages(search);
  const pillsHTML = stages.map(s => {
    const count = counts[s.name] || 0;
    return count > 0 ? `<span class="stage-pill" style="background:${s.color_bg};color:${s.color_text}">${count} ${escapeHtml(s.name)}</span>` : '';
  }).filter(Boolean).join('');

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
    appAlert('Error loading searches: ' + err.message, { type: 'error' });
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
          `<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;padding:8px;border:1px solid #e0e0e0;border-radius:6px;${wizardData.sectors.includes(s.id) ? 'background:#F3E8EF;border-color:#6B2D5B;' : ''}">
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
      appAlert('Client Name and Role Title are required.', { type: 'warning' });
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
    const slug = slugify(wizardData.client_name) + '-' + slugify(wizardData.role_title || '') + '-' + new Date().getFullYear();
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
    appAlert('Error creating search: ' + err.message, { type: 'error' });
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

  const tabsHTML = ['Pipeline', 'Sourcing Coverage', 'Weekly Updates', 'Search Kit', 'Analytics'].map(t => {
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
    } else if (tab === 'analytics') {
      tabContent = typeof renderSearchAnalyticsTabHTML === 'function'
        ? renderSearchAnalyticsTabHTML()
        : '<div class="error-banner">search-analytics.js not loaded</div>';
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
  if (tab === 'analytics') {
    loadSearchAnalyticsTab();
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
  const stages = getSearchStages(search);
  const counts = getPipelineStats(pipeline, search);

  // Metric pills — one per stage
  const metricsHTML = `
    <div class="pipeline-metrics">
      ${stages.map(s => {
        const count = counts[s.name] || 0;
        return `<div class="metric-pill" style="background:${s.color_bg};color:${s.color_text}">${count} ${escapeHtml(s.name)}</div>`;
      }).join('')}
    </div>
  `;

  // Filter bar (no owner filter)
  const filterBarHTML = `
    <div class="filter-bar" style="margin-bottom:16px">
      <select id="filter-stage" onchange="applyPipelineFilters()">
        <option value="all">All Stages</option>
        ${stages.map(s => `<option value="${escapeHtml(s.name)}" ${pipelineFilters.stage === s.name ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
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
  const filtered = applyFiltersToList(pipeline);

  // Build one collapsible section per stage
  const sectionsHTML = stages.map((s, idx) => {
    const stageCandidates = filtered.filter(c => c.stage === s.name);
    // If filtering by stage and this isn't the selected stage, skip
    if (pipelineFilters.stage !== 'all' && pipelineFilters.stage !== s.name) return '';

    const count = stageCandidates.length;
    const startExpanded = count > 0 && idx < 5; // first 5 stages start expanded if they have candidates
    const sectionId = 'stage-section-' + slugify(s.name);

    const tableBody = count === 0
      ? `<p style="color:#aaa;font-size:13px;padding:12px 0">No candidates in this stage.</p>`
      : `<div class="table-wrapper">
           <table class="pipeline-table">
             <thead>
               <tr>
                 <th>Candidate</th>
                 <th style="text-align:center">
                   <div style="font-size:10px;color:#888">Team members met with</div>
                 </th>
                 <th>Next Step</th>
               </tr>
             </thead>
             <tbody>
               ${stageCandidates.map(c => pipelineRowHTML(c, search)).join('')}
             </tbody>
           </table>
         </div>`;

    return `
      <div class="collapsible-section stage-section" style="border-left:4px solid ${s.color_bg}"
        data-stage="${escapeHtml(s.name)}"
        ondragover="onPipelineDragOver(event)" ondragleave="onPipelineDragLeave(event)"
        ondrop="onPipelineDrop(event,'${escapeHtml(s.name)}')">
        <div class="collapsible-header" onclick="toggleSection('${sectionId}')" style="background:${s.color_bg}22">
          <span style="font-weight:700;color:${s.color_text}">${escapeHtml(s.name)} <span style="font-weight:400;color:#888">(${count})</span></span>
          <span id="${sectionId}-arrow">${startExpanded ? '&#9660;' : '&#9654;'}</span>
        </div>
        <div class="collapsible-body" id="${sectionId}" style="${startExpanded ? '' : 'display:none'}">
          ${tableBody}
        </div>
      </div>`;
  }).join('');

  return `
    ${metricsHTML}
    ${filterBarHTML}
    <div id="pipeline-table-container">${sectionsHTML}</div>
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
    const abbr = ct.abbreviation || (ct.name || '??').slice(0, 2).toUpperCase();
    return `<div class="meeting-dot ${dotClass}" title="${escapeHtml(ct.name)}: ${escapeHtml(m.status)}"
      data-cid="${escapeHtml(c.candidate_id)}" data-contact="${escapeHtml(ct.name)}"
      onclick="cycleMeetingStatus('${escapeHtml(c.candidate_id)}','${escapeHtml(ct.name)}')">${escapeHtml(abbr)}</div>`;
  }).join('');

  const linkedinLink = c.linkedin_url
    ? ` <a href="${escapeHtml(c.linkedin_url)}" target="_blank" title="LinkedIn" style="color:#0a66c2;font-size:11px;margin-left:4px">in</a>`
    : '';

  const stageColor = getStageColor(search, c.stage);

  return `
    <tr data-cid="${escapeHtml(c.candidate_id)}" draggable="true"
      ondragstart="onPipelineDragStart(event,'${escapeHtml(c.candidate_id)}')"
      ondragend="onPipelineDragEnd(event)">
      <td>
        <div class="candidate-name"><span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${escapeHtml(c.candidate_id)}')">${escapeHtml(c.name)}</span>${linkedinLink}</div>
        <div class="candidate-subtitle">${escapeHtml(c.current_title || '')}${c.current_firm ? ' @ ' + escapeHtml(c.current_firm) : ''}</div>
        ${c.location ? `<div class="candidate-subtitle">${escapeHtml(c.location)}</div>` : ''}
        <span class="stage-pill" style="background:${stageColor.bg};color:${stageColor.color};cursor:pointer;margin-top:4px;display:inline-block;font-size:10px"
          onclick="event.stopPropagation();openStageDropdown(event,'${escapeHtml(c.candidate_id)}')">${escapeHtml(c.stage)} &#9662;</span>
      </td>
      <td>
        <div class="meeting-dots" style="justify-content:center">${meetingDotsHTML}</div>
      </td>
      <td class="editable-cell" data-cid="${escapeHtml(c.candidate_id)}" data-field="next_step"
        onclick="startInlineEdit(this)" style="min-width:180px;white-space:pre-wrap">
        ${c.next_step ? escapeHtml(c.next_step) : '<span style="color:#bbb">—</span>'}
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
  const archEl  = document.getElementById('filter-archetype');
  const textEl  = document.getElementById('filter-text');

  pipelineFilters.stage    = stageEl ? stageEl.value : 'all';
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

  const trigger = event.target.closest('.stage-pill') || event.target;
  const rect = trigger.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.className = 'stage-dropdown-popup';
  popup.id = 'stage-popup-' + candidateId;
  popup.style.position = 'fixed';
  popup.style.zIndex = '9999';
  popup.style.top = (rect.bottom + 4) + 'px';
  popup.style.left = rect.left + 'px';

  const stages = getSearchStages(currentSearchData);
  popup.innerHTML = stages.map(s => {
    return `<div class="stage-option" style="background:${s.color_bg};color:${s.color_text}"
      onclick="setStage('${candidateId}','${escapeHtml(s.name)}')">${escapeHtml(s.name)}</div>`;
  }).join('');

  document.body.appendChild(popup);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeAllDropdowns, { once: true });
  }, 0);
}

function closeAllDropdowns() {
  document.querySelectorAll('.stage-dropdown-popup').forEach(el => el.remove());
}

// ── Drag and drop between pipeline sections ────────────────────────────────

let _dragCandidateId = null;

function onPipelineDragStart(event, candidateId) {
  _dragCandidateId = candidateId;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', candidateId);
  // Style the dragged row
  const row = event.target.closest('tr');
  if (row) row.style.opacity = '0.4';
}

function onPipelineDragEnd(event) {
  _dragCandidateId = null;
  const row = event.target.closest('tr');
  if (row) row.style.opacity = '';
  // Remove all drop highlights
  document.querySelectorAll('.stage-section').forEach(s => s.classList.remove('drag-over'));
}

function onPipelineDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const section = event.target.closest('.stage-section');
  if (section) section.classList.add('drag-over');
}

function onPipelineDragLeave(event) {
  const section = event.target.closest('.stage-section');
  // Only remove if we're actually leaving the section (not entering a child)
  if (section && !section.contains(event.relatedTarget)) {
    section.classList.remove('drag-over');
  }
}

function onPipelineDrop(event, targetStage) {
  event.preventDefault();
  const candidateId = event.dataTransfer.getData('text/plain') || _dragCandidateId;
  document.querySelectorAll('.stage-section').forEach(s => s.classList.remove('drag-over'));
  if (!candidateId || !targetStage) return;
  setStage(candidateId, targetStage);
}

async function setStage(candidateId, newStage) {
  closeAllDropdowns();

  if (!currentSearchData) return;

  const pipeline = currentSearchData.pipeline;
  const idx = pipeline.findIndex(c => c.candidate_id === candidateId);
  if (idx === -1) return;

  // Prompt for DQ reason
  if (newStage === 'DQ' || newStage === 'NI') {
    const reason = await appPrompt(`Reason for ${newStage}:`);
    pipeline[idx].dq_reason = reason || '';
  }

  pipeline[idx].stage = newStage;

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { pipeline });
    currentSearchData.pipeline = updated.pipeline || pipeline;
    renderSearchDetailView(currentSearchData, 'pipeline');
  } catch (err) {
    appAlert('Error saving stage: ' + err.message, { type: 'error' });
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
    appAlert('Error saving meeting status: ' + err.message, { type: 'error' });
  }
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
    appAlert('Error saving: ' + err.message, { type: 'error' });
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
        <div style="border-left:3px solid #6B2D5B;padding-left:16px;margin-bottom:20px">
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
        <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;color:#6B2D5B">Client Dashboard</h3>
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
  if (!notes) { appAlert('Please enter notes.', { type: 'warning' }); return; }

  if (!currentSearchData) return;

  const weekly_updates = [...(currentSearchData.weekly_updates || []), { date, notes }];

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, { weekly_updates });
    currentSearchData.weekly_updates = updated.weekly_updates || weekly_updates;
    renderSearchDetailView(currentSearchData, 'weekly-updates');
  } catch (err) {
    appAlert('Error saving note: ' + err.message, { type: 'error' });
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
          ${getSearchStages(currentSearchData).map(s => `<option ${s.name === 'Pursuing' ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
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
    appAlert('Please fill in all required fields (Name, Title, Firm, Location).', { type: 'warning' });
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
    appAlert('Error adding candidate: ' + err.message, { type: 'error' });
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
    appAlert('Please select an HTML file.', { type: 'warning' });
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

      <!-- Pipeline Stages Editor -->
      <div class="form-group">
        <label class="form-label">Pipeline Stages</label>
        <div id="edit-stages-list" style="margin-bottom:8px">
          ${getSearchStages(s).map((st, i) => `
            <div class="edit-stage-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <button class="btn btn-ghost btn-sm" onclick="moveStageUp(this)" style="padding:2px 6px">&#9650;</button>
              <button class="btn btn-ghost btn-sm" onclick="moveStageDown(this)" style="padding:2px 6px">&#9660;</button>
              <span style="width:14px;height:14px;border-radius:3px;background:${st.color_bg};border:1px solid ${st.color_text};flex-shrink:0"></span>
              <input class="form-control edit-stage-name" value="${escapeHtml(st.name)}" style="flex:1;padding:4px 8px;font-size:13px">
              <input type="color" class="edit-stage-color" value="${st.color_text}" style="width:28px;height:28px;padding:0;border:none;cursor:pointer" title="Stage color">
              <button class="btn btn-ghost btn-sm" onclick="removeStageRow(this)" style="color:#c62828;padding:2px 6px">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="addStageRow()" style="font-size:12px">+ Add Stage</button>
      </div>

      <!-- Client Contacts Editor -->
      <div class="form-group">
        <label class="form-label">Client Contacts (meeting matrix)</label>
        <div id="edit-contacts-list" style="margin-bottom:8px">
          ${(s.client_contacts || []).map((ct, i) => `
            <div class="edit-contact-row" style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <input class="form-control edit-contact-name" value="${escapeHtml(ct.name || '')}" placeholder="Name" style="flex:1;padding:4px 8px;font-size:13px">
              <input class="form-control edit-contact-abbr" value="${escapeHtml(ct.abbreviation || '')}" placeholder="Abbr" style="width:50px;padding:4px 8px;font-size:13px;text-align:center" maxlength="3">
              <label style="font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap">
                <input type="checkbox" class="edit-contact-visible" ${ct.display_in_matrix !== false ? 'checked' : ''}> Show
              </label>
              <button class="btn btn-ghost btn-sm" onclick="this.closest('.edit-contact-row').remove()" style="color:#c62828;padding:2px 6px">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="addContactRow()" style="font-size:12px">+ Add Contact</button>
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

// ── Stage/Contact editor helpers ──────────────────────────────────────────────

function addStageRow() {
  const list = document.getElementById('edit-stages-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'edit-stage-row';
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
  row.innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="moveStageUp(this)" style="padding:2px 6px">&#9650;</button>
    <button class="btn btn-ghost btn-sm" onclick="moveStageDown(this)" style="padding:2px 6px">&#9660;</button>
    <span style="width:14px;height:14px;border-radius:3px;background:#e0e0e0;border:1px solid #888;flex-shrink:0"></span>
    <input class="form-control edit-stage-name" value="" placeholder="New stage name" style="flex:1;padding:4px 8px;font-size:13px">
    <input type="color" class="edit-stage-color" value="#666666" style="width:28px;height:28px;padding:0;border:none;cursor:pointer" title="Stage color">
    <button class="btn btn-ghost btn-sm" onclick="removeStageRow(this)" style="color:#c62828;padding:2px 6px">&#10005;</button>
  `;
  list.appendChild(row);
}

function removeStageRow(btn) {
  btn.closest('.edit-stage-row').remove();
}

function moveStageUp(btnOrIdx) {
  const list = document.getElementById('edit-stages-list');
  if (!list) return;
  const row = typeof btnOrIdx === 'number'
    ? list.querySelectorAll('.edit-stage-row')[btnOrIdx]
    : btnOrIdx.closest('.edit-stage-row');
  if (!row || !row.previousElementSibling) return;
  list.insertBefore(row, row.previousElementSibling);
}

function moveStageDown(btnOrIdx) {
  const list = document.getElementById('edit-stages-list');
  if (!list) return;
  const row = typeof btnOrIdx === 'number'
    ? list.querySelectorAll('.edit-stage-row')[btnOrIdx]
    : btnOrIdx.closest('.edit-stage-row');
  if (!row || !row.nextElementSibling) return;
  list.insertBefore(row.nextElementSibling, row);
}

function addContactRow() {
  const list = document.getElementById('edit-contacts-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'edit-contact-row';
  row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
  row.innerHTML = `
    <input class="form-control edit-contact-name" value="" placeholder="Name" style="flex:1;padding:4px 8px;font-size:13px">
    <input class="form-control edit-contact-abbr" value="" placeholder="Abbr" style="width:50px;padding:4px 8px;font-size:13px;text-align:center" maxlength="3">
    <label style="font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap">
      <input type="checkbox" class="edit-contact-visible" checked> Show
    </label>
    <button class="btn btn-ghost btn-sm" onclick="this.closest('.edit-contact-row').remove()" style="color:#c62828;padding:2px 6px">&#10005;</button>
  `;
  list.appendChild(row);
}

function collectStagesFromEditor() {
  const rows = document.querySelectorAll('#edit-stages-list .edit-stage-row');
  return Array.from(rows).map(row => {
    const name = row.querySelector('.edit-stage-name').value.trim();
    const colorText = row.querySelector('.edit-stage-color').value;
    // Generate a light background from the text color
    const hex = colorText.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
    const colorBg = `rgba(${r},${g},${b},0.1)`;
    return { name, color_bg: colorBg, color_text: colorText };
  }).filter(s => s.name);
}

function collectContactsFromEditor() {
  const rows = document.querySelectorAll('#edit-contacts-list .edit-contact-row');
  return Array.from(rows).map(row => {
    const name = row.querySelector('.edit-contact-name').value.trim();
    let abbreviation = row.querySelector('.edit-contact-abbr').value.trim();
    if (!abbreviation && name) {
      const parts = name.split(/\s+/);
      abbreviation = parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
    }
    const display_in_matrix = row.querySelector('.edit-contact-visible').checked;
    return { name, abbreviation, display_in_matrix };
  }).filter(c => c.name);
}

async function saveEditSearch() {
  const updates = {
    client_name:             document.getElementById('edit-client-name').value.trim(),
    role_title:              document.getElementById('edit-role-title').value.trim(),
    lead_recruiter:          document.getElementById('edit-lead').value.trim(),
    status:                  document.getElementById('edit-status').value,
    ideal_candidate_profile: document.getElementById('edit-profile').value.trim(),
    pipeline_stages:         collectStagesFromEditor(),
    client_contacts:         collectContactsFromEditor()
  };

  try {
    const updated = await api('PUT', '/searches/' + currentSearchId, updates);
    currentSearchData = Object.assign({}, currentSearchData, updated);
    closeModal();
    renderSearchDetailView(currentSearchData, currentTab);
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

// ── Close Search + Debrief trigger ───────────────────────────────────────────

async function initiateCloseSearch(searchId) {
  if (!(await appConfirm('Close this search? You will be prompted to debrief the pipeline before archiving.'))) return;
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
      appAlert('Search closed. Open Candidate Pool to run the debrief.', { type: 'success' });
    }
  } catch (e) {
    appAlert('Error closing search: ' + e.message, { type: 'error' });
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

// ── Kit state ──
let _kitSearch = null; // current search reference for kit operations

async function loadSearchKitTab(search) {
  _kitSearch = search;
  const container = document.getElementById('search-kit-content');
  if (!container) return;
  const kit = search.search_kit || {};
  container.innerHTML = renderSearchKitWorkspace(search, kit);
}

async function saveKitEntry(type, entry) {
  if (!_kitSearch) return;
  if (!_kitSearch.search_kit) _kitSearch.search_kit = { boolean_strings:[], outreach_messages:[], ideal_candidate_profiles:[], screen_question_guides:[], pitchbook_params:[] };
  if (!_kitSearch.search_kit[type]) _kitSearch.search_kit[type] = [];
  _kitSearch.search_kit[type].push(entry);
  await api('PUT', '/searches/' + _kitSearch.search_id, { search_kit: _kitSearch.search_kit });
  currentSearchData = _kitSearch;
  loadSearchKitTab(_kitSearch);
}

async function confirmDeleteKitEntry(type, id) {
  if (!(await appConfirm('Delete this entry?'))) return;
  deleteKitEntry(type, id);
}

async function deleteKitEntry(type, id) {
  if (!_kitSearch?.search_kit?.[type]) return;
  _kitSearch.search_kit[type] = _kitSearch.search_kit[type].filter(e => e.id !== id);
  await api('PUT', '/searches/' + _kitSearch.search_id, { search_kit: _kitSearch.search_kit });
  currentSearchData = _kitSearch;
  loadSearchKitTab(_kitSearch);
}

async function updateKitEntry(type, id, updates) {
  if (!_kitSearch?.search_kit?.[type]) return;
  const idx = _kitSearch.search_kit[type].findIndex(e => e.id === id);
  if (idx === -1) return;
  Object.assign(_kitSearch.search_kit[type][idx], updates);
  await api('PUT', '/searches/' + _kitSearch.search_id, { search_kit: _kitSearch.search_kit });
  currentSearchData = _kitSearch;
  loadSearchKitTab(_kitSearch);
}

function closeKitModal() {
  document.getElementById('kit-modal-overlay')?.remove();
}

function kitModal(title, subtitle, bodyHTML, footerHTML, opts = {}) {
  closeKitModal();
  const maxW = opts.maxWidth || '720px';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'kit-modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:${maxW};max-height:90vh;overflow-y:auto;padding:0;border-radius:14px">
      <div style="background:linear-gradient(135deg,#6B2D5B,#8B4D7B);padding:20px 24px 18px;border-radius:14px 14px 0 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <h2 style="margin:0;font-size:1.05rem;font-weight:800;color:#fff;letter-spacing:-0.2px">${title}</h2>
            ${subtitle ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:4px">${subtitle}</div>` : ''}
          </div>
          <button onclick="closeKitModal()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center">&#10005;</button>
        </div>
      </div>
      <div style="padding:20px 24px 24px" id="kit-modal-body">
        ${bodyHTML}
      </div>
      ${footerHTML ? `<div style="padding:0 24px 20px;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap" id="kit-modal-footer">${footerHTML}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeKitModal(); });
  return overlay;
}

// ── Workspace Renderer ────────────────────────────────────────────────────────

function renderSearchKitWorkspace(search, kit) {
  const sj = JSON.stringify(search).replace(/"/g, '&quot;');

  const SECTIONS = [
    { key: 'ideal_candidate_profiles', label: 'Ideal Candidate Profiles', icon: '&#128100;', ai: false, buildFn: 'openICPBuilder' },
    { key: 'boolean_strings',          label: 'Boolean Strings',          icon: '&#128269;', ai: false, buildFn: 'openBooleanBuilder' },
    { key: 'outreach_messages',        label: 'Outreach Messages',        icon: '&#9993;',   ai: false, buildFn: 'openOutreachBuilder' },
    { key: 'screen_question_guides',   label: 'Screen Question Guides',   icon: '&#128172;', ai: true,  buildFn: 'openScreenQBuilder' },
    { key: 'pitchbook_params',         label: 'PitchBook Parameters',     icon: '&#128200;', ai: true,  buildFn: 'openPitchbookBuilder' }
  ];

  let html = '';
  SECTIONS.forEach(sec => {
    const items = kit[sec.key] || [];
    const buildLabel = sec.ai ? '+ Generate with AI' : '+ Build New';
    const itemsHTML = items.length === 0
      ? `<div class="search-kit-empty">No ${sec.label.toLowerCase()} yet. Click "${buildLabel}" to create one.</div>`
      : items.map(item => renderKitItem(sec.key, item, search)).join('');

    html += `
      <div class="search-kit-section">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div class="search-kit-section-header" style="margin-bottom:0;border-bottom:none;flex:1">
            ${sec.icon} ${sec.label} (${items.length})
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-primary btn-sm" onclick="${sec.buildFn}(${sj})">${buildLabel}</button>
            <button class="btn btn-ghost btn-sm" onclick="openImportFromLibrary('${sec.key}', ${sj})">Import from Library</button>
          </div>
        </div>
        <div style="margin-top:12px;padding-bottom:8px;border-bottom:1px solid #F3E8EF">
          ${itemsHTML}
        </div>
      </div>`;
  });

  html += `
    <div style="margin-top:16px;font-size:13px;color:#888">
      <a href="#" onclick="navigateTo('templates');return false;" style="color:#6B2D5B;font-weight:600">&#8594; Open Templates Library</a>
    </div>`;

  return html;
}

function renderKitItem(type, item, search) {
  const name = escapeHtml(item.name || '(Untitled)');
  const date = item.created_at ? `<span style="color:#bbb;font-size:11px;margin-left:8px">${item.created_at}</span>` : '';
  const aiTag = item.ai_generated ? `<span style="background:#F3E8EF;color:#6B2D5B;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px">AI</span>` : '';
  const sj = JSON.stringify(search).replace(/"/g, '&quot;');
  const ij = JSON.stringify(item).replace(/"/g, '&quot;');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5">
      <div>
        <span style="font-weight:600;font-size:13px">${name}</span>${aiTag}${date}
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="viewKitItem('${type}', ${ij}, ${sj})">View</button>
        <button class="btn btn-ghost btn-sm" style="color:#c62828" onclick="confirmDeleteKitEntry('${type}','${item.id}')">Delete</button>
        <button class="btn btn-ghost btn-sm" onclick="saveKitToLibrary('${type}', ${ij}, ${sj})">Save to Library</button>
      </div>
    </div>`;
}

// ── View Kit Item ─────────────────────────────────────────────────────────────

function viewKitItem(type, item, search) {
  let bodyHTML = '';
  let copyText = '';

  if (type === 'ideal_candidate_profiles') {
    const listHtml = (label, items) => items?.length ? `<div style="margin-bottom:12px"><strong>${label}</strong><ul style="margin:4px 0 0 18px;line-height:1.7;font-size:13px">${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>` : '';
    bodyHTML = `
      ${item.archetypes?.length ? `<div style="margin-bottom:10px"><strong>Archetypes:</strong> ${item.archetypes.map(escapeHtml).join(', ')}</div>` : ''}
      ${item.years_experience ? `<div style="margin-bottom:10px"><strong>Experience:</strong> ${item.years_experience.min}-${item.years_experience.max} years</div>` : ''}
      ${item.sector_preferences?.length ? `<div style="margin-bottom:10px"><strong>Sectors:</strong> ${item.sector_preferences.map(escapeHtml).join(', ')}</div>` : ''}
      ${item.target_companies?.length ? `<div style="margin-bottom:10px"><strong>Target Companies:</strong> ${item.target_companies.map(escapeHtml).join(', ')}</div>` : ''}
      ${item.target_pe_firms?.length ? `<div style="margin-bottom:10px"><strong>Target PE Firms:</strong> ${item.target_pe_firms.map(escapeHtml).join(', ')}</div>` : ''}
      ${listHtml('Must-Haves', item.must_haves)}
      ${listHtml('Nice-to-Haves', item.nice_to_haves)}
      ${listHtml('Red Flags', item.red_flags)}`;
    copyText = [
      item.archetypes?.length ? 'Archetypes: ' + item.archetypes.join(', ') : '',
      item.years_experience ? `Experience: ${item.years_experience.min}-${item.years_experience.max} years` : '',
      item.must_haves?.length ? 'Must-Haves:\n' + item.must_haves.map(x => '  - ' + x).join('\n') : '',
      item.nice_to_haves?.length ? 'Nice-to-Haves:\n' + item.nice_to_haves.map(x => '  - ' + x).join('\n') : '',
      item.red_flags?.length ? 'Red Flags:\n' + item.red_flags.map(x => '  - ' + x).join('\n') : ''
    ].filter(Boolean).join('\n\n');

  } else if (type === 'boolean_strings') {
    bodyHTML = `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;line-height:1.6">${escapeHtml(item.query || '')}</pre>`;
    copyText = item.query || '';

  } else if (type === 'outreach_messages') {
    bodyHTML = `
      ${item.channel ? `<div style="margin-bottom:8px"><strong>Channel:</strong> ${escapeHtml(item.channel)}</div>` : ''}
      ${item.subject ? `<div style="margin-bottom:8px"><strong>Subject:</strong> ${escapeHtml(item.subject)}</div>` : ''}
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;background:#f5f5f5;padding:16px;border-radius:8px;line-height:1.6">${escapeHtml(item.body || '')}</pre>`;
    copyText = (item.subject ? 'Subject: ' + item.subject + '\n\n' : '') + (item.body || '');

  } else if (type === 'screen_question_guides') {
    const cats = item.categories || [];
    bodyHTML = cats.map(cat => `
      <div style="margin-bottom:16px">
        <strong style="color:#6B2D5B">${escapeHtml(cat.category)}</strong>
        <ol style="margin:6px 0 0 18px;line-height:1.8;font-size:13px">${cat.questions.map(q => `<li>${escapeHtml(q)}</li>`).join('')}</ol>
      </div>`).join('');
    copyText = cats.map(cat => cat.category + '\n' + cat.questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')).join('\n\n');

  } else if (type === 'pitchbook_params') {
    const field = (label, val) => val ? `<tr><td style="padding:6px 12px 6px 0;color:#666;font-weight:600;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0">${escapeHtml(Array.isArray(val) ? val.join(', ') : String(val))}</td></tr>` : '';
    bodyHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px">
      ${field('Similar PE Firms', item.similar_pe_firms)}
      ${field('Similar Companies', item.similar_companies)}
      ${field('Revenue Range', item.revenue_range ? item.revenue_range.min + ' - ' + item.revenue_range.max : null)}
      ${field('Geographies', item.geographies)}
      ${field('Ownership Types', item.ownership_types)}
      ${field('Industries', item.industries)}
      ${field('Notes', item.notes)}
    </table>`;
    copyText = ['Similar PE Firms: ' + (item.similar_pe_firms||[]).join(', '), 'Similar Companies: ' + (item.similar_companies||[]).join(', ')].join('\n');
  }

  kitModal(escapeHtml(item.name || '(Untitled)'), '', `
    <div style="margin-bottom:12px">
      <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText(${JSON.stringify(copyText).replace(/"/g, '&quot;')}).then(()=>{this.textContent='Copied!';setTimeout(()=>{this.textContent='Copy'},1500)})">Copy</button>
    </div>
    ${bodyHTML}`);
}

// ── Save to Library ───────────────────────────────────────────────────────────

async function saveKitToLibrary(type, item, search) {
  const typeMap = { boolean_strings:'boolean', outreach_messages:'outreach', ideal_candidate_profiles:'profile', screen_question_guides:'screen', pitchbook_params:'pitchbook' };
  const apiType = typeMap[type];
  if (!apiType) return;
  const sector = (search.sectors || []).map(id => SECTOR_NAME_MAP[id] || id)[0] || '';
  const archetype = (search.archetypes_requested || [])[0] || '';
  const payload = Object.assign({}, item, { sector, archetype });
  delete payload.id;
  delete payload.created_at;
  try {
    await api('POST', '/templates/' + apiType, payload);
    appAlert('Saved to Templates Library!', { type: 'success' });
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

// ── Import from Library ───────────────────────────────────────────────────────

async function openImportFromLibrary(type, search) {
  try {
    const data = await api('GET', '/templates');
    const items = data[type] || [];
    if (items.length === 0) {
      appAlert('No items in the Templates Library for this category.', { type: 'warning' });
      return;
    }
    const rows = items.map(tpl => {
      const tj = JSON.stringify(tpl).replace(/"/g, '&quot;');
      return `<tr>
        <td style="font-weight:600;padding:8px 10px;font-size:13px">${escapeHtml(tpl.name || '(Untitled)')}</td>
        <td style="padding:8px 10px;color:#888;font-size:13px">${escapeHtml(tpl.sector || '—')}</td>
        <td style="padding:8px 10px"><button class="btn btn-primary btn-sm" onclick="importLibraryItem('${type}', ${tj})">Import</button></td>
      </tr>`;
    }).join('');

    kitModal('Import from Library', '', `
      <table class="search-kit-table" style="width:100%">
        <thead><tr>
          <th style="text-align:left;font-size:11px;color:#999;padding:4px 10px">Name</th>
          <th style="text-align:left;font-size:11px;color:#999;padding:4px 10px">Sector</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`);
  } catch (err) {
    appAlert('Error loading library: ' + err.message, { type: 'error' });
  }
}

async function importLibraryItem(type, tpl) {
  const entry = Object.assign({}, tpl, {
    id: type.replace(/_/g,'').slice(0,6) + '-' + Date.now(),
    created_at: new Date().toISOString().slice(0,10),
    source: 'library'
  });
  delete entry.sector;
  delete entry.archetype;
  try {
    await saveKitEntry(type, entry);
    closeKitModal();
  } catch (err) {
    appAlert('Error importing: ' + err.message, { type: 'error' });
  }
}

// ── Ideal Candidate Profile Builder ───────────────────────────────────────────

let _icpState = null;
let _icpStep  = 0;

function openICPBuilder(search) {
  _kitSearch = search;
  _icpStep = 0;
  _icpState = {
    name: '',
    archetypes: [...(search.archetypes_requested || [])],
    years_experience: { min: 10, max: 25 },
    sector_preferences: (search.sectors || []).map(id => SECTOR_NAME_MAP[id] || id),
    target_companies: [],
    target_pe_firms: [],
    must_haves: [],
    nice_to_haves: [],
    red_flags: []
  };
  renderICPStep(search);
}

async function handleICPFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const textarea = document.getElementById('icp-jd');
  if (file.name.endsWith('.txt')) {
    textarea.value = await file.text();
  } else {
    try {
      const text = await file.text();
      const cleaned = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, '\n').trim();
      textarea.value = cleaned.length > 50 ? cleaned : '[File uploaded: ' + file.name + ' — could not extract text. Please paste the content manually.]';
    } catch (e) {
      textarea.value = '[Error reading file. Please paste the content manually.]';
    }
  }
}

async function generateICPWithAI() {
  const jd = document.getElementById('icp-jd')?.value?.trim() || '';
  const btn = document.getElementById('icp-ai-btn');
  const status = document.getElementById('icp-ai-status');

  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  if (status) status.innerHTML = '<div style="text-align:center;padding:16px;color:#888"><div class="spinner" style="display:inline-block;margin-bottom:8px"></div><br>AI is analyzing the search context and building a candidate profile...</div>';

  try {
    const resp = await api('POST', '/searches/' + _kitSearch.search_id + '/ai/generate-icp', {
      job_description: jd
    });
    // Merge AI results into state
    if (resp.archetypes?.length) _icpState.archetypes = resp.archetypes;
    if (resp.years_experience) _icpState.years_experience = resp.years_experience;
    if (resp.sector_preferences?.length) _icpState.sector_preferences = resp.sector_preferences;
    if (resp.target_companies?.length) _icpState.target_companies = resp.target_companies;
    if (resp.target_pe_firms?.length) _icpState.target_pe_firms = resp.target_pe_firms;
    if (resp.must_haves?.length) _icpState.must_haves = resp.must_haves;
    if (resp.nice_to_haves?.length) _icpState.nice_to_haves = resp.nice_to_haves;
    if (resp.red_flags?.length) _icpState.red_flags = resp.red_flags;
    // Jump to step 1 so user can review/edit starting from archetypes
    _icpStep = 1;
    renderICPStep(_kitSearch);
  } catch (err) {
    if (status) status.innerHTML = `<div class="error-banner">Error: ${escapeHtml(err.message)}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = 'Retry Generate with AI'; }
  }
}

function renderICPStep(search) {
  const steps = ['Start', 'Archetypes & Experience', 'Sectors & Targets', 'Qualifications', 'Review & Save'];
  const stepDots = steps.map((s, i) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:${i === _icpStep ? 700 : 400};color:${i === _icpStep ? '#6B2D5B' : '#bbb'}"><span style="width:22px;height:22px;border-radius:50%;background:${i <= _icpStep ? '#6B2D5B' : '#e0e0e0'};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${i + 1}</span>${s}</span>`).join('<span style="color:#ddd;margin:0 6px">&#8594;</span>');

  let body = `<div style="margin-bottom:20px;display:flex;align-items:center;flex-wrap:wrap;gap:4px">${stepDots}</div>`;

  if (_icpStep === 0) {
    // Start — choose AI or manual
    const weeklyCount = (search.weekly_updates || []).length;
    body += `
      <div style="background:#faf6f9;border-radius:8px;padding:16px;margin-bottom:20px;font-size:13px;line-height:1.6">
        <strong style="color:#6B2D5B">Build your ideal candidate profile</strong><br>
        You can let AI analyze the job description and meeting notes to pre-fill the profile, then refine each section manually. Or skip straight to building it yourself.
      </div>
      <div class="form-group">
        <label class="form-label">Job Description (optional)</label>
        <div style="font-size:11px;color:#999;margin-bottom:6px">Upload a file or paste the text — AI will use this along with ${weeklyCount} meeting note${weeklyCount !== 1 ? 's' : ''} from this search</div>
        <div style="margin-bottom:8px">
          <input type="file" id="icp-file" accept=".pdf,.doc,.docx,.txt" onchange="handleICPFile(this)" style="font-size:12px">
        </div>
        <textarea class="form-control" id="icp-jd" rows="6" placeholder="Or paste job description text here..."></textarea>
      </div>
      <div id="icp-ai-status"></div>
      <div style="display:flex;gap:12px;margin-top:8px">
        <button class="btn btn-primary" id="icp-ai-btn" onclick="generateICPWithAI()">Generate with AI</button>
        <button class="btn btn-ghost" onclick="_icpStep=1;renderICPStep(_kitSearch)">Skip — Build Manually</button>
      </div>`;
  } else if (_icpStep === 1) {
    // Archetypes & Experience
    const allArchetypes = ['PE Lateral', 'Industry Operator', 'Functional Expert', 'Founder/Entrepreneur', 'Consultant'];
    const archChecks = allArchetypes.map(a => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" ${_icpState.archetypes.includes(a) ? 'checked' : ''} onchange="toggleICPArchetype('${a}', this.checked)"> ${a}</label>`).join('');
    body += `
      <div class="form-group">
        <label class="form-label">Archetypes</label>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:6px">${archChecks}</div>
        <div style="margin-top:8px;display:flex;gap:6px">
          <input class="form-control" id="icp-custom-arch" placeholder="Add custom archetype..." style="flex:1;max-width:250px">
          <button class="btn btn-ghost btn-sm" onclick="addICPCustomArchetype()">Add</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Years of Experience</label>
        <div style="display:flex;gap:12px;align-items:center;margin-top:6px">
          <input type="number" class="form-control" id="icp-yoe-min" value="${_icpState.years_experience.min}" min="0" max="50" style="width:80px" onchange="_icpState.years_experience.min=+this.value">
          <span style="color:#888">to</span>
          <input type="number" class="form-control" id="icp-yoe-max" value="${_icpState.years_experience.max}" min="0" max="50" style="width:80px" onchange="_icpState.years_experience.max=+this.value">
          <span style="font-size:12px;color:#888">years</span>
        </div>
      </div>`;
  } else if (_icpStep === 2) {
    // Sectors & Targets
    const allSectors = Object.values(SECTOR_NAME_MAP);
    const secChecks = allSectors.map(s => `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer"><input type="checkbox" ${_icpState.sector_preferences.includes(s) ? 'checked' : ''} onchange="toggleICPSector('${s}', this.checked)"> ${s}</label>`).join('');

    const coTags = _icpState.target_companies.map((c, i) => `<span class="bool-tag" style="background:#E3F2FD;color:#1565C0">${escapeHtml(c)}<button type="button" onclick="_icpState.target_companies.splice(${i},1);renderICPStep(_kitSearch)">&#10005;</button></span>`).join('');
    const peTags = _icpState.target_pe_firms.map((f, i) => `<span class="bool-tag" style="background:#F3E8EF;color:#6B2D5B">${escapeHtml(f)}<button type="button" onclick="_icpState.target_pe_firms.splice(${i},1);renderICPStep(_kitSearch)">&#10005;</button></span>`).join('');

    body += `
      <div class="form-group">
        <label class="form-label">Industry / Sector Preferences</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">${secChecks}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Target Companies</label>
        <div style="font-size:11px;color:#999;margin-bottom:6px">Companies whose alumni would be good candidate fits</div>
        <div class="bool-tag-input" style="min-height:42px" onclick="document.getElementById('icp-co-input').focus()">
          ${coTags}
          <input class="bool-tag-raw" id="icp-co-input" placeholder="Type company name & press Enter..." onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){_icpState.target_companies.push(v);this.value='';renderICPStep(_kitSearch)}}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Target PE Firms</label>
        <div style="font-size:11px;color:#999;margin-bottom:6px">PE firms with similar strategies or portfolio to the hiring client</div>
        <div class="bool-tag-input" style="min-height:42px" onclick="document.getElementById('icp-pe-input').focus()">
          ${peTags}
          <input class="bool-tag-raw" id="icp-pe-input" placeholder="Type PE firm name & press Enter..." onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){_icpState.target_pe_firms.push(v);this.value='';renderICPStep(_kitSearch)}}">
        </div>
      </div>`;
  } else if (_icpStep === 3) {
    // Qualifications
    const tagSection = (label, hint, key, color) => {
      const tags = (_icpState[key] || []).map((t, i) => `<span class="bool-tag" style="background:${color.bg};color:${color.text}">${escapeHtml(t)}<button type="button" onclick="_icpState.${key}.splice(${i},1);renderICPStep(_kitSearch)">&#10005;</button></span>`).join('');
      return `
        <div class="form-group">
          <label class="form-label">${label}</label>
          <div style="font-size:11px;color:#999;margin-bottom:6px">${hint}</div>
          <div class="bool-tag-input" style="min-height:42px" onclick="document.getElementById('icp-${key}-input').focus()">
            ${tags}
            <input class="bool-tag-raw" id="icp-${key}-input" placeholder="Type & press Enter..." onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){_icpState.${key}.push(v);this.value='';renderICPStep(_kitSearch)}}">
          </div>
        </div>`;
    };
    body += tagSection('Must-Haves', 'Non-negotiable qualifications', 'must_haves', { bg:'#E8F5E9', text:'#2E7D32' });
    body += tagSection('Nice-to-Haves', 'Preferred but not required', 'nice_to_haves', { bg:'#E3F2FD', text:'#1565C0' });
    body += tagSection('Red Flags', 'Disqualifying or concerning traits', 'red_flags', { bg:'#FFEBEE', text:'#B71C1C' });
  } else if (_icpStep === 4) {
    // Review & Save
    const listPreview = (label, arr) => arr?.length ? `<div style="margin-bottom:10px"><strong>${label}:</strong> ${arr.map(escapeHtml).join(', ')}</div>` : '';
    body += `
      <div class="form-group">
        <label class="form-label">Profile Name</label>
        <input class="form-control" id="icp-name" value="${escapeHtml(_icpState.name || (_icpState.archetypes[0] || 'Profile') + ' — ' + (_kitSearch.role_title || 'Role'))}" placeholder="Name this profile...">
      </div>
      <div style="background:#faf6f9;border-radius:8px;padding:16px;font-size:13px;line-height:1.7">
        <strong style="color:#6B2D5B">Summary</strong>
        ${listPreview('Archetypes', _icpState.archetypes)}
        ${_icpState.years_experience ? `<div style="margin-bottom:10px"><strong>Experience:</strong> ${_icpState.years_experience.min}-${_icpState.years_experience.max} years</div>` : ''}
        ${listPreview('Sectors', _icpState.sector_preferences)}
        ${listPreview('Target Companies', _icpState.target_companies)}
        ${listPreview('Target PE Firms', _icpState.target_pe_firms)}
        ${listPreview('Must-Haves', _icpState.must_haves)}
        ${listPreview('Nice-to-Haves', _icpState.nice_to_haves)}
        ${listPreview('Red Flags', _icpState.red_flags)}
      </div>`;
  }

  const backBtn = _icpStep > 0 ? `<button class="btn btn-ghost" onclick="_icpStep--;renderICPStep(_kitSearch)">&#8592; Back</button>` : '';
  const nextBtn = _icpStep < 4
    ? `<button class="btn btn-primary" onclick="_icpStep++;renderICPStep(_kitSearch)">Next &#8594;</button>`
    : `<button class="btn btn-primary" onclick="saveICPProfile()">Save Profile</button>`;

  kitModal('&#128100; Ideal Candidate Profile', `${escapeHtml(_kitSearch.client_name)} — ${escapeHtml(_kitSearch.role_title || '')}`,
    body,
    `<span style="flex:1"></span>${backBtn}${nextBtn}`,
    { maxWidth: '760px' });
}

function toggleICPArchetype(a, checked) {
  if (checked && !_icpState.archetypes.includes(a)) _icpState.archetypes.push(a);
  if (!checked) _icpState.archetypes = _icpState.archetypes.filter(x => x !== a);
}
function addICPCustomArchetype() {
  const inp = document.getElementById('icp-custom-arch');
  const val = inp?.value?.trim();
  if (val && !_icpState.archetypes.includes(val)) {
    _icpState.archetypes.push(val);
    inp.value = '';
    renderICPStep(_kitSearch);
  }
}
function toggleICPSector(s, checked) {
  if (checked && !_icpState.sector_preferences.includes(s)) _icpState.sector_preferences.push(s);
  if (!checked) _icpState.sector_preferences = _icpState.sector_preferences.filter(x => x !== s);
}

async function saveICPProfile() {
  const name = document.getElementById('icp-name')?.value?.trim();
  if (!name) { appAlert('Please enter a profile name.', { type: 'warning' }); return; }
  const entry = Object.assign({}, _icpState, {
    id: 'icp-' + Date.now(),
    name,
    created_at: new Date().toISOString().slice(0, 10)
  });
  try {
    await saveKitEntry('ideal_candidate_profiles', entry);
    closeKitModal();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
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

  if (set.size === 1) {
    const words = roleTitle.split(' ');
    const fn = words.slice(-1)[0];
    ['VP', 'SVP', 'EVP'].forEach(pre => set.add(`${pre} ${fn}`));
  }

  return [...set].slice(0, 8);
}

function openBooleanBuilder(search) {
  _kitSearch = search;
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
      <div style="background:linear-gradient(135deg,#6B2D5B,#8B4D7B);padding:20px 24px 18px;border-radius:14px 14px 0 0">
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
      <div style="font-size:12px;color:#888;margin-bottom:16px;padding:10px 14px;background:#faf6f9;border-radius:7px;border:1px solid #F3E8EF">
        Click &#10005; on a tag to remove it &nbsp;&middot;&nbsp; Type + <kbd style="font-size:11px;background:#fff;padding:1px 5px;border-radius:3px;border:1px solid #ddd">Enter</kbd> to add your own
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
        <button class="btn btn-primary" onclick="saveBooleanToSearch()">Save to Search Kit</button>
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
  }).catch(() => appAlert('Copy failed — please copy manually.', { type: 'error' }));
}

async function saveBooleanToSearch() {
  const query = document.getElementById('bool-preview')?.textContent || '';
  if (!query || query.startsWith('(add tags')) {
    appAlert('Please add some tags before saving.', { type: 'warning' });
    return;
  }
  const entry = {
    id: 'bool-' + Date.now(),
    name: `${_kitSearch.role_title || 'Role'} — Boolean String`,
    query,
    tags: JSON.parse(JSON.stringify(_boolState)),
    created_at: new Date().toISOString().slice(0, 10),
    source: 'builder'
  };
  try {
    await saveKitEntry('boolean_strings', entry);
    document.getElementById('bool-builder-modal')?.remove();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

// ── Outreach Message Builder ──────────────────────────────────────────────────

function openOutreachBuilder(search) {
  _kitSearch = search;
  const body = `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-control" id="om-name" placeholder="e.g., Initial LinkedIn InMail" value="${escapeHtml(search.role_title || '')} — Outreach">
    </div>
    <div class="form-group">
      <label class="form-label">Channel</label>
      <select class="form-control" id="om-channel" onchange="toggleOutreachSubject()">
        <option value="LinkedIn">LinkedIn</option>
        <option value="Email">Email</option>
        <option value="Phone Script">Phone Script</option>
      </select>
    </div>
    <div class="form-group" id="om-subject-group">
      <label class="form-label">Subject Line</label>
      <input class="form-control" id="om-subject" placeholder="Subject...">
    </div>
    <div class="form-group">
      <label class="form-label">Message Body</label>
      <div style="font-size:11px;color:#999;margin-bottom:6px">Use {firstName} for candidate name, {role} for role title, {firm} for client name</div>
      <textarea class="form-control" id="om-body" rows="10" placeholder="Write your outreach message...">{firstName},\n\nHope all is well. I wanted to reach out regarding an interesting opportunity. Lancor Partners is working on a ${escapeHtml(search.role_title || 'senior leadership')} search for ${escapeHtml(search.client_name || 'our client')}. I would love to share more details and get your thoughts.\n\nWould you have 15 minutes for a quick call this week?\n\nBest regards</textarea>
    </div>`;

  kitModal('&#9993; Outreach Message', `${escapeHtml(search.client_name)} — ${escapeHtml(search.role_title || '')}`,
    body,
    `<button class="btn btn-ghost" onclick="closeKitModal()">Cancel</button><button class="btn btn-primary" onclick="saveOutreachMessage()">Save Message</button>`);
}

function toggleOutreachSubject() {
  const channel = document.getElementById('om-channel')?.value;
  const group = document.getElementById('om-subject-group');
  if (group) group.style.display = channel === 'Phone Script' ? 'none' : '';
}

async function saveOutreachMessage() {
  const name = document.getElementById('om-name')?.value?.trim();
  const channel = document.getElementById('om-channel')?.value;
  const subject = document.getElementById('om-subject')?.value?.trim();
  const body = document.getElementById('om-body')?.value?.trim();
  if (!name || !body) { appAlert('Please fill in the name and message body.', { type: 'warning' }); return; }

  const entry = {
    id: 'outreach-' + Date.now(),
    name,
    channel,
    subject: channel === 'Phone Script' ? '' : subject,
    body,
    created_at: new Date().toISOString().slice(0, 10),
    source: 'builder'
  };
  try {
    await saveKitEntry('outreach_messages', entry);
    closeKitModal();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

// ── Screen Question Guide Builder (AI) ────────────────────────────────────────

let _screenQCategories = null;

function openScreenQBuilder(search) {
  _kitSearch = search;
  _screenQCategories = null;
  const profiles = (search.search_kit?.ideal_candidate_profiles || []);
  const profileOpts = profiles.length === 0
    ? '<option value="">No profiles yet — build one first</option>'
    : profiles.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');

  const body = `
    <div class="form-group">
      <label class="form-label">Job Description</label>
      <div style="font-size:11px;color:#999;margin-bottom:6px">Upload a file or paste the job description text</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <input type="file" id="sq-file" accept=".pdf,.doc,.docx,.txt" onchange="handleScreenQFile(this)" style="font-size:12px">
      </div>
      <textarea class="form-control" id="sq-jd" rows="6" placeholder="Or paste job description text here..."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Reference Candidate Profile</label>
      <select class="form-control" id="sq-profile">${profileOpts}</select>
    </div>
    <div id="sq-results"></div>`;

  kitModal('&#128172; Screen Question Guide', `${escapeHtml(search.client_name)} — ${escapeHtml(search.role_title || '')}`,
    body,
    `<button class="btn btn-ghost" onclick="closeKitModal()">Cancel</button>
     <button class="btn btn-primary" id="sq-gen-btn" onclick="generateScreenQuestions()">Generate with AI</button>`,
    { maxWidth: '800px' });
}

async function handleScreenQFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const textarea = document.getElementById('sq-jd');
  if (file.name.endsWith('.txt')) {
    textarea.value = await file.text();
  } else {
    // For PDF/Word, read as text (basic extraction)
    try {
      const text = await file.text();
      // Strip obvious binary/markup if it looks like it has some readable text
      const cleaned = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, '\n').trim();
      if (cleaned.length > 50) {
        textarea.value = cleaned;
      } else {
        textarea.value = '[File uploaded: ' + file.name + ' — could not extract text. Please paste the content manually.]';
      }
    } catch (e) {
      textarea.value = '[Error reading file. Please paste the content manually.]';
    }
  }
}

async function generateScreenQuestions() {
  const jd = document.getElementById('sq-jd')?.value?.trim() || '';
  const profileId = document.getElementById('sq-profile')?.value || '';
  const btn = document.getElementById('sq-gen-btn');
  const results = document.getElementById('sq-results');

  btn.disabled = true;
  btn.textContent = 'Generating...';
  results.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="display:inline-block;margin-bottom:8px"></div><br>AI is generating screening questions...</div>';

  try {
    const resp = await api('POST', '/searches/' + _kitSearch.search_id + '/ai/generate-screen-questions', {
      job_description: jd,
      profile_id: profileId
    });
    _screenQCategories = resp.categories || [];
    renderScreenQResults();
  } catch (err) {
    results.innerHTML = `<div class="error-banner">Error: ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Regenerate';
  }
}

function renderScreenQResults() {
  const results = document.getElementById('sq-results');
  if (!results || !_screenQCategories) return;

  let html = '<div style="margin-top:16px">';
  _screenQCategories.forEach((cat, ci) => {
    html += `
      <div style="margin-bottom:16px;background:#faf6f9;border-radius:8px;padding:14px 16px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <input class="form-control" value="${escapeHtml(cat.category)}" style="font-weight:700;color:#6B2D5B;border:none;background:transparent;padding:0;font-size:14px" onchange="_screenQCategories[${ci}].category=this.value">
          <button class="btn btn-ghost btn-sm" style="color:#c62828" onclick="_screenQCategories.splice(${ci},1);renderScreenQResults()">Remove Category</button>
        </div>
        <ol style="margin:0 0 0 16px;list-style:decimal">`;
    cat.questions.forEach((q, qi) => {
      html += `
          <li style="margin-bottom:6px;display:flex;align-items:flex-start;gap:6px">
            <textarea class="form-control" rows="2" style="flex:1;font-size:13px;min-height:36px" onchange="_screenQCategories[${ci}].questions[${qi}]=this.value">${escapeHtml(q)}</textarea>
            <button class="btn btn-ghost btn-sm" style="color:#c62828;padding:4px" onclick="_screenQCategories[${ci}].questions.splice(${qi},1);renderScreenQResults()">&#10005;</button>
          </li>`;
    });
    html += `
          <li style="list-style:none;margin-left:-16px;margin-top:4px">
            <button class="btn btn-ghost btn-sm" onclick="_screenQCategories[${ci}].questions.push('');renderScreenQResults()">+ Add Question</button>
          </li>
        </ol>
      </div>`;
  });
  html += `
    <button class="btn btn-ghost btn-sm" onclick="_screenQCategories.push({category:'New Category',questions:['']});renderScreenQResults()">+ Add Category</button>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
      <input class="form-control" id="sq-name" placeholder="Guide name..." value="${escapeHtml(_kitSearch.role_title || 'Role')} — Screen Guide" style="max-width:300px">
      <button class="btn btn-primary" onclick="saveScreenQGuide()">Save Guide</button>
    </div>
  </div>`;
  results.innerHTML = html;
}

async function saveScreenQGuide() {
  const name = document.getElementById('sq-name')?.value?.trim();
  if (!name) { appAlert('Please enter a guide name.', { type: 'warning' }); return; }
  if (!_screenQCategories?.length) { appAlert('No questions to save.', { type: 'warning' }); return; }
  // Clean empty questions
  const categories = _screenQCategories.map(c => ({
    category: c.category,
    questions: c.questions.filter(q => q.trim())
  })).filter(c => c.questions.length > 0);

  const entry = {
    id: 'screen-' + Date.now(),
    name,
    categories,
    created_at: new Date().toISOString().slice(0, 10),
    ai_generated: true
  };
  try {
    await saveKitEntry('screen_question_guides', entry);
    closeKitModal();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}

// ── PitchBook Parameters Builder (AI) ─────────────────────────────────────────

let _pbState = null;

function openPitchbookBuilder(search) {
  _kitSearch = search;
  _pbState = null;

  const body = `
    <div style="background:#faf6f9;border-radius:8px;padding:14px 16px;margin-bottom:16px;font-size:13px;line-height:1.6">
      <strong style="color:#6B2D5B">How this works:</strong> AI will analyze <strong>${escapeHtml(search.client_name)}</strong>'s profile and suggest similar PE firms, portfolio companies, and search parameters for PitchBook sourcing.
    </div>
    <div id="pb-results">
      <div style="text-align:center;padding:30px">
        <button class="btn btn-primary" id="pb-gen-btn" onclick="generatePitchbookParams()">Generate Suggestions with AI</button>
      </div>
    </div>`;

  kitModal('&#128200; PitchBook Parameters', `${escapeHtml(search.client_name)} — ${escapeHtml(search.role_title || '')}`,
    body, '', { maxWidth: '800px' });
}

async function generatePitchbookParams() {
  const btn = document.getElementById('pb-gen-btn');
  const results = document.getElementById('pb-results');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  results.innerHTML = '<div style="text-align:center;padding:20px;color:#888"><div class="spinner" style="display:inline-block;margin-bottom:8px"></div><br>AI is analyzing and generating parameters...</div>';

  try {
    const resp = await api('POST', '/searches/' + _kitSearch.search_id + '/ai/generate-pitchbook-params', {});
    _pbState = resp;
    renderPitchbookResults();
  } catch (err) {
    results.innerHTML = `<div class="error-banner">Error: ${escapeHtml(err.message)}</div><div style="text-align:center;margin-top:12px"><button class="btn btn-primary" id="pb-gen-btn" onclick="generatePitchbookParams()">Retry</button></div>`;
  }
}

function renderPitchbookResults() {
  const results = document.getElementById('pb-results');
  if (!results || !_pbState) return;

  const tagInput = (id, arr, color) => {
    const tags = arr.map((t, i) => `<span class="bool-tag" style="background:${color.bg};color:${color.text}">${escapeHtml(t)}<button type="button" onclick="removePBTag('${id}',${i})">&#10005;</button></span>`).join('');
    return `<div class="bool-tag-input" style="min-height:42px" onclick="document.getElementById('pb-${id}-input').focus()">
      ${tags}
      <input class="bool-tag-raw" id="pb-${id}-input" placeholder="Type & press Enter..." onkeydown="if(event.key==='Enter'){event.preventDefault();const v=this.value.trim();if(v){addPBTag('${id}',v);this.value='';}}">
    </div>`;
  };

  let html = `
    <div class="form-group">
      <label class="form-label">Similar PE Firms</label>
      <div style="font-size:11px;color:#999;margin-bottom:6px">PE firms with similar strategies to ${escapeHtml(_kitSearch.client_name)}</div>
      ${tagInput('pe', _pbState.similar_pe_firms || [], { bg:'#F3E8EF', text:'#6B2D5B' })}
    </div>
    <div class="form-group">
      <label class="form-label">Similar Companies</label>
      <div style="font-size:11px;color:#999;margin-bottom:6px">Companies where operating talent could be a good fit</div>
      ${tagInput('co', _pbState.similar_companies || [], { bg:'#E3F2FD', text:'#1565C0' })}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="form-group">
        <label class="form-label">Revenue Range</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="form-control" id="pb-rev-min" value="${escapeHtml(_pbState.revenue_range?.min || '$50M')}" style="width:100px">
          <span>to</span>
          <input class="form-control" id="pb-rev-max" value="${escapeHtml(_pbState.revenue_range?.max || '$500M')}" style="width:100px">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Ownership Types</label>
        ${tagInput('own', _pbState.ownership_types || [], { bg:'#FFF3E0', text:'#E65100' })}
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Geographies</label>
      ${tagInput('geo', _pbState.geographies || [], { bg:'#E8F5E9', text:'#2E7D32' })}
    </div>
    <div class="form-group">
      <label class="form-label">Industries</label>
      ${tagInput('ind', _pbState.industries || [], { bg:'#FFF8E1', text:'#F57F17' })}
    </div>
    <div class="form-group">
      <label class="form-label">AI Rationale</label>
      <textarea class="form-control" id="pb-notes" rows="3">${escapeHtml(_pbState.notes || '')}</textarea>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <input class="form-control" id="pb-name" placeholder="Name..." value="${escapeHtml(_kitSearch.role_title || 'Role')} — PitchBook Params" style="max-width:300px">
      <button class="btn btn-primary" onclick="savePitchbookParams()">Save Parameters</button>
    </div>`;
  results.innerHTML = html;
}

function addPBTag(field, val) {
  const map = { pe: 'similar_pe_firms', co: 'similar_companies', own: 'ownership_types', geo: 'geographies', ind: 'industries' };
  const key = map[field];
  if (key && _pbState[key]) { _pbState[key].push(val); renderPitchbookResults(); }
}
function removePBTag(field, idx) {
  const map = { pe: 'similar_pe_firms', co: 'similar_companies', own: 'ownership_types', geo: 'geographies', ind: 'industries' };
  const key = map[field];
  if (key && _pbState[key]) { _pbState[key].splice(idx, 1); renderPitchbookResults(); }
}

async function savePitchbookParams() {
  const name = document.getElementById('pb-name')?.value?.trim();
  if (!name) { appAlert('Please enter a name.', { type: 'warning' }); return; }
  const entry = {
    id: 'pb-' + Date.now(),
    name,
    similar_pe_firms: _pbState.similar_pe_firms || [],
    similar_companies: _pbState.similar_companies || [],
    revenue_range: {
      min: document.getElementById('pb-rev-min')?.value || '',
      max: document.getElementById('pb-rev-max')?.value || ''
    },
    geographies: _pbState.geographies || [],
    ownership_types: _pbState.ownership_types || [],
    industries: _pbState.industries || [],
    notes: document.getElementById('pb-notes')?.value || '',
    created_at: new Date().toISOString().slice(0, 10),
    ai_generated: true
  };
  try {
    await saveKitEntry('pitchbook_params', entry);
    closeKitModal();
  } catch (err) {
    appAlert('Error saving: ' + err.message, { type: 'error' });
  }
}
