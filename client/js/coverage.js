/* ── Lancor Search OS — coverage.js ─────────────────────────────────────────
   Session 4: Sourcing Coverage module
   All functions called from searches.js or via inline onclick handlers.
   renderCoverageTabHTML() returns an HTML string (no DOM manipulation).
   All mutation functions are async and manipulate DOM after saving.
   ──────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── Type-ahead helper ─────────────────────────────────────────────────────────

let _taCache = null;
let _taDebounce = null;

async function loadCompanyPool() {
  if (!_taCache) {
    const resp = await api('GET', '/companies');
    _taCache = resp.companies || [];
  }
  return _taCache;
}

function setupTypeahead(inputId, opts) {
  // opts: { filterType: 'PE Firm'|'company'|null, onSelect: fn(company), onAddNew: fn(name) }
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrap = input.parentElement;
  wrap.classList.add('typeahead-wrap');

  let dropdown = null;
  let selectedIdx = -1;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    selectedIdx = -1;
  }

  async function showResults(query) {
    if (!query || query.length < 2) { removeDropdown(); return; }
    const pool = await loadCompanyPool();
    const q = query.toLowerCase();
    let matches = pool.filter(c => {
      const nameMatch = (c.name || '').toLowerCase().includes(q);
      const typeMatch = !opts.filterType || (c.company_type || '').toLowerCase().includes(opts.filterType.toLowerCase());
      return nameMatch && typeMatch;
    }).slice(0, 8);

    removeDropdown();
    dropdown = document.createElement('div');
    dropdown.className = 'typeahead-dropdown';

    if (matches.length > 0) {
      matches.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'typeahead-item';
        item.innerHTML = `<span>${escCov(c.name)}</span><span class="ta-meta">${escCov(c.hq || c.company_type || '')}</span>`;
        item.addEventListener('click', () => {
          removeDropdown();
          if (opts.onSelect) opts.onSelect(c);
        });
        dropdown.appendChild(item);
      });
    }

    // Always show "Add new" option at bottom
    const addItem = document.createElement('div');
    addItem.className = 'typeahead-add';
    addItem.textContent = '+ Add "' + query + '" as new';
    addItem.addEventListener('click', () => {
      removeDropdown();
      if (opts.onAddNew) opts.onAddNew(query);
    });
    dropdown.appendChild(addItem);

    wrap.appendChild(dropdown);
  }

  input.addEventListener('input', () => {
    clearTimeout(_taDebounce);
    _taDebounce = setTimeout(() => showResults(input.value.trim()), 200);
  });

  input.addEventListener('keydown', (e) => {
    if (!dropdown) return;
    const items = dropdown.querySelectorAll('.typeahead-item, .typeahead-add');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = Math.min(selectedIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === selectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = Math.max(selectedIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === selectedIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && items[selectedIdx]) items[selectedIdx].click();
    } else if (e.key === 'Escape') {
      removeDropdown();
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) removeDropdown();
  }, { capture: true });
}

// ── Module-level state ────────────────────────────────────────────────────────

let coverageSubTab = 'pe-firms'; // 'pe-firms' | 'companies'
let coverageFilters = {
  size_tier: 'all',
  revenue_tier: 'all',
  text: ''
};
let openAccordionId = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function covSlugify(s) {
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

function getReviewStats(entity) {
  const roster = entity.roster || [];
  if (roster.length === 0) return { relevant: 0, notRelevant: 0, pending: 0, total: 0, pct: 0 };
  const relevant = roster.filter(p => p.review_status === 'relevant' || (p.reviewed && p.review_status !== 'not_relevant')).length;
  const notRelevant = roster.filter(p => p.review_status === 'not_relevant').length;
  const pending = roster.length - relevant - notRelevant;
  const pct = Math.round(((relevant + notRelevant) / roster.length) * 100);
  return { relevant, notRelevant, pending, total: roster.length, pct };
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

function reviewedBar(entity) {
  const { relevant, notRelevant, pending, total } = getReviewStats(entity);
  if (total === 0) return `<span style="font-size:11px;color:#bbb">—</span>`;
  const relPct = Math.round((relevant / total) * 100);
  const nrPct = Math.round((notRelevant / total) * 100);
  return `<div style="display:flex;align-items:center;gap:6px">
    <div style="width:80px;height:8px;background:#e8e8e8;border-radius:4px;overflow:hidden;display:flex">
      <div style="width:${relPct}%;background:#4caf50;transition:width 0.2s"></div>
      <div style="width:${nrPct}%;background:#ef5350;transition:width 0.2s"></div>
    </div>
    <span style="font-size:10px;display:inline-flex;align-items:center;gap:3px">
      <span style="color:#4caf50;font-weight:700">${relevant}</span>
      <span style="color:#bbb">/</span>
      <span style="color:#ef5350;font-weight:700">${notRelevant}</span>
      <span style="color:#bbb">/</span>
      <span style="color:#999">${pending}</span>
    </span>
  </div>`;
}

// ROSTER_STATUSES is defined in playbooks.js (loaded before this file)

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
  const stats = getReviewStats({ roster });

  // Sort: pending first, then relevant, then not-relevant
  const sortOrder = { 'undefined': 0, 'null': 0, 'relevant': 1, 'not_relevant': 2 };
  const sorted = [...roster].sort((a, b) => {
    const sa = sortOrder[String(a.review_status)] ?? 0;
    const sb = sortOrder[String(b.review_status)] ?? 0;
    return sa - sb;
  });

  const rows = sorted.map(p => {
    const status = p.review_status; // 'relevant' | 'not_relevant' | null/undefined
    const isRelevant = status === 'relevant';
    const isNotRelevant = status === 'not_relevant';
    const isPending = !isRelevant && !isNotRelevant;

    const linkedinBtn = p.linkedin_url
      ? `<a href="${escCov(p.linkedin_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#0077B5;border-radius:4px;color:#fff;text-decoration:none;flex-shrink:0" title="Open LinkedIn"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>`
      : `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#eee;border-radius:4px;color:#bbb;font-size:10px" title="No LinkedIn">—</span>`;

    // Row styling based on status
    let rowStyle = 'border-bottom:1px solid #f0f0f0;';
    let nameStyle = 'font-weight:600;font-size:13px;';
    if (isRelevant) {
      rowStyle += 'background:#f1f8e9;';
      nameStyle += 'color:#2e7d32;';
    } else if (isNotRelevant) {
      rowStyle += 'background:#fafafa;';
      nameStyle += 'color:#bbb;text-decoration:line-through;';
    } else {
      nameStyle += 'color:#1a1a1a;';
    }

    // ✓ and ✗ buttons
    const checkBtn = `<button onclick="setReviewStatus('${escCov(searchId)}','${type}','${escCov(entityId)}','${escCov(p.candidate_id)}','relevant')" title="Relevant" style="width:28px;height:28px;border-radius:6px;border:${isRelevant ? '2px solid #4caf50' : '1.5px solid #ccc'};background:${isRelevant ? '#e8f5e9' : '#fff'};color:${isRelevant ? '#4caf50' : '#bbb'};cursor:pointer;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s">&#10003;</button>`;
    const xBtn = `<button onclick="setReviewStatus('${escCov(searchId)}','${type}','${escCov(entityId)}','${escCov(p.candidate_id)}','not_relevant')" title="Not relevant" style="width:28px;height:28px;border-radius:6px;border:${isNotRelevant ? '2px solid #ef5350' : '1.5px solid #ccc'};background:${isNotRelevant ? '#ffebee' : '#fff'};color:${isNotRelevant ? '#ef5350' : '#bbb'};cursor:pointer;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s">&#10005;</button>`;

    return `<tr style="${rowStyle}">
      <td style="padding:6px 8px;width:70px">
        <div style="display:flex;gap:4px">${checkBtn}${xBtn}</div>
      </td>
      <td style="padding:6px 8px;width:30px">${linkedinBtn}</td>
      <td style="padding:6px 8px">
        <div style="${nameStyle}"><span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${escCov(p.candidate_id)}')" style="color:inherit">${escCov(p.name)}</span></div>
      </td>
      <td style="padding:6px 8px;font-size:12px;color:#666">${escCov(p.title || '')}</td>
      <td style="padding:6px 8px">${rosterStatusSelect(entityId, p.candidate_id, p.roster_status, searchId, type)}</td>
    </tr>`;
  }).join('');

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
      <div style="display:flex;align-items:center;gap:12px;font-size:12px">
        <span style="color:#4caf50;font-weight:700">&#10003; ${stats.relevant} relevant</span>
        <span style="color:#ef5350;font-weight:700">&#10005; ${stats.notRelevant} not relevant</span>
        <span style="color:#999">${stats.pending} pending</span>
      </div>
    </div>
    <table class="roster-table" style="width:100%">
      <thead><tr>
        <th style="width:70px;font-size:10px;padding:4px 8px">Review</th>
        <th style="width:30px;padding:4px"></th>
        <th style="font-size:11px;padding:4px 8px">Name</th>
        <th style="font-size:11px;padding:4px 8px">Title</th>
        <th style="font-size:11px;padding:4px 8px">Status</th>
      </tr></thead>
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
    <td colspan="7">
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
    const rosterCount = (f.roster || []).length;
    const firmRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escCov(f.firm_id)}" onclick="toggleCoverageAccordion('${escCov(searchId)}','pe_firms','${escCov(f.firm_id)}')">
      <td><strong>${escCov(f.name)}</strong></td>
      <td>${escCov(f.hq || '—')}</td>
      <td>${escCov(f.size_tier || '—')}</td>
      <td>${badge}</td>
      <td style="text-align:center"><span style="font-size:12px;color:#555">${rosterCount}</span></td>
      <td id="revbar-${escCov(f.firm_id)}">${reviewedBar(f)}</td>
      <td id="covbar-${escCov(f.firm_id)}">${coverageBar(pct, manual)}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(f, f.firm_id, searchId, 'pe_firms') : `<tr class="accordion-tr" id="acc-${escCov(f.firm_id)}" style="display:none"><td colspan="7"></td></tr>`;
    return [firmRow, accRow];
  });

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th>Firm Name</th>
      <th>HQ</th>
      <th>Size Tier</th>
      <th>Search-Specific</th>
      <th style="text-align:center">People</th>
      <th>Reviewed</th>
      <th>Coverage</th>
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
    const rosterCount = (c.roster || []).length;
    const compRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escCov(c.company_id)}" onclick="toggleCoverageAccordion('${escCov(searchId)}','companies','${escCov(c.company_id)}')">
      <td><strong>${escCov(c.name)}</strong></td>
      <td>${escCov(c.hq || '—')}</td>
      <td>${escCov(c.revenue_tier || '—')}</td>
      <td>${badge}</td>
      <td style="text-align:center"><span style="font-size:12px;color:#555">${rosterCount}</span></td>
      <td id="revbar-${escCov(c.company_id)}">${reviewedBar(c)}</td>
      <td id="covbar-${escCov(c.company_id)}">${coverageBar(pct, manual)}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(c, c.company_id, searchId, 'companies') : `<tr class="accordion-tr" id="acc-${escCov(c.company_id)}" style="display:none"><td colspan="7"></td></tr>`;
    return [compRow, accRow];
  });

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th>Company Name</th>
      <th>HQ</th>
      <th>Revenue Tier</th>
      <th>Search-Specific</th>
      <th style="text-align:center">People</th>
      <th>Reviewed</th>
      <th>Coverage</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`;
}

// ── Main render entry point ───────────────────────────────────────────────────

async function autoLinkCandidatesToRosters(search) {
  try {
    const poolResp = await api('GET', '/candidates');
    const candidates = poolResp.candidates || [];
    if (candidates.length === 0) return false;

    const coverage = search.sourcing_coverage;
    if (!coverage) return false;

    let changed = false;

    // Match PE firms using fuzzy firm name matching
    (coverage.pe_firms || []).forEach(firm => {
      const matched = candidates.filter(c => firmNamesMatch(c.current_firm, firm.name));
      if (matched.length === 0) return;
      if (!firm.roster) firm.roster = [];
      matched.forEach(c => {
        const alreadyOnRoster = firm.roster.some(r =>
          r.candidate_id === c.candidate_id ||
          (r.name || '').toLowerCase() === (c.name || '').toLowerCase()
        );
        if (!alreadyOnRoster) {
          firm.roster.push({
            candidate_id: c.candidate_id,
            name: c.name,
            title: c.current_title || '',
            linkedin_url: c.linkedin_url || '',
            roster_status: 'Identified',
            source: 'auto-linked'
          });
          changed = true;
        }
      });
    });

    // Match companies using fuzzy firm name matching
    (coverage.companies || []).forEach(co => {
      const matched = candidates.filter(c => firmNamesMatch(c.current_firm, co.name));
      if (matched.length === 0) return;
      if (!co.roster) co.roster = [];
      matched.forEach(c => {
        const alreadyOnRoster = co.roster.some(r =>
          r.candidate_id === c.candidate_id ||
          (r.name || '').toLowerCase() === (c.name || '').toLowerCase()
        );
        if (!alreadyOnRoster) {
          co.roster.push({
            candidate_id: c.candidate_id,
            name: c.name,
            title: c.current_title || '',
            linkedin_url: c.linkedin_url || '',
            roster_status: 'Identified',
            source: 'auto-linked'
          });
          changed = true;
        }
      });
    });

    // Save if any new people were linked
    if (changed) {
      await api('PUT', '/searches/' + search.search_id, { sourcing_coverage: coverage });
    }
    return changed;
  } catch (e) {
    console.error('autoLinkCandidatesToRosters error:', e);
    return false;
  }
}

function renderCoverageTabHTML(search) {
  // Reset state when tab first loads
  coverageSubTab = 'pe-firms';
  coverageFilters = { size_tier: 'all', revenue_tier: 'all', text: '' };
  openAccordionId = null;

  const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
  const firms = coverage.pe_firms || [];
  const companies = coverage.companies || [];
  const searchId = search.search_id;

  // Auto-link candidates from pool to rosters (async, re-renders when done)
  autoLinkCandidatesToRosters(search).then(changed => {
    if (changed) {
      const tableEl = document.getElementById('coverage-table');
      if (tableEl) {
        const freshCoverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
        if (coverageSubTab === 'pe-firms') {
          tableEl.innerHTML = buildPEFirmsTableHTML(freshCoverage.pe_firms || [], searchId);
        } else {
          tableEl.innerHTML = buildCompaniesTableHTML(freshCoverage.companies || [], searchId);
        }
        // Update counts
        const peBtn = document.getElementById('cov-tab-pe');
        const coBtn = document.getElementById('cov-tab-companies');
        if (peBtn) peBtn.textContent = 'PE Firms (' + (freshCoverage.pe_firms || []).length + ')';
        if (coBtn) coBtn.textContent = 'Target Companies (' + (freshCoverage.companies || []).length + ')';
      }
    }
  });

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

  const candidate_id = covSlugify(name + '-' + entityId);

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
  if (barEl) {
    const { pct, manual } = getCoveragePct(entity, type);
    barEl.innerHTML = coverageBar(pct, manual);
  }
  const revEl = document.getElementById('revbar-' + entityId);
  if (revEl) revEl.innerHTML = reviewedBar(entity);
}

async function setReviewStatus(searchId, type, entityId, candidateId, newStatus) {
  try {
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    const person = (entity.roster || []).find(p => p.candidate_id === candidateId);
    if (!person) return;
    // Toggle: if already set to this status, clear it back to pending
    if (person.review_status === newStatus) {
      person.review_status = null;
      person.reviewed = false;
      person.reviewed_date = null;
    } else {
      person.review_status = newStatus;
      person.reviewed = true;
      person.reviewed_date = todayISO();
    }
    search.sourcing_coverage = coverage;
    await api('PUT', '/searches/' + searchId, search);
    const rosterEl = document.getElementById('roster-section-' + entityId);
    if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type);
    refreshCoverageBar(entity, entityId, type);
  } catch (e) {
    console.error('setReviewStatus error:', e);
  }
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
        <div id="ta-firm-wrap">
          <input type="text" id="modal-firm-name" autocomplete="off" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="Start typing to search database..." />
        </div>
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
  setupTypeahead('modal-firm-name', {
    filterType: 'PE Firm',
    onSelect: function(company) {
      document.getElementById('modal-firm-name').value = company.name;
      if (company.hq) document.getElementById('modal-firm-hq').value = company.hq;
      if (company.size_tier) document.getElementById('modal-firm-size').value = company.size_tier;
      if (company.strategy) document.getElementById('modal-firm-strategy').value = company.strategy;
      const sectors = (company.sector_focus_tags || []).map(id => {
        const map = { 'industrials':'Industrials','technology-software':'Technology','healthcare':'Healthcare','financial-services':'Financial Services','consumer':'Consumer','business-services':'Business Services' };
        return map[id] || id;
      }).join(', ');
      if (sectors) document.getElementById('modal-firm-sector').value = sectors;
    },
    onAddNew: function(name) {
      document.getElementById('modal-firm-name').value = name;
    }
  });
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

  const firm_id = covSlugify(name);
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
    // Add to company pool if not already there
    const pool = await loadCompanyPool();
    const exists = pool.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      await api('POST', '/companies', { name, company_type: 'PE Firm', hq, size_tier, strategy });
      _taCache = null; // invalidate cache
    }

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
        <div id="ta-co-wrap">
          <input type="text" id="modal-co-name" autocomplete="off" style="width:100%;margin-top:4px;padding:8px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px" placeholder="Start typing to search database..." />
        </div>
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
  setupTypeahead('modal-co-name', {
    filterType: null, // search all company types
    onSelect: function(company) {
      document.getElementById('modal-co-name').value = company.name;
      if (company.hq) document.getElementById('modal-co-hq').value = company.hq;
      if (company.revenue_tier) document.getElementById('modal-co-rev').value = company.revenue_tier;
      if (company.ownership_type) document.getElementById('modal-co-ownership').value = company.ownership_type;
    },
    onAddNew: function(name) {
      document.getElementById('modal-co-name').value = name;
    }
  });
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

  const company_id = covSlugify(name);
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
    // Add to company pool if not already there
    const pool = await loadCompanyPool();
    const exists = pool.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists) {
      await api('POST', '/companies', { name, company_type: 'Private Company', hq, revenue_tier, ownership_type });
      _taCache = null; // invalidate cache
    }

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
