/* ── Lancor Search OS — templates.js ─────────────────────────────────────────
   Search Templates Module — Session 6
   Full CRUD: Boolean Strings, PitchBook Parameters, Outreach Messages,
              Ideal Candidate Profiles, Screen Question Guides
   ──────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let templateSubTab = 'boolean'; // 'boolean' | 'pitchbook' | 'outreach' | 'profile' | 'screen'
let allTemplatesData = null;    // cached from last fetch

// ── Escape helper ─────────────────────────────────────────────────────────────

function escTpl(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Highlight {{placeholders}} in purple ─────────────────────────────────────

function highlightPlaceholders(text) {
  if (!text) return '';
  return escTpl(text).replace(/\{\{([^}]+)\}\}/g,
    '<span style="background:#EDE7F6;color:#5C2D91;font-weight:600;border-radius:3px;padding:0 3px">{{$1}}</span>');
}

// ── Sector + Archetype options ────────────────────────────────────────────────

const TPL_SECTORS = [
  'Industrials', 'Healthcare', 'Business Services', 'Consumer',
  'Technology', 'Financial Services', 'Energy', 'Real Estate',
  'Media & Communications', 'Infrastructure', 'Education', 'Government / Defense'
];

const TPL_ARCHETYPES = [
  'PE Lateral', 'Operating Partner', 'CFO', 'CEO', 'COO',
  'VP Operations', 'Plant Manager', 'Functional Lead', 'Board Member', 'Other'
];

function sectorOptions(selected) {
  return ['', ...TPL_SECTORS].map(s =>
    `<option value="${escTpl(s)}" ${s === selected ? 'selected' : ''}>${s || '-- Select Sector --'}</option>`
  ).join('');
}

function archetypeOptions(selected) {
  return ['', ...TPL_ARCHETYPES].map(a =>
    `<option value="${escTpl(a)}" ${a === selected ? 'selected' : ''}>${a || '-- Select Archetype --'}</option>`
  ).join('');
}

// ── Sub-tab config ────────────────────────────────────────────────────────────

const TAB_CONFIG = {
  boolean:   { label: 'Boolean Strings',           key: 'boolean_strings',           apiType: 'boolean',   singular: 'Boolean String' },
  pitchbook: { label: 'PitchBook Parameters',       key: 'pitchbook_params',           apiType: 'pitchbook', singular: 'PitchBook Parameters' },
  outreach:  { label: 'Outreach Messages',          key: 'outreach_messages',          apiType: 'outreach',  singular: 'Outreach Message' },
  profile:   { label: 'Ideal Candidate Profiles',   key: 'ideal_candidate_profiles',   apiType: 'profile',   singular: 'Candidate Profile' },
  screen:    { label: 'Screen Question Guides',     key: 'screen_question_guides',     apiType: 'screen',    singular: 'Question Guide' }
};

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderTemplates() {
  const content = document.getElementById('app-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div> Loading templates...</div>';

  try {
    allTemplatesData = await api('GET', '/templates');
    renderTemplatesPage(content);
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load templates: ${escTpl(err.message)}</div>`;
  }
}

function renderTemplatesPage(container) {
  if (!container) container = document.getElementById('app-content');

  // Count all templates
  let totalCount = 0;
  if (allTemplatesData && allTemplatesData.templates) {
    Object.values(allTemplatesData.templates).forEach(arr => {
      if (Array.isArray(arr)) totalCount += arr.length;
    });
  }

  const cfg = TAB_CONFIG[templateSubTab];
  const templates = (allTemplatesData && allTemplatesData.templates && allTemplatesData.templates[cfg.key]) || [];

  // Build sub-tab nav
  const tabNav = Object.entries(TAB_CONFIG).map(([key, c]) => {
    const count = (allTemplatesData && allTemplatesData.templates && allTemplatesData.templates[c.key] || []).length;
    return `<button class="subtab-btn${templateSubTab === key ? ' active' : ''}"
      onclick="switchTemplateTab('${key}')"
      style="padding:8px 16px;border:none;background:${templateSubTab === key ? '#5C2D91' : '#f5f5f5'};
             color:${templateSubTab === key ? 'white' : '#444'};border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">
      ${c.label} <span style="opacity:0.7;font-weight:400">(${count})</span>
    </button>`;
  }).join('');

  container.innerHTML = `
    <div style="max-width:1100px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div>
          <h2 style="font-size:20px;font-weight:700;margin-bottom:4px">Search Templates</h2>
          <p style="font-size:13px;color:#888">${totalCount} template${totalCount !== 1 ? 's' : ''} saved</p>
        </div>
      </div>

      <!-- Sub-tab nav -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e0e0e0">
        ${tabNav}
      </div>

      <!-- Template list -->
      <div id="template-list-container">
        ${renderTemplateList(templateSubTab, templates)}
      </div>
    </div>
  `;
}

function switchTemplateTab(tab) {
  templateSubTab = tab;
  const cfg = TAB_CONFIG[tab];
  const templates = (allTemplatesData && allTemplatesData.templates && allTemplatesData.templates[cfg.key]) || [];

  // Re-render sub-tab buttons
  renderTemplatesPage();
}

function renderTemplateList(tab, templates) {
  const cfg = TAB_CONFIG[tab];

  if (templates.length === 0) {
    return `
      <div class="empty-state" style="text-align:center;padding:48px;color:#aaa">
        <div style="font-size:36px">&#128203;</div>
        <h3 style="margin:12px 0 6px;color:#888">No ${cfg.label} templates yet</h3>
        <p style="font-size:13px">Click &ldquo;+ Add ${cfg.singular}&rdquo; to create your first template.</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="openTemplateModal('${tab}', null)">+ Add ${cfg.singular}</button>
      </div>`;
  }

  let tableHTML = '';
  switch (tab) {
    case 'boolean':   tableHTML = renderBooleanTable(templates); break;
    case 'pitchbook': tableHTML = renderPitchbookTable(templates); break;
    case 'outreach':  tableHTML = renderOutreachTable(templates); break;
    case 'profile':   tableHTML = renderProfileTable(templates); break;
    case 'screen':    tableHTML = renderScreenTable(templates); break;
  }

  return `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn btn-primary" onclick="openTemplateModal('${tab}', null)">+ Add ${cfg.singular}</button>
    </div>
    ${tableHTML}
  `;
}

// ── Boolean Strings table ─────────────────────────────────────────────────────

function renderBooleanTable(templates) {
  const rows = templates.map((t, i) => `
    <tr>
      <td>
        <a href="#" style="color:#5C2D91;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('boolean-detail-${i}');return false">${escTpl(t.name)}</a>
      </td>
      <td>${escTpl(t.sector || '')}</td>
      <td>${escTpl(t.archetype || '')}</td>
      <td style="color:#888;font-size:12px">${t.last_used ? formatDate(t.last_used) : '&mdash;'}</td>
      <td>
        <div class="template-actions">
          <button class="btn btn-ghost btn-sm" onclick="copyToClipboard(${JSON.stringify(t.boolean_string || '')}, this)">Copy</button>
          <button class="btn btn-secondary btn-sm" onclick="openTemplateModal('boolean', '${t.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate('boolean', '${t.id}')">Dupe</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef5350" onclick="deleteTemplate('boolean', '${t.id}')">Delete</button>
        </div>
      </td>
    </tr>
    <tr id="boolean-detail-${i}" style="display:none">
      <td colspan="5">
        <div class="template-detail">
          ${t.notes ? `<p style="font-size:12px;color:#666;margin-bottom:8px">${escTpl(t.notes)}</p>` : ''}
          <pre>${escTpl(t.boolean_string || '')}</pre>
          <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="copyToClipboard(${JSON.stringify(t.boolean_string || '')}, this)">Copy String</button>
        </div>
      </td>
    </tr>`).join('');

  return `
    <table class="templates-table">
      <thead><tr>
        <th>Name</th><th>Sector</th><th>Archetype</th><th>Last Used</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── PitchBook Parameters table ────────────────────────────────────────────────

function renderPitchbookTable(templates) {
  const rows = templates.map((t, i) => `
    <tr>
      <td>
        <a href="#" style="color:#5C2D91;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('pb-detail-${i}');return false">${escTpl(t.name)}</a>
      </td>
      <td>${escTpl(t.sector || '')}</td>
      <td>${escTpl(t.pull_type || '')}</td>
      <td>
        <div class="template-actions">
          <button class="btn btn-secondary btn-sm" onclick="openTemplateModal('pitchbook', '${t.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate('pitchbook', '${t.id}')">Dupe</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef5350" onclick="deleteTemplate('pitchbook', '${t.id}')">Delete</button>
        </div>
      </td>
    </tr>
    <tr id="pb-detail-${i}" style="display:none">
      <td colspan="4">
        <div class="template-detail">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
            ${t.geography ? `<div><strong>Geography:</strong> ${escTpl(t.geography)}</div>` : ''}
            ${t.deal_size_min ? `<div><strong>Deal Size Min:</strong> ${escTpl(t.deal_size_min)}</div>` : ''}
            ${t.revenue_range ? `<div><strong>Revenue Range:</strong> ${escTpl(t.revenue_range)}</div>` : ''}
            ${t.date_range ? `<div><strong>Date Range:</strong> ${escTpl(t.date_range)}</div>` : ''}
            ${t.ownership_types ? `<div><strong>Ownership Types:</strong> ${escTpl(t.ownership_types)}</div>` : ''}
          </div>
          ${t.notes ? `<p style="font-size:12px;color:#666;margin-top:10px">${escTpl(t.notes)}</p>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `
    <table class="templates-table">
      <thead><tr>
        <th>Name</th><th>Sector</th><th>Pull Type</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Outreach Messages table ───────────────────────────────────────────────────

function renderOutreachTable(templates) {
  const rows = templates.map((t, i) => `
    <tr>
      <td>
        <a href="#" style="color:#5C2D91;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('out-detail-${i}');return false">${escTpl(t.name)}</a>
      </td>
      <td>${escTpl(t.archetype || '')}</td>
      <td>${escTpl(t.channel || '')}</td>
      <td>
        <div class="template-actions">
          <button class="btn btn-ghost btn-sm" onclick="copyToClipboard(${JSON.stringify(t.body || '')}, this)">Copy</button>
          <button class="btn btn-secondary btn-sm" onclick="openTemplateModal('outreach', '${t.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate('outreach', '${t.id}')">Dupe</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef5350" onclick="deleteTemplate('outreach', '${t.id}')">Delete</button>
        </div>
      </td>
    </tr>
    <tr id="out-detail-${i}" style="display:none">
      <td colspan="4">
        <div class="template-detail">
          ${t.subject ? `<div style="font-size:12px;font-weight:700;color:#5C2D91;margin-bottom:6px">Subject: ${escTpl(t.subject)}</div>` : ''}
          <div class="template-body-preview">${highlightPlaceholders(t.body || '')}</div>
          ${t.notes ? `<p style="font-size:12px;color:#666;margin-top:10px">${escTpl(t.notes)}</p>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `
    <table class="templates-table">
      <thead><tr>
        <th>Name</th><th>Archetype</th><th>Channel</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Ideal Candidate Profiles table ───────────────────────────────────────────

function renderProfileTable(templates) {
  const rows = templates.map((t, i) => `
    <tr>
      <td>
        <a href="#" style="color:#5C2D91;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('prof-detail-${i}');return false">${escTpl(t.name)}</a>
      </td>
      <td>${escTpl(t.sector || '')}</td>
      <td>${escTpl(t.archetype || '')}</td>
      <td>
        <div class="template-actions">
          <button class="btn btn-secondary btn-sm" onclick="openTemplateModal('profile', '${t.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate('profile', '${t.id}')">Dupe</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef5350" onclick="deleteTemplate('profile', '${t.id}')">Delete</button>
        </div>
      </td>
    </tr>
    <tr id="prof-detail-${i}" style="display:none">
      <td colspan="4">
        <div class="template-detail">
          ${renderBulletSection('Must-Haves', t.must_haves || [], false)}
          ${renderBulletSection('Nice-to-Haves', t.nice_to_haves || [], false)}
          ${renderBulletSection('Red Flags', t.red_flags || [], true)}
          ${t.notes ? `<p style="font-size:12px;color:#666;margin-top:10px">${escTpl(t.notes)}</p>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `
    <table class="templates-table">
      <thead><tr>
        <th>Name</th><th>Sector</th><th>Archetype</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderBulletSection(title, items, isRedFlag) {
  if (!items || items.length === 0) return '';
  const cls = isRedFlag ? 'bullet-list red-flag-list' : 'bullet-list';
  return `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">${title}</div>
      <ul class="${cls}">${items.map(item => `<li>${escTpl(item)}</li>`).join('')}</ul>
    </div>`;
}

// ── Screen Question Guides table ──────────────────────────────────────────────

function renderScreenTable(templates) {
  const rows = templates.map((t, i) => `
    <tr>
      <td>
        <a href="#" style="color:#5C2D91;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('scr-detail-${i}');return false">${escTpl(t.name)}</a>
      </td>
      <td>${escTpl(t.archetype || '')}</td>
      <td>${(t.questions || []).length} question${(t.questions || []).length !== 1 ? 's' : ''}</td>
      <td>
        <div class="template-actions">
          <button class="btn btn-secondary btn-sm" onclick="openTemplateModal('screen', '${t.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="duplicateTemplate('screen', '${t.id}')">Dupe</button>
          <button class="btn btn-ghost btn-sm" style="color:#ef5350" onclick="deleteTemplate('screen', '${t.id}')">Delete</button>
        </div>
      </td>
    </tr>
    <tr id="scr-detail-${i}" style="display:none">
      <td colspan="4">
        <div class="template-detail">
          <ol style="padding-left:20px">
            ${(t.questions || []).map(q => `<li style="padding:4px 0;font-size:13px">${escTpl(q)}</li>`).join('')}
          </ol>
          ${t.notes ? `<p style="font-size:12px;color:#666;margin-top:10px">${escTpl(t.notes)}</p>` : ''}
        </div>
      </td>
    </tr>`).join('');

  return `
    <table class="templates-table">
      <thead><tr>
        <th>Name</th><th>Archetype</th><th>Questions</th><th>Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Toggle detail row ─────────────────────────────────────────────────────────

function toggleTemplateDetail(id) {
  const row = document.getElementById(id);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? '' : 'none';
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

function copyToClipboard(text, btn) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  }).catch(err => {
    alert('Copy failed: ' + err.message);
  });
}

// ── Delete template ───────────────────────────────────────────────────────────

async function deleteTemplate(tabType, id) {
  if (!confirm('Delete this template? This cannot be undone.')) return;
  try {
    await api('DELETE', '/templates/' + tabType + '/' + id);
    allTemplatesData = await api('GET', '/templates');
    renderTemplatesPage();
  } catch (err) {
    alert('Error deleting template: ' + err.message);
  }
}

// ── Duplicate template ────────────────────────────────────────────────────────

async function duplicateTemplate(tabType, id) {
  const cfg = TAB_CONFIG[tabType];
  if (!cfg || !allTemplatesData) return;
  const list = allTemplatesData.templates[cfg.key] || [];
  const original = list.find(t => t.id === id);
  if (!original) return;

  const copy = Object.assign({}, original);
  delete copy.id;
  delete copy.created_date;
  copy.name = (copy.name || '') + ' (Copy)';

  try {
    await api('POST', '/templates/' + tabType, copy);
    allTemplatesData = await api('GET', '/templates');
    renderTemplatesPage();
  } catch (err) {
    alert('Error duplicating template: ' + err.message);
  }
}

// ── Modal: open ───────────────────────────────────────────────────────────────

function openTemplateModal(tabType, id) {
  const cfg = TAB_CONFIG[tabType];
  const list = (allTemplatesData && allTemplatesData.templates && allTemplatesData.templates[cfg.key]) || [];
  const existing = id ? list.find(t => t.id === id) : null;

  const title = existing ? `Edit ${cfg.singular}` : `Add ${cfg.singular}`;

  // Remove existing modal if any
  const existingOverlay = document.getElementById('template-modal-overlay');
  if (existingOverlay) existingOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = 'template-modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';

  overlay.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:640px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2)">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #eee;position:sticky;top:0;background:white;z-index:1">
        <h3 style="font-size:16px;font-weight:700;color:#5C2D91">${title}</h3>
        <button onclick="closeTemplateModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;line-height:1">&times;</button>
      </div>
      <div style="padding:24px" id="template-modal-body">
        ${renderTemplateForm(tabType, existing)}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #eee;display:flex;justify-content:flex-end;gap:8px;position:sticky;bottom:0;background:white">
        <button class="btn btn-ghost" onclick="closeTemplateModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTemplate('${tabType}', ${id ? "'" + id + "'" : 'null'})">
          ${existing ? 'Save Changes' : 'Create Template'}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeTemplateModal();
  });
}

function closeTemplateModal() {
  const overlay = document.getElementById('template-modal-overlay');
  if (overlay) overlay.remove();
}

// ── Template forms ────────────────────────────────────────────────────────────

function renderTemplateForm(tabType, t) {
  switch (tabType) {
    case 'boolean':   return renderBooleanForm(t);
    case 'pitchbook': return renderPitchbookForm(t);
    case 'outreach':  return renderOutreachForm(t);
    case 'profile':   return renderProfileForm(t);
    case 'screen':    return renderScreenForm(t);
    default: return '<p>Unknown template type.</p>';
  }
}

function formGroup(label, inputHTML, required) {
  return `
    <div class="form-group">
      <label class="form-label">${label}${required ? ' <span style="color:red">*</span>' : ''}</label>
      ${inputHTML}
    </div>`;
}

// Boolean String form
function renderBooleanForm(t) {
  t = t || {};
  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Industrial Ops PE Lateral">`, true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Sector', `<select class="form-control" id="tf-sector">${sectorOptions(t.sector)}</select>`)}
      ${formGroup('Archetype', `<select class="form-control" id="tf-archetype">${archetypeOptions(t.archetype)}</select>`)}
    </div>
    ${formGroup('Boolean String', `<textarea class="form-control" id="tf-boolean" rows="8" style="font-family:monospace;font-size:12px" placeholder='("VP Operations" OR "Director of Operations") AND ("private equity" OR "PE-backed")'>${escTpl(t.boolean_string || '')}</textarea>`, true)}
    ${formGroup('Notes', `<textarea class="form-control" id="tf-notes" rows="2" placeholder="Optional notes...">${escTpl(t.notes || '')}</textarea>`)}
  `;
}

// PitchBook Parameters form
function renderPitchbookForm(t) {
  t = t || {};
  const pullTypes = ['', 'active-portfolio', 'exits', 'transactions'];
  const pullOptions = pullTypes.map(v => `<option value="${v}" ${v === (t.pull_type || '') ? 'selected' : ''}>${v || '-- Select Pull Type --'}</option>`).join('');
  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Industrial PE Mid-Market">`, true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Sector', `<select class="form-control" id="tf-sector">${sectorOptions(t.sector)}</select>`)}
      ${formGroup('Pull Type', `<select class="form-control" id="tf-pull-type">${pullOptions}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Geography', `<input class="form-control" id="tf-geography" value="${escTpl(t.geography || '')}" placeholder="e.g. North America">`)}
      ${formGroup('Deal Size Min', `<input class="form-control" id="tf-deal-size" value="${escTpl(t.deal_size_min || '')}" placeholder="e.g. $50M EBITDA">`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Revenue Range', `<input class="form-control" id="tf-revenue" value="${escTpl(t.revenue_range || '')}" placeholder="e.g. $100M-$500M">`)}
      ${formGroup('Date Range', `<input class="form-control" id="tf-date-range" value="${escTpl(t.date_range || '')}" placeholder="e.g. 2018-2024">`)}
    </div>
    ${formGroup('Ownership Types', `<input class="form-control" id="tf-ownership" value="${escTpl(t.ownership_types || '')}" placeholder="e.g. Buyout, Growth">`)}
    ${formGroup('Notes', `<textarea class="form-control" id="tf-notes" rows="2" placeholder="Optional notes...">${escTpl(t.notes || '')}</textarea>`)}
  `;
}

// Outreach Message form
function renderOutreachForm(t) {
  t = t || {};
  const channels = ['', 'LinkedIn', 'Email', 'Phone'];
  const channelOptions = channels.map(v => `<option value="${v}" ${v === (t.channel || '') ? 'selected' : ''}>${v || '-- Select Channel --'}</option>`).join('');
  const showSubject = (t.channel === 'Email') ? '' : 'display:none';
  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Cold LinkedIn — Industrials VP Ops">`, true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Archetype', `<select class="form-control" id="tf-archetype">${archetypeOptions(t.archetype)}</select>`)}
      ${formGroup('Channel', `<select class="form-control" id="tf-channel" onchange="toggleEmailSubject(this.value)">${channelOptions}</select>`)}
    </div>
    <div id="tf-subject-group" style="${showSubject}">
      ${formGroup('Subject Line', `<input class="form-control" id="tf-subject" value="${escTpl(t.subject || '')}" placeholder="Subject: {{role}} opportunity at {{firm}}">`)}
    </div>
    ${formGroup('Message Body', `<textarea class="form-control" id="tf-body" rows="10" placeholder="Hi {{name}},&#10;&#10;I wanted to reach out about a {{role}} opportunity...">${escTpl(t.body || '')}</textarea>`, true)}
    <p style="font-size:11px;color:#888;margin-top:-8px;margin-bottom:12px">Use &#123;&#123;name&#125;&#125; &#123;&#123;role&#125;&#125; &#123;&#123;firm&#125;&#125; as dynamic placeholders.</p>
    ${formGroup('Notes', `<textarea class="form-control" id="tf-notes" rows="2" placeholder="Optional notes...">${escTpl(t.notes || '')}</textarea>`)}
  `;
}

function toggleEmailSubject(channel) {
  const group = document.getElementById('tf-subject-group');
  if (group) group.style.display = channel === 'Email' ? '' : 'none';
}

// Ideal Candidate Profile form
function renderProfileForm(t) {
  t = t || {};
  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Industrial Operating Partner">`, true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Sector', `<select class="form-control" id="tf-sector">${sectorOptions(t.sector)}</select>`)}
      ${formGroup('Archetype', `<select class="form-control" id="tf-archetype">${archetypeOptions(t.archetype)}</select>`)}
    </div>
    ${formGroup('Must-Haves', renderDynamicList('must-haves', t.must_haves || []))}
    ${formGroup('Nice-to-Haves', renderDynamicList('nice-to-haves', t.nice_to_haves || []))}
    ${formGroup('Red Flags', renderDynamicList('red-flags', t.red_flags || []))}
    ${formGroup('Notes', `<textarea class="form-control" id="tf-notes" rows="2" placeholder="Optional notes...">${escTpl(t.notes || '')}</textarea>`)}
  `;
}

// Screen Question Guide form
function renderScreenForm(t) {
  t = t || {};
  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Ops Leader — 45-min Screen">`, true)}
    ${formGroup('Archetype', `<select class="form-control" id="tf-archetype">${archetypeOptions(t.archetype)}</select>`)}
    <div>
      <label class="form-label">Questions <span style="font-weight:400;color:#888">(listed in order)</span></label>
      ${renderDynamicList('questions', t.questions || [])}
    </div>
    ${formGroup('Notes', `<textarea class="form-control" id="tf-notes" rows="2" placeholder="Optional notes...">${escTpl(t.notes || '')}</textarea>`)}
  `;
}

// ── Dynamic list component ────────────────────────────────────────────────────

function renderDynamicList(listId, items) {
  const itemsHTML = items.map((item, i) => `
    <div class="dynamic-list-item" id="${listId}-item-${i}">
      <input type="text" value="${escTpl(item)}" placeholder="Add item...">
      <button type="button" onclick="removeDynamicItem('${listId}', ${i})" title="Remove">&times;</button>
    </div>`).join('');

  return `
    <div id="${listId}-container">
      ${itemsHTML}
      <div style="display:flex;gap:8px;margin-top:6px">
        <input type="text" class="form-control" id="${listId}-new-input" placeholder="New item..." style="font-size:13px" onkeydown="if(event.key==='Enter'){event.preventDefault();addDynamicItem('${listId}')}">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addDynamicItem('${listId}')">Add</button>
      </div>
    </div>`;
}

function addDynamicItem(listId) {
  const input = document.getElementById(listId + '-new-input');
  if (!input || !input.value.trim()) return;
  const value = input.value.trim();

  const container = document.getElementById(listId + '-container');
  if (!container) return;

  // Count current items
  const items = container.querySelectorAll('.dynamic-list-item');
  const nextIndex = items.length;

  const newItem = document.createElement('div');
  newItem.className = 'dynamic-list-item';
  newItem.id = `${listId}-item-${nextIndex}`;
  newItem.innerHTML = `
    <input type="text" value="${escTpl(value)}" placeholder="Add item...">
    <button type="button" onclick="removeDynamicItem('${listId}', ${nextIndex})" title="Remove">&times;</button>
  `;

  // Insert before the add row (last child)
  container.insertBefore(newItem, container.lastElementChild);
  input.value = '';
  input.focus();
}

function removeDynamicItem(listId, index) {
  const item = document.getElementById(`${listId}-item-${index}`);
  if (item) item.remove();
}

function collectDynamicList(listId) {
  const container = document.getElementById(listId + '-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.dynamic-list-item input'))
    .map(inp => inp.value.trim())
    .filter(Boolean);
}

// ── Save template ─────────────────────────────────────────────────────────────

async function saveTemplate(tabType, id) {
  const name = (document.getElementById('tf-name') || {}).value || '';
  if (!name.trim()) { alert('Template name is required.'); return; }

  let payload = { name: name.trim() };

  // Collect fields per type
  switch (tabType) {
    case 'boolean':
      payload.sector = (document.getElementById('tf-sector') || {}).value || '';
      payload.archetype = (document.getElementById('tf-archetype') || {}).value || '';
      payload.boolean_string = (document.getElementById('tf-boolean') || {}).value || '';
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      if (!payload.boolean_string.trim()) { alert('Boolean string is required.'); return; }
      break;

    case 'pitchbook':
      payload.sector = (document.getElementById('tf-sector') || {}).value || '';
      payload.pull_type = (document.getElementById('tf-pull-type') || {}).value || '';
      payload.geography = (document.getElementById('tf-geography') || {}).value || '';
      payload.deal_size_min = (document.getElementById('tf-deal-size') || {}).value || '';
      payload.revenue_range = (document.getElementById('tf-revenue') || {}).value || '';
      payload.date_range = (document.getElementById('tf-date-range') || {}).value || '';
      payload.ownership_types = (document.getElementById('tf-ownership') || {}).value || '';
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      break;

    case 'outreach':
      payload.archetype = (document.getElementById('tf-archetype') || {}).value || '';
      payload.channel = (document.getElementById('tf-channel') || {}).value || '';
      payload.subject = (document.getElementById('tf-subject') || {}).value || '';
      payload.body = (document.getElementById('tf-body') || {}).value || '';
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      if (!payload.body.trim()) { alert('Message body is required.'); return; }
      break;

    case 'profile':
      payload.sector = (document.getElementById('tf-sector') || {}).value || '';
      payload.archetype = (document.getElementById('tf-archetype') || {}).value || '';
      payload.must_haves = collectDynamicList('must-haves');
      payload.nice_to_haves = collectDynamicList('nice-to-haves');
      payload.red_flags = collectDynamicList('red-flags');
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      break;

    case 'screen':
      payload.archetype = (document.getElementById('tf-archetype') || {}).value || '';
      payload.questions = collectDynamicList('questions');
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      break;
  }

  try {
    if (id && id !== 'null') {
      await api('PUT', '/templates/' + tabType + '/' + id, payload);
    } else {
      await api('POST', '/templates/' + tabType, payload);
    }
    closeTemplateModal();
    allTemplatesData = await api('GET', '/templates');
    renderTemplatesPage();
  } catch (err) {
    alert('Error saving template: ' + err.message);
  }
}
