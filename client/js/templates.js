/* ── Lancor Search OS — templates.js ─────────────────────────────────────────
   Search Templates Module — Session 6
   Full CRUD: Boolean Strings, PitchBook Parameters, Outreach Messages,
              Ideal Candidate Profiles, Screen Question Guides
   ──────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let templateSubTab = 'boolean'; // 'boolean' | 'pitchbook' | 'outreach' | 'profile' | 'screen'
let allTemplatesData = null;    // cached from last fetch
let allSearchesForIdeas = null; // cached searches data for the ideas panel

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
    '<span style="background:#F3E8EF;color:#6B2D5B;font-weight:600;border-radius:3px;padding:0 3px">{{$1}}</span>');
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
    const [tplRes, srchRes] = await Promise.all([
      api('GET', '/templates'),
      api('GET', '/searches')
    ]);
    allTemplatesData = tplRes;
    allSearchesForIdeas = srchRes.searches || [];
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
      style="padding:8px 16px;border:none;background:${templateSubTab === key ? '#6B2D5B' : '#f5f5f5'};
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

      <!-- New Search Ideas panel -->
      ${renderNewSearchIdeasPanel(templateSubTab, allSearchesForIdeas || [])}
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
        <a href="#" style="color:#6B2D5B;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('boolean-detail-${i}');return false">${escTpl(t.name)}</a>
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
        <a href="#" style="color:#6B2D5B;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('pb-detail-${i}');return false">${escTpl(t.name)}</a>
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
            ${t.ownership_types && (Array.isArray(t.ownership_types) ? t.ownership_types.length : t.ownership_types) ? `<div><strong>Ownership Types:</strong> ${escTpl(Array.isArray(t.ownership_types) ? t.ownership_types.join(', ') : t.ownership_types)}</div>` : ''}
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
        <a href="#" style="color:#6B2D5B;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('out-detail-${i}');return false">${escTpl(t.name)}</a>
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
          ${t.subject ? `<div style="font-size:12px;font-weight:700;color:#6B2D5B;margin-bottom:6px">Subject: ${escTpl(t.subject)}</div>` : ''}
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
        <a href="#" style="color:#6B2D5B;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('prof-detail-${i}');return false">${escTpl(t.name)}</a>
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
        <a href="#" style="color:#6B2D5B;font-weight:600;text-decoration:none" onclick="toggleTemplateDetail('scr-detail-${i}');return false">${escTpl(t.name)}</a>
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

// ── New Search Ideas Panel ────────────────────────────────────────────────────

function buildNewSearchIdeas(tab, searches) {
  const ideas = [];

  // Aggregate pipeline activity across all searches
  const sectorData = {};   // sector -> { qualifying, total, clients, archetypes }
  const archetypeData = {}; // archetype -> { qualifying, total, sectors }

  (searches || []).forEach(s => {
    const client = s.client_name || 'Unknown';
    (s.sectors || []).forEach(rawSec => {
      const sec = rawSec.charAt(0).toUpperCase() + rawSec.slice(1);
      if (!sectorData[sec]) sectorData[sec] = { qualifying: 0, total: 0, clients: [], archetypes: [] };
      sectorData[sec].total++;
      if (!sectorData[sec].clients.includes(client)) sectorData[sec].clients.push(client);
    });

    (s.pipeline || []).forEach(c => {
      const arch = c.archetype || 'PE Lateral';
      const ok = ['Qualifying', 'Scheduling'].includes(c.stage);
      if (!archetypeData[arch]) archetypeData[arch] = { qualifying: 0, total: 0, sectors: [] };
      archetypeData[arch].total++;
      if (ok) archetypeData[arch].qualifying++;

      (s.sectors || []).forEach(rawSec => {
        const sec = rawSec.charAt(0).toUpperCase() + rawSec.slice(1);
        if (!sectorData[sec]) sectorData[sec] = { qualifying: 0, total: 0, clients: [], archetypes: [] };
        if (ok) sectorData[sec].qualifying++;
        if (!sectorData[sec].archetypes.includes(arch)) sectorData[sec].archetypes.push(arch);
        if (!archetypeData[arch].sectors.includes(sec)) archetypeData[arch].sectors.push(sec);
      });
    });
  });

  const topSectors = Object.entries(sectorData)
    .sort((a, b) => (b[1].qualifying * 3 + b[1].total) - (a[1].qualifying * 3 + a[1].total));
  const topArchetypes = Object.entries(archetypeData)
    .sort((a, b) => (b[1].qualifying * 3 + b[1].total) - (a[1].qualifying * 3 + a[1].total));

  const existingBoolean  = (allTemplatesData?.templates?.boolean_strings || []).map(t => `${(t.sector||'').toLowerCase()}|${(t.archetype||'').toLowerCase()}`);
  const existingPB       = (allTemplatesData?.templates?.pitchbook_params || []).map(t => (t.sector||'').toLowerCase());
  const existingOutreach = (allTemplatesData?.templates?.outreach_messages || []).map(t => (t.archetype||'').toLowerCase());
  const existingProfile  = (allTemplatesData?.templates?.ideal_candidate_profiles || []).map(t => `${(t.sector||'').toLowerCase()}|${(t.archetype||'').toLowerCase()}`);
  const existingScreen   = (allTemplatesData?.templates?.screen_question_guides || []).map(t => (t.archetype||'').toLowerCase());

  // ── Boolean tab ideas ──
  if (tab === 'boolean') {
    topSectors.slice(0, 4).forEach(([sec, d]) => {
      const archs = d.archetypes.length > 0 ? d.archetypes : ['PE Lateral'];
      archs.slice(0, 2).forEach(arch => {
        const key = `${sec.toLowerCase()}|${arch.toLowerCase()}`;
        if (!existingBoolean.includes(key) && ideas.length < 4) {
          const why = d.qualifying > 0
            ? `${d.qualifying} qualifying candidate${d.qualifying > 1 ? 's' : ''} found in ${sec} pipeline — proven demand`
            : `Active ${sec} search open — build the boolean string now to accelerate sourcing`;
          ideas.push({ title: `${sec} ${arch} — LinkedIn Boolean`, reason: why, action: '+ Add Boolean String', onclick: `openTemplateModal('boolean', null)` });
        }
      });
    });
    if (topSectors.length >= 2 && ideas.length < 5) {
      ideas.push({ title: 'Cross-Sector Operating Partner — LinkedIn Boolean', reason: `${topSectors.length} sectors active in pipeline — a cross-sector boolean surfaces candidates who fit multiple mandates`, action: '+ Add Boolean String', onclick: `openTemplateModal('boolean', null)` });
    }
    if (ideas.length === 0) {
      ideas.push({ title: 'Industrials Operating Partner — LinkedIn Boolean', reason: 'Operating Partner roles at PE-backed industrials companies are a core Lancor mandate — build a reusable boolean string', action: '+ Add Boolean String', onclick: `openTemplateModal('boolean', null)` });
      ideas.push({ title: 'Business Services PE Lateral — LinkedIn Boolean', reason: 'Business Services is a high-volume PE sector — a targeted boolean string speeds future sourcing', action: '+ Add Boolean String', onclick: `openTemplateModal('boolean', null)` });
    }
  }

  // ── PitchBook tab ideas ──
  if (tab === 'pitchbook') {
    topSectors.slice(0, 4).forEach(([sec, d]) => {
      if (!existingPB.includes(sec.toLowerCase()) && ideas.length < 4) {
        const why = d.qualifying > 0
          ? `${d.qualifying} qualifying candidate${d.qualifying > 1 ? 's' : ''} from ${sec} — build a PitchBook pull to find executives at similar portfolio companies`
          : `Active ${sec} search — a PitchBook parameters template will accelerate future mandates in this sector`;
        ideas.push({ title: `${sec} — PE-Backed Exit Pull`, reason: why, action: '+ Add PitchBook Parameters', onclick: `openTemplateModal('pitchbook', null)` });
      }
    });
    if (ideas.length < 5) {
      ideas.push({ title: 'Recent Deal Exits (2020–Present) — All Sectors', reason: 'Executives exiting PE-backed deals in the last 5 years are prime Operating Partner candidates — a broad exit pull builds prospective pipeline', action: '+ Add PitchBook Parameters', onclick: `openTemplateModal('pitchbook', null)` });
    }
    if (ideas.length === 0) {
      ideas.push({ title: 'Industrials — PE-Backed Exit Pull', reason: 'Industrials is a core Lancor sector — save a standard PitchBook parameter set for fast reuse', action: '+ Add PitchBook Parameters', onclick: `openTemplateModal('pitchbook', null)` });
    }
  }

  // ── Outreach tab ideas ──
  if (tab === 'outreach') {
    topArchetypes.slice(0, 3).forEach(([arch, d]) => {
      if (!existingOutreach.includes(arch.toLowerCase()) && ideas.length < 3) {
        const why = d.qualifying > 0
          ? `${arch} archetype has ${d.qualifying} qualifying candidate${d.qualifying > 1 ? 's' : ''} — lock in what's working as a reusable template`
          : `${arch} is an active archetype in current pipeline — standardize the first-touch message now`;
        ideas.push({ title: `${arch} — InMail Template`, reason: why, action: '+ Add Outreach Message', onclick: `openTemplateModal('outreach', null)` });
      }
    });
    if (!existingOutreach.includes('pe lateral') && ideas.length < 5) {
      ideas.push({ title: 'PE Lateral — InMail Template', reason: 'PE Laterals are the most common archetype across Lancor mandates — a crisp, reusable InMail will cut sourcing time', action: '+ Add Outreach Message', onclick: `openTemplateModal('outreach', null)` });
    }
    ideas.push({ title: 'Follow-Up InMail — No Response (7 Days)', reason: 'Pipeline candidates sitting in "Outreach Sent" need a standard follow-up cadence — a template reduces candidate drop-off', action: '+ Add Outreach Message', onclick: `openTemplateModal('outreach', null)` });
  }

  // ── Profile tab ideas ──
  if (tab === 'profile') {
    topSectors.slice(0, 3).forEach(([sec, d]) => {
      const archs = d.archetypes.length > 0 ? d.archetypes : ['PE Lateral'];
      archs.slice(0, 2).forEach(arch => {
        const key = `${sec.toLowerCase()}|${arch.toLowerCase()}`;
        if (!existingProfile.includes(key) && ideas.length < 4) {
          const why = d.qualifying > 0
            ? `${d.qualifying} qualifying ${sec} candidate${d.qualifying > 1 ? 's' : ''} found — document the winning profile before the next search starts`
            : `Active ${sec} search — an ICP sharpens screening and aligns the client faster`;
          ideas.push({ title: `${sec} ${arch} — Ideal Candidate Profile`, reason: why, action: '+ Add Profile', onclick: `openTemplateModal('profile', null)` });
        }
      });
    });
    if (ideas.length === 0) {
      ideas.push({ title: 'Industrials Operating Partner — ICP', reason: 'Document must-haves, nice-to-haves, and red flags from your current Berkshire search to reuse on the next mandate', action: '+ Add Profile', onclick: `openTemplateModal('profile', null)` });
      ideas.push({ title: 'PE Lateral — ICP', reason: 'A general PE Lateral profile accelerates alignment with new PE clients and cuts first-round screening time', action: '+ Add Profile', onclick: `openTemplateModal('profile', null)` });
    }
  }

  // ── Screen tab ideas ──
  if (tab === 'screen') {
    topArchetypes.filter(([, d]) => d.qualifying > 0 || d.total > 0).slice(0, 3).forEach(([arch, d]) => {
      if (!existingScreen.includes(arch.toLowerCase()) && ideas.length < 3) {
        const why = d.qualifying > 0
          ? `${d.qualifying} qualifying ${arch} candidate${d.qualifying > 1 ? 's' : ''} in pipeline — standardize the screen before the next one comes through`
          : `${arch} is active in current pipeline — a question guide ensures consistent, comparable evaluations`;
        ideas.push({ title: `${arch} — Screen Question Guide`, reason: why, action: '+ Add Question Guide', onclick: `openTemplateModal('screen', null)` });
      }
    });
    if (!existingScreen.includes('pe lateral') && ideas.length < 5) {
      ideas.push({ title: 'PE Lateral — Screen Question Guide', reason: 'PE Laterals are the highest-volume archetype — a reusable screen guide reduces recruiter ramp time on new searches', action: '+ Add Question Guide', onclick: `openTemplateModal('screen', null)` });
    }
    if (!existingScreen.includes('industry operator') && ideas.length < 5) {
      ideas.push({ title: 'Industry Operator — Screen Question Guide', reason: 'Industry Operators are consistently in demand across PE mandates — document the key evaluation criteria now', action: '+ Add Question Guide', onclick: `openTemplateModal('screen', null)` });
    }
  }

  return ideas.slice(0, 5);
}

function renderNewSearchIdeasPanel(tab, searches) {
  const ideas = buildNewSearchIdeas(tab, searches);
  if (ideas.length === 0) return '';

  const cards = ideas.map(idea => `
    <div style="background:#faf7ff;border:1px solid #d8c8f5;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:200px;max-width:280px;flex:1">
      <div style="font-size:13px;font-weight:700;color:#1a1a1a;line-height:1.3">${escTpl(idea.title)}</div>
      <div style="font-size:11px;color:#666;line-height:1.5;flex:1">${escTpl(idea.reason)}</div>
      <button class="btn btn-ghost btn-sm" style="margin-top:6px;font-size:11px;align-self:flex-start;color:#6B2D5B;border-color:#c8a8f0" onclick="${idea.onclick}">${escTpl(idea.action)}</button>
    </div>`).join('');

  return `
    <div style="margin-top:36px;padding-top:24px;border-top:2px solid #e0e0e0">
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px">
        <h3 style="font-size:14px;font-weight:700;color:#6B2D5B;margin:0">&#128161; New Search Ideas</h3>
        <span style="font-size:12px;color:#999">Based on your current pipeline and search activity</span>
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        ${cards}
      </div>
    </div>`;
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
        <h3 style="font-size:16px;font-weight:700;color:#6B2D5B">${title}</h3>
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

  const PULL_TYPES = [
    { value: '',                     label: '-- Select Pull Type --' },
    { value: 'active-portfolio',     label: 'Active Portfolio' },
    { value: 'exits',                label: 'Exits' },
    { value: 'transactions',         label: 'Transactions' },
    { value: 'public-company-leaders', label: 'Public Company Leaders' },
    { value: 'private-non-pe',       label: 'Private (Non-PE)' }
  ];
  const pullOptions = PULL_TYPES.map(({ value, label }) =>
    `<option value="${value}" ${value === (t.pull_type || '') ? 'selected' : ''}>${label}</option>`
  ).join('');

  const GEOGRAPHIES = ['', 'North America', 'United States', 'Europe', 'EMEA', 'Asia-Pacific', 'Global'];
  const geoOptions = GEOGRAPHIES.map(g =>
    `<option value="${g}" ${g === (t.geography || '') ? 'selected' : ''}>${g || '-- Select Geography --'}</option>`
  ).join('');

  const DEAL_SIZES = ['', '$10M EBITDA', '$25M EBITDA', '$50M EBITDA', '$100M EBITDA', '$250M EBITDA', '$500M+ EBITDA'];
  const dealOptions = DEAL_SIZES.map(d =>
    `<option value="${d}" ${d === (t.deal_size_min || '') ? 'selected' : ''}>${d || '-- No Minimum --'}</option>`
  ).join('');

  const REVENUE_RANGES = ['', '< $50M', '$50M – $250M', '$250M – $1B', '$1B – $5B', '$5B+'];
  const revenueOptions = REVENUE_RANGES.map(r =>
    `<option value="${r}" ${r === (t.revenue_range || '') ? 'selected' : ''}>${r || '-- Any Revenue --'}</option>`
  ).join('');

  // Parse existing date_range "YYYY–YYYY" or "YYYY-YYYY"
  const dateMatch = (t.date_range || '').match(/(\d{4})\s*[–\-]\s*(\d{4})/);
  const savedFrom = dateMatch ? dateMatch[1] : '';
  const savedTo   = dateMatch ? dateMatch[2] : '';
  const currentYear = new Date().getFullYear();
  const years = [''];
  for (let y = 2010; y <= currentYear + 1; y++) years.push(String(y));
  const fromOptions = years.map(y => `<option value="${y}" ${y === savedFrom ? 'selected' : ''}>${y || 'From Year'}</option>`).join('');
  const toOptions   = years.map(y => `<option value="${y}" ${y === savedTo   ? 'selected' : ''}>${y || 'To Year'}</option>`).join('');

  const OWNERSHIP_OPTS = [
    'Buyout', 'Growth Equity', 'Venture', 'Secondary',
    'Debt / Mezzanine', 'Public Company', 'Founder / Family-Owned', 'Corporate Carve-Out'
  ];
  const ownershipSelected = Array.isArray(t.ownership_types)
    ? t.ownership_types
    : (t.ownership_types ? t.ownership_types.split(/,\s*/) : []);
  const ownershipCheckboxes = OWNERSHIP_OPTS.map(opt => `
    <label style="display:inline-flex;align-items:center;gap:5px;margin:4px 12px 4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" name="tf-ownership-cb" value="${opt}" ${ownershipSelected.includes(opt) ? 'checked' : ''}>
      ${escTpl(opt)}
    </label>`).join('');

  return `
    ${formGroup('Template Name', `<input class="form-control" id="tf-name" value="${escTpl(t.name || '')}" placeholder="e.g. Industrials PE Mid-Market Exits">`, true)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Sector', `<select class="form-control" id="tf-sector">${sectorOptions(t.sector)}</select>`)}
      ${formGroup('Pull Type', `<select class="form-control" id="tf-pull-type">${pullOptions}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Geography', `<select class="form-control" id="tf-geography">${geoOptions}</select>`)}
      ${formGroup('Deal Size Min', `<select class="form-control" id="tf-deal-size">${dealOptions}</select>`)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${formGroup('Revenue Range', `<select class="form-control" id="tf-revenue">${revenueOptions}</select>`)}
      <div class="form-group">
        <label class="form-label">Date Range</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <select class="form-control" id="tf-date-from">${fromOptions}</select>
          <select class="form-control" id="tf-date-to">${toOptions}</select>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Ownership Types</label>
      <div style="border:1px solid #ddd;border-radius:4px;padding:10px 14px">
        ${ownershipCheckboxes}
      </div>
    </div>
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

    case 'pitchbook': {
      payload.sector        = (document.getElementById('tf-sector')    || {}).value || '';
      payload.pull_type     = (document.getElementById('tf-pull-type') || {}).value || '';
      payload.geography     = (document.getElementById('tf-geography') || {}).value || '';
      payload.deal_size_min = (document.getElementById('tf-deal-size') || {}).value || '';
      payload.revenue_range = (document.getElementById('tf-revenue')   || {}).value || '';
      const dateFrom = (document.getElementById('tf-date-from') || {}).value || '';
      const dateTo   = (document.getElementById('tf-date-to')   || {}).value || '';
      payload.date_range = (dateFrom && dateTo) ? `${dateFrom}–${dateTo}` : (dateFrom || dateTo || '');
      payload.ownership_types = Array.from(document.querySelectorAll('input[name="tf-ownership-cb"]:checked')).map(cb => cb.value);
      payload.notes = (document.getElementById('tf-notes') || {}).value || '';
      break;
    }

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
