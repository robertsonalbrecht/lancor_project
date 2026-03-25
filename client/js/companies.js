/* ── Lancor Search OS — companies.js ─────────────────────────────────────── */
/* Company Pool: central database of PE firms, private companies, public cos  */

'use strict';

// ── Module state ──────────────────────────────────────────────────────────────

let cpFilters = {
  type: 'all',
  size_tier: 'all',
  sector: 'all',
  industry: 'all',
  enrichment: 'all',
  text: ''
};
let cpSortField = 'name';
let cpSortAsc = true;
let cpAllCompanies = [];

// ── Sector definitions (shared with pool.js context) ─────────────────────────

const CP_SECTORS = [
  { id: 'industrials',           label: 'Industrials' },
  { id: 'technology-software',   label: 'Technology / Software' },
  { id: 'tech-enabled-services', label: 'Tech-Enabled Services' },
  { id: 'healthcare',            label: 'Healthcare' },
  { id: 'financial-services',    label: 'Financial Services' },
  { id: 'consumer',              label: 'Consumer' },
  { id: 'business-services',     label: 'Business Services' },
  { id: 'infrastructure-energy', label: 'Infrastructure / Energy' },
  { id: 'life-sciences',         label: 'Life Sciences' },
  { id: 'media-entertainment',   label: 'Media / Entertainment' },
  { id: 'real-estate-proptech',  label: 'Real Estate / PropTech' },
  { id: 'agriculture-fb',        label: 'Agriculture / F&B' }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function cpEscape(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function companyTypePill(type) {
  const map = {
    'PE Firm':              { bg: '#EDE7F6', color: '#5C2D91' },
    'Private Company':      { bg: '#e3f2fd', color: '#1565c0' },
    'Public Company':       { bg: '#e8f5e9', color: '#2e7d32' },
    'Portfolio Company':    { bg: '#fff3e0', color: '#e65100' },
    'Consulting Firm':      { bg: '#fce4ec', color: '#880e4f' },
    'Investment Bank':      { bg: '#f3e5f5', color: '#6a1b9a' },
    'Accounting Firm':      { bg: '#efebe9', color: '#4e342e' },
    'Law Firm':             { bg: '#e0f2f1', color: '#00695c' },
    'Government / Military':{ bg: '#eceff1', color: '#37474f' },
    'Nonprofit / Education':{ bg: '#fff8e1', color: '#f57f17' }
  };
  const c = map[type] || { bg: '#f5f5f5', color: '#555' };
  return `<span style="background:${c.bg};color:${c.color};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">${cpEscape(type) || 'Unclassified'}</span>`;
}

function sizeTierPillCP(tier) {
  const map = {
    'Mega':               { bg: '#f3e5f5', color: '#6a1b9a' },
    'Large':              { bg: '#ede7f6', color: '#7b1fa2' },
    'Middle Market':      { bg: '#e8eaf6', color: '#283593' },
    'Lower Middle Market':{ bg: '#e3f2fd', color: '#1565c0' }
  };
  const c = map[tier] || { bg: '#f5f5f5', color: '#888' };
  return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600">${cpEscape(tier) || '—'}</span>`;
}

function cpSectorTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return '<span style="color:#ccc">—</span>';
  const abbrs = { 'industrials':'Ind.','technology-software':'Tech','tech-enabled-services':'TES','healthcare':'HC','financial-services':'Fin.','consumer':'Con.','business-services':'BizSvc','infrastructure-energy':'Infra','life-sciences':'LS','media-entertainment':'Media','real-estate-proptech':'RE','agriculture-fb':'Ag/FB' };
  return tags.slice(0, 4).map(t =>
    `<span style="background:#f5f5f5;color:#555;padding:2px 6px;border-radius:4px;font-size:10px;margin-right:3px">${abbrs[t] || t}</span>`
  ).join('') + (tags.length > 4 ? `<span style="color:#aaa;font-size:10px">+${tags.length-4}</span>` : '');
}

function formatCPDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Filters & Sort ────────────────────────────────────────────────────────────

function applyCompanyFilters(companies) {
  return companies.filter(c => {
    // Type filter: "Unclassified" matches null/undefined types
    if (cpFilters.type !== 'all') {
      if (cpFilters.type === 'Unclassified') {
        if (c.company_type) return false;
      } else if (c.company_type !== cpFilters.type) return false;
    }
    if (cpFilters.size_tier !== 'all') {
      if (cpFilters.size_tier.startsWith('rev:')) {
        // Revenue tier filter
        if (c.revenue_tier !== cpFilters.size_tier.slice(4)) return false;
      } else {
        // PE firm size tier filter
        if (c.size_tier !== cpFilters.size_tier) return false;
      }
    }
    if (cpFilters.sector !== 'all') {
      if (!Array.isArray(c.sector_focus_tags) || !c.sector_focus_tags.includes(cpFilters.sector)) return false;
    }
    if (cpFilters.industry !== 'all') {
      if ((c.industry || '') !== cpFilters.industry) return false;
    }
    if (cpFilters.enrichment !== 'all') {
      if ((c.enrichment_status || 'none') !== cpFilters.enrichment) return false;
    }
    if (cpFilters.text) {
      const q = cpFilters.text.toLowerCase();
      const hay = [c.name, c.hq, c.description, c.industry, ...(c.aliases || [])].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sortCompanies(companies) {
  const field = cpSortField;
  return [...companies].sort((a, b) => {
    let va = a[field] || '';
    let vb = b[field] || '';
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return cpSortAsc ? -1 : 1;
    if (va > vb) return cpSortAsc ?  1 : -1;
    return 0;
  });
}

function setCpSort(field) {
  if (cpSortField === field) {
    cpSortAsc = !cpSortAsc;
  } else {
    cpSortField = field;
    cpSortAsc = true;
  }
  renderCompanyView();
}

function onCpFilterChange() {
  const typeSelect  = document.getElementById('cp-filter-type');
  const tierSelect  = document.getElementById('cp-filter-tier');
  const secSelect   = document.getElementById('cp-filter-sector');
  const indSelect   = document.getElementById('cp-filter-industry');
  const textInput   = document.getElementById('cp-filter-text');
  if (typeSelect)  cpFilters.type      = typeSelect.value;
  if (tierSelect)  cpFilters.size_tier = tierSelect.value;
  if (secSelect)   cpFilters.sector    = secSelect.value;
  if (indSelect)   cpFilters.industry  = indSelect.value;
  if (textInput)   cpFilters.text      = textInput.value.trim();

  // Only update the table + count (not the whole page) to preserve focus
  const tableWrap = document.getElementById('cp-table-container');
  const countEl   = document.getElementById('cp-count');
  if (tableWrap) {
    const filtered = applyCompanyFilters(cpAllCompanies);
    const sorted   = sortCompanies(filtered);
    tableWrap.innerHTML = renderCompanyTable(sorted);
    if (countEl) countEl.textContent = `${filtered.length.toLocaleString()} of ${cpAllCompanies.length.toLocaleString()} companies`;
    return;
  }
  renderCompanyView();
}

function setCpTypeFilter(type) {
  cpFilters.type = type;
  // Reset size filter when switching types to avoid stale filters
  cpFilters.size_tier = 'all';
  cpFilters.industry = 'all';
  // Sync the hidden select
  const typeSelect = document.getElementById('cp-filter-type');
  if (typeSelect) typeSelect.value = type;
  renderCompanyView();
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderCompanies() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading Company Pool…</div>`;

  try {
    const data = await api('GET', '/companies');
    cpAllCompanies = data.companies || [];
    renderCompanyView();
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load companies: ${cpEscape(err.message)}</div>`;
  }
}

// ── Main view ─────────────────────────────────────────────────────────────────

function renderCompanyView() {
  const content = document.getElementById('app-content');
  const filtered = applyCompanyFilters(cpAllCompanies);
  const sorted   = sortCompanies(filtered);

  const activeType = cpFilters.type;
  const pillClass = t => `cp-type-pill${activeType === t ? ' active-all' : ''}`;

  // Count companies by type
  const typeCounts = {};
  cpAllCompanies.forEach(c => { const t = c.company_type || 'Unclassified'; typeCounts[t] = (typeCounts[t] || 0) + 1; });

  // Build type pills: All, PE Firm, then others sorted by count
  const typeOrder = ['PE Firm', 'Portfolio Company', 'Public Company', 'Private Company',
    'Consulting Firm', 'Investment Bank', 'Accounting Firm', 'Law Firm',
    'Government / Military', 'Nonprofit / Education', 'Other', 'Unclassified'];
  const typePills = typeOrder
    .filter(t => typeCounts[t] > 0)
    .map(t => `<button class="${pillClass(t)}" data-type="${cpEscape(t)}" onclick="setCpTypeFilter('${cpEscape(t)}')">${cpEscape(t === 'Unclassified' ? 'Unclassified' : t)} (${typeCounts[t].toLocaleString()})</button>`)
    .join('');

  // Collect unique industries for filter dropdown
  const industries = [...new Set(cpAllCompanies.map(c => c.industry).filter(Boolean))].sort();

  // Size dropdown — show PE sizes + revenue tiers
  const sizeOpts = `
    <option value="all">All Sizes</option>
    <optgroup label="PE Firm Size">
      <option value="Mega" ${cpFilters.size_tier==='Mega'?'selected':''}>Mega</option>
      <option value="Large" ${cpFilters.size_tier==='Large'?'selected':''}>Large</option>
      <option value="Middle Market" ${cpFilters.size_tier==='Middle Market'?'selected':''}>Middle Market</option>
      <option value="Lower Middle Market" ${cpFilters.size_tier==='Lower Middle Market'?'selected':''}>Lower Middle Market</option>
    </optgroup>
    <optgroup label="Revenue Tier">
      <option value="rev:$1B+" ${cpFilters.size_tier==='rev:$1B+'?'selected':''}>$1B+</option>
      <option value="rev:$500M-$1B" ${cpFilters.size_tier==='rev:$500M-$1B'?'selected':''}>$500M-$1B</option>
      <option value="rev:$200M-$500M" ${cpFilters.size_tier==='rev:$200M-$500M'?'selected':''}>$200M-$500M</option>
      <option value="rev:$50M-$200M" ${cpFilters.size_tier==='rev:$50M-$200M'?'selected':''}>$50M-$200M</option>
      <option value="rev:$10M-$50M" ${cpFilters.size_tier==='rev:$10M-$50M'?'selected':''}>$10M-$50M</option>
      <option value="rev:<$10M" ${cpFilters.size_tier==='rev:<$10M'?'selected':''}>&lt;$10M</option>
    </optgroup>`;

  content.innerHTML = `
    <div class="pool-header">
      <div>
        <h1 class="pool-title">Company Pool</h1>
        <div class="pool-subtitle" id="cp-count">${filtered.length.toLocaleString()} of ${cpAllCompanies.length.toLocaleString()} companies</div>
      </div>
      <button class="btn btn-primary" onclick="openAddCompanyModal()">+ Add Company</button>
    </div>

    <div class="pool-filter-bar" style="flex-wrap:wrap;gap:10px">
      <!-- Type pills -->
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button class="${pillClass('all')}" data-type="all" onclick="setCpTypeFilter('all')">All (${cpAllCompanies.length.toLocaleString()})</button>
        ${typePills}
      </div>

      <!-- Hidden type select for onCpFilterChange compatibility -->
      <select id="cp-filter-type" style="display:none" onchange="onCpFilterChange()">
        <option value="all">All</option>
        ${typeOrder.filter(t => typeCounts[t] > 0).map(t => `<option value="${cpEscape(t)}">${cpEscape(t)}</option>`).join('')}
      </select>

      <select id="cp-filter-tier" class="pool-filter-select" onchange="onCpFilterChange()">
        ${sizeOpts}
      </select>

      <select id="cp-filter-sector" class="pool-filter-select" onchange="onCpFilterChange()">
        <option value="all">All Sectors</option>
        ${CP_SECTORS.map(s => `<option value="${s.id}" ${cpFilters.sector===s.id?'selected':''}>${s.label}</option>`).join('')}
      </select>

      ${industries.length > 0 ? `
      <select id="cp-filter-industry" class="pool-filter-select" onchange="onCpFilterChange()">
        <option value="all">All Industries</option>
        ${industries.map(i => `<option value="${cpEscape(i)}" ${cpFilters.industry===i?'selected':''}>${cpEscape(i)}</option>`).join('')}
      </select>` : ''}

      <input id="cp-filter-text" class="pool-filter-text" placeholder="Search companies…"
             value="${cpEscape(cpFilters.text)}" oninput="onCpFilterChange()">
    </div>

    <div id="cp-table-container">${renderCompanyTable(sorted)}</div>
  `;
}

// ── Table ─────────────────────────────────────────────────────────────────────

function renderCompanyTable(companies) {
  if (!companies.length) {
    return `<div class="empty-state"><p>No companies match the current filters.</p></div>`;
  }

  const activeType = cpFilters.type;
  const isPE       = activeType === 'PE Firm';
  const isAll      = activeType === 'all';
  const isNonPE    = !isPE && !isAll;

  const sortIcon = field => cpSortField === field ? (cpSortAsc ? ' ↑' : ' ↓') : '';

  return `
    <div class="pool-table-wrap">
      <table class="pool-table">
        <thead>
          <tr>
            <th onclick="setCpSort('name')" style="cursor:pointer;min-width:200px">Name${sortIcon('name')}</th>
            <th onclick="setCpSort('hq')" style="cursor:pointer">HQ${sortIcon('hq')}</th>
            <th>Type</th>
            ${isPE ? `
              <th onclick="setCpSort('size_tier')" style="cursor:pointer">Size${sortIcon('size_tier')}</th>
              <th onclick="setCpSort('strategy')" style="cursor:pointer">Strategy${sortIcon('strategy')}</th>
              <th>Sectors</th>
            ` : ''}
            ${isNonPE ? `
              <th onclick="setCpSort('industry')" style="cursor:pointer">Industry${sortIcon('industry')}</th>
              <th onclick="setCpSort('revenue_tier')" style="cursor:pointer">Revenue${sortIcon('revenue_tier')}</th>
              <th onclick="setCpSort('ownership_type')" style="cursor:pointer">Ownership${sortIcon('ownership_type')}</th>
              <th onclick="setCpSort('employee_count')" style="cursor:pointer">Employees${sortIcon('employee_count')}</th>
            ` : ''}
            ${isAll ? `
              <th onclick="setCpSort('size_tier')" style="cursor:pointer">Size / Revenue${sortIcon('size_tier')}</th>
              <th onclick="setCpSort('industry')" style="cursor:pointer">Industry${sortIcon('industry')}</th>
            ` : ''}
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${companies.map(c => renderCompanyRow(c, isAll, isPE, isNonPE)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCompanyRow(c, isAll, isPE, isNonPE) {
  const nameCell = `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-weight:600;font-size:13px">${cpEscape(c.name)}</span>
      ${c.website_url ? `<a href="${cpEscape(c.website_url)}" target="_blank" rel="noopener"
          onclick="event.stopPropagation()" title="Open website"
          style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#5C2D91;border-radius:3px;color:#fff;text-decoration:none;font-size:10px;font-weight:800;flex-shrink:0">W</a>` : ''}
      ${c.linkedin_company_url ? `<a href="${cpEscape(c.linkedin_company_url)}" target="_blank" rel="noopener"
          onclick="event.stopPropagation()" title="LinkedIn"
          style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#0a66c2;border-radius:3px;color:#fff;text-decoration:none;font-size:9px;font-weight:800;flex-shrink:0">in</a>` : ''}
    </div>
  `;

  const desc = c.description ? c.description.slice(0, 80) + (c.description.length > 80 ? '…' : '') : '';

  // Size display: show PE size_tier or revenue_tier depending on company type
  const sizeDisplay = c.size_tier || c.revenue_tier || '—';

  const fmtEmployees = n => {
    if (!n) return '—';
    if (n >= 1000) return Math.round(n / 1000).toLocaleString() + 'K';
    return n.toLocaleString();
  };

  return `
    <tr onclick="openCompanyDetail('${cpEscape(c.company_id)}')" style="cursor:pointer">
      <td>${nameCell}</td>
      <td style="color:#666;font-size:12px">${cpEscape(c.hq || '—')}</td>
      <td>${companyTypePill(c.company_type)}</td>
      ${isPE ? `
        <td>${sizeTierPillCP(c.size_tier)}</td>
        <td style="color:#666;font-size:12px">${cpEscape(c.strategy || '—')}</td>
        <td>${cpSectorTags(c.sector_focus_tags)}</td>
      ` : ''}
      ${isNonPE ? `
        <td style="color:#666;font-size:12px">${cpEscape(c.industry || '—')}</td>
        <td style="color:#666;font-size:12px">${cpEscape(c.revenue_tier || '—')}</td>
        <td style="color:#666;font-size:12px">${cpEscape(c.ownership_type || '—')}</td>
        <td style="color:#666;font-size:12px">${fmtEmployees(c.employee_count)}</td>
      ` : ''}
      ${isAll ? `
        <td style="color:#666;font-size:12px">${cpEscape(sizeDisplay)}</td>
        <td style="color:#666;font-size:12px">${cpEscape(c.industry || '—')}</td>
      ` : ''}
      <td style="color:#888;font-size:12px;max-width:200px">${cpEscape(desc)}</td>
    </tr>
  `;
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function closeCompanyDetail() {
  const overlay = document.getElementById('company-detail-overlay');
  if (overlay) overlay.remove();
  document.removeEventListener('keydown', _cpPanelEscapeHandler);
}

// Keep for backwards compat — old sidebar panel references
function renderCompanyDetailPanel(company) {
  openCompanyDetail(company.company_id);
}

function _cpPanelEscapeHandler(e) {
  if (e.key === 'Escape') closeCompanyDetail();
}

async function openCompanyDetail(companyId) {
  closeCompanyDetail();
  try {
    const company = await api('GET', '/companies/' + companyId);
    // Fetch candidates for people sections
    const poolResp = await api('GET', '/candidates');
    const allCandidates = poolResp.candidates || [];
    renderCompanyFullPage(company, allCandidates);
  } catch (err) {
    alert('Error loading company: ' + err.message);
  }
}

function renderCompanyFullPage(company, allCandidates) {
  const isPE    = company.company_type === 'PE Firm';
  const isPriv  = company.company_type === 'Private Company';
  const isPub   = company.company_type === 'Public Company';

  // Match current employees and alumni from candidate pool (with alias support)
  const companyName = company.name || '';
  const aliases = company.aliases || [];
  const currentEmployees = allCandidates.filter(c =>
    firmNamesMatch(c.current_firm, companyName, aliases)
  );
  const alumni = allCandidates.filter(c => {
    if (firmNamesMatch(c.current_firm, companyName, aliases)) return false;
    return (c.work_history || []).some(w =>
      firmNamesMatch(w.company, companyName, aliases)
    );
  });

  function personRow(c, showCurrentRole) {
    const linkedinIcon = c.linkedin_url
      ? `<a href="${cpEscape(c.linkedin_url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;margin-left:6px;color:#0077B5" title="LinkedIn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>`
      : '';
    const subtitle = showCurrentRole
      ? cpEscape(c.current_title || '')
      : cpEscape((c.current_title || '') + (c.current_firm ? ' @ ' + c.current_firm : ''));
    const location = cpEscape(c.home_location || c.location || '');
    return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:10px 12px">
          <div style="font-weight:600;font-size:13px;color:#5C2D91"><span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${cpEscape(c.candidate_id)}')">${cpEscape(c.name)}</span>${linkedinIcon}</div>
          <div style="font-size:12px;color:#777;margin-top:2px">${subtitle}</div>
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#666">${location}</td>
        <td style="padding:10px 12px;font-size:13px">
          ${(c.sector_tags || []).map(t => {
            const s = CP_SECTORS.find(s => s.id === t);
            return `<span style="background:#f3e8ff;color:#7c3aed;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-right:3px">${s ? s.label.slice(0,4) : t.slice(0,4)}</span>`;
          }).join('')}
        </td>
        <td style="padding:10px 12px;font-size:12px;color:#888">${cpEscape(c.archetype || '—')}</td>
      </tr>`;
  }

  function peopleTable(people, showCurrentRole) {
    if (people.length === 0) {
      return `<div style="padding:16px;color:#aaa;font-size:13px">No candidates found in the pool.</div>`;
    }
    return `
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="border-bottom:2px solid #e0e0e0">
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#999;text-transform:uppercase;font-weight:700">Name</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#999;text-transform:uppercase;font-weight:700">Location</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#999;text-transform:uppercase;font-weight:700">Sectors</th>
            <th style="text-align:left;padding:8px 12px;font-size:11px;color:#999;text-transform:uppercase;font-weight:700">Archetype</th>
          </tr>
        </thead>
        <tbody>${people.map(c => personRow(c, showCurrentRole)).join('')}</tbody>
      </table>`;
  }

  const content = document.getElementById('app-content');
  content.innerHTML = `
    <div style="max-width:1100px;margin:0 auto;padding:24px">
      <div style="margin-bottom:20px">
        <button class="btn btn-ghost btn-sm" onclick="renderCompanies()">← Back to Company Pool</button>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:24px">
        <div>
          <h1 style="font-size:1.6rem;font-weight:800;margin:0 0 4px;color:#1a1a1a">${cpEscape(company.name)}</h1>
          <div style="font-size:14px;color:#555;margin-bottom:8px">${cpEscape(company.hq || '')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${companyTypePill(company.company_type)}
            ${isPE && company.size_tier ? sizeTierPillCP(company.size_tier) : ''}
            ${isPE && company.strategy ? `<span style="background:#f5f5f5;color:#555;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${cpEscape(company.strategy)}</span>` : ''}
            ${company.website_url ? `<a href="${cpEscape(company.website_url)}" target="_blank" rel="noopener" style="font-size:12px;color:#5C2D91;text-decoration:none">Website →</a>` : ''}
            ${isPE && company.sector_focus_tags && company.sector_focus_tags.length ? `<button onclick="openFirmInPlaybook('${cpEscape(company.company_id)}','${cpEscape(company.sector_focus_tags[0])}')" style="background:#fff;border:1px solid #5C2D91;color:#5C2D91;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer">View in Playbook →</button>` : ''}
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="openEditCompanyForm('${cpEscape(company.company_id)}')">Edit</button>
      </div>

      ${company.description ? `
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Description</div>
        <div style="font-size:13px;color:#444;line-height:1.6">${cpEscape(company.description)}</div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:${isPE ? '1fr 1fr' : '1fr'};gap:16px;margin-bottom:24px">
        ${isPE ? `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Firm Details</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            ${company.entity_type ? `<div><span style="color:#888">Type:</span> ${cpEscape(company.entity_type)}</div>` : ''}
            ${company.year_founded ? `<div><span style="color:#888">Founded:</span> ${cpEscape(String(company.year_founded))}</div>` : ''}
            ${company.investment_professionals ? `<div><span style="color:#888">Investment Pros:</span> ${cpEscape(String(company.investment_professionals))}</div>` : ''}
            ${company.preferred_geography ? `<div><span style="color:#888">Geography:</span> ${cpEscape(company.preferred_geography)}</div>` : ''}
            ${company.preferred_ebitda_min || company.preferred_ebitda_max ? `<div><span style="color:#888">EBITDA:</span> $${cpEscape(String(company.preferred_ebitda_min||''))}M – $${cpEscape(String(company.preferred_ebitda_max||''))}M</div>` : ''}
            ${company.active_portfolio_count ? `<div><span style="color:#888">Portfolio Cos:</span> ${cpEscape(String(company.active_portfolio_count))}</div>` : ''}
          </div>
        </div>
        ${(company.last_fund_name || company.last_fund_size || company.last_fund_vintage) ? `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Latest Fund</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            ${company.last_fund_name ? `<div><span style="color:#888">Fund:</span> ${cpEscape(company.last_fund_name)}</div>` : ''}
            ${company.last_fund_size ? `<div><span style="color:#888">Size:</span> $${cpEscape(String(company.last_fund_size))}M</div>` : ''}
            ${company.last_fund_vintage ? `<div><span style="color:#888">Vintage:</span> ${cpEscape(String(company.last_fund_vintage))}</div>` : ''}
            ${company.dry_powder ? `<div><span style="color:#888">Dry Powder:</span> $${cpEscape(String(company.dry_powder))}M</div>` : ''}
          </div>
        </div>` : `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Sector Focus</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            ${(company.sector_focus_tags || []).length
              ? company.sector_focus_tags.map(t => {
                  const s = CP_SECTORS.find(s => s.id === t);
                  return `<span style="background:#EDE7F6;color:#5C2D91;padding:4px 12px;border-radius:10px;font-size:12px;font-weight:600">${s ? s.label : t}</span>`;
                }).join('')
              : '<span style="color:#aaa;font-size:13px">None specified</span>'
            }
          </div>
        </div>`}
        ` : ''}

        ${(isPriv || isPub) ? `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Company Details</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            ${company.revenue_tier ? `<div><span style="color:#888">Revenue Tier:</span> ${cpEscape(company.revenue_tier)}</div>` : ''}
            ${company.ownership_type ? `<div><span style="color:#888">Ownership:</span> ${cpEscape(company.ownership_type)}</div>` : ''}
            ${company.industry ? `<div><span style="color:#888">Industry:</span> ${cpEscape(company.industry)}</div>` : ''}
            ${company.year_founded ? `<div><span style="color:#888">Founded:</span> ${cpEscape(String(company.year_founded))}</div>` : ''}
            ${company.employee_count ? `<div><span style="color:#888">Employees:</span> ${cpEscape(String(company.employee_count))}</div>` : ''}
            ${company.parent_company ? `<div><span style="color:#888">Parent Co:</span> ${cpEscape(company.parent_company)}</div>` : ''}
            ${isPub && company.ticker ? `<div><span style="color:#888">Ticker:</span> <strong style="color:#1565c0">${cpEscape(company.ticker)}</strong></div>` : ''}
          </div>
        </div>` : ''}
      </div>

      ${isPE && (company.sector_focus_tags || []).length && (company.last_fund_name || company.last_fund_size) ? `
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Sector Focus</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${company.sector_focus_tags.map(t => {
            const s = CP_SECTORS.find(s => s.id === t);
            return `<span style="background:#EDE7F6;color:#5C2D91;padding:4px 12px;border-radius:10px;font-size:12px;font-weight:600">${s ? s.label : t}</span>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Aliases -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Also Known As</div>
        <div id="company-aliases-container">
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center" id="company-alias-tags">
            ${(company.aliases || []).map((a, i) => `<span style="background:#EDE7F6;color:#5C2D91;padding:4px 10px;border-radius:10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px">${cpEscape(a)}<button onclick="removeCompanyAlias('${cpEscape(company.company_id)}',${i})" style="background:none;border:none;cursor:pointer;color:#5C2D91;font-size:12px;padding:0;line-height:1">&#10005;</button></span>`).join('')}
            <div style="display:inline-flex;gap:4px;align-items:center">
              <input type="text" id="new-alias-input" placeholder="Add alias..." style="padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;width:140px"
                onkeydown="if(event.key==='Enter'){event.preventDefault();addCompanyAlias('${cpEscape(company.company_id)}');}">
              <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="addCompanyAlias('${cpEscape(company.company_id)}')">Add</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Current Employees -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">
          Current Employees in Candidate Pool (${currentEmployees.length})
        </div>
        ${peopleTable(currentEmployees, true)}
      </div>

      <!-- Alumni -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">
          Alumni in Candidate Pool (${alumni.length})
        </div>
        ${peopleTable(alumni, false)}
      </div>

      <!-- Notes -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Notes</div>
        <textarea style="width:100%;min-height:80px;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box"
          onblur="saveCompanyField('${cpEscape(company.company_id)}', 'notes', this.value)">${cpEscape(company.notes || '')}</textarea>
      </div>

      <div style="font-size:11px;color:#aaa;margin-bottom:40px">
        Added ${formatCPDate(company.date_added)}
        ${company.source ? ' &bull; Source: ' + cpEscape(company.source) : ''}
      </div>
    </div>`;
}

async function saveCompanyField(companyId, field, value) {
  try {
    const updates = {};
    updates[field] = value;
    await api('PUT', '/companies/' + companyId, updates);
    const idx = cpAllCompanies.findIndex(c => c.company_id === companyId);
    if (idx !== -1) cpAllCompanies[idx] = Object.assign({}, cpAllCompanies[idx], updates);
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}

// ── Add / Edit Form ───────────────────────────────────────────────────────────

function openAddCompanyModal() {
  _renderCompanyForm(null);
}

async function openEditCompanyForm(companyId) {
  closeCompanyDetail();
  try {
    const company = await api('GET', '/companies/' + companyId);
    _renderCompanyForm(company);
  } catch (err) {
    alert('Error loading company: ' + err.message);
  }
}

function _renderCompanyForm(company) {
  const isEdit = !!company;
  const c = company || {};

  const overlay = document.createElement('div');
  overlay.id = 'cp-form-overlay';
  overlay.className = 'modal-overlay-s3';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const sectorCheckboxes = CP_SECTORS.map(s => {
    const checked = Array.isArray(c.sector_focus_tags) && c.sector_focus_tags.includes(s.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
      <input type="checkbox" value="${s.id}" ${checked} style="cursor:pointer"> ${s.label}
    </label>`;
  }).join('');

  overlay.innerHTML = `
    <div class="modal-s3" style="max-width:620px;max-height:90vh;overflow-y:auto">
      <div class="modal-header-s3">
        <h3>${isEdit ? 'Edit Company' : 'Add Company'}</h3>
        <button class="modal-close-s3" onclick="document.getElementById('cp-form-overlay').remove()">✕</button>
      </div>
      <div class="modal-body-s3">

        <div class="form-group">
          <label class="form-label">Company Type *</label>
          <select id="cf-type" class="form-control" onchange="_cpFormTypeToggle()">
            <option value="PE Firm"          ${(!c.company_type||c.company_type==='PE Firm')?'selected':''}>PE Firm</option>
            <option value="Private Company"  ${c.company_type==='Private Company'?'selected':''}>Private Company</option>
            <option value="Public Company"   ${c.company_type==='Public Company'?'selected':''}>Public Company</option>
          </select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group">
            <label class="form-label">Name *</label>
            <input id="cf-name" class="form-control" value="${cpEscape(c.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">HQ</label>
            <input id="cf-hq" class="form-control" value="${cpEscape(c.hq||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Website URL</label>
            <input id="cf-website" class="form-control" value="${cpEscape(c.website_url||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Year Founded</label>
            <input id="cf-founded" class="form-control" type="number" value="${c.year_founded||''}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea id="cf-description" class="form-control" rows="2">${cpEscape(c.description||'')}</textarea>
        </div>

        <!-- PE Firm fields -->
        <div id="cf-pe-fields">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Size Tier</label>
              <select id="cf-size" class="form-control">
                <option value="">— Select —</option>
                ${['Mega','Large','Middle Market','Lower Middle Market'].map(t => `<option value="${t}" ${c.size_tier===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Strategy</label>
              <select id="cf-strategy" class="form-control">
                <option value="">— Select —</option>
                ${['Buyout','Growth Equity','Venture Capital','Distressed / Credit','Turnaround','Multi-Strategy'].map(t => `<option value="${t}" ${c.strategy===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Entity Type</label>
              <input id="cf-entity" class="form-control" value="${cpEscape(c.entity_type||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">Preferred Geography</label>
              <input id="cf-geo" class="form-control" value="${cpEscape(c.preferred_geography||'')}">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Sector Focus Tags</label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px" id="cf-sector-checkboxes">
              ${sectorCheckboxes}
            </div>
          </div>
        </div>

        <!-- Private / Public fields -->
        <div id="cf-priv-fields" style="display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Revenue Tier</label>
              <select id="cf-rev" class="form-control">
                <option value="">— Select —</option>
                ${['Large Cap','Upper Middle','Middle Market','Lower Middle'].map(t => `<option value="${t}" ${c.revenue_tier===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Ownership Type</label>
              <select id="cf-ownership" class="form-control">
                <option value="">— Select —</option>
                ${['PE-Backed','Founder-Owned','Family-Owned','Public','Other'].map(t => `<option value="${t}" ${c.ownership_type===t?'selected':''}>${t}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Industry</label>
              <input id="cf-industry" class="form-control" value="${cpEscape(c.industry||'')}">
            </div>
            <div class="form-group" id="cf-ticker-group" style="display:none">
              <label class="form-label">Ticker Symbol</label>
              <input id="cf-ticker" class="form-control" value="${cpEscape(c.ticker||'')}">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea id="cf-notes" class="form-control" rows="2">${cpEscape(c.notes||'')}</textarea>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="document.getElementById('cp-form-overlay').remove()">Cancel</button>
          ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="_deleteCompany('${cpEscape(c.company_id)}')">Delete</button>` : ''}
          <button class="btn btn-primary" onclick="_submitCompanyForm('${cpEscape(c.company_id || '')}')">
            ${isEdit ? 'Save Changes' : 'Add Company'}
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  _cpFormTypeToggle();
}

function _cpFormTypeToggle() {
  const type = document.getElementById('cf-type').value;
  const peFields   = document.getElementById('cf-pe-fields');
  const privFields = document.getElementById('cf-priv-fields');
  const tickerGrp  = document.getElementById('cf-ticker-group');
  if (peFields)   peFields.style.display   = type === 'PE Firm' ? '' : 'none';
  if (privFields) privFields.style.display = (type === 'Private Company' || type === 'Public Company') ? '' : 'none';
  if (tickerGrp)  tickerGrp.style.display  = type === 'Public Company' ? '' : 'none';
}

async function _submitCompanyForm(existingId) {
  const type = document.getElementById('cf-type').value;
  const name = document.getElementById('cf-name').value.trim();
  if (!name) { alert('Name is required.'); return; }

  const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

  const payload = {
    company_type:  type,
    name,
    hq:            document.getElementById('cf-hq').value.trim(),
    website_url:   document.getElementById('cf-website').value.trim(),
    year_founded:  parseInt(document.getElementById('cf-founded').value) || null,
    description:   document.getElementById('cf-description').value.trim(),
    notes:         document.getElementById('cf-notes').value.trim()
  };

  if (!existingId) {
    payload.company_id = slugify(name);
  } else {
    payload.company_id = existingId;
  }

  if (type === 'PE Firm') {
    payload.size_tier           = document.getElementById('cf-size').value || null;
    payload.strategy            = document.getElementById('cf-strategy').value || null;
    payload.entity_type         = document.getElementById('cf-entity').value.trim() || null;
    payload.preferred_geography = document.getElementById('cf-geo').value.trim();
    payload.sector_focus_tags   = [...document.querySelectorAll('#cf-sector-checkboxes input:checked')].map(cb => cb.value);
    payload.revenue_tier  = null; payload.ownership_type = null;
    payload.industry = null; payload.ticker = null;
  } else {
    payload.revenue_tier  = document.getElementById('cf-rev').value || null;
    payload.ownership_type= document.getElementById('cf-ownership').value || null;
    payload.industry      = document.getElementById('cf-industry').value.trim() || null;
    payload.ticker        = type === 'Public Company' ? (document.getElementById('cf-ticker').value.trim() || null) : null;
    payload.size_tier = null; payload.strategy = null;
    payload.entity_type = null; payload.sector_focus_tags = [];
  }

  try {
    const result = await api('POST', '/companies', payload);
    const formOverlay = document.getElementById('cp-form-overlay');
    if (formOverlay) formOverlay.remove();

    // Full re-fetch so the table is always up to date
    const data = await api('GET', '/companies');
    cpAllCompanies = data.companies || [];
    renderCompanyView();

    // Reopen detail panel so the user sees the saved result
    openCompanyDetail(result.company_id);
  } catch (err) {
    alert('Error saving company: ' + err.message);
  }
}

async function _deleteCompany(companyId) {
  if (!confirm('Delete this company from the pool? This cannot be undone.')) return;
  try {
    await api('DELETE', '/companies/' + companyId);
    document.getElementById('cp-form-overlay').remove();
    cpAllCompanies = cpAllCompanies.filter(c => c.company_id !== companyId);
    renderCompanyView();
  } catch (err) {
    alert('Error deleting: ' + err.message);
  }
}

// ── Company Aliases ───────────────────────────────────────────────────────────

async function addCompanyAlias(companyId) {
  const input = document.getElementById('new-alias-input');
  const alias = (input?.value || '').trim();
  if (!alias) return;
  try {
    const company = await api('GET', '/companies/' + companyId);
    const aliases = company.aliases || [];
    if (aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
      alert('Alias already exists.');
      return;
    }
    aliases.push(alias);
    await api('PUT', '/companies/' + companyId, { aliases });
    invalidateAliasCache();
    // Refresh the page
    openCompanyDetail(companyId);
  } catch (err) {
    alert('Error adding alias: ' + err.message);
  }
}

async function removeCompanyAlias(companyId, index) {
  try {
    const company = await api('GET', '/companies/' + companyId);
    const aliases = company.aliases || [];
    aliases.splice(index, 1);
    await api('PUT', '/companies/' + companyId, { aliases });
    invalidateAliasCache();
    openCompanyDetail(companyId);
  } catch (err) {
    alert('Error removing alias: ' + err.message);
  }
}
