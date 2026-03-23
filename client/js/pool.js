/* ── Lancor Search OS — pool.js — Session 5 ──────────────────────────────── */
/* Candidate Pool: master view, filters, detail panel, edit form, debrief flow */

'use strict';

// ── Module state ───────────────────────────────────────────────────────────────

let poolFilters = {
  sector: 'all',
  archetype: 'all',
  operator_background: 'all',
  firm_size_tier: 'all',
  company_revenue_tier: 'all',
  availability: 'all',
  rating: 'all',
  text: ''
};
let poolSortField = 'name';
let poolSortAsc = true;
let poolAllCandidates = [];

// ── Sector definitions ────────────────────────────────────────────────────────

const POOL_SECTORS = [
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

// ── Helper functions ──────────────────────────────────────────────────────────

function ratingStars(rating) {
  if (!rating) return '<span style="color:#ccc">—</span>';
  return '<span class="stars-display">' + '★'.repeat(rating) + '<span style="color:#ddd">' + '☆'.repeat(3 - rating) + '</span></span>';
}

function availabilityPill(availability) {
  const colors = {
    'Open':         { bg: '#e8f5e9', color: '#2e7d32' },
    'Passive':      { bg: '#fff3e0', color: '#e65100' },
    'Unknown':      { bg: '#f5f5f5', color: '#757575' },
    'Not Interested': { bg: '#ffebee', color: '#c62828' },
    'Placed':       { bg: '#e0f2f1', color: '#00695c' }
  };
  const c = colors[availability] || colors['Unknown'];
  return `<span style="background:${c.bg};color:${c.color};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${availability || 'Unknown'}</span>`;
}

function archetypePill(archetype) {
  const colors = {
    'PE Lateral':        { bg: '#f3e5f5', color: '#7b1fa2' },
    'Industry Operator': { bg: '#e3f2fd', color: '#1565c0' },
    'Functional Expert': { bg: '#e0f2f1', color: '#00695c' }
  };
  const c = colors[archetype] || { bg: '#f5f5f5', color: '#555' };
  return `<span style="background:${c.bg};color:${c.color};padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${archetype || '—'}</span>`;
}

function sectorAbbr(sectorId) {
  const map = {
    'industrials':           'Ind.',
    'technology-software':   'Tech',
    'tech-enabled-services': 'TES',
    'healthcare':            'HC',
    'financial-services':    'Fin.',
    'consumer':              'Con.',
    'business-services':     'BizSvc',
    'infrastructure-energy': 'Infra',
    'life-sciences':         'LS',
    'media-entertainment':   'Media',
    'real-estate-proptech':  'RE',
    'agriculture-fb':        'Ag/FB'
  };
  return map[sectorId] || sectorId;
}

function formatPoolDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function poolEscape(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── renderPool — main entry point ─────────────────────────────────────────────

async function renderPool() {
  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading candidate pool...</div>`;

  try {
    const data = await api('GET', '/candidates');
    poolAllCandidates = data.candidates || [];
    renderPoolView();
  } catch (err) {
    content.innerHTML = `<div class="error-banner">Failed to load pool: ${poolEscape(err.message)}</div>`;
  }
}

function renderPoolView() {
  const content = document.getElementById('app-content');
  const filtered = applyPoolFilters(poolAllCandidates);
  const sorted = sortPoolCandidates(filtered);

  content.innerHTML = `
    <div style="max-width:1400px;margin:0 auto">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:1.6rem;font-weight:800;color:#1a1a1a;margin-bottom:2px">Candidate Pool</h1>
          <div style="font-size:13px;color:#888">${poolAllCandidates.length} candidates total &bull; ${filtered.length} shown</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="openRunDebriefPicker()">&#9998; Run Debrief</button>
        </div>
      </div>

      <!-- Filter bar -->
      <div class="pool-filter-bar">
        <select id="pf-sector" onchange="onPoolFilterChange()">
          <option value="all">All Sectors</option>
          ${POOL_SECTORS.map(s => `<option value="${s.id}" ${poolFilters.sector === s.id ? 'selected' : ''}>${poolEscape(s.label)}</option>`).join('')}
        </select>
        <select id="pf-archetype" onchange="onPoolFilterChange()">
          <option value="all">All Archetypes</option>
          <option value="PE Lateral" ${poolFilters.archetype === 'PE Lateral' ? 'selected' : ''}>PE Lateral</option>
          <option value="Industry Operator" ${poolFilters.archetype === 'Industry Operator' ? 'selected' : ''}>Industry Operator</option>
          <option value="Functional Expert" ${poolFilters.archetype === 'Functional Expert' ? 'selected' : ''}>Functional Expert</option>
        </select>
        <select id="pf-op-bg" onchange="onPoolFilterChange()">
          <option value="all">All Backgrounds</option>
          <option value="Traditional Buyout" ${poolFilters.operator_background === 'Traditional Buyout' ? 'selected' : ''}>Traditional Buyout</option>
          <option value="Growth Scaling" ${poolFilters.operator_background === 'Growth Scaling' ? 'selected' : ''}>Growth Scaling</option>
          <option value="Distressed Turnaround" ${poolFilters.operator_background === 'Distressed Turnaround' ? 'selected' : ''}>Distressed Turnaround</option>
          <option value="Functional Expert" ${poolFilters.operator_background === 'Functional Expert' ? 'selected' : ''}>Functional Expert</option>
        </select>
        <select id="pf-firm-size" onchange="onPoolFilterChange()">
          <option value="all">All Firm Sizes</option>
          <option value="Mega" ${poolFilters.firm_size_tier === 'Mega' ? 'selected' : ''}>Mega</option>
          <option value="Large" ${poolFilters.firm_size_tier === 'Large' ? 'selected' : ''}>Large</option>
          <option value="Middle Market" ${poolFilters.firm_size_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
          <option value="Lower Middle Market" ${poolFilters.firm_size_tier === 'Lower Middle Market' ? 'selected' : ''}>Lower Middle Market</option>
        </select>
        <select id="pf-rev-tier" onchange="onPoolFilterChange()">
          <option value="all">All Revenue Tiers</option>
          <option value="Large Cap" ${poolFilters.company_revenue_tier === 'Large Cap' ? 'selected' : ''}>Large Cap</option>
          <option value="Upper Middle" ${poolFilters.company_revenue_tier === 'Upper Middle' ? 'selected' : ''}>Upper Middle</option>
          <option value="Middle Market" ${poolFilters.company_revenue_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
          <option value="Lower Middle" ${poolFilters.company_revenue_tier === 'Lower Middle' ? 'selected' : ''}>Lower Middle</option>
        </select>
        <select id="pf-avail" onchange="onPoolFilterChange()">
          <option value="all">All Availability</option>
          <option value="Open" ${poolFilters.availability === 'Open' ? 'selected' : ''}>Open</option>
          <option value="Passive" ${poolFilters.availability === 'Passive' ? 'selected' : ''}>Passive</option>
          <option value="Unknown" ${poolFilters.availability === 'Unknown' ? 'selected' : ''}>Unknown</option>
          <option value="Not Interested" ${poolFilters.availability === 'Not Interested' ? 'selected' : ''}>Not Interested</option>
          <option value="Placed" ${poolFilters.availability === 'Placed' ? 'selected' : ''}>Placed</option>
        </select>
        <select id="pf-rating" onchange="onPoolFilterChange()">
          <option value="all">All Ratings</option>
          <option value="3" ${poolFilters.rating === '3' ? 'selected' : ''}>★★★</option>
          <option value="2" ${poolFilters.rating === '2' ? 'selected' : ''}>★★</option>
          <option value="1" ${poolFilters.rating === '1' ? 'selected' : ''}>★</option>
          <option value="0" ${poolFilters.rating === '0' ? 'selected' : ''}>Unrated</option>
        </select>
        <input type="text" id="pf-text" placeholder="Search name, title, firm..." value="${poolEscape(poolFilters.text)}" oninput="onPoolFilterChange()" style="min-width:180px">
      </div>

      <!-- Table or empty state -->
      ${sorted.length === 0 ? renderPoolEmptyState() : renderPoolTable(sorted)}
    </div>
  `;
}

function renderPoolEmptyState() {
  if (poolAllCandidates.length === 0) {
    return `
      <div class="empty-state" style="text-align:center;padding:60px 20px;color:#888">
        <div style="font-size:48px">&#128100;</div>
        <h3 style="margin:16px 0 8px;color:#555">No candidates in pool yet</h3>
        <p style="max-width:420px;margin:0 auto">Candidates are added to the pool when you use Quick Add from a search, or run the debrief flow after closing a search.</p>
      </div>
    `;
  }
  return `<div style="text-align:center;padding:40px;color:#888">No candidates match the current filters.</div>`;
}

function renderPoolTable(candidates) {
  function th(label, field) {
    const arrow = poolSortField === field ? (poolSortAsc ? ' <span class="sort-arrow">&#9650;</span>' : ' <span class="sort-arrow">&#9660;</span>') : '';
    return `<th onclick="setPoolSort('${field}')">${label}${arrow}</th>`;
  }

  const rows = candidates.map(c => {
    const sectorPills = (c.sector_tags || []).map(sid =>
      `<span class="sector-tag-pill">${sectorAbbr(sid)}</span>`
    ).join('');
    const sizeTier = c.firm_size_tier || c.company_revenue_tier || '—';
    const searchCount = (c.search_history || []).length;

    return `
      <tr onclick="openCandidateDetail('${poolEscape(c.candidate_id)}')">
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="candidate-name-link">${poolEscape(c.name)}</span>
            ${c.linkedin_url ? `<a href="${poolEscape(c.linkedin_url)}" target="_blank" rel="noopener"
                onclick="event.stopPropagation()"
                title="Open LinkedIn profile"
                style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:#0A66C2;border-radius:4px;color:#fff;text-decoration:none;font-size:11px;font-weight:800;flex-shrink:0;">in</a>` : ''}
          </div>
          <div style="font-size:11px;color:#888;margin-top:2px">${poolEscape(c.current_title || '')}${c.current_firm ? ' @ ' + poolEscape(c.current_firm) : ''}</div>
        </td>
        <td style="color:#666;font-size:12px">${poolEscape(c.home_location || '—')}</td>
        <td>${sectorPills || '<span style="color:#ccc">—</span>'}</td>
        <td>${archetypePill(c.archetype)}</td>
        <td style="font-size:12px;color:#555">${Array.isArray(c.operator_background) ? (c.operator_background.length ? poolEscape(c.operator_background.join(', ')) : '—') : poolEscape(c.operator_background || '—')}</td>
        <td style="font-size:12px;color:#555">${poolEscape(sizeTier)}</td>
        <td>${ratingStars(c.quality_rating)}</td>
        <td>${availabilityPill(c.availability)}</td>
        <td style="font-size:12px;color:#888">${formatPoolDate(c.last_contact_date)}</td>
        <td style="text-align:center;font-size:12px;color:#888">${searchCount}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="overflow-x:auto">
      <table class="pool-table">
        <thead>
          <tr>
            ${th('Name', 'name')}
            ${th('Location', 'home_location')}
            ${th('Sectors', 'sector_tags')}
            ${th('Archetype', 'archetype')}
            ${th('Background', 'operator_background')}
            ${th('Size / Tier', 'firm_size_tier')}
            ${th('Rating', 'quality_rating')}
            ${th('Availability', 'availability')}
            ${th('Last Contact', 'last_contact_date')}
            ${th('Searches', 'search_history')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ── Filter + Sort ─────────────────────────────────────────────────────────────

function onPoolFilterChange() {
  poolFilters.sector             = document.getElementById('pf-sector').value;
  poolFilters.archetype          = document.getElementById('pf-archetype').value;
  poolFilters.operator_background = document.getElementById('pf-op-bg').value;
  poolFilters.firm_size_tier     = document.getElementById('pf-firm-size').value;
  poolFilters.company_revenue_tier = document.getElementById('pf-rev-tier').value;
  poolFilters.availability       = document.getElementById('pf-avail').value;
  poolFilters.rating             = document.getElementById('pf-rating').value;
  poolFilters.text               = document.getElementById('pf-text').value;
  renderPoolView();
}

function applyPoolFilters(candidates) {
  return candidates.filter(c => {
    if (poolFilters.sector !== 'all' && !(Array.isArray(c.sector_tags) && c.sector_tags.includes(poolFilters.sector))) return false;
    if (poolFilters.archetype !== 'all' && c.archetype !== poolFilters.archetype) return false;
    if (poolFilters.operator_background !== 'all') {
      const bg = c.operator_background;
      const match = Array.isArray(bg) ? bg.includes(poolFilters.operator_background) : bg === poolFilters.operator_background;
      if (!match) return false;
    }
    if (poolFilters.firm_size_tier !== 'all' && c.firm_size_tier !== poolFilters.firm_size_tier) return false;
    if (poolFilters.company_revenue_tier !== 'all' && c.company_revenue_tier !== poolFilters.company_revenue_tier) return false;
    if (poolFilters.availability !== 'all' && c.availability !== poolFilters.availability) return false;
    if (poolFilters.rating !== 'all') {
      if (poolFilters.rating === '0') {
        if (c.quality_rating) return false;
      } else {
        if (String(c.quality_rating) !== poolFilters.rating) return false;
      }
    }
    if (poolFilters.text) {
      const q = poolFilters.text.toLowerCase();
      const haystack = [c.name, c.current_title, c.current_firm].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function sortPoolCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    let va, vb;
    if (poolSortField === 'search_history') {
      va = (a.search_history || []).length;
      vb = (b.search_history || []).length;
    } else if (poolSortField === 'quality_rating') {
      va = a.quality_rating || 0;
      vb = b.quality_rating || 0;
    } else {
      va = (a[poolSortField] || '').toString().toLowerCase();
      vb = (b[poolSortField] || '').toString().toLowerCase();
    }
    if (va < vb) return poolSortAsc ? -1 : 1;
    if (va > vb) return poolSortAsc ? 1 : -1;
    return 0;
  });
}

function setPoolSort(field) {
  if (poolSortField === field) {
    poolSortAsc = !poolSortAsc;
  } else {
    poolSortField = field;
    poolSortAsc = true;
  }
  renderPoolView();
}

// ── Candidate Detail Panel ────────────────────────────────────────────────────

async function openCandidateDetail(candidateId) {
  // Remove any existing panel
  closeCandidateDetail();

  try {
    const candidate = await api('GET', '/candidates/' + candidateId);
    renderCandidateDetailPanel(candidate);
  } catch (err) {
    alert('Error loading candidate: ' + err.message);
  }
}

function closeCandidateDetail() {
  const existing = document.getElementById('candidate-detail-overlay');
  if (existing) existing.remove();
}

function renderCandidateDetailPanel(candidate) {
  const overlay = document.createElement('div');
  overlay.id = 'candidate-detail-overlay';
  overlay.className = 'detail-panel-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCandidateDetail(); });

  const sectorPills = (candidate.sector_tags || []).map(sid =>
    `<span class="sector-tag-pill">${poolEscape(sectorAbbr(sid))}</span>`
  ).join(' ');

  const searchHistoryRows = [...(candidate.search_history || [])].reverse().map(h => `
    <tr>
      <td>${poolEscape(h.client_name || h.search_id)}</td>
      <td>${poolEscape(h.stage_reached || '—')}</td>
      <td>${poolEscape(h.outcome || '—')}</td>
      <td style="color:#888">${poolEscape(h.notes || '')}</td>
    </tr>
  `).join('');

  const dqSection = (candidate.dq_reasons || []).length > 0 ? `
    <div class="detail-section">
      <details>
        <summary style="cursor:pointer;font-size:12px;font-weight:600;color:#c62828;text-transform:uppercase;letter-spacing:0.5px">
          DQ Reasons (${candidate.dq_reasons.length})
        </summary>
        <table class="history-table" style="margin-top:8px">
          <thead><tr><th>Search</th><th>Reason</th><th>Permanent</th></tr></thead>
          <tbody>
            ${(candidate.dq_reasons).map(d => `
              <tr>
                <td>${poolEscape(d.search_id)}</td>
                <td>${poolEscape(d.reason)}</td>
                <td>${d.permanent ? 'Yes' : 'No'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </details>
    </div>
  ` : '';

  const linkedinLink = candidate.linkedin_url
    ? `<a href="${poolEscape(candidate.linkedin_url)}" target="_blank" style="font-size:12px;color:#1565c0;text-decoration:none">&#128279; LinkedIn</a>`
    : '';

  overlay.innerHTML = `
    <div class="detail-panel" id="candidate-detail-panel">
      <!-- Header -->
      <div class="detail-panel-header">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:1.3rem;font-weight:800;margin:0 0 4px;color:#1a1a1a">${poolEscape(candidate.name)}</h2>
          <div style="font-size:13px;color:#555">${poolEscape(candidate.current_title || '')}${candidate.current_firm ? ' <span style="color:#aaa">@</span> ' + poolEscape(candidate.current_firm) : ''}</div>
          ${linkedinLink ? '<div style="margin-top:4px">' + linkedinLink + '</div>' : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;flex-shrink:0;margin-left:12px">
          <button class="btn btn-ghost btn-sm" onclick="openEditCandidateForm('${poolEscape(candidate.candidate_id)}')">&#9998; Edit</button>
          <button class="detail-panel-close" onclick="closeCandidateDetail()">&#10005;</button>
        </div>
      </div>

      <!-- Location -->
      <div class="detail-section">
        <div class="detail-label">Location</div>
        <div class="detail-value">${poolEscape(candidate.home_location || '—')}</div>
      </div>

      <!-- Tags row -->
      <div class="detail-section">
        <div class="detail-label">Profile</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">
          ${sectorPills}
          ${archetypePill(candidate.archetype)}
          ${(() => {
            const bg = candidate.operator_background;
            const list = Array.isArray(bg) ? bg : (bg ? [bg] : []);
            return list.map(b => `<span style="background:#f5f5f5;color:#555;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${poolEscape(b)}</span>`).join('');
          })()}
          ${candidate.owned_pl ? `<span style="background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">P&amp;L Owner</span>` : ''}
        </div>
      </div>

      <!-- Availability inline edit -->
      <div class="detail-section">
        <div class="detail-label">Availability</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          ${availabilityPill(candidate.availability)}
          <select id="detail-avail-select" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px" onchange="saveDetailField('${poolEscape(candidate.candidate_id)}', 'availability', this.value)">
            <option value="Open" ${candidate.availability === 'Open' ? 'selected' : ''}>Open</option>
            <option value="Passive" ${candidate.availability === 'Passive' ? 'selected' : ''}>Passive</option>
            <option value="Unknown" ${candidate.availability === 'Unknown' ? 'selected' : ''}>Unknown</option>
            <option value="Not Interested" ${candidate.availability === 'Not Interested' ? 'selected' : ''}>Not Interested</option>
            <option value="Placed" ${candidate.availability === 'Placed' ? 'selected' : ''}>Placed</option>
          </select>
        </div>
      </div>

      <!-- Rating inline edit -->
      <div class="detail-section">
        <div class="detail-label">Rating</div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:4px">
          ${ratingStars(candidate.quality_rating)}
          <select id="detail-rating-select" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px" onchange="saveDetailField('${poolEscape(candidate.candidate_id)}', 'quality_rating', this.value ? parseInt(this.value) : null)">
            <option value="" ${!candidate.quality_rating ? 'selected' : ''}>— Unrated</option>
            <option value="1" ${candidate.quality_rating === 1 ? 'selected' : ''}>★ (1)</option>
            <option value="2" ${candidate.quality_rating === 2 ? 'selected' : ''}>★★ (2)</option>
            <option value="3" ${candidate.quality_rating === 3 ? 'selected' : ''}>★★★ (3)</option>
          </select>
        </div>
      </div>

      <!-- Firm / Revenue Tier -->
      ${(candidate.firm_size_tier || candidate.company_revenue_tier) ? `
      <div class="detail-section">
        <div class="detail-label">Size / Revenue Tier</div>
        <div class="detail-value">${poolEscape([candidate.firm_size_tier, candidate.company_revenue_tier].filter(Boolean).join(' / '))}</div>
      </div>
      ` : ''}

      <!-- Notes inline edit -->
      <div class="detail-section">
        <div class="detail-label">Notes</div>
        <textarea id="detail-notes-ta" style="width:100%;min-height:70px;padding:8px;border:1px solid #ddd;border-radius:4px;font-size:13px;resize:vertical;box-sizing:border-box" onblur="saveDetailField('${poolEscape(candidate.candidate_id)}', 'notes', this.value)">${poolEscape(candidate.notes || '')}</textarea>
      </div>

      <!-- Work History -->
      ${(candidate.work_history && candidate.work_history.length) ? `
      <div class="detail-section">
        <div class="detail-label" style="margin-bottom:4px">Work History</div>
        <div style="font-size:11px;color:#aaa;margin-bottom:8px">Click an entry to set it as the primary experience</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${candidate.work_history.map((j, idx) => {
            const isPrimary = candidate.primary_experience_index === idx;
            return `<div
              onclick="setPrimaryExperience('${poolEscape(candidate.candidate_id)}', ${idx})"
              style="border-left:3px solid ${isPrimary ? '#5C2D91' : '#e0d4f5'};padding:6px 10px;background:${isPrimary ? '#f3ebff' : '#faf8ff'};border-radius:0 6px 6px 0;cursor:pointer;transition:background 0.15s"
              onmouseover="this.style.background='${isPrimary ? '#ecdeff' : '#f0ebff'}'"
              onmouseout="this.style.background='${isPrimary ? '#f3ebff' : '#faf8ff'}'">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                <div style="font-weight:600;font-size:13px;color:#1a1a1a">${poolEscape(j.title||'')}</div>
                ${isPrimary ? `<span style="font-size:10px;font-weight:700;color:#5C2D91;background:#e8d5ff;padding:2px 7px;border-radius:8px;flex-shrink:0">PRIMARY</span>` : ''}
              </div>
              <div style="font-size:12px;color:#555;margin-top:1px">${poolEscape(j.company||'')}</div>
              ${(j.dates||j.dateRange) ? `<div style="font-size:11px;color:#999;margin-top:2px">${poolEscape(j.dates||j.dateRange)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <!-- Search History -->
      <div class="detail-section">
        <div class="detail-label" style="margin-bottom:8px">Search History (${(candidate.search_history || []).length})</div>
        ${(candidate.search_history || []).length === 0
          ? '<div style="color:#aaa;font-size:13px">No search history</div>'
          : `<table class="history-table">
              <thead><tr><th>Client / Search</th><th>Stage Reached</th><th>Outcome</th><th>Notes</th></tr></thead>
              <tbody>${searchHistoryRows}</tbody>
            </table>`
        }
      </div>

      ${dqSection}

      <!-- Meta -->
      <div class="detail-section">
        <div style="font-size:11px;color:#aaa">
          Added ${formatPoolDate(candidate.date_added)}
          ${candidate.added_from_search ? ' &bull; From search: ' + poolEscape(candidate.added_from_search) : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Escape key closes panel
  document.addEventListener('keydown', _panelEscapeHandler);
}

function _panelEscapeHandler(e) {
  if (e.key === 'Escape') {
    closeCandidateDetail();
    document.removeEventListener('keydown', _panelEscapeHandler);
  }
}

async function saveDetailField(candidateId, field, value) {
  try {
    const updates = {};
    updates[field] = value;
    const updated = await api('PUT', '/candidates/' + candidateId, updates);
    // Update local cache
    const idx = poolAllCandidates.findIndex(c => c.candidate_id === candidateId);
    if (idx !== -1) poolAllCandidates[idx] = Object.assign({}, poolAllCandidates[idx], updates);
    // Re-render pill if availability changed
    if (field === 'availability') {
      const panel = document.getElementById('candidate-detail-panel');
      if (panel) {
        // Quick visual refresh — re-open with updated data
        closeCandidateDetail();
        renderCandidateDetailPanel(updated);
      }
    }
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}

async function setPrimaryExperience(candidateId, idx) {
  try {
    const candidate = poolAllCandidates.find(c => c.candidate_id === candidateId);
    if (!candidate || !candidate.work_history) return;
    const job = candidate.work_history[idx];
    if (!job) return;

    // Clean title: first segment before | or ·
    const cleanTitle = (job.title || '').split(/\s*[|·]\s*/)[0].trim();
    const cleanFirm  = (job.company || '').replace(/\s*[·•]\s*(full[- ]time|part[- ]time|contract|freelance|self[- ]employed).*$/i, '').trim();

    const updates = {
      current_title:            cleanTitle,
      current_firm:             cleanFirm,
      primary_experience_index: idx
    };

    const updated = await api('PUT', '/candidates/' + candidateId, updates);

    // Update local cache
    const cacheIdx = poolAllCandidates.findIndex(c => c.candidate_id === candidateId);
    if (cacheIdx !== -1) poolAllCandidates[cacheIdx] = Object.assign({}, poolAllCandidates[cacheIdx], updates);

    // Refresh detail panel
    closeCandidateDetail();
    renderCandidateDetailPanel(updated);

    // Refresh pool table row subtitle
    renderPoolView();
  } catch (err) {
    alert('Error setting primary experience: ' + err.message);
  }
}

// ── Edit Candidate Form ───────────────────────────────────────────────────────

async function openEditCandidateForm(candidateId) {
  let candidate;
  try {
    candidate = await api('GET', '/candidates/' + candidateId);
  } catch (err) {
    alert('Error loading candidate: ' + err.message);
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'edit-candidate-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';

  const sectorCheckboxes = POOL_SECTORS.map(s => `
    <label style="display:inline-flex;align-items:center;gap:5px;margin:4px 8px 4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" name="edit-sector" value="${s.id}" ${(candidate.sector_tags || []).includes(s.id) ? 'checked' : ''}>
      ${poolEscape(s.label)}
    </label>
  `).join('');

  const OP_BG_OPTIONS = ['Traditional Buyout', 'Growth Scaling', 'Distressed Turnaround', 'Functional Expert'];
  const opBgSelected = Array.isArray(candidate.operator_background)
    ? candidate.operator_background
    : (candidate.operator_background ? [candidate.operator_background] : []);
  const opBgCheckboxes = OP_BG_OPTIONS.map(opt => `
    <label style="display:inline-flex;align-items:center;gap:5px;margin:4px 12px 4px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" name="edit-op-bg" value="${opt}" ${opBgSelected.includes(opt) ? 'checked' : ''}>
      ${poolEscape(opt)}
    </label>
  `).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:10px;padding:28px;width:min(600px,95vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="margin:0;font-size:1.1rem;font-weight:700">Edit Candidate</h3>
        <button onclick="closeEditCandidateForm()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666">&#10005;</button>
      </div>

      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-control" id="ec-name" value="${poolEscape(candidate.name || '')}">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Current Title</label>
          <input class="form-control" id="ec-title" value="${poolEscape(candidate.current_title || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Current Firm</label>
          <input class="form-control" id="ec-firm" value="${poolEscape(candidate.current_firm || '')}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Home Location (City, State)</label>
          <input class="form-control" id="ec-location" value="${poolEscape(candidate.home_location || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">LinkedIn URL</label>
          <input class="form-control" id="ec-linkedin" value="${poolEscape(candidate.linkedin_url || '')}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Archetype</label>
          <select class="form-control" id="ec-archetype">
            <option value="PE Lateral" ${candidate.archetype === 'PE Lateral' ? 'selected' : ''}>PE Lateral</option>
            <option value="Industry Operator" ${candidate.archetype === 'Industry Operator' ? 'selected' : ''}>Industry Operator</option>
            <option value="Functional Expert" ${candidate.archetype === 'Functional Expert' ? 'selected' : ''}>Functional Expert</option>
          </select>
        </div>
        <div class="form-group" style="display:flex;flex-direction:column;justify-content:flex-end">
          <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:10px 0 2px">
            <input type="checkbox" id="ec-owned-pl" ${candidate.owned_pl ? 'checked' : ''} style="width:15px;height:15px;accent-color:#5C2D91">
            <span class="form-label" style="margin:0;text-transform:none;font-size:13px;font-weight:600;letter-spacing:0">Has Owned a P&amp;L</span>
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Operator Background</label>
        <div style="border:1px solid #ddd;border-radius:4px;padding:10px 14px">
          ${opBgCheckboxes}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Firm Size Tier</label>
          <select class="form-control" id="ec-firm-size">
            <option value="">— None</option>
            <option value="Mega" ${candidate.firm_size_tier === 'Mega' ? 'selected' : ''}>Mega</option>
            <option value="Large" ${candidate.firm_size_tier === 'Large' ? 'selected' : ''}>Large</option>
            <option value="Middle Market" ${candidate.firm_size_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
            <option value="Lower Middle Market" ${candidate.firm_size_tier === 'Lower Middle Market' ? 'selected' : ''}>Lower Middle Market</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Company Revenue Tier</label>
          <select class="form-control" id="ec-rev-tier">
            <option value="">— None</option>
            <option value="Large Cap" ${candidate.company_revenue_tier === 'Large Cap' ? 'selected' : ''}>Large Cap</option>
            <option value="Upper Middle" ${candidate.company_revenue_tier === 'Upper Middle' ? 'selected' : ''}>Upper Middle</option>
            <option value="Middle Market" ${candidate.company_revenue_tier === 'Middle Market' ? 'selected' : ''}>Middle Market</option>
            <option value="Lower Middle" ${candidate.company_revenue_tier === 'Lower Middle' ? 'selected' : ''}>Lower Middle</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Sector Tags</label>
        <div style="border:1px solid #ddd;border-radius:4px;padding:10px;max-height:120px;overflow-y:auto">
          ${sectorCheckboxes}
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-control" id="ec-notes" rows="3">${poolEscape(candidate.notes || '')}</textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:8px">
        <button class="btn btn-ghost" onclick="closeEditCandidateForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveEditCandidate('${poolEscape(candidate.candidate_id)}')">Save Changes</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeEditCandidateForm(); });
}

function closeEditCandidateForm() {
  const el = document.getElementById('edit-candidate-overlay');
  if (el) el.remove();
}

async function saveEditCandidate(candidateId) {
  const selectedSectors = Array.from(document.querySelectorAll('input[name="edit-sector"]:checked')).map(cb => cb.value);
  const selectedOpBg    = Array.from(document.querySelectorAll('input[name="edit-op-bg"]:checked')).map(cb => cb.value);

  const updates = {
    name:                 document.getElementById('ec-name').value.trim(),
    current_title:        document.getElementById('ec-title').value.trim(),
    current_firm:         document.getElementById('ec-firm').value.trim(),
    home_location:        document.getElementById('ec-location').value.trim(),
    linkedin_url:         document.getElementById('ec-linkedin').value.trim(),
    archetype:            document.getElementById('ec-archetype').value,
    operator_background:  selectedOpBg,
    owned_pl:             document.getElementById('ec-owned-pl').checked,
    firm_size_tier:       document.getElementById('ec-firm-size').value || null,
    company_revenue_tier: document.getElementById('ec-rev-tier').value || null,
    sector_tags:          selectedSectors,
    notes:                document.getElementById('ec-notes').value.trim()
  };

  try {
    const updated = await api('PUT', '/candidates/' + candidateId, updates);
    // Update local cache
    const idx = poolAllCandidates.findIndex(c => c.candidate_id === candidateId);
    if (idx !== -1) poolAllCandidates[idx] = Object.assign({}, poolAllCandidates[idx], updates);
    closeEditCandidateForm();
    // Refresh detail panel if open
    closeCandidateDetail();
    renderCandidateDetailPanel(updated);
    // Re-render pool table
    renderPoolView();
  } catch (err) {
    alert('Error saving: ' + err.message);
  }
}

// ── Run Debrief Picker (from pool header button) ──────────────────────────────

async function openRunDebriefPicker() {
  let allSearches;
  try {
    const data = await api('GET', '/searches?include=closed');
    allSearches = data.searches || [];
  } catch (err) {
    alert('Error loading searches: ' + err.message);
    return;
  }

  const closedSearches = allSearches.filter(s => s.status === 'closed');
  if (closedSearches.length === 0) {
    alert('No closed searches found. Close a search first to run a debrief.');
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'debrief-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';

  const options = closedSearches.map(s =>
    `<option value="${poolEscape(s.search_id)}">${poolEscape(s.client_name)} — ${poolEscape(s.role_title || s.search_id)}</option>`
  ).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:10px;padding:28px;width:min(440px,95vw);box-shadow:0 8px 40px rgba(0,0,0,0.2)">
      <h3 style="margin:0 0 16px;font-size:1.1rem;font-weight:700">Run Debrief</h3>
      <p style="font-size:13px;color:#666;margin-bottom:16px">Select a closed search to debrief:</p>
      <select id="debrief-picker-select" class="form-control" style="margin-bottom:20px">
        ${options}
      </select>
      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-ghost" onclick="document.getElementById('debrief-picker-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="pickAndDebrief()">Continue &#8594;</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function pickAndDebrief() {
  const select = document.getElementById('debrief-picker-select');
  if (!select) return;
  const searchId = select.value;
  document.getElementById('debrief-picker-overlay').remove();

  try {
    const search = await api('GET', '/searches/' + searchId);
    openDebriefFlow(search);
  } catch (err) {
    alert('Error loading search: ' + err.message);
  }
}

// ── Debrief Flow ──────────────────────────────────────────────────────────────

async function openDebriefFlow(search) {
  // Fetch current pool to check which candidates already debriefed
  let poolData;
  try {
    const data = await api('GET', '/candidates');
    poolData = data.candidates || [];
  } catch (err) {
    alert('Error loading pool: ' + err.message);
    return;
  }

  const pipeline = search.pipeline || [];
  if (pipeline.length === 0) {
    alert('This search has no pipeline candidates to debrief.');
    return;
  }

  // Include candidates not in pool OR in pool but missing this search in history
  const toDebrief = pipeline.filter(p => {
    const poolEntry = poolData.find(c => c.candidate_id === p.candidate_id);
    if (!poolEntry) return true;
    const alreadyInHistory = (poolEntry.search_history || []).some(h => h.search_id === search.search_id);
    return !alreadyInHistory;
  });

  const overlay = document.createElement('div');
  overlay.id = 'debrief-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2500;display:flex;align-items:center;justify-content:center;padding:20px';

  if (toDebrief.length === 0) {
    overlay.innerHTML = `
      <div style="background:white;border-radius:10px;padding:28px;width:min(480px,95vw);box-shadow:0 8px 40px rgba(0,0,0,0.2)">
        <h3 style="margin:0 0 12px;font-size:1.1rem;font-weight:700">Debrief: ${poolEscape(search.client_name)} — ${poolEscape(search.role_title || '')}</h3>
        <p style="color:#2e7d32;font-size:14px">&#10003; All candidates are already in the pool — nothing to debrief.</p>
        <div style="display:flex;justify-content:flex-end;margin-top:20px">
          <button class="btn btn-primary" onclick="document.getElementById('debrief-modal-overlay').remove()">Done</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return;
  }

  const candidateRows = toDebrief.map((p, i) => {
    const stageColor = {
      'Qualifying': '#2e7d32', 'Scheduling': '#e65100', 'Hold': '#4e342e',
      'DQ': '#c62828', 'NI': '#f57f17', 'Pursuing': '#616161', 'Outreach Sent': '#7b1fa2'
    }[p.stage] || '#555';
    return `
      <div class="debrief-candidate-row" id="debrief-row-${i}">
        <input type="checkbox" id="debrief-check-${i}" checked>
        <div>
          <div class="debrief-name">${poolEscape(p.name)}</div>
          <div class="debrief-sub">${poolEscape(p.current_title || '')}${p.current_firm ? ' @ ' + poolEscape(p.current_firm) : ''}</div>
          <span style="background:#f5f5f5;color:${stageColor};border-radius:8px;padding:2px 8px;font-size:10px;font-weight:600">${poolEscape(p.stage)}</span>
          <input type="hidden" id="debrief-cid-${i}" value="${poolEscape(p.candidate_id)}">
        </div>
        <select id="debrief-rating-${i}" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px">
          <option value="">— Rating</option>
          <option value="1">★ (1)</option>
          <option value="2">★★ (2)</option>
          <option value="3">★★★ (3)</option>
        </select>
        <select id="debrief-avail-${i}" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px">
          <option value="Unknown">Unknown</option>
          <option value="Open">Open</option>
          <option value="Passive">Passive</option>
          <option value="Not Interested">Not Interested</option>
          <option value="Placed">Placed</option>
        </select>
        <input type="text" id="debrief-outcome-${i}" placeholder="Outcome note..." style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;min-width:140px">
      </div>
    `;
  }).join('');

  overlay.innerHTML = `
    <div style="background:white;border-radius:10px;padding:28px;width:min(800px,95vw);max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.2)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <h3 style="margin:0;font-size:1.1rem;font-weight:700">Debrief: ${poolEscape(search.client_name)} — ${poolEscape(search.role_title || '')}</h3>
        <button onclick="document.getElementById('debrief-modal-overlay').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666">&#10005;</button>
      </div>
      <p style="font-size:13px;color:#666;margin-bottom:16px">${toDebrief.length} candidate${toDebrief.length !== 1 ? 's' : ''} to debrief. Check those to add/update in pool, set ratings and availability.</p>

      <div style="margin-bottom:20px">
        ${candidateRows}
      </div>

      <div id="debrief-result-msg" style="display:none;padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:16px"></div>

      <div style="display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-ghost" onclick="document.getElementById('debrief-modal-overlay').remove()">Cancel</button>
        <button class="btn btn-primary" id="debrief-submit-btn" onclick="submitDebrief('${poolEscape(search.search_id)}', ${toDebrief.length})">
          Add Selected to Pool
        </button>
        <button class="btn btn-ghost" id="debrief-done-btn" style="display:none" onclick="finishDebrief()">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function submitDebrief(searchId, count) {
  const candidates = [];
  for (let i = 0; i < count; i++) {
    const checkbox = document.getElementById('debrief-check-' + i);
    if (!checkbox || !checkbox.checked) continue;
    const candidateId = document.getElementById('debrief-cid-' + i).value;
    const ratingVal = document.getElementById('debrief-rating-' + i).value;
    const availability = document.getElementById('debrief-avail-' + i).value;
    const outcome = document.getElementById('debrief-outcome-' + i).value.trim();
    candidates.push({
      candidate_id: candidateId,
      rating: ratingVal ? parseInt(ratingVal) : null,
      availability: availability || 'Unknown',
      outcome
    });
  }

  if (candidates.length === 0) {
    alert('No candidates selected.');
    return;
  }

  const submitBtn = document.getElementById('debrief-submit-btn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

  try {
    const result = await api('POST', '/searches/' + searchId + '/debrief', { candidates });
    const msgEl = document.getElementById('debrief-result-msg');
    if (msgEl) {
      const allStarCount = candidates.filter(c => c.rating >= 2).length;
      msgEl.style.display = 'block';
      msgEl.style.background = '#e8f5e9';
      msgEl.style.color = '#2e7d32';
      msgEl.innerHTML = `&#10003; Added <strong>${result.added}</strong> candidates, updated <strong>${result.updated}</strong> existing records.${allStarCount > 0 ? ` <strong>${allStarCount}</strong> promoted to all-star pool.` : ''}`;
    }
    if (submitBtn) submitBtn.style.display = 'none';
    const doneBtn = document.getElementById('debrief-done-btn');
    if (doneBtn) doneBtn.style.display = 'inline-block';

    // Refresh pool data
    const freshData = await api('GET', '/candidates');
    poolAllCandidates = freshData.candidates || [];
  } catch (err) {
    const msgEl = document.getElementById('debrief-result-msg');
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.background = '#ffebee';
      msgEl.style.color = '#c62828';
      msgEl.textContent = 'Error: ' + err.message;
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Add Selected to Pool'; }
  }
}

function finishDebrief() {
  const overlay = document.getElementById('debrief-modal-overlay');
  if (overlay) overlay.remove();
  renderPoolView();
}
