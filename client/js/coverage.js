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
    const resp = await api('GET', '/companies?limit=500');
    _taCache = resp.companies || [];
  }
  return _taCache;
}

/** Search companies server-side for typeahead (bypasses loading overlay) */
async function searchCompanies(query, filterType) {
  const params = new URLSearchParams({ text: query, limit: '8' });
  if (filterType) params.set('type', filterType);
  const res = await fetch('/api/companies?' + params.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return data.companies || [];
}

function setupTypeahead(inputId, opts) {
  // opts: { filterType: 'PE Firm'|'company'|null, onSelect: fn(company), onAddNew: fn(name) }
  const input = document.getElementById(inputId);
  if (!input) return;
  const wrap = input.parentElement;
  wrap.classList.add('typeahead-wrap');

  let dropdown = null;
  let selectedIdx = -1;
  let _taSearchTimer = null;

  function removeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    selectedIdx = -1;
  }

  async function showResults(query) {
    if (!query || query.length < 2) { removeDropdown(); return; }
    const matches = await searchCompanies(query, opts.filterType || null);

    removeDropdown();
    dropdown = document.createElement('div');
    dropdown.className = 'typeahead-dropdown';

    if (matches.length > 0) {
      matches.forEach((c, i) => {
        const item = document.createElement('div');
        item.className = 'typeahead-item';
        item.innerHTML = `<span>${escapeHtml(c.name)}</span><span class="ta-meta">${escapeHtml(c.hq || c.company_type || '')}</span>`;
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

let coverageSubTab = 'pe-firms'; // 'pe-firms' | 'companies' | 'playbook'
let coverageFilters = {
  size_tier: 'all',
  revenue_tier: 'all',
  text: ''
};
let coverageSortField = 'name';
let coverageSortAsc = true;
const SIZE_TIER_ORDER = { 'Mega': 0, 'Large': 1, 'Upper Middle Market': 2, 'Middle Market': 3, 'Lower Middle Market': 4, 'Small': 5 };
let openAccordionId = null;

function scrapeFreshnessIcon(lastScraped) {
  if (!lastScraped) return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c62828;vertical-align:middle;margin-left:2px" title="Never scraped"></span>';
  const daysAgo = Math.floor((Date.now() - new Date(lastScraped).getTime()) / 86400000);
  if (daysAgo <= 365) return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e7d32;vertical-align:middle;margin-left:2px" title="Scraped ' + daysAgo + 'd ago"></span>';
  if (daysAgo <= 730) return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ff9800;vertical-align:middle;margin-left:2px" title="Scraped ' + daysAgo + 'd ago"></span>';
  return '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#c62828;vertical-align:middle;margin-left:2px" title="Scraped ' + daysAgo + 'd ago"></span>';
}

function sortCoverageFirms(firms, type) {
  const dir = coverageSortAsc ? 1 : -1;
  return [...firms].sort((a, b) => {
    // Archived/completed always last
    if (a.archived_complete && !b.archived_complete) return 1;
    if (!a.archived_complete && b.archived_complete) return -1;

    let va, vb;
    switch (coverageSortField) {
      case 'name':
        va = (a.name || '').toLowerCase();
        vb = (b.name || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      case 'hq':
        va = (a.hq || '').toLowerCase();
        vb = (b.hq || '').toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      case 'size_tier':
        va = SIZE_TIER_ORDER[a.size_tier] ?? 99;
        vb = SIZE_TIER_ORDER[b.size_tier] ?? 99;
        return (va - vb) * dir;
      case 'people':
        va = (a.roster || []).length;
        vb = (b.roster || []).length;
        return (va - vb) * dir;
      case 'coverage':
        va = getCoveragePct(a, type).pct;
        vb = getCoveragePct(b, type).pct;
        return (va - vb) * dir;
      default:
        return 0;
    }
  });
}

function toggleCoverageSort(field, searchId) {
  if (coverageSortField === field) {
    coverageSortAsc = !coverageSortAsc;
  } else {
    coverageSortField = field;
    coverageSortAsc = true;
  }
  applyCoverageFilters(searchId);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function coverageBar(pct, manual_complete, entity) {
  // If verified/complete, show freshness + checkmark instead of bar
  if (manual_complete && entity && entity.last_verified) {
    const daysAgo = Math.floor((Date.now() - new Date(entity.last_verified).getTime()) / 86400000);
    const freshness = daysAgo <= 365 ? { color: '#2e7d32', label: 'Fresh', bg: '#e8f5e9' }
                    : daysAgo <= 730 ? { color: '#e65100', label: 'Review', bg: '#fff3e0' }
                    : { color: '#c62828', label: 'Stale', bg: '#ffebee' };
    return `<div style="display:flex;align-items:center;gap:6px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${freshness.bg};color:${freshness.color};font-size:13px;font-weight:700">&#10003;</span>
      <span style="font-size:11px;font-weight:700;color:${freshness.color}">${freshness.label}</span>
    </div>`;
  }
  if (manual_complete) {
    return `<div style="display:flex;align-items:center;gap:6px">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#F3E8EF;color:#6B2D5B;font-size:13px;font-weight:700">&#10003;</span>
      <span style="font-size:11px;font-weight:700;color:#6B2D5B">Complete</span>
    </div>`;
  }
  let color, label;
  if (pct === 0)       { color = '#bdbdbd'; label = 'Unsearched'; }
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
    `<option value="${escapeHtml(s)}" ${s === currentStatus ? 'selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');
  return `<select class="roster-status-select" onchange="updateRosterPersonStatus('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}','${escapeHtml(candidateId)}',this.value)">${opts}</select>`;
}

function addPersonFormHTML(entityId, searchId, type) {
  const statusOpts = ROSTER_STATUSES.map(s =>
    `<option value="${escapeHtml(s)}" ${s === 'Identified' ? 'selected' : ''}>${escapeHtml(s)}</option>`
  ).join('');
  return `
  <div class="add-person-form" id="add-form-${escapeHtml(entityId)}">
    <input type="text" id="add-name-${escapeHtml(entityId)}" placeholder="Name (required)" />
    <input type="text" id="add-title-${escapeHtml(entityId)}" placeholder="Title" />
    <input type="text" id="add-linkedin-${escapeHtml(entityId)}" placeholder="LinkedIn URL" style="min-width:160px" />
    <button class="btn btn-primary btn-sm" onclick="addRosterPerson('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}')">Add</button>
  </div>`;
}

function overrideSectionHTML(entity, entityId, searchId, type) {
  const isComplete = entity.manual_complete;
  const note = escapeHtml(entity.manual_complete_note || '');
  const lastVerified = entity.last_verified;
  const verifiedBy = entity.verified_by || '';

  let verifiedDisplay;
  if (lastVerified) {
    const daysAgo = Math.floor((Date.now() - new Date(lastVerified).getTime()) / 86400000);
    const freshness = daysAgo <= 365 ? { color: '#2e7d32', label: 'Fresh' }
                    : daysAgo <= 730 ? { color: '#ff9800', label: 'Review soon' }
                    : { color: '#c62828', label: 'Stale' };
    verifiedDisplay = `<span style="font-size:12px;color:${freshness.color};font-weight:600">${freshness.label}</span>
      <span style="font-size:11px;color:#888;margin-left:6px">Last verified: ${escapeHtml(lastVerified)}${verifiedBy ? ' by ' + escapeHtml(verifiedBy) : ''} (${daysAgo}d ago)</span>`;
  } else {
    verifiedDisplay = `<span style="font-size:12px;color:#bbb">Never verified</span>`;
  }

  const isManualComplete = entity.manual_complete;
  const resetLink = isManualComplete
    ? `<span style="font-size:11px;color:#999;cursor:pointer;text-decoration:underline;margin-left:8px" onclick="resetVerification('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}')">Reset verification</span>`
    : '';

  return `
  <div class="override-section">
    <strong style="font-size:13px;display:block;margin-bottom:10px;text-decoration:none">Coverage Verification</strong>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
      ${verifiedDisplay}${resetLink}
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="override-note-${escapeHtml(entityId)}" value="${note}" placeholder="Note (optional)" style="padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;flex:1;min-width:160px" />
      <button class="btn btn-primary btn-sm" onclick="verifyCoverage('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}')">${isManualComplete ? '&#10003; Verified' : 'Verify &amp; Mark Complete'}</button>
    </div>
  </div>`;
}

function rosterTableHTML(roster, entityId, searchId, type) {
  if (!roster || roster.length === 0) {
    return `<p style="font-size:13px;color:#888;margin-bottom:8px">No people on roster yet.</p>`;
  }
  const stats = getReviewStats({ roster });

  // Sort: pending first, then relevant, then not-relevant; alphabetical within each group
  const sortOrder = { 'undefined': 0, 'null': 0, 'relevant': 1, 'not_relevant': 2 };
  const sorted = [...roster].sort((a, b) => {
    const sa = sortOrder[String(a.review_status)] ?? 0;
    const sb = sortOrder[String(b.review_status)] ?? 0;
    if (sa !== sb) return sa - sb;
    return (a.name || '').localeCompare(b.name || '');
  });

  const rows = sorted.map(p => {
    const status = p.review_status; // 'relevant' | 'not_relevant' | null/undefined
    const isRelevant = status === 'relevant';
    const isNotRelevant = status === 'not_relevant';
    const isPending = !isRelevant && !isNotRelevant;

    const linkedinBtn = p.linkedin_url
      ? `<a href="${escapeHtml(p.linkedin_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#0077B5;border-radius:4px;color:#fff;text-decoration:none;flex-shrink:0" title="Open LinkedIn"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a>`
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
    const checkBtn = `<button onclick="setReviewStatus('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}','${escapeHtml(p.candidate_id)}','relevant')" title="Relevant" style="width:28px;height:28px;border-radius:6px;border:${isRelevant ? '2px solid #4caf50' : '1.5px solid #ccc'};background:${isRelevant ? '#e8f5e9' : '#fff'};color:${isRelevant ? '#4caf50' : '#bbb'};cursor:pointer;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s">&#10003;</button>`;
    const xBtn = `<button onclick="setReviewStatus('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}','${escapeHtml(p.candidate_id)}','not_relevant')" title="Not relevant" style="width:28px;height:28px;border-radius:6px;border:${isNotRelevant ? '2px solid #ef5350' : '1.5px solid #ccc'};background:${isNotRelevant ? '#ffebee' : '#fff'};color:${isNotRelevant ? '#ef5350' : '#bbb'};cursor:pointer;font-size:14px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;transition:all 0.15s">&#10005;</button>`;

    return `<tr style="${rowStyle}">
      <td style="padding:6px 8px;width:70px">
        <div style="display:flex;gap:4px">${checkBtn}${xBtn}</div>
      </td>
      <td style="padding:6px 8px;width:30px">${linkedinBtn}</td>
      <td style="padding:6px 8px">
        <div style="${nameStyle}"><span class="cand-name-link" onclick="event.stopPropagation();openCandidatePanel('${escapeHtml(p.candidate_id)}')" style="color:inherit">${escapeHtml(p.name)}</span></div>
      </td>
      <td style="padding:6px 8px;font-size:12px;color:#666">${escapeHtml(p.title || '')}</td>
      <td style="padding:6px 8px;font-size:11px;color:#888">${escapeHtml(p.location || '')} ${scrapeFreshnessIcon(p.last_scraped)}</td>
      <td style="padding:6px 8px;width:36px">
        <button onclick="event.stopPropagation();openAddToPipelineModal({candidate_id:'${escapeHtml(p.candidate_id).replace(/'/g,"\\'")}',name:'${escapeHtml(p.name).replace(/'/g,"\\'")}',current_title:'${escapeHtml(p.title||'').replace(/'/g,"\\'")}',current_firm:'',location:'',linkedin_url:'${escapeHtml(p.linkedin_url||'').replace(/'/g,"\\'")}',archetype:''},{preSelectSearchId:'${escapeHtml(searchId)}',source:'Sourcing Coverage'})" title="Add to Pipeline" style="background:#6B2D5B;color:#fff;border:none;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;justify-content:center">&#8594;</button>
      </td>
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
        <th style="font-size:11px;padding:4px 8px">Location</th>
        <th style="width:36px"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function accordionHTML(entity, entityId, searchId, type) {
  const roster = entity.roster || [];
  const archiveBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <button class="btn btn-ghost btn-sm" style="color:#888;font-size:11px" onclick="event.stopPropagation();toggleArchiveComplete('${escapeHtml(searchId)}','${type}','${escapeHtml(entityId)}')">${entity.archived_complete ? '&#9664; Restore to Active' : '&#10003; Move to Completed'}</button>
  </div>`;

  return `<tr class="accordion-tr" id="acc-${escapeHtml(entityId)}">
    <td colspan="6">
      <div class="accordion-inner">
        ${archiveBtn}
        <div id="roster-section-${escapeHtml(entityId)}">
          ${rosterTableHTML(roster, entityId, searchId, type)}
        </div>
        <div style="margin-top:4px">
          <strong style="font-size:12px;color:#666;text-transform:uppercase;letter-spacing:0.5px">Add Person</strong>
          ${addPersonFormHTML(entityId, searchId, type)}
        </div>
        ${overrideSectionHTML(entity, entityId, searchId, type)}
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

  // Sort using the current sort state
  const sorted = sortCoverageFirms(filtered, 'pe_firms');

  const sortArrow = (field) => coverageSortField === field ? (coverageSortAsc ? ' ▲' : ' ▼') : '';
  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap';

  const filterBar = `
  <div class="filter-bar" id="coverage-filters" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <select id="cov-filter-size" onchange="applyCoverageFilters('${escapeHtml(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      <option value="all" ${coverageFilters.size_tier === 'all' ? 'selected' : ''}>All Size Tiers</option>
      <option value="Mega" ${coverageFilters.size_tier === 'Mega' ? 'selected' : ''}>Mega</option>
      <option value="Large" ${coverageFilters.size_tier === 'Large' ? 'selected' : ''}>Large</option>
      <option value="Middle Market" ${coverageFilters.size_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
      <option value="Lower Middle Market" ${coverageFilters.size_tier === 'Lower Middle Market' ? 'selected' : ''}>Lower Middle Market</option>
    </select>
    <input type="text" id="cov-filter-text" value="${escapeHtml(coverageFilters.text)}" placeholder="Search firm name..." oninput="applyCoverageFilters('${escapeHtml(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;min-width:180px" />
    <span style="font-size:12px;color:#888">${sorted.length} firm${sorted.length !== 1 ? 's' : ''}</span>
  </div>`;

  if (filtered.length === 0) {
    return filterBar + `<div style="padding:32px;text-align:center;color:#888;font-size:14px">No PE firms loaded — use "Add PE Firm" below to get started.</div>`;
  }

  function buildFirmRow(f) {
    const { pct, manual } = getCoveragePct(f, 'pe_firms');
    const isOpen = openAccordionId === f.firm_id;
    const rosterCount = (f.roster || []).length;
    const webUrl = f.website_url || '';
    const firmWebsite = webUrl ? `<a href="${escapeHtml(webUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0077B5;font-size:11px;margin-left:6px" title="Company website">&#127760;</a>` : '';
    const firmRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escapeHtml(f.firm_id)}" onclick="toggleCoverageAccordion('${escapeHtml(searchId)}','pe_firms','${escapeHtml(f.firm_id)}')">
      <td><strong>${escapeHtml(f.name)}</strong>${firmWebsite}</td>
      <td>${escapeHtml(f.hq || '—')}</td>
      <td>${escapeHtml(f.size_tier || '—')}</td>
      <td style="text-align:center"><span style="font-size:12px;color:#555">${rosterCount}</span></td>
      <td id="revbar-${escapeHtml(f.firm_id)}">${reviewedBar(f)}</td>
      <td id="covbar-${escapeHtml(f.firm_id)}">${coverageBar(pct, manual, f)}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(f, f.firm_id, searchId, 'pe_firms') : `<tr class="accordion-tr" id="acc-${escapeHtml(f.firm_id)}" style="display:none"><td colspan="6"></td></tr>`;
    return [firmRow, accRow];
  }

  // Split into active and completed
  const active = sorted.filter(f => !f.archived_complete);
  const completed = sorted.filter(f => f.archived_complete);
  const activeRows = active.flatMap(buildFirmRow);
  const completedRows = completed.flatMap(buildFirmRow);

  const completedSection = completed.length > 0 ? `
    <div class="collapsible-section" style="margin-top:16px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
      <div class="collapsible-header" onclick="toggleSection('completed-pe')" style="background:#f5f5f5;padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;font-size:13px;color:#888">Completed (${completed.length})</span>
        <span id="completed-pe-arrow">&#9654;</span>
      </div>
      <div class="collapsible-body" id="completed-pe" style="display:none;padding:0">
        <table class="coverage-table">
          <tbody>${completedRows.join('')}</tbody>
        </table>
      </div>
    </div>` : '';

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th style="${thStyle}" onclick="toggleCoverageSort('name','${escapeHtml(searchId)}')">Firm Name${sortArrow('name')}</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('hq','${escapeHtml(searchId)}')">HQ${sortArrow('hq')}</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('size_tier','${escapeHtml(searchId)}')">Size Tier${sortArrow('size_tier')}</th>
      <th style="${thStyle};text-align:center" onclick="toggleCoverageSort('people','${escapeHtml(searchId)}')">People${sortArrow('people')}</th>
      <th>Reviewed</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('coverage','${escapeHtml(searchId)}')">Coverage${sortArrow('coverage')}</th>
    </tr></thead>
    <tbody>${activeRows.join('')}</tbody>
  </table>
  ${completedSection}`;
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

  const sorted = sortCoverageFirms(filtered, 'companies');
  const sortArrow = (field) => coverageSortField === field ? (coverageSortAsc ? ' ▲' : ' ▼') : '';
  const thStyle = 'cursor:pointer;user-select:none;white-space:nowrap';

  const filterBar = `
  <div class="filter-bar" id="coverage-filters" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
    <select id="cov-filter-rev" onchange="applyCoverageFilters('${escapeHtml(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px">
      <option value="all" ${coverageFilters.revenue_tier === 'all' ? 'selected' : ''}>All Revenue Tiers</option>
      <option value="Large Cap" ${coverageFilters.revenue_tier === 'Large Cap' ? 'selected' : ''}>Large Cap</option>
      <option value="Upper Middle" ${coverageFilters.revenue_tier === 'Upper Middle' ? 'selected' : ''}>Upper Middle</option>
      <option value="Middle Market" ${coverageFilters.revenue_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
      <option value="Lower Middle" ${coverageFilters.revenue_tier === 'Lower Middle' ? 'selected' : ''}>Lower Middle</option>
    </select>
    <input type="text" id="cov-filter-text" value="${escapeHtml(coverageFilters.text)}" placeholder="Search company name..." oninput="applyCoverageFilters('${escapeHtml(searchId)}')" style="padding:6px 10px;border:1px solid #ccc;border-radius:4px;font-size:13px;min-width:180px" />
    <span style="font-size:12px;color:#888">${sorted.length} compan${sorted.length !== 1 ? 'ies' : 'y'}</span>
  </div>`;

  if (filtered.length === 0) {
    return filterBar + `<div style="padding:32px;text-align:center;color:#888;font-size:14px">No target companies loaded — use "Add Target Company" below to get started.</div>`;
  }

  function buildCompanyRow(c) {
    const { pct, manual } = getCoveragePct(c, 'companies');
    const isOpen = openAccordionId === c.company_id;
    const rosterCount = (c.roster || []).length;
    const coWebUrl = c.website_url || '';
    const coWebsite = coWebUrl ? `<a href="${escapeHtml(coWebUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color:#0077B5;font-size:11px;margin-left:6px" title="Company website">&#127760;</a>` : '';
    const compRow = `<tr class="firm-row${isOpen ? ' open' : ''}" id="row-${escapeHtml(c.company_id)}" onclick="toggleCoverageAccordion('${escapeHtml(searchId)}','companies','${escapeHtml(c.company_id)}')">
      <td><strong>${escapeHtml(c.name)}</strong>${coWebsite}</td>
      <td>${escapeHtml(c.hq || '—')}</td>
      <td>${escapeHtml(c.revenue_tier || '—')}</td>
      <td style="text-align:center"><span style="font-size:12px;color:#555">${rosterCount}</span></td>
      <td id="revbar-${escapeHtml(c.company_id)}">${reviewedBar(c)}</td>
      <td id="covbar-${escapeHtml(c.company_id)}">${coverageBar(pct, manual, c)}</td>
    </tr>`;
    const accRow = isOpen ? accordionHTML(c, c.company_id, searchId, 'companies') : `<tr class="accordion-tr" id="acc-${escapeHtml(c.company_id)}" style="display:none"><td colspan="6"></td></tr>`;
    return [compRow, accRow];
  }

  const active = sorted.filter(c => !c.archived_complete);
  const completed = sorted.filter(c => c.archived_complete);
  const activeRows = active.flatMap(buildCompanyRow);
  const completedRows = completed.flatMap(buildCompanyRow);

  const completedSection = completed.length > 0 ? `
    <div class="collapsible-section" style="margin-top:16px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden">
      <div class="collapsible-header" onclick="toggleSection('completed-co')" style="background:#f5f5f5;padding:10px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:600;font-size:13px;color:#888">Completed (${completed.length})</span>
        <span id="completed-co-arrow">&#9654;</span>
      </div>
      <div class="collapsible-body" id="completed-co" style="display:none;padding:0">
        <table class="coverage-table">
          <tbody>${completedRows.join('')}</tbody>
        </table>
      </div>
    </div>` : '';

  return filterBar + `
  <table class="coverage-table">
    <thead><tr>
      <th style="${thStyle}" onclick="toggleCoverageSort('name','${escapeHtml(searchId)}')">Company Name${sortArrow('name')}</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('hq','${escapeHtml(searchId)}')">HQ${sortArrow('hq')}</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('size_tier','${escapeHtml(searchId)}')">Revenue Tier${sortArrow('size_tier')}</th>
      <th style="${thStyle};text-align:center" onclick="toggleCoverageSort('people','${escapeHtml(searchId)}')">People${sortArrow('people')}</th>
      <th>Reviewed</th>
      <th style="${thStyle}" onclick="toggleCoverageSort('coverage','${escapeHtml(searchId)}')">Coverage${sortArrow('coverage')}</th>
    </tr></thead>
    <tbody>${activeRows.join('')}</tbody>
  </table>
  ${completedSection}`;
}

// ── Main render entry point ───────────────────────────────────────────────────

async function autoLinkCandidatesToRosters(search) {
  try {
    const poolResp = await api('GET', '/candidates/slim');
    const candidates = poolResp.candidates || [];
    if (candidates.length === 0) return false;

    const coverage = search.sourcing_coverage;
    if (!coverage) return false;

    let changed = false;

    // Build alias map from coverage data (server now includes aliases per firm/company)
    const aliasMap = {};
    const covEntities = [...(coverage.pe_firms || []), ...(coverage.companies || [])];
    for (const entity of covEntities) {
      const name = entity.name || '';
      const aliases = entity.aliases || [];
      if (!aliases.length) continue;
      const key = normalizeFirmName(name);
      if (key) aliasMap[key] = aliases;
      aliases.forEach(alias => {
        const ak = normalizeFirmName(alias);
        if (ak && !aliasMap[ak]) aliasMap[ak] = [name, ...aliases.filter(a => normalizeFirmName(a) !== ak)];
      });
    }

    // Build candidate lookup by ID for stale-check
    const candidateById = {};
    candidates.forEach(c => { if (c.candidate_id) candidateById[c.candidate_id] = c; });

    function syncRoster(entity, entityName) {
      if (!entity.roster) entity.roster = [];

      // 1. Add new matches (current employees by current_firm OR concurrent roles at this firm)
      // Blocklist: exclude board seats and passive roles; everything else gets linked
      const EXCLUDED_TITLES = /\b(board\s*(member|director|advisor|observer)|independent\s*director|non[- ]executive\s*director|investor)\b/i;

      const matched = candidates.filter(c => {
        // Direct current_firm match (with aliases: TJC ↔ The Jordan Company etc.)
        if (firmNamesMatchWithAliases(c.current_firm, entityName, aliasMap)) return true;
        // Check work history for concurrent roles at this firm (exclude board/passive roles)
        if (Array.isArray(c.work_history)) {
          return c.work_history.some(w =>
            w.dates && /present/i.test(w.dates) &&
            w.title && !EXCLUDED_TITLES.test(w.title) &&
            firmNamesMatchWithAliases(w.company, entityName, aliasMap)
          );
        }
        return false;
      });

      matched.forEach(c => {
        const alreadyOnRoster = entity.roster.some(r =>
          r.candidate_id === c.candidate_id ||
          (r.name || '').toLowerCase() === (c.name || '').toLowerCase()
        );
        if (!alreadyOnRoster) {
          // Use the role title at this firm if matched via work history, otherwise current_title
          let matchTitle = c.current_title || '';
          if (!firmNamesMatchWithAliases(c.current_firm, entityName, aliasMap) && Array.isArray(c.work_history)) {
            const role = c.work_history.find(w =>
              w.dates && /present/i.test(w.dates) &&
              w.title && !EXCLUDED_TITLES.test(w.title) &&
              firmNamesMatchWithAliases(w.company, entityName, aliasMap)
            );
            if (role) matchTitle = role.title;
          }
          entity.roster.push({
            candidate_id: c.candidate_id,
            name: c.name,
            title: matchTitle,
            linkedin_url: c.linkedin_url || '',
            location: c.home_location || null,
            roster_status: 'Identified',
            source: 'auto-linked',
            _new: true
          });
          changed = true;
        }
      });

      // 1b. Enrich existing roster entries with missing data from candidate pool
      entity.roster.forEach(r => {
        const poolCand = candidateById[r.candidate_id];
        if (!poolCand) return;
        if (!r.location && poolCand.home_location) { r.location = poolCand.home_location; r._enriched = true; changed = true; }
        if (!r.linkedin_url && poolCand.linkedin_url) { r.linkedin_url = poolCand.linkedin_url; r._enriched = true; changed = true; }
        if ((!r.title || r.title === 'Identified') && poolCand.current_title) { r.title = poolCand.current_title; r._enriched = true; changed = true; }
      });

      // 2. Remove roster entries for people who no longer work at this firm
      // Keep if: reviewed, status changed, current_firm matches, or has a current non-excluded role in work history
      entity.roster = entity.roster.filter(r => {
        // Keep if user has reviewed or changed status (user made a deliberate decision)
        if (r.review_status === 'relevant' || r.review_status === 'not_relevant') return true;
        if (r.roster_status && r.roster_status !== 'Identified') return true;
        // Check candidate pool for current association
        const poolCandidate = candidateById[r.candidate_id];
        if (!poolCandidate) return true; // not in pool — keep (manually added without candidate match)
        // Keep if current_firm matches (with aliases)
        if (firmNamesMatchWithAliases(poolCandidate.current_firm, entityName, aliasMap)) return true;
        // Keep if they have a current (Present) non-excluded role at this firm in work history
        if (Array.isArray(poolCandidate.work_history)) {
          const hasCurrentRole = poolCandidate.work_history.some(w =>
            w.dates && /present/i.test(w.dates) &&
            w.title && !EXCLUDED_TITLES.test(w.title) &&
            firmNamesMatchWithAliases(w.company, entityName, aliasMap)
          );
          if (hasCurrentRole) return true;
        }
        // Person no longer at this firm — remove
        changed = true;
        return false;
      });
    }

    // Match PE firms
    (coverage.pe_firms || []).forEach(firm => syncRoster(firm, firm.name));

    // Match companies
    (coverage.companies || []).forEach(co => syncRoster(co, co.name));

    // Also auto-link to new firm if person moved
    // (the add-new-matches step above already handles this since we check current_firm)

    // Save newly linked people via roster POST endpoints
    if (changed) {
      for (const firm of (coverage.pe_firms || [])) {
        for (const r of (firm.roster || [])) {
          if (r.source === 'auto-linked' && r._new) {
            try {
              await fetch('/api/searches/' + search.search_id + '/coverage/firms/' + firm.firm_id + '/roster', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: r.name, title: r.title, linkedin_url: r.linkedin_url, location: r.location, roster_status: r.roster_status, source: 'auto-linked' })
              });
            } catch (e) { /* continue */ }
            delete r._new;
          }
        }
      }
      for (const co of (coverage.companies || [])) {
        for (const r of (co.roster || [])) {
          if (r.source === 'auto-linked' && r._new) {
            try {
              await fetch('/api/searches/' + search.search_id + '/coverage/companies/' + co.company_id + '/roster', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: r.name, title: r.title, linkedin_url: r.linkedin_url, location: r.location, roster_status: r.roster_status, source: 'auto-linked' })
              });
            } catch (e) { /* continue */ }
            delete r._new;
          }
        }
      }

      // PATCH enriched existing roster entries (title/location/linkedin filled from candidate pool)
      for (const firm of (coverage.pe_firms || [])) {
        for (const r of (firm.roster || [])) {
          if (r._enriched) {
            try {
              await fetch('/api/searches/' + search.search_id + '/coverage/firms/' + firm.firm_id + '/roster/' + r.candidate_id, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: r.title, location: r.location, linkedin_url: r.linkedin_url })
              });
            } catch (e) { /* continue */ }
            delete r._enriched;
          }
        }
      }
      for (const co of (coverage.companies || [])) {
        for (const r of (co.roster || [])) {
          if (r._enriched) {
            try {
              await fetch('/api/searches/' + search.search_id + '/coverage/companies/' + co.company_id + '/roster/' + r.candidate_id, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: r.title, location: r.location, linkedin_url: r.linkedin_url })
              });
            } catch (e) { /* continue */ }
            delete r._enriched;
          }
        }
      }
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

  // Load company pool first, then auto-link (both need company data)
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
  <!-- Sub-tab bar + actions -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px">
    <div class="sub-tab-bar" style="margin-bottom:0">
      <button class="sub-tab active" id="cov-tab-pe" onclick="switchCoverageTab('pe-firms','${escapeHtml(searchId)}')">PE Firms (${firms.length})</button>
      <button class="sub-tab" id="cov-tab-companies" onclick="switchCoverageTab('companies','${escapeHtml(searchId)}')">Target Companies (${companies.length})</button>
      <button class="sub-tab" id="cov-tab-playbook" onclick="switchCoverageTab('playbook','${escapeHtml(searchId)}')">Playbook</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap" id="cov-action-btns">
      <button class="btn btn-secondary btn-sm" id="cov-add-btn" onclick="openAddFirmModal('${escapeHtml(searchId)}')">+ Add PE Firm</button>
      <button class="btn btn-ghost btn-sm" onclick="loadCoverageFromPlaybook('${escapeHtml(searchId)}')">&#8627; Load from Playbook</button>
      <button class="btn btn-ghost btn-sm" style="color:#c62828" onclick="toggleCovSelectMode('${escapeHtml(searchId)}')">&#9744; Select &amp; Delete</button>
    </div>
  </div>
  <!-- Filter bar + table -->
  <div id="coverage-table">
    ${tableHTML}
  </div>
</div>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

async function switchCoverageTab(tab, searchId) {
  coverageSubTab = tab;
  openAccordionId = null;
  coverageFilters.text = '';

  const peBtn = document.getElementById('cov-tab-pe');
  const coBtn = document.getElementById('cov-tab-companies');
  const pbBtn = document.getElementById('cov-tab-playbook');
  const addBtn = document.getElementById('cov-add-btn');
  const actionBtns = document.getElementById('cov-action-btns');
  if (peBtn) peBtn.classList.toggle('active', tab === 'pe-firms');
  if (coBtn) coBtn.classList.toggle('active', tab === 'companies');
  if (pbBtn) pbBtn.classList.toggle('active', tab === 'playbook');

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
      if (addBtn) { addBtn.style.display = ''; addBtn.textContent = '+ Add PE Firm'; addBtn.setAttribute('onclick', `openAddFirmModal('${escapeHtml(searchId)}')`); }
      if (actionBtns) actionBtns.style.display = '';
      if (peBtn) peBtn.textContent = `PE Firms (${firms.length})`;
      if (coBtn) coBtn.textContent = `Target Companies (${companies.length})`;
    } else if (tab === 'companies') {
      coverageFilters.size_tier = 'all';
      tableEl.innerHTML = buildCompaniesTableHTML(companies, searchId);
      if (addBtn) { addBtn.style.display = ''; addBtn.textContent = '+ Add Target Company'; addBtn.setAttribute('onclick', `openAddCompanyModal('${escapeHtml(searchId)}')`); }
      if (actionBtns) actionBtns.style.display = '';
      if (peBtn) peBtn.textContent = `PE Firms (${firms.length})`;
      if (coBtn) coBtn.textContent = `Target Companies (${companies.length})`;
    } else if (tab === 'playbook') {
      if (actionBtns) actionBtns.style.display = 'none';
      tableEl.innerHTML = await buildPlaybookTabHTML(search);
    }
  } catch (e) {
    console.error('switchCoverageTab error:', e);
  }
}

// ── Playbook tab (Top 25 from sector playbooks) ─────────────────────────────

async function buildPlaybookTabHTML(search) {
  const sectors = search.sectors || [];
  if (sectors.length === 0) {
    return `<div style="padding:24px;text-align:center;color:#888">
      <p>No sectors assigned to this search. Edit the search to add sectors.</p>
      <button class="btn btn-secondary btn-sm" style="margin-top:12px" onclick="openAddPlaybookModal('${escapeHtml(search.search_id)}')">+ Add a Sector Playbook</button>
    </div>`;
  }

  const searchId = search.search_id;
  const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };

  // Build lookup sets for what's already in sourcing coverage
  const covFirmIds = new Set((coverage.pe_firms || []).map(f => f.firm_id));
  const covFirmNames = new Set((coverage.pe_firms || []).map(f => (f.name || '').toLowerCase()));
  const covCompanyIds = new Set((coverage.companies || []).map(c => c.company_id));
  const covCompanyNames = new Set((coverage.companies || []).map(c => (c.name || '').toLowerCase()));

  function isFirmAdded(f) {
    return covFirmIds.has(f.firm_id) || covFirmNames.has((f.name || '').toLowerCase());
  }
  function isCompanyAdded(c) {
    return covCompanyIds.has(c.company_id) || covCompanyNames.has((c.name || '').toLowerCase());
  }

  const sectorSections = [];

  for (const sectorId of sectors) {
    try {
      const sector = await api('GET', '/playbooks/' + sectorId);
      const topFirmIds = sector.top_pe_firms || [];
      const topCompanyIds = sector.top_companies || [];

      const topFirms = topFirmIds.map(id => (sector.pe_firms || []).find(f => f.firm_id === id)).filter(Boolean);
      const topCompanies = topCompanyIds.map(id => (sector.target_companies || []).find(c => c.company_id === id)).filter(Boolean);

      // Progress counts
      const firmsAdded = topFirms.filter(isFirmAdded).length;
      const companiesAdded = topCompanies.filter(isCompanyAdded).length;

      const firmsHTML = topFirms.length === 0
        ? `<p style="color:#aaa;font-size:13px;padding:12px">No top PE firms ranked yet.</p>`
        : topFirms.map((f, i) => {
            const added = isFirmAdded(f);
            const sizePill = f.size_tier ? `<span style="background:#F3E8EF;color:#6B2D5B;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:600">${escapeHtml(f.size_tier)}</span>` : '';
            const tagBadge = f.firm_tag === 'Specialist'
              ? `<span style="background:#fff8e1;color:#f57f17;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:700">&#9733; Specialist</span>`
              : f.firm_tag === 'Generalist'
              ? `<span style="background:#f5f5f5;color:#999;padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600">Generalist</span>`
              : '';
            const statusBtn = added
              ? `<span style="color:#4caf50;font-size:16px;flex-shrink:0" title="Added to sourcing coverage">&#10003;</span>`
              : `<button onclick="addPlaybookItemToSearch('${escapeHtml(searchId)}','pe','${escapeHtml(f.firm_id)}','${escapeHtml(sectorId)}')" style="background:#6B2D5B;color:#fff;border:none;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">+ Add</button>`;
            return `<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;${added ? 'background:#f8fdf8;' : ''}">
              <span style="font-weight:700;color:#999;width:18px;text-align:right;font-size:11px">${i + 1}</span>
              <span style="font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f.name)}</span>
              ${tagBadge} ${sizePill}
              ${statusBtn}
            </div>`;
          }).join('');

      const companiesHTML = topCompanies.length === 0
        ? `<p style="color:#aaa;font-size:13px;padding:12px">No top companies ranked yet.</p>`
        : topCompanies.map((c, i) => {
            const added = isCompanyAdded(c);
            const statusBtn = added
              ? `<span style="color:#4caf50;font-size:16px;flex-shrink:0" title="Added to sourcing coverage">&#10003;</span>`
              : `<button onclick="addPlaybookItemToSearch('${escapeHtml(searchId)}','company','${escapeHtml(c.company_id)}','${escapeHtml(sectorId)}')" style="background:#6B2D5B;color:#fff;border:none;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">+ Add</button>`;
            return `<div style="display:flex;align-items:center;gap:6px;padding:5px 12px;border-bottom:1px solid #f0f0f0;font-size:13px;${added ? 'background:#f8fdf8;' : ''}">
              <span style="font-weight:700;color:#999;width:18px;text-align:right;font-size:11px">${i + 1}</span>
              <span style="font-weight:600;flex:1">${escapeHtml(c.name)}</span>
              <span style="color:#888;font-size:10px;white-space:nowrap">${escapeHtml(c.hq || '')}</span>
              <span style="color:#888;font-size:10px">${escapeHtml(c.revenue_tier || '')}</span>
              ${statusBtn}
            </div>`;
          }).join('');

      // Progress bar
      const firmsPct = topFirms.length > 0 ? Math.round(firmsAdded / topFirms.length * 100) : 0;
      const companiesPct = topCompanies.length > 0 ? Math.round(companiesAdded / topCompanies.length * 100) : 0;

      sectorSections.push(`
        <div style="border:2px solid #F3E8EF;border-radius:12px;overflow:hidden;margin-bottom:16px">
          <div style="background:linear-gradient(135deg,#6B2D5B,#8B4D7B);padding:14px 20px;display:flex;justify-content:space-between;align-items:center">
            <h2 style="margin:0;color:#fff;font-size:18px;font-weight:700">${escapeHtml(sector.sector_name)} Playbook</h2>
            <div style="display:flex;align-items:center;gap:12px">
              <span style="color:rgba(255,255,255,0.8);font-size:12px">${firmsAdded}/${topFirms.length} firms · ${companiesAdded}/${topCompanies.length} companies added</span>
              <button class="btn btn-ghost btn-sm" style="color:#fff;border-color:rgba(255,255,255,0.3);font-size:11px" onclick="loadSectorPlaybookIntoSearch('${escapeHtml(searchId)}','${escapeHtml(sectorId)}')">Add All</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0">
            <div style="border-right:1px solid #f0f0f0">
              <div style="padding:8px 12px;background:#faf6f9;font-weight:700;font-size:11px;color:#6B2D5B;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #F3E8EF;display:flex;justify-content:space-between;align-items:center">
                <span>Top PE Firms (${firmsAdded}/${topFirms.length})</span>
                <div style="width:60px;height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden"><div style="width:${firmsPct}%;height:100%;background:#4caf50;border-radius:2px"></div></div>
              </div>
              <div style="max-height:400px;overflow-y:auto">${firmsHTML}</div>
            </div>
            <div>
              <div style="padding:8px 12px;background:#faf6f9;font-weight:700;font-size:11px;color:#6B2D5B;text-transform:uppercase;letter-spacing:0.5px;border-bottom:1px solid #F3E8EF;display:flex;justify-content:space-between;align-items:center">
                <span>Top Companies (${companiesAdded}/${topCompanies.length})</span>
                <div style="width:60px;height:4px;background:#e0e0e0;border-radius:2px;overflow:hidden"><div style="width:${companiesPct}%;height:100%;background:#4caf50;border-radius:2px"></div></div>
              </div>
              <div style="max-height:400px;overflow-y:auto">${companiesHTML}</div>
            </div>
          </div>
        </div>`);
    } catch { /* skip sector */ }
  }

  if (sectorSections.length === 0) {
    return `<div style="padding:24px;text-align:center;color:#888">No playbook data available for the selected sectors.</div>`;
  }

  return `<div style="margin-top:8px">
    ${sectorSections.join('')}
    <div style="text-align:center;padding:16px">
      <button class="btn btn-secondary btn-sm" onclick="openAddPlaybookModal('${escapeHtml(searchId)}')">+ Add Another Sector Playbook</button>
    </div>
  </div>`;
}

async function loadTop25IntoSearch(searchId) {
  if (!(await appConfirm('Load all Top 25 PE firms and companies from the sector playbooks into this search sourcing coverage? Existing firms and companies will not be duplicated.'))) return;

  try {
    const search = await api('GET', '/searches/' + searchId);
    const sectors = search.sectors || [];
    let addedFirms = 0;
    let addedCompanies = 0;

    for (const sectorId of sectors) {
      const sector = await api('GET', '/playbooks/' + sectorId);

      for (const firmId of (sector.top_pe_firms || [])) {
        const firm = (sector.pe_firms || []).find(f => f.firm_id === firmId);
        if (!firm) continue;
        const result = await api('POST', `/searches/${searchId}/coverage/firms`, {
          firm_id: firm.firm_id, name: firm.name, hq: firm.hq || '', size_tier: firm.size_tier || '',
          strategy: firm.strategy || '', sector_focus: firm.sector_focus || '', why_target: firm.why_target || ''
        });
        // Check if it was actually new (total increased)
        addedFirms++;
      }

      for (const coId of (sector.top_companies || [])) {
        const co = (sector.target_companies || []).find(c => c.company_id === coId);
        if (!co) continue;
        await api('POST', `/searches/${searchId}/coverage/companies`, {
          company_id: co.company_id, name: co.name, hq: co.hq || '', revenue_tier: co.revenue_tier || '',
          ownership_type: co.ownership_type || '', why_target: co.why_target || ''
        });
        addedCompanies++;
      }
    }

    appAlert('Loaded ' + addedFirms + ' PE firms and ' + addedCompanies + ' companies into sourcing coverage (duplicates skipped).', { type: 'success' });
    switchCoverageTab('pe-firms', searchId);
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function openAddPlaybookModal(searchId) {
  try {
    const search = await api('GET', '/searches/' + searchId);
    const currentSectors = search.sectors || [];
    const allSectors = [
      { id: 'industrials', label: 'Industrials' },
      { id: 'technology-software', label: 'Technology / Software' },
      { id: 'tech-enabled-services', label: 'Tech-Enabled Services' },
      { id: 'healthcare', label: 'Healthcare' },
      { id: 'financial-services', label: 'Financial Services' },
      { id: 'consumer', label: 'Consumer' },
      { id: 'business-services', label: 'Business Services' },
      { id: 'infrastructure-energy', label: 'Infrastructure / Energy' },
      { id: 'life-sciences', label: 'Life Sciences' },
      { id: 'media-entertainment', label: 'Media / Entertainment' },
      { id: 'real-estate-proptech', label: 'Real Estate / PropTech' },
      { id: 'agriculture-fb', label: 'Agriculture / Food & Beverage' }
    ];
    const available = allSectors.filter(s => !currentSectors.includes(s.id));

    if (available.length === 0) {
      appAlert('All sector playbooks are already added to this search.', { type: 'warning' });
      return;
    }

    const choice = await appPrompt(
      'Add a sector playbook:\n\n' +
      available.map((s, i) => `${i + 1}. ${s.label}`).join('\n') +
      '\n\nEnter number:'
    );
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= available.length) { appAlert('Invalid selection.', { type: 'warning' }); return; }

    const newSectorId = available[idx].id;
    const updatedSectors = [...currentSectors, newSectorId];
    await api('PUT', '/searches/' + searchId, { sectors: updatedSectors });

    // Refresh playbook tab
    switchCoverageTab('playbook', searchId);
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function addPlaybookItemToSearch(searchId, type, itemId, sectorId) {
  try {
    const sector = await api('GET', '/playbooks/' + sectorId);

    if (type === 'pe') {
      const firm = (sector.pe_firms || []).find(f => f.firm_id === itemId);
      if (!firm) { appAlert('Firm not found.', { type: 'warning' }); return; }
      await api('POST', `/searches/${searchId}/coverage/firms`, {
        firm_id: firm.firm_id, name: firm.name, hq: firm.hq || '', size_tier: firm.size_tier || '',
        strategy: firm.strategy || '', sector_focus: firm.sector_focus || '', why_target: firm.why_target || ''
      });
    } else {
      const co = (sector.target_companies || []).find(c => c.company_id === itemId);
      if (!co) { appAlert('Company not found.', { type: 'warning' }); return; }
      await api('POST', `/searches/${searchId}/coverage/companies`, {
        company_id: co.company_id, name: co.name, hq: co.hq || '', revenue_tier: co.revenue_tier || '',
        ownership_type: co.ownership_type || '', why_target: co.why_target || ''
      });
    }

    switchCoverageTab('playbook', searchId);
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function loadSectorPlaybookIntoSearch(searchId, sectorId) {
  if (!(await appConfirm('Load this sector playbook into the search sourcing coverage?'))) return;

  try {
    const sector = await api('GET', '/playbooks/' + sectorId);
    let addedFirms = 0;
    let addedCompanies = 0;

    for (const firmId of (sector.top_pe_firms || [])) {
      const firm = (sector.pe_firms || []).find(f => f.firm_id === firmId);
      if (!firm) continue;
      await api('POST', `/searches/${searchId}/coverage/firms`, {
        firm_id: firm.firm_id, name: firm.name, hq: firm.hq || '', size_tier: firm.size_tier || '',
        strategy: firm.strategy || '', sector_focus: firm.sector_focus || '', why_target: firm.why_target || ''
      });
      addedFirms++;
    }

    for (const coId of (sector.top_companies || [])) {
      const co = (sector.target_companies || []).find(c => c.company_id === coId);
      if (!co) continue;
      await api('POST', `/searches/${searchId}/coverage/companies`, {
        company_id: co.company_id, name: co.name, hq: co.hq || '', revenue_tier: co.revenue_tier || '',
        ownership_type: co.ownership_type || '', why_target: co.why_target || ''
      });
      addedCompanies++;
    }

    appAlert('Loaded ' + addedFirms + ' PE firms and ' + addedCompanies + ' companies from ' + (sector.sector_name || sectorId) + ' (duplicates skipped).', { type: 'success' });
    switchCoverageTab('playbook', searchId);
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
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
    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    await api('PATCH', `/searches/${searchId}/coverage/${subPath}/${entityId}/roster/${candidateId}`, {
      roster_status: newStatus
    });
    // Re-fetch and re-render
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (entity) {
      const rosterEl = document.getElementById('roster-section-' + entityId);
      if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type, entity.name);
      refreshCoverageBar(entity, entityId, type);
    }
  } catch (e) {
    console.error('updateRosterPersonStatus error:', e);
  }
}

async function removeRosterPerson(searchId, type, entityId, candidateId) {
  if (!(await appConfirm('Remove this person from the roster?'))) return;
  try {
    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    await api('DELETE', `/searches/${searchId}/coverage/${subPath}/${entityId}/roster/${candidateId}`);
    // Re-fetch and re-render
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (entity) {
      const rosterEl = document.getElementById('roster-section-' + entityId);
      if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type, entity.name);
      refreshCoverageBar(entity, entityId, type);
    }
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
  if (!name) { appAlert('Name is required.', { type: 'warning' }); return; }

  const title = titleEl ? titleEl.value.trim() : '';
  const linkedin_url = linkedinEl ? linkedinEl.value.trim() : '';
  const roster_status = statusEl ? statusEl.value : 'Identified';

  try {
    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    const url = `/searches/${searchId}/coverage/${subPath}/${entityId}/roster`;
    console.log('[addRosterPerson] POST', url, { name, title, linkedin_url, roster_status });
    const result = await api('POST', url, {
      name, title, linkedin_url, roster_status
    });
    console.log('[addRosterPerson] result:', result);

    // Re-fetch full coverage to get updated roster
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);

    if (entity) {
      const rosterEl = document.getElementById('roster-section-' + entityId);
      if (rosterEl) rosterEl.innerHTML = rosterTableHTML(entity.roster, entityId, searchId, type, entity.name);
      refreshCoverageBar(entity, entityId, type);
    }

    // Clear form
    if (nameEl) nameEl.value = '';
    if (titleEl) titleEl.value = '';
    if (linkedinEl) linkedinEl.value = '';
    if (statusEl) statusEl.value = 'Identified';
  } catch (e) {
    console.error('addRosterPerson error:', e);
    appAlert('Error saving person: ' + e.message, { type: 'error' });
  }
}

async function toggleArchiveComplete(searchId, type, entityId) {
  try {
    // Read current state to toggle
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idField = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = list.find(e => e[idField] === entityId);
    if (!entity) return;

    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    await api('PATCH', `/searches/${searchId}/coverage/${subPath}/${entityId}`, {
      archived_complete: !entity.archived_complete
    });

    // Refresh the tab
    const tab = type === 'pe_firms' ? 'pe-firms' : 'companies';
    openAccordionId = null;
    switchCoverageTab(tab, searchId);
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function resetVerification(searchId, type, entityId) {
  try {
    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    const updated = await api('PATCH', `/searches/${searchId}/coverage/${subPath}/${entityId}`, {
      manual_complete: false,
      last_verified: null,
      verified_by: null,
      manual_complete_note: ''
    });

    // Re-render with updated data
    refreshCoverageBar(updated, entityId, type);
    const accInner = document.getElementById('roster-section-' + entityId)?.closest('.accordion-inner');
    if (accInner) {
      const overrideDiv = accInner.querySelector('.override-section');
      if (overrideDiv) overrideDiv.outerHTML = overrideSectionHTML(updated, entityId, searchId, type);
    }
  } catch (err) {
    appAlert('Error: ' + err.message, { type: 'error' });
  }
}

async function verifyCoverage(searchId, type, entityId) {
  const noteEl = document.getElementById('override-note-' + entityId);
  const note = noteEl ? noteEl.value.trim() : '';
  const btn = event?.target;

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    const updated = await api('PATCH', `/searches/${searchId}/coverage/${subPath}/${entityId}`, {
      manual_complete: true,
      manual_complete_note: note,
      last_verified: todayISO(),
      verified_by: 'RA'
    });

    refreshCoverageBar(updated, entityId, type);

    // Flash confirmation then re-render
    if (btn) {
      btn.textContent = 'Verified!';
      btn.style.background = '#4caf50';
      btn.style.color = '#fff';
    }
    setTimeout(() => {
      const rosterEl = document.getElementById('roster-section-' + entityId);
      if (rosterEl) rosterEl.innerHTML = rosterTableHTML(updated.roster || [], entityId, searchId, type, updated.name);
      const accInner = rosterEl?.closest('.accordion-inner');
      if (accInner) {
        const overrideDiv = accInner.querySelector('.override-section');
        if (overrideDiv) overrideDiv.outerHTML = overrideSectionHTML(updated, entityId, searchId, type);
      }
    }, 1000);
  } catch (e) {
    console.error('verifyCoverage error:', e);
    if (btn) { btn.disabled = false; btn.textContent = 'Verify Now'; }
  }
}

// Keep old name for backwards compat
async function saveCoverageOverride(searchId, type, entityId) { return verifyCoverage(searchId, type, entityId); }

// Helper: update the coverage bar cell in place (no full re-render)
function refreshCoverageBar(entity, entityId, type) {
  const barEl = document.getElementById('covbar-' + entityId);
  if (barEl) {
    const { pct, manual } = getCoveragePct(entity, type);
    barEl.innerHTML = coverageBar(pct, manual, entity);
  }
  const revEl = document.getElementById('revbar-' + entityId);
  if (revEl) revEl.innerHTML = reviewedBar(entity);
}

async function setReviewStatus(searchId, type, entityId, candidateId, newStatus) {
  try {
    // Read current state to check for toggle
    const search = await api('GET', '/searches/' + searchId);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const list = type === 'pe_firms' ? coverage.pe_firms : coverage.companies;
    const idKey = type === 'pe_firms' ? 'firm_id' : 'company_id';
    const entity = (list || []).find(e => e[idKey] === entityId);
    if (!entity) return;
    const person = (entity.roster || []).find(p => p.candidate_id === candidateId);
    if (!person) return;

    const subPath = type === 'pe_firms' ? 'firms' : 'companies';
    let patchData;
    if (person.review_status === newStatus) {
      patchData = { review_status: null, reviewed: false, reviewed_date: null };
    } else {
      patchData = { review_status: newStatus, reviewed: true, reviewed_date: todayISO() };
    }
    await api('PATCH', `/searches/${searchId}/coverage/${subPath}/${entityId}/roster/${candidateId}`, patchData);

    // Re-fetch and re-render
    const freshSearch = await api('GET', '/searches/' + searchId);
    const freshCov = freshSearch.sourcing_coverage || { pe_firms: [], companies: [] };
    const freshList = type === 'pe_firms' ? freshCov.pe_firms : freshCov.companies;
    const freshEntity = (freshList || []).find(e => e[idKey] === entityId);
    if (freshEntity) {
      const rosterEl = document.getElementById('roster-section-' + entityId);
      if (rosterEl) rosterEl.innerHTML = rosterTableHTML(freshEntity.roster, entityId, searchId, type, freshEntity.name);
      refreshCoverageBar(freshEntity, entityId, type);
    }
  } catch (e) {
    console.error('setReviewStatus error:', e);
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
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cov-add-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitAddFirm('${escapeHtml(searchId)}')">Add Firm</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  setupTypeahead('modal-firm-name', {
    filterType: 'PE Firm',
    onSelect: function(company) {
      document.getElementById('modal-firm-name').value = company.name;
      document.getElementById('modal-firm-name').dataset.companyId = company.company_id;
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
      document.getElementById('modal-firm-name').dataset.companyId = '';
    }
  });
  document.getElementById('modal-firm-name').focus();
}

async function submitAddFirm(searchId) {
  const nameEl = document.getElementById('modal-firm-name');
  const name = (nameEl.value || '').trim();
  if (!name) { appAlert('Firm name is required.', { type: 'warning' }); return; }
  const hq = (document.getElementById('modal-firm-hq').value || '').trim();
  const size_tier = document.getElementById('modal-firm-size').value;
  const strategy = (document.getElementById('modal-firm-strategy').value || '').trim();
  const sector_focus = (document.getElementById('modal-firm-sector').value || '').trim();
  const why_target = (document.getElementById('modal-firm-why').value || '').trim();

  // Use the company_id from typeahead selection if available, otherwise generate slug
  const firm_id = nameEl.dataset.companyId || slugify(name);

  try {
    // Only create company if it's a new entry (no existing company_id from typeahead)
    if (!nameEl.dataset.companyId) {
      await api('POST', '/companies', { company_id: firm_id, name, company_type: 'PE Firm', hq, size_tier, strategy });
      _taCache = null;
    }

    // Add to coverage via the dedicated endpoint
    const coverage = await api('POST', `/searches/${searchId}/coverage/firms`, {
      firm_id, name, hq, size_tier, strategy, sector_focus, why_target
    });

    document.getElementById('cov-add-modal').remove();
    const tableEl = document.getElementById('coverage-table');
    if (tableEl) tableEl.innerHTML = buildPEFirmsTableHTML(coverage.pe_firms, searchId);
    const peBtn = document.getElementById('cov-tab-pe');
    if (peBtn) peBtn.textContent = `PE Firms (${coverage.pe_firms.length})`;
  } catch (e) {
    console.error('submitAddFirm error:', e);
    appAlert('Error adding firm: ' + e.message, { type: 'error' });
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
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:4px">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cov-add-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitAddCompany('${escapeHtml(searchId)}')">Add Company</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);
  setupTypeahead('modal-co-name', {
    filterType: null, // search all company types
    onSelect: function(company) {
      document.getElementById('modal-co-name').value = company.name;
      document.getElementById('modal-co-name').dataset.companyId = company.company_id;
      if (company.hq) document.getElementById('modal-co-hq').value = company.hq;
      if (company.revenue_tier) document.getElementById('modal-co-rev').value = company.revenue_tier;
      if (company.ownership_type) document.getElementById('modal-co-ownership').value = company.ownership_type;
    },
    onAddNew: function(name) {
      document.getElementById('modal-co-name').value = name;
      document.getElementById('modal-co-name').dataset.companyId = '';
    }
  });
  document.getElementById('modal-co-name').focus();
}

async function submitAddCompany(searchId) {
  const nameEl = document.getElementById('modal-co-name');
  const name = (nameEl.value || '').trim();
  if (!name) { appAlert('Company name is required.', { type: 'warning' }); return; }
  const hq = (document.getElementById('modal-co-hq').value || '').trim();
  const revenue_tier = document.getElementById('modal-co-rev').value;
  const ownership_type = (document.getElementById('modal-co-ownership').value || '').trim();
  const roles_to_target = (document.getElementById('modal-co-roles').value || '').trim();
  const why_target = (document.getElementById('modal-co-why').value || '').trim();

  const company_id = nameEl.dataset.companyId || slugify(name);

  try {
    // Only create company if it's a new entry
    if (!nameEl.dataset.companyId) {
      await api('POST', '/companies', { company_id, name, company_type: 'Private Company', hq, revenue_tier, ownership_type });
      _taCache = null;
    }

    // Add to coverage via the dedicated endpoint
    const coverage = await api('POST', `/searches/${searchId}/coverage/companies`, {
      company_id, name, hq, revenue_tier, ownership_type, why_target
    });

    document.getElementById('cov-add-modal').remove();
    const tableEl = document.getElementById('coverage-table');
    if (tableEl) tableEl.innerHTML = buildCompaniesTableHTML(coverage.companies, searchId);
    const coBtn = document.getElementById('cov-tab-companies');
    if (coBtn) coBtn.textContent = `Target Companies (${coverage.companies.length})`;
  } catch (e) {
    console.error('submitAddCompany error:', e);
    appAlert('Error adding company: ' + e.message, { type: 'error' });
  }
}

// ── Load from Playbook ────────────────────────────────────────────────────────

async function loadCoverageFromPlaybook(searchId) {
  try {
    // Step 1: Show sector picker
    const summary = await api('GET', '/playbooks/summary');
    const sectors = summary.sectors || [];

    const existing = document.getElementById('cov-add-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'cov-add-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center';

    const sectorCards = sectors.map(s => `
      <div onclick="loadPlaybookSectorPicker('${escapeHtml(searchId)}','${escapeHtml(s.sector_id)}')"
           style="padding:14px 18px;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s"
           onmouseover="this.style.background='#F3E8EF'" onmouseout="this.style.background='white'">
        <div>
          <div style="font-weight:700;font-size:14px">${escapeHtml(s.sector_name)}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${s.pe_firm_count} PE firms · ${s.target_company_count} companies</div>
        </div>
        <span style="color:#6B2D5B;font-size:18px">&#8250;</span>
      </div>
    `).join('');

    modal.innerHTML = `
    <div class="modal-box" style="max-width:520px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-header-s3">
        <span class="modal-title-s3">Load from Playbook</span>
        <button class="modal-close-s3" onclick="document.getElementById('cov-add-modal').remove()">&#x2715;</button>
      </div>
      <div style="font-size:12px;color:#888;padding:0 0 12px;border-bottom:1px solid #e0e0e0">Choose a sector playbook to load firms and companies from.</div>
      <div style="overflow-y:auto;flex:1;padding:8px 0;display:flex;flex-direction:column;gap:8px">
        ${sectorCards}
      </div>
    </div>`;
    document.body.appendChild(modal);

  } catch (e) {
    console.error('loadCoverageFromPlaybook error:', e);
    appAlert('Error: ' + e.message, { type: 'error' });
  }
}

async function loadPlaybookSectorPicker(searchId, sectorId) {
  try {
    const [sector, search] = await Promise.all([
      api('GET', '/playbooks/' + sectorId),
      api('GET', '/searches/' + searchId)
    ]);
    const coverage = search.sourcing_coverage || { pe_firms: [], companies: [] };
    const topFirmIds = new Set(sector.top_pe_firms || []);
    const topCoIds = new Set(sector.top_companies || []);

    // Filter out already loaded
    const availFirms = (sector.pe_firms || []).filter(f => !coverage.pe_firms.some(cf => cf.firm_id === f.firm_id));
    const availCos = (sector.target_companies || []).filter(c => !coverage.companies.some(cc => cc.company_id === c.company_id));

    const topFirmsAvail = availFirms.filter(f => topFirmIds.has(f.firm_id));
    const topCosAvail = availCos.filter(c => topCoIds.has(c.company_id));
    const hasTop = topFirmsAvail.length > 0 || topCosAvail.length > 0;

    const firmRows = availFirms.map(f => {
      const isTop = topFirmIds.has(f.firm_id);
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;cursor:pointer${isTop ? ';background:#faf5ff' : ''}">
        <input type="checkbox" class="pb-pick-firm" value="${escapeHtml(f.firm_id)}" style="width:16px;height:16px;accent-color:#6B2D5B">
        <strong>${escapeHtml(f.name)}</strong>${isTop ? '<span style="background:#6B2D5B;color:white;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:700;margin-left:4px">TOP</span>' : ''}
        <span style="color:#888;font-size:11px;margin-left:auto;white-space:nowrap">${escapeHtml(f.hq || '')} · ${escapeHtml(f.size_tier || '')}</span>
      </label>`;
    }).join('');

    const coRows = availCos.map(c => {
      const isTop = topCoIds.has(c.company_id);
      return `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:13px;cursor:pointer${isTop ? ';background:#faf5ff' : ''}">
        <input type="checkbox" class="pb-pick-co" value="${escapeHtml(c.company_id)}" style="width:16px;height:16px;accent-color:#6B2D5B">
        <strong>${escapeHtml(c.name)}</strong>${isTop ? '<span style="background:#6B2D5B;color:white;font-size:9px;padding:1px 6px;border-radius:8px;font-weight:700;margin-left:4px">TOP</span>' : ''}
        <span style="color:#888;font-size:11px;margin-left:auto;white-space:nowrap">${escapeHtml(c.hq || '')} · ${escapeHtml(c.revenue_tier || '')}</span>
      </label>`;
    }).join('');

    const quickLoadBtn = hasTop ? `
      <button class="btn btn-secondary btn-sm" style="width:100%" onclick="loadTopFromSector('${escapeHtml(searchId)}','${escapeHtml(sectorId)}')">
        &#9733; Add All Top Firms (${topFirmsAvail.length}) &amp; Companies (${topCosAvail.length})
      </button>` : '';

    const modal = document.getElementById('cov-add-modal');
    modal.innerHTML = `
    <div class="modal-box" style="max-width:640px;max-height:80vh;display:flex;flex-direction:column">
      <div class="modal-header-s3">
        <span class="modal-title-s3">${escapeHtml(sector.sector_name)} Playbook</span>
        <button class="modal-close-s3" onclick="document.getElementById('cov-add-modal').remove()">&#x2715;</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:0 0 12px;border-bottom:1px solid #e0e0e0">
        <button class="btn btn-ghost btn-sm" onclick="loadCoverageFromPlaybook('${escapeHtml(searchId)}')" style="font-size:12px">&#8249; Back to sectors</button>
        <span style="font-size:12px;color:#888">${availFirms.length} firms · ${availCos.length} companies available</span>
      </div>
      ${hasTop ? `<div style="padding:12px 0;border-bottom:1px solid #e0e0e0">${quickLoadBtn}</div>` : ''}
      <div style="overflow-y:auto;flex:1;padding:8px 0">
        ${availFirms.length > 0 ? `
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6B2D5B;letter-spacing:0.5px">PE Firms (${availFirms.length})</div>
            <label style="font-size:11px;color:#888;cursor:pointer"><input type="checkbox" onchange="document.querySelectorAll('.pb-pick-firm').forEach(c=>c.checked=this.checked)" style="margin-right:4px">Select All</label>
          </div>
          ${firmRows}` : ''}
        ${availCos.length > 0 ? `
          <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#6B2D5B;letter-spacing:0.5px">Target Companies (${availCos.length})</div>
            <label style="font-size:11px;color:#888;cursor:pointer"><input type="checkbox" onchange="document.querySelectorAll('.pb-pick-co').forEach(c=>c.checked=this.checked)" style="margin-right:4px">Select All</label>
          </div>
          ${coRows}` : ''}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid #e0e0e0">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('cov-add-modal').remove()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="submitPlaybookPick('${escapeHtml(searchId)}')">Add Selected</button>
      </div>
    </div>`;

  } catch (e) {
    console.error('loadPlaybookSectorPicker error:', e);
    appAlert('Error: ' + e.message, { type: 'error' });
  }
}

async function loadTopFromSector(searchId, sectorId) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Loading...';
  try {
    await api('POST', `/searches/${searchId}/coverage/seed`, { sector_id: sectorId, top_only: true });
    document.getElementById('cov-add-modal')?.remove();
    switchCoverageTab(coverageSubTab, searchId);
  } catch (e) {
    appAlert('Error: ' + e.message, { type: 'error' });
    btn.disabled = false;
    btn.textContent = 'Add All Top Firms & Companies';
  }
}

async function submitPlaybookPick(searchId) {
  const selectedFirmIds = [...document.querySelectorAll('.pb-pick-firm:checked')].map(c => c.value);
  const selectedCoIds = [...document.querySelectorAll('.pb-pick-co:checked')].map(c => c.value);

  if (selectedFirmIds.length === 0 && selectedCoIds.length === 0) {
    appAlert('Please select at least one firm or company.', { type: 'warning' });
    return;
  }

  try {
    const search = await api('GET', '/searches/' + searchId);
    const playbooks = await api('GET', '/playbooks');

    for (const sectorId of (search.sectors || [])) {
      const sector = playbooks.sectors.find(s => s.sector_id === sectorId);
      if (!sector) continue;

      for (const firm of (sector.pe_firms || [])) {
        if (selectedFirmIds.includes(firm.firm_id)) {
          await api('POST', `/searches/${searchId}/coverage/firms`, {
            firm_id: firm.firm_id, name: firm.name, hq: firm.hq || '', size_tier: firm.size_tier || '',
            strategy: firm.strategy || '', sector_focus: firm.sector_focus || '', why_target: firm.why_target || ''
          });
        }
      }
      for (const co of (sector.target_companies || [])) {
        if (selectedCoIds.includes(co.company_id)) {
          await api('POST', `/searches/${searchId}/coverage/companies`, {
            company_id: co.company_id, name: co.name, hq: co.hq || '', revenue_tier: co.revenue_tier || '',
            ownership_type: co.ownership_type || '', why_target: co.why_target || ''
          });
        }
      }
    }

    document.getElementById('cov-add-modal')?.remove();
    switchCoverageTab(coverageSubTab, searchId);
  } catch (e) {
    appAlert('Error: ' + e.message, { type: 'error' });
  }
}

// ── Multi-select delete for coverage entries ──────────────────────────────────

let _covSelectMode = false;

function toggleCovSelectMode(searchId) {
  _covSelectMode = !_covSelectMode;
  const tableEl = document.getElementById('coverage-table');
  if (!tableEl) return;

  if (_covSelectMode) {
    // Add checkboxes to each row
    tableEl.querySelectorAll('.firm-row').forEach(row => {
      const td = document.createElement('td');
      td.style.cssText = 'width:32px;text-align:center;padding:6px';
      td.innerHTML = `<input type="checkbox" class="cov-select-cb" value="${row.id.replace('row-','')}" style="width:16px;height:16px;accent-color:#c62828" onclick="event.stopPropagation()">`;
      row.insertBefore(td, row.firstChild);
    });
    // Show delete bar
    let bar = document.getElementById('cov-delete-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cov-delete-bar';
      bar.style.cssText = 'display:flex;gap:10px;align-items:center;padding:10px 0;margin-bottom:8px';
      bar.innerHTML = `
        <label style="font-size:12px;color:#888;cursor:pointer"><input type="checkbox" onchange="document.querySelectorAll('.cov-select-cb').forEach(c=>c.checked=this.checked)" style="margin-right:4px">Select All</label>
        <button class="btn btn-sm" style="background:#c62828;color:#fff;border:none" onclick="deleteSelectedCovEntries('${escapeHtml(searchId)}')">Delete Selected</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleCovSelectMode('${escapeHtml(searchId)}')">Cancel</button>
      `;
      const module = document.getElementById('coverage-module');
      if (module) module.insertBefore(bar, document.getElementById('coverage-table'));
    }
  } else {
    // Remove checkboxes and bar
    tableEl.querySelectorAll('.cov-select-cb').forEach(cb => cb.closest('td')?.remove());
    document.getElementById('cov-delete-bar')?.remove();
  }
}

async function deleteSelectedCovEntries(searchId) {
  const selected = [...document.querySelectorAll('.cov-select-cb:checked')].map(c => c.value);
  if (selected.length === 0) { appAlert('No items selected.', { type: 'warning' }); return; }
  if (!(await appConfirm(`Delete ${selected.length} selected entries from sourcing coverage?`))) return;

  try {
    const subPath = coverageSubTab === 'pe-firms' ? 'firms' : 'companies';

    // Delete each selected entry via the dedicated DELETE endpoint
    for (const entityId of selected) {
      await api('DELETE', `/searches/${searchId}/coverage/${subPath}/${entityId}`);
    }

    _covSelectMode = false;
    document.getElementById('cov-delete-bar')?.remove();

    // Re-fetch fresh data and re-render
    switchCoverageTab(coverageSubTab, searchId);
  } catch (e) {
    appAlert('Error deleting: ' + e.message, { type: 'error' });
  }
}
