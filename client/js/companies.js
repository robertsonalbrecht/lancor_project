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
let cpAllCompanies = [];   // current page of companies
let cpTotal = 0;           // total matching the current filter
let cpLimit = 100;
let cpOffset = 0;
let cpTypeCounts = {};     // { 'PE Firm': 2640, ... }
let cpIndustrySectors = []; // for filter dropdown
let cpDuplicateCount = 0;   // pairs of probable duplicates above the similarity threshold
let _cpFilterTimer = null; // debounce timer for text input

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


function companyTypePill(type) {
  const map = {
    'PE Firm':              { bg: '#F3E8EF', color: '#6B2D5B' },
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
  return `<span style="background:${c.bg};color:${c.color};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap">${escapeHtml(type) || 'Unclassified'}</span>`;
}

function sizeTierPillCP(tier) {
  const map = {
    'Mega':               { bg: '#f3e5f5', color: '#6a1b9a' },
    'Large':              { bg: '#F3E8EF', color: '#7b1fa2' },
    'Middle Market':      { bg: '#e8eaf6', color: '#283593' },
    'Lower Middle Market':{ bg: '#e3f2fd', color: '#1565c0' }
  };
  const c = map[tier] || { bg: '#f5f5f5', color: '#888' };
  return `<span style="background:${c.bg};color:${c.color};padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600">${escapeHtml(tier) || '—'}</span>`;
}

function cpSectorTags(tags) {
  if (!Array.isArray(tags) || !tags.length) return '<span style="color:#ccc">—</span>';
  const abbrs = { 'industrials':'Ind.','technology-software':'Tech','tech-enabled-services':'TES','healthcare':'HC','financial-services':'Fin.','consumer':'Con.','business-services':'BizSvc','infrastructure-energy':'Infra','life-sciences':'LS','media-entertainment':'Media','real-estate-proptech':'RE','agriculture-fb':'Ag/FB' };
  return tags.slice(0, 4).map(t =>
    `<span style="background:#f5f5f5;color:#555;padding:2px 6px;border-radius:4px;font-size:10px;margin-right:3px">${abbrs[t] || t}</span>`
  ).join('') + (tags.length > 4 ? `<span style="color:#aaa;font-size:10px">+${tags.length-4}</span>` : '');
}

// ── Server-side filtering & pagination ────────────────────────────────────────

/** Build query string from current filters */
function _cpBuildQuery(extraOffset) {
  const p = new URLSearchParams();
  if (cpFilters.type !== 'all') p.set('type', cpFilters.type);
  if (cpFilters.size_tier !== 'all') p.set('size_tier', cpFilters.size_tier);
  if (cpFilters.sector !== 'all') p.set('sector', cpFilters.sector);
  if (cpFilters.industry !== 'all') p.set('industry', cpFilters.industry);
  if (cpFilters.enrichment !== 'all') p.set('enrichment', cpFilters.enrichment);
  if (cpFilters.text) p.set('text', cpFilters.text);
  p.set('sort', cpSortField);
  p.set('order', cpSortAsc ? 'asc' : 'desc');
  p.set('limit', String(cpLimit));
  p.set('offset', String(extraOffset != null ? extraOffset : cpOffset));
  return p.toString();
}

/** Fetch a page of companies from the server and update state */
async function _cpFetchPage(append) {
  const qs = _cpBuildQuery();
  const data = await api('GET', '/companies?' + qs);
  if (append) {
    cpAllCompanies = cpAllCompanies.concat(data.companies || []);
  } else {
    cpAllCompanies = data.companies || [];
  }
  cpTotal = data.total;
  cpLimit = data.limit;
  cpOffset = data.offset;
}

function setCpSort(field) {
  if (cpSortField === field) {
    cpSortAsc = !cpSortAsc;
  } else {
    cpSortField = field;
    cpSortAsc = true;
  }
  cpOffset = 0;
  _cpRefreshTable();
}

async function _cpRefreshTable() {
  const tableWrap = document.getElementById('cp-table-container');
  const countEl   = document.getElementById('cp-count');
  if (tableWrap) tableWrap.innerHTML = `<div class="loading"><div class="spinner"></div> Loading…</div>`;
  try {
    await _cpFetchPage(false);
    if (tableWrap) tableWrap.innerHTML = renderCompanyTable(cpAllCompanies);
    if (countEl) countEl.textContent = `Showing ${cpAllCompanies.length.toLocaleString()} of ${cpTotal.toLocaleString()} companies`;
  } catch (err) {
    if (tableWrap) tableWrap.innerHTML = `<div class="error-banner">Error: ${escapeHtml(err.message)}</div>`;
  }
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

  cpOffset = 0;

  // Debounce text input, immediate for dropdowns
  if (_cpFilterTimer) clearTimeout(_cpFilterTimer);
  if (textInput && document.activeElement === textInput) {
    _cpFilterTimer = setTimeout(() => _cpRefreshTable(), 300);
  } else {
    _cpRefreshTable();
  }
}

function setCpTypeFilter(type) {
  cpFilters.type = type;
  cpFilters.size_tier = 'all';
  cpFilters.industry = 'all';
  cpOffset = 0;
  // Sync hidden select
  const typeSelect = document.getElementById('cp-filter-type');
  if (typeSelect) typeSelect.value = type;
  // Update pill active states immediately
  document.querySelectorAll('.cp-type-pill').forEach(btn => {
    btn.classList.toggle('active-all', btn.dataset.type === type);
  });
  _cpRefreshTable();
}

async function cpLoadMore() {
  cpOffset += cpLimit;
  const btn = document.getElementById('cp-load-more-btn');
  if (btn) btn.textContent = 'Loading…';
  try {
    await _cpFetchPage(true);
    const tableWrap = document.getElementById('cp-table-container');
    if (tableWrap) tableWrap.innerHTML = renderCompanyTable(cpAllCompanies);
    const countEl = document.getElementById('cp-count');
    if (countEl) countEl.textContent = `Showing ${cpAllCompanies.length.toLocaleString()} of ${cpTotal.toLocaleString()} companies`;
  } catch (err) {
    if (btn) btn.textContent = 'Error — try again';
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function renderCompanies() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading Company Pool…</div>`;

  try {
    // Fetch counts + first page in parallel
    const [countsData, dupData] = await Promise.all([
      api('GET', '/companies/counts'),
      api('GET', '/companies/duplicates/count').catch(() => ({ count: 0 })),
      _cpFetchPage(false)
    ]);
    cpTypeCounts = countsData.type_counts || {};
    cpIndustrySectors = countsData.industry_sectors || [];
    cpDuplicateCount = (dupData && dupData.count) || 0;
    renderCompanyView();
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load companies: ${escapeHtml(err.message)}</div>`;
  }
}

// ── Main view ─────────────────────────────────────────────────────────────────

function renderCompanyView() {
  const content = document.getElementById('app-content');
  const typeCounts = cpTypeCounts;
  const totalAll = Object.values(typeCounts).reduce((s, n) => s + n, 0);

  const activeType = cpFilters.type;
  const pillClass = t => `cp-type-pill${activeType === t ? ' active-all' : ''}`;

  const typeOrder = ['PE Firm', 'Portfolio Company', 'Public Company', 'Private Company',
    'Consulting Firm', 'Investment Bank', 'Accounting Firm', 'Law Firm',
    'Government / Military', 'Nonprofit / Education', 'Other', 'Unclassified'];
  const typePills = typeOrder
    .filter(t => typeCounts[t] > 0)
    .map(t => `<button class="${pillClass(t)}" data-type="${escapeHtml(t)}" onclick="setCpTypeFilter('${escapeHtml(t)}')">${escapeHtml(t === 'Unclassified' ? 'Unclassified' : t)} (${typeCounts[t].toLocaleString()})</button>`)
    .join('');

  const industries = cpIndustrySectors;

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
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div>
        <h1 class="pool-title" style="margin:0">Company Pool</h1>
        <div class="pool-subtitle" id="cp-count">Showing ${cpAllCompanies.length.toLocaleString()} of ${cpTotal.toLocaleString()} companies</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        ${cpDuplicateCount > 0
          ? `<button class="btn btn-ghost btn-sm" onclick="openDuplicatesReview()"
                     title="Review companies whose names look like the same firm under different spellings"
                     style="white-space:nowrap;padding:5px 12px;font-size:12px;border:1px solid #E0B500;background:#FFFBEB;color:#8A6100">
               ⚠ Possible duplicates (${cpDuplicateCount})
             </button>`
          : ''}
        <button class="btn btn-primary btn-sm" onclick="openAddCompanyModal()" style="white-space:nowrap;padding:5px 12px;font-size:12px">+ Add Company</button>
      </div>
    </div>

    <div class="pool-filter-bar" style="flex-wrap:wrap;gap:10px">
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <button class="${pillClass('all')}" data-type="all" onclick="setCpTypeFilter('all')">All (${totalAll.toLocaleString()})</button>
        ${typePills}
      </div>

      <select id="cp-filter-type" style="display:none" onchange="onCpFilterChange()">
        <option value="all">All</option>
        ${typeOrder.filter(t => typeCounts[t] > 0).map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
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
        ${industries.map(i => `<option value="${escapeHtml(i)}" ${cpFilters.industry===i?'selected':''}>${escapeHtml(i)}</option>`).join('')}
      </select>` : ''}

      <input id="cp-filter-text" class="pool-filter-text" placeholder="Search companies…"
             value="${escapeHtml(cpFilters.text)}" oninput="onCpFilterChange()">
    </div>

    <div id="cp-table-container">${renderCompanyTable(cpAllCompanies)}</div>
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

  const hasMore = cpAllCompanies.length < cpTotal;
  const loadMoreBtn = hasMore
    ? `<div style="text-align:center;padding:16px">
        <button id="cp-load-more-btn" class="btn btn-secondary" onclick="cpLoadMore()">
          Load more (${(cpTotal - cpAllCompanies.length).toLocaleString()} remaining)
        </button>
      </div>`
    : '';

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
    ${loadMoreBtn}
  `;
}

function renderCompanyRow(c, isAll, isPE, isNonPE) {
  const nameCell = `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-weight:600;font-size:13px">${escapeHtml(c.name)}</span>
      ${c.website_url ? `<a href="${escapeHtml(c.website_url)}" target="_blank" rel="noopener"
          onclick="event.stopPropagation()" title="Open website"
          style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#6B2D5B;border-radius:3px;color:#fff;text-decoration:none;font-size:10px;font-weight:800;flex-shrink:0">W</a>` : ''}
      ${c.linkedin_company_url ? `<a href="${escapeHtml(c.linkedin_company_url)}" target="_blank" rel="noopener"
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
    <tr onclick="openCompanyDetail('${escapeHtml(c.company_id)}')" style="cursor:pointer">
      <td>${nameCell}</td>
      <td style="color:#666;font-size:12px">${escapeHtml(c.hq || '—')}</td>
      <td>${companyTypePill(c.company_type)}</td>
      ${isPE ? `
        <td>${sizeTierPillCP(c.size_tier)}</td>
        <td style="color:#666;font-size:12px">${escapeHtml(c.strategy || '—')}</td>
        <td>${cpSectorTags(c.sector_focus_tags)}</td>
      ` : ''}
      ${isNonPE ? `
        <td style="color:#666;font-size:12px" title="${escapeHtml(c.industry || '')}">${escapeHtml(c.industry_sector || c.industry || '—')}</td>
        <td style="color:#666;font-size:12px">${escapeHtml(c.revenue_tier || '—')}</td>
        <td style="color:#666;font-size:12px">${escapeHtml(c.ownership_type || '—')}</td>
        <td style="color:#666;font-size:12px">${fmtEmployees(c.employee_count)}</td>
      ` : ''}
      ${isAll ? `
        <td style="color:#666;font-size:12px">${escapeHtml(sizeDisplay)}</td>
        <td style="color:#666;font-size:12px" title="${escapeHtml(c.industry || '')}">${escapeHtml(c.industry_sector || c.industry || '—')}</td>
      ` : ''}
      <td style="color:#888;font-size:12px;max-width:200px">${escapeHtml(desc)}</td>
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
    // Fetch candidates for people sections (slim endpoint for speed)
    const poolResp = await api('GET', '/candidates/slim');
    const allCandidates = poolResp.candidates || [];
    renderCompanyFullPage(company, allCandidates);
  } catch (err) {
    appAlert('Error loading company: ' + err.message, { type: 'error' });
  }
}

function renderCompanyFullPage(company, allCandidates) {
  const isPE    = company.company_type === 'PE Firm';
  const isPriv  = company.company_type === 'Private Company';
  const isPub   = company.company_type === 'Public Company';

  // Match current employees and alumni from candidate pool (with alias support)
  // Same logic as coverage auto-link: current_firm match OR current work history role (excluding board/passive)
  const companyName = company.name || '';
  const aliases = company.aliases || [];
  const EXCLUDED_TITLES = /\b(board\s*(member|director|advisor|observer)|independent\s*director|non[- ]executive\s*director|investor)\b/i;

  function isCurrentAtFirm(c) {
    if (firmNamesMatch(c.current_firm, companyName, aliases)) return true;
    if (Array.isArray(c.work_history)) {
      return c.work_history.some(w =>
        w.dates && /present/i.test(w.dates) &&
        w.title && !EXCLUDED_TITLES.test(w.title) &&
        firmNamesMatch(w.company, companyName, aliases)
      );
    }
    return false;
  }

  const currentEmployees = allCandidates.filter(c => isCurrentAtFirm(c));
  const alumni = allCandidates.filter(c => {
    if (isCurrentAtFirm(c)) return false;
    return (c.work_history || []).some(w =>
      firmNamesMatch(w.company, companyName, aliases)
    );
  });

  function personRow(c, showCurrentRole) {
    const linkedinIcon = c.linkedin_url
      ? `<a href="${escapeHtml(c.linkedin_url)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;margin-left:6px;color:#0077B5" title="LinkedIn"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>`
      : '';
    const subtitle = showCurrentRole
      ? escapeHtml(c.current_title || '')
      : escapeHtml((c.current_title || '') + (c.current_firm ? ' @ ' + c.current_firm : ''));
    const location = escapeHtml(c.home_location || c.location || '');
    return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:10px 12px">
          <div style="font-weight:600;font-size:13px;color:#6B2D5B"><span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${escapeHtml(c.candidate_id)}')">${escapeHtml(c.name)}</span>${linkedinIcon}</div>
          <div style="font-size:12px;color:#777;margin-top:2px">${subtitle}</div>
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#666">${location}</td>
        <td style="padding:10px 12px;font-size:13px">
          ${(c.sector_tags || []).map(t => {
            const s = CP_SECTORS.find(s => s.id === t);
            return `<span style="background:#f3e8ff;color:#7c3aed;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-right:3px">${s ? s.label.slice(0,4) : t.slice(0,4)}</span>`;
          }).join('')}
        </td>
        <td style="padding:10px 12px;font-size:12px;color:#888">${escapeHtml(c.archetype || '—')}</td>
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
          <h1 style="font-size:1.6rem;font-weight:800;margin:0 0 4px;color:#1a1a1a">${escapeHtml(company.name)}</h1>
          <div style="font-size:14px;color:#555;margin-bottom:8px">${escapeHtml(company.hq || '')}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            ${companyTypePill(company.company_type)}
            ${isPE && company.size_tier ? sizeTierPillCP(company.size_tier) : ''}
            ${isPE && company.strategy ? `<span style="background:#f5f5f5;color:#555;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${escapeHtml(company.strategy)}</span>` : ''}
            ${company.website_url ? `<a href="${escapeHtml(company.website_url)}" target="_blank" rel="noopener" style="font-size:12px;color:#6B2D5B;text-decoration:none">Website →</a>` : ''}
            ${isPE && company.sector_focus_tags && company.sector_focus_tags.length ? `<button onclick="openFirmInPlaybook('${escapeHtml(company.company_id)}','${escapeHtml(company.sector_focus_tags[0])}')" style="background:#fff;border:1px solid #6B2D5B;color:#6B2D5B;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;cursor:pointer">View in Playbook →</button>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost btn-sm" onclick="openMergeIntoPicker('${escapeHtml(company.company_id)}', '${escapeHtml(company.name).replace(/'/g, "\\'")}')">Merge into…</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditCompanyForm('${escapeHtml(company.company_id)}')">Edit</button>
        </div>
      </div>

      ${company.description ? `
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Description</div>
        <div style="font-size:13px;color:#444;line-height:1.6">${escapeHtml(company.description)}</div>
      </div>` : ''}

      <div style="display:grid;grid-template-columns:${isPE ? '1fr 1fr' : '1fr'};gap:16px;margin-bottom:24px">
        ${isPE ? `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Firm Details</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            ${company.entity_type ? `<div><span style="color:#888">Type:</span> ${escapeHtml(company.entity_type)}</div>` : ''}
            ${company.year_founded ? `<div><span style="color:#888">Founded:</span> ${escapeHtml(String(company.year_founded))}</div>` : ''}
            ${company.investment_professionals ? `<div><span style="color:#888">Investment Pros:</span> ${escapeHtml(String(company.investment_professionals))}</div>` : ''}
            ${company.preferred_geography ? `<div><span style="color:#888">Geography:</span> ${escapeHtml(company.preferred_geography)}</div>` : ''}
            ${company.preferred_ebitda_min || company.preferred_ebitda_max ? `<div><span style="color:#888">EBITDA:</span> $${escapeHtml(String(company.preferred_ebitda_min||''))}M – $${escapeHtml(String(company.preferred_ebitda_max||''))}M</div>` : ''}
            ${company.active_portfolio_count ? `<div><span style="color:#888">Portfolio Cos:</span> ${escapeHtml(String(company.active_portfolio_count))}</div>` : ''}
          </div>
        </div>
        ${(company.last_fund_name || company.last_fund_size || company.last_fund_vintage) ? `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Latest Fund</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px">
            ${company.last_fund_name ? `<div><span style="color:#888">Fund:</span> ${escapeHtml(company.last_fund_name)}</div>` : ''}
            ${company.last_fund_size ? `<div><span style="color:#888">Size:</span> $${escapeHtml(String(company.last_fund_size))}M</div>` : ''}
            ${company.last_fund_vintage ? `<div><span style="color:#888">Vintage:</span> ${escapeHtml(String(company.last_fund_vintage))}</div>` : ''}
            ${company.dry_powder ? `<div><span style="color:#888">Dry Powder:</span> $${escapeHtml(String(company.dry_powder))}M</div>` : ''}
          </div>
        </div>` : `
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Sector Focus</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
            ${(company.sector_focus_tags || []).length
              ? company.sector_focus_tags.map(t => {
                  const s = CP_SECTORS.find(s => s.id === t);
                  return `<span style="background:#F3E8EF;color:#6B2D5B;padding:4px 12px;border-radius:10px;font-size:12px;font-weight:600">${s ? s.label : t}</span>`;
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
            ${company.revenue_tier ? `<div><span style="color:#888">Revenue Tier:</span> ${escapeHtml(company.revenue_tier)}</div>` : ''}
            ${company.ownership_type ? `<div><span style="color:#888">Ownership:</span> ${escapeHtml(company.ownership_type)}</div>` : ''}
            ${company.industry ? `<div><span style="color:#888">Industry:</span> ${escapeHtml(company.industry)}</div>` : ''}
            ${company.year_founded ? `<div><span style="color:#888">Founded:</span> ${escapeHtml(String(company.year_founded))}</div>` : ''}
            ${company.employee_count ? `<div><span style="color:#888">Employees:</span> ${escapeHtml(String(company.employee_count))}</div>` : ''}
            ${company.parent_company ? `<div><span style="color:#888">Parent Co:</span> ${escapeHtml(company.parent_company)}</div>` : ''}
            ${isPub && company.ticker ? `<div><span style="color:#888">Ticker:</span> <strong style="color:#1565c0">${escapeHtml(company.ticker)}</strong></div>` : ''}
          </div>
        </div>` : ''}
      </div>

      ${isPE && (company.sector_focus_tags || []).length && (company.last_fund_name || company.last_fund_size) ? `
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:10px">Sector Focus</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${company.sector_focus_tags.map(t => {
            const s = CP_SECTORS.find(s => s.id === t);
            return `<span style="background:#F3E8EF;color:#6B2D5B;padding:4px 12px;border-radius:10px;font-size:12px;font-weight:600">${s ? s.label : t}</span>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Aliases -->
      <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Also Known As</div>
        <div id="company-aliases-container">
          <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center" id="company-alias-tags">
            ${(company.aliases || []).map((a, i) => `<span style="background:#F3E8EF;color:#6B2D5B;padding:4px 10px;border-radius:10px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px">${escapeHtml(a)}<button onclick="removeCompanyAlias('${escapeHtml(company.company_id)}',${i})" style="background:none;border:none;cursor:pointer;color:#6B2D5B;font-size:12px;padding:0;line-height:1">&#10005;</button></span>`).join('')}
            <div style="display:inline-flex;gap:4px;align-items:center">
              <input type="text" id="new-alias-input" placeholder="Add alias..." style="padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;width:140px"
                onkeydown="if(event.key==='Enter'){event.preventDefault();addCompanyAlias('${escapeHtml(company.company_id)}');}">
              <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="addCompanyAlias('${escapeHtml(company.company_id)}')">Add</button>
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
          onblur="saveCompanyField('${escapeHtml(company.company_id)}', 'notes', this.value)">${escapeHtml(company.notes || '')}</textarea>
      </div>

      <div style="font-size:11px;color:#aaa;margin-bottom:40px">
        Added ${formatDate(company.date_added)}
        ${company.source ? ' &bull; Source: ' + escapeHtml(company.source) : ''}
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
    appAlert('Error saving: ' + err.message, { type: 'error' });
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
    appAlert('Error loading company: ' + err.message, { type: 'error' });
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
            <input id="cf-name" class="form-control" value="${escapeHtml(c.name||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">HQ</label>
            <input id="cf-hq" class="form-control" value="${escapeHtml(c.hq||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Website URL</label>
            <input id="cf-website" class="form-control" value="${escapeHtml(c.website_url||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Year Founded</label>
            <input id="cf-founded" class="form-control" type="number" value="${c.year_founded||''}">
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea id="cf-description" class="form-control" rows="2">${escapeHtml(c.description||'')}</textarea>
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
              <input id="cf-entity" class="form-control" value="${escapeHtml(c.entity_type||'')}">
            </div>
            <div class="form-group">
              <label class="form-label">Preferred Geography</label>
              <input id="cf-geo" class="form-control" value="${escapeHtml(c.preferred_geography||'')}">
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
              <input id="cf-industry" class="form-control" value="${escapeHtml(c.industry||'')}">
            </div>
            <div class="form-group" id="cf-ticker-group" style="display:none">
              <label class="form-label">Ticker Symbol</label>
              <input id="cf-ticker" class="form-control" value="${escapeHtml(c.ticker||'')}">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea id="cf-notes" class="form-control" rows="2">${escapeHtml(c.notes||'')}</textarea>
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
          <button class="btn btn-ghost" onclick="document.getElementById('cp-form-overlay').remove()">Cancel</button>
          ${isEdit ? `<button class="btn btn-danger btn-sm" onclick="_deleteCompany('${escapeHtml(c.company_id)}')">Delete</button>` : ''}
          <button class="btn btn-primary" onclick="_submitCompanyForm('${escapeHtml(c.company_id || '')}')">
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
  if (!name) { appAlert('Name is required.', { type: 'warning' }); return; }

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
    appAlert('Error saving company: ' + err.message, { type: 'error' });
  }
}

async function _deleteCompany(companyId) {
  if (!(await appConfirm('Delete this company from the pool? This cannot be undone.', { type: 'warning' }))) return;
  try {
    await api('DELETE', '/companies/' + companyId);
    document.getElementById('cp-form-overlay').remove();
    cpAllCompanies = cpAllCompanies.filter(c => c.company_id !== companyId);
    renderCompanyView();
  } catch (err) {
    appAlert('Error deleting: ' + err.message, { type: 'error' });
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
      appAlert('Alias already exists.', { type: 'warning' });
      return;
    }
    aliases.push(alias);
    await api('PUT', '/companies/' + companyId, { aliases });
    invalidateAliasCache();
    // Refresh the page
    openCompanyDetail(companyId);
  } catch (err) {
    appAlert('Error adding alias: ' + err.message, { type: 'error' });
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
    appAlert('Error removing alias: ' + err.message, { type: 'error' });
  }
}

// ── Merge & duplicate-review UI ──────────────────────────────────────────────

// Pretty-print a similarity score from pg_trgm (0..1) as a percentage.
function _fmtSim(sim) {
  return Math.round(Number(sim || 0) * 100) + '%';
}

// Generic full-screen modal. Returns the overlay element so the caller can
// query its inner nodes by id and close it (overlay.remove()).
function _openModal(innerHtml) {
  const overlay = document.createElement('div');
  overlay.className = 'cp-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding:60px 20px;overflow-y:auto';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:10px;max-width:760px;width:100%;box-shadow:0 12px 36px rgba(0,0,0,0.18);overflow:hidden">
      ${innerHtml}
    </div>`;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

// ── Merge target picker ──────────────────────────────────────────────────────
// Opens a modal that lets the user search the Company Pool for the canonical
// company to fold the duplicate into. On confirm, calls the merge endpoint.

async function openMergeIntoPicker(duplicateSlug, duplicateName) {
  const overlay = _openModal(`
    <div style="padding:20px 24px;border-bottom:1px solid #eee">
      <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:4px">Merge duplicate</div>
      <div style="font-size:16px;font-weight:700;color:#1a1a1a">${escapeHtml(duplicateName)}</div>
      <div style="font-size:13px;color:#666;margin-top:4px">Pick the canonical company to fold this record into. The duplicate's work history, aliases, sector tags, and search-coverage entries will be re-pointed; the duplicate's name will become an alias on the canonical.</div>
    </div>
    <div style="padding:16px 24px">
      <input type="text" id="mip-search" placeholder="Search for canonical company…" autocomplete="off"
             style="width:100%;padding:10px 14px;border:1px solid #ccc;border-radius:6px;font-size:14px;outline:none">
      <div id="mip-results" style="margin-top:12px;max-height:340px;overflow-y:auto;border:1px solid #eee;border-radius:6px;padding:6px;display:none"></div>
      <div id="mip-status" style="font-size:12px;color:#888;margin-top:10px">Type at least 2 characters to search.</div>
    </div>
    <div style="padding:14px 24px;border-top:1px solid #eee;display:flex;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" onclick="this.closest('.cp-modal-overlay').remove()">Cancel</button>
    </div>`);

  const search = overlay.querySelector('#mip-search');
  const results = overlay.querySelector('#mip-results');
  const status = overlay.querySelector('#mip-status');
  let timer = null;
  let lastQuery = '';

  search.focus();
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) {
      results.style.display = 'none';
      status.textContent = 'Type at least 2 characters to search.';
      return;
    }
    timer = setTimeout(async () => {
      lastQuery = q;
      status.textContent = 'Searching…';
      try {
        const data = await api('GET', `/companies?text=${encodeURIComponent(q)}&limit=20`);
        if (lastQuery !== q) return;
        const list = (data.companies || []).filter(c => c.company_id !== duplicateSlug);
        if (list.length === 0) {
          results.style.display = 'none';
          status.textContent = 'No matching companies.';
          return;
        }
        status.textContent = `${list.length} result${list.length === 1 ? '' : 's'}`;
        results.innerHTML = list.map(c => `
          <div class="mip-row" data-slug="${escapeHtml(c.company_id)}" data-name="${escapeHtml(c.name).replace(/"/g, '&quot;')}"
               style="padding:8px 10px;border-radius:5px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="min-width:0">
              <div style="font-weight:600;color:#1a1a1a;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name)}</div>
              <div style="font-size:11px;color:#888;margin-top:2px">${escapeHtml(c.company_type || 'Unclassified')}${c.hq ? ' · ' + escapeHtml(c.hq) : ''}</div>
            </div>
            <button class="btn btn-primary btn-sm" style="padding:4px 10px;font-size:11px">Merge into this</button>
          </div>
        `).join('');
        results.style.display = 'block';
        results.querySelectorAll('.mip-row').forEach(row => {
          const onPick = async () => {
            const targetSlug = row.dataset.slug;
            const targetName = row.dataset.name;
            if (!await appConfirm(
              `Merge "${duplicateName}" into "${targetName}"?\n\nThis cannot be undone. The duplicate row will be removed and its work history + sector/coverage entries will be re-pointed to the canonical.`,
              { type: 'warning' }
            )) return;
            overlay.remove();
            await _doMerge(duplicateSlug, targetSlug, targetName);
          };
          row.addEventListener('click', onPick);
          row.addEventListener('mouseenter', () => row.style.background = '#F8F4F7');
          row.addEventListener('mouseleave', () => row.style.background = '');
        });
      } catch (err) {
        status.textContent = 'Search failed: ' + err.message;
      }
    }, 200);
  });
}

async function _doMerge(duplicateSlug, canonicalSlug, canonicalName) {
  try {
    const result = await api('POST', `/companies/${encodeURIComponent(duplicateSlug)}/merge-into/${encodeURIComponent(canonicalSlug)}`, {});
    invalidateAliasCache();
    appAlert(
      `Merged into "${canonicalName}".${result.work_history_rows_updated ? ` (${result.work_history_rows_updated} work-history rows re-pointed)` : ''}`,
      { type: 'success' }
    );
    // Refresh the pool list
    await renderCompanies();
  } catch (err) {
    appAlert('Merge failed: ' + err.message, { type: 'error' });
  }
}

// ── Possible duplicates review ───────────────────────────────────────────────
// Side-by-side view of pairs the database flags as similar names. Each pair
// can be merged or dismissed.

async function openDuplicatesReview() {
  const overlay = _openModal(`
    <div style="padding:20px 24px;border-bottom:1px solid #eee">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;margin-bottom:4px">Possible duplicates</div>
          <div style="font-size:13px;color:#666">Companies whose names are at least 80% similar. Review each pair and either merge them or mark as not a duplicate.</div>
        </div>
        <button onclick="this.closest('.cp-modal-overlay').remove()" style="background:none;border:none;font-size:24px;color:#999;cursor:pointer;padding:0 4px">×</button>
      </div>
    </div>
    <div id="dup-list" style="padding:8px 24px 24px;max-height:60vh;overflow-y:auto">
      <div style="text-align:center;color:#888;padding:40px">Loading…</div>
    </div>`);

  await _renderDuplicatesList(overlay.querySelector('#dup-list'));
}

async function _renderDuplicatesList(container) {
  try {
    const data = await api('GET', '/companies/duplicates?limit=200');
    const pairs = data.pairs || [];
    if (pairs.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:#1B5E20;background:#E8F5E9;padding:24px;border-radius:8px;margin-top:12px">✓ No pairs above the similarity threshold. The Company Pool looks clean.</div>`;
      return;
    }
    container.innerHTML = pairs.map((p, i) => _renderDuplicatePair(p, i)).join('');
    pairs.forEach((p, i) => {
      const node = container.querySelector(`#dup-pair-${i}`);
      if (!node) return;
      node.querySelector('[data-act="merge-a-into-b"]').addEventListener('click', () => _confirmAndMergeFromPair(p.a_slug, p.a_name, p.b_slug, p.b_name, container));
      node.querySelector('[data-act="merge-b-into-a"]').addEventListener('click', () => _confirmAndMergeFromPair(p.b_slug, p.b_name, p.a_slug, p.a_name, container));
      node.querySelector('[data-act="ignore"]').addEventListener('click', () => _ignoreDuplicatePair(p.a_slug, p.b_slug, container));
    });
  } catch (err) {
    container.innerHTML = `<div class="error-banner">Failed to load duplicates: ${escapeHtml(err.message)}</div>`;
  }
}

function _renderDuplicatePair(p, i) {
  const sideHtml = (slug, name, type, hq, industry) => `
    <div style="flex:1;padding:12px;background:#fafafa;border:1px solid #eee;border-radius:6px;min-width:0">
      <div style="font-weight:700;color:#1a1a1a;font-size:14px;word-break:break-word">
        <a href="#" onclick="event.preventDefault(); event.stopPropagation(); document.querySelector('.cp-modal-overlay')?.remove(); openCompanyDetail('${escapeHtml(slug)}')"
           style="color:#6B2D5B;text-decoration:none">${escapeHtml(name)} ↗</a>
      </div>
      <div style="font-size:11px;color:#888;margin-top:4px">${escapeHtml(type || 'Unclassified')}${hq ? ' · ' + escapeHtml(hq) : ''}</div>
      ${industry ? `<div style="font-size:11px;color:#888;margin-top:2px">${escapeHtml(industry)}</div>` : ''}
    </div>`;

  return `
    <div id="dup-pair-${i}" style="border:1px solid #e0e0e0;border-radius:8px;padding:14px;margin-top:12px;background:#fff">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:11px;color:#888">Similarity: <b style="color:#8A6100">${_fmtSim(p.similarity)}</b></div>
        <button data-act="ignore" class="btn btn-ghost btn-sm" style="padding:3px 10px;font-size:11px">Not a duplicate</button>
      </div>
      <div style="display:flex;gap:10px;align-items:stretch">
        ${sideHtml(p.a_slug, p.a_name, p.a_type, p.a_hq, p.a_industry || p.a_industry_sector)}
        ${sideHtml(p.b_slug, p.b_name, p.b_type, p.b_hq, p.b_industry || p.b_industry_sector)}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end">
        <button data-act="merge-a-into-b" class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px">Merge ← left into right</button>
        <button data-act="merge-b-into-a" class="btn btn-ghost btn-sm" style="padding:4px 10px;font-size:11px">Merge right into left →</button>
      </div>
    </div>`;
}

async function _confirmAndMergeFromPair(dupSlug, dupName, canonSlug, canonName, container) {
  if (!await appConfirm(
    `Merge "${dupName}" into "${canonName}"?\n\nThis cannot be undone. The duplicate row will be removed; its work history + sector/coverage entries are re-pointed to the canonical.`,
    { type: 'warning' }
  )) return;
  try {
    const result = await api('POST', `/companies/${encodeURIComponent(dupSlug)}/merge-into/${encodeURIComponent(canonSlug)}`, {});
    invalidateAliasCache();
    appAlert(`Merged into "${canonName}".${result.work_history_rows_updated ? ` (${result.work_history_rows_updated} work-history rows re-pointed)` : ''}`, { type: 'success' });
    // Refresh the list inside the open modal and the pool count behind it.
    cpDuplicateCount = Math.max(0, cpDuplicateCount - 1);
    await _renderDuplicatesList(container);
    await renderCompanies();
    // Re-open the duplicates modal won't happen; renderCompanies redraws under it.
  } catch (err) {
    appAlert('Merge failed: ' + err.message, { type: 'error' });
  }
}

async function _ignoreDuplicatePair(aSlug, bSlug, container) {
  try {
    await api('POST', '/companies/duplicates/ignore', { a_slug: aSlug, b_slug: bSlug });
    cpDuplicateCount = Math.max(0, cpDuplicateCount - 1);
    await _renderDuplicatesList(container);
  } catch (err) {
    appAlert('Failed to dismiss: ' + err.message, { type: 'error' });
  }
}
