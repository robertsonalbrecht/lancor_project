/* ── Lancor Search OS — app.js ────────────────────────────────────────────── */
/* Navigation controller, API utility, home overview                          */

'use strict';

// ── Firm name normalization (shared across modules) ───────────────────────────

function normalizeFirmName(name) {
  if (!name) return '';
  return name
    .replace(/\s*·\s*(Full-time|Part-time|Contract|Seasonal|Internship|Self-employed|Freelance)/gi, '')
    .replace(/\s*\(.*?\)\s*/g, '')  // strip parenthetical like (GCI)
    .trim()
    .toLowerCase();
}

function firmNamesMatch(a, b, aliases) {
  const na = normalizeFirmName(a);
  const nb = normalizeFirmName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Contains match: the shorter string must be at least 60% the length of the longer
  // This prevents "L Capital" from matching "Arsenal Capital Partners"
  if (na.length >= 4 && nb.length >= 4) {
    const shorter = na.length <= nb.length ? na : nb;
    const longer = na.length > nb.length ? na : nb;
    if (longer.includes(shorter) && shorter.length >= longer.length * 0.6) return true;
  }
  // Check aliases if provided
  if (aliases && aliases.length) {
    const normalizedAliases = aliases.map(normalizeFirmName);
    if (normalizedAliases.some(al => al && al === na)) return true;
  }
  return false;
}

// Company alias cache — loaded once, used by firmNamesMatchWithPool
let _companyAliasCache = null;

async function loadCompanyAliases() {
  if (_companyAliasCache) return _companyAliasCache;
  try {
    const resp = await api('GET', '/companies');
    const companies = resp.companies || [];
    _companyAliasCache = {};
    companies.forEach(c => {
      const key = normalizeFirmName(c.name);
      if (key) {
        _companyAliasCache[key] = (c.aliases || []);
        // Also map each alias back to the primary name's aliases
        (c.aliases || []).forEach(alias => {
          const ak = normalizeFirmName(alias);
          if (ak) _companyAliasCache[ak] = [c.name, ...(c.aliases || []).filter(a => normalizeFirmName(a) !== ak)];
        });
      }
    });
  } catch (e) {
    _companyAliasCache = {};
  }
  return _companyAliasCache;
}

function invalidateAliasCache() { _companyAliasCache = null; }

function firmNamesMatchWithAliases(a, b, aliasMap) {
  if (firmNamesMatch(a, b)) return true;
  if (!aliasMap) return false;
  const na = normalizeFirmName(a);
  const nb = normalizeFirmName(b);
  const aliasesA = aliasMap[na] || [];
  const aliasesB = aliasMap[nb] || [];
  if (firmNamesMatch(a, b, aliasesA)) return true;
  if (firmNamesMatch(a, b, aliasesB)) return true;
  return false;
}

// ── API utility ───────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method: method.toUpperCase(),
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Date formatter ────────────────────────────────────────────────────────────

function formatDate(isoString) {
  if (!isoString) return '—';
  try {
    const d = new Date(isoString + (isoString.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return isoString;
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

let currentModule = null;

// ── Navigation History ────────────────────────────────────────────────────────
let _navHistory = ['home'];
let _navIndex = 0;
let _navFromHistory = false;

function navGoHome() {
  navigateTo(null);
}
function navGoBack() {
  if (_navIndex > 0) {
    _navIndex--;
    _navFromHistory = true;
    const target = _navHistory[_navIndex];
    navigateTo(target === 'home' ? null : target);
  }
}
function navGoForward() {
  if (_navIndex < _navHistory.length - 1) {
    _navIndex++;
    _navFromHistory = true;
    const target = _navHistory[_navIndex];
    navigateTo(target === 'home' ? null : target);
  }
}

function navigateTo(module) {
  currentModule = module;

  // Track navigation history
  const entry = module || 'home';
  if (!_navFromHistory) {
    // Trim forward history and push new entry
    _navHistory = _navHistory.slice(0, _navIndex + 1);
    if (_navHistory[_navHistory.length - 1] !== entry) {
      _navHistory.push(entry);
      _navIndex = _navHistory.length - 1;
    }
  }
  _navFromHistory = false;

  // Update active nav link
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.module === module);
  });

  const content = document.getElementById('app-content');

  switch (module) {
    case 'playbooks':
      if (typeof renderPlaybooks === 'function') renderPlaybooks();
      break;
    case 'searches':
      if (typeof renderSearches === 'function') renderSearches();
      break;
    case 'companies':
      if (typeof renderCompanies === 'function') renderCompanies();
      break;
    case 'pool':
      if (typeof renderPool === 'function') renderPool();
      break;
    case 'templates':
      if (typeof renderTemplates === 'function') renderTemplates();
      break;
    case 'settings':
      content.innerHTML = `
        <div class="module-placeholder">
          <div class="empty-state-icon">&#9881;</div>
          <h2>Settings</h2>
          <p>Settings panel coming in a future session.</p>
        </div>`;
      break;
    default:
      loadHome();
  }
}

// ── Duration calculator for work history ───────────────────────────────────────

function _calcDuration(dateStr) {
  if (!dateStr) return '';
  // Already has duration embedded like "Jan 2023 - Present · 3 yrs 2 mos"
  const embeddedMatch = dateStr.match(/·\s*(.+)$/);
  if (embeddedMatch) return embeddedMatch[1].trim();
  // Parse "Mon YYYY - Mon YYYY" or "YYYY - YYYY" or "Mon YYYY - Present"
  const parts = dateStr.split(/\s*[-–]\s*/);
  if (parts.length < 2) return '';
  const parseDate = s => {
    const s2 = s.trim();
    if (/present/i.test(s2)) return new Date();
    const ym = s2.match(/(?:(\w+)\s+)?(\d{4})/);
    if (!ym) return null;
    const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    const m = ym[1] ? (months[ym[1].toLowerCase().slice(0,3)] ?? 0) : 0;
    return new Date(parseInt(ym[2]), m);
  };
  const start = parseDate(parts[0]);
  const end = parseDate(parts[1]);
  if (!start || !end) return '';
  let totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (totalMonths < 0) totalMonths = 0;
  const yrs = Math.floor(totalMonths / 12);
  const mos = totalMonths % 12;
  if (yrs === 0 && mos === 0) return '< 1 mo';
  let result = '';
  if (yrs > 0) result += yrs + ' yr' + (yrs > 1 ? 's' : '');
  if (mos > 0) result += (result ? ' ' : '') + mos + ' mo' + (mos > 1 ? 's' : '');
  return result;
}

// ── Candidate Profile Panel (slide-in from right) ─────────────────────────────

function closeCandidatePanel() {
  const panel = document.getElementById('candidate-panel-overlay');
  if (panel) panel.remove();
}

async function openCandidatePanel(candidateId) {
  closeCandidatePanel();
  // Try fetching by candidate_id first
  let candidate;
  try {
    candidate = await api('GET', '/candidates/' + encodeURIComponent(candidateId));
  } catch (e) {
    // If not found by ID, search by name
    try {
      const resp = await api('GET', '/candidates');
      candidate = (resp.candidates || []).find(c =>
        c.candidate_id === candidateId || c.name === candidateId
      );
    } catch (e2) { /* ignore */ }
  }
  if (!candidate) { alert('Candidate not found.'); return; }
  renderCandidatePanel(candidate);
}

function _escPanel(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCandidatePanel(c) {
  const overlay = document.createElement('div');
  overlay.id = 'candidate-panel-overlay';
  overlay.className = 'cand-panel-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCandidatePanel(); });

  const linkedinBtn = c.linkedin_url
    ? `<a href="${_escPanel(c.linkedin_url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="color:#0077B5;display:inline-flex;align-items:center;gap:4px"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> LinkedIn</a>`
    : '';

  const sectorPills = (c.sector_tags || []).map(t => {
    const labels = {'industrials':'Industrials','technology-software':'Technology','healthcare':'Healthcare','financial-services':'Financial Services','consumer':'Consumer','business-services':'Business Services','infrastructure-energy':'Infrastructure','life-sciences':'Life Sciences','media-entertainment':'Media','real-estate-proptech':'Real Estate','agriculture-fb':'Agriculture'};
    return `<span style="background:#EDE7F6;color:#5C2D91;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${labels[t]||t}</span>`;
  }).join('');

  const rating = c.quality_rating != null
    ? `<span style="color:#ff9800;font-size:14px">${'★'.repeat(c.quality_rating)}${'☆'.repeat(3-c.quality_rating)}</span>`
    : `<span style="color:#ccc;font-size:12px">Unrated</span>`;

  // Group consecutive entries at the same company
  const whEntries = c.work_history || [];
  const whGroups = [];
  whEntries.forEach((w, idx) => {
    const co = normalizeFirmName(w.company || '');
    const lastGroup = whGroups[whGroups.length - 1];
    if (lastGroup && normalizeFirmName(lastGroup.company) === co && co) {
      lastGroup.roles.push({ ...w, _idx: idx });
    } else {
      whGroups.push({ company: w.company || '', roles: [{ ...w, _idx: idx }] });
    }
  });

  const workHistory = whGroups.map(group => {
    const isMulti = group.roles.length > 1;
    // Get logo from first role in group
    const logoUrl = group.roles[0].logo_url || group.roles[0].logoUrl || '';
    const logoImg = logoUrl
      ? `<img src="${_escPanel(logoUrl)}" style="width:36px;height:36px;border-radius:6px;object-fit:contain;background:#f5f5f5;flex-shrink:0" onerror="this.style.display='none'">`
      : `<div style="width:36px;height:36px;border-radius:6px;background:#f0f0f0;flex-shrink:0"></div>`;

    const roleHTML = (w, showCompany) => {
      const idx = w._idx;
      const isCurrent = (w.dates || '').toLowerCase().includes('present');
      const isPrimary = c.primary_experience_index === idx;
      const barColor = isPrimary ? '#5C2D91' : isCurrent ? '#4caf50' : '#e0e0e0';
      const bgColor = isPrimary ? '#f3ebff' : isCurrent ? '#f8fdf8' : 'transparent';
      const hoverBg = isPrimary ? '#ecdeff' : isCurrent ? '#f0faf0' : '#f9f6fd';
      return `<div onclick="setCandidatePrimaryExperience('${_escPanel(c.candidate_id)}', ${idx})"
        style="display:flex;gap:10px;padding:8px 0;cursor:pointer;background:${bgColor};transition:background 0.15s;${isMulti ? 'margin-left:48px;border-left:2px solid #e0e0e0;padding-left:12px;' : ''}"
        onmouseover="this.style.background='${hoverBg}'" onmouseout="this.style.background='${bgColor}'">
        <div style="width:4px;border-radius:3px;background:${barColor};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <div style="font-weight:600;font-size:13px;color:#1a1a1a">${_escPanel(w.title || '')}</div>
            ${isPrimary ? `<span style="font-size:10px;font-weight:700;color:#5C2D91;background:#e8d5ff;padding:2px 7px;border-radius:8px;flex-shrink:0">PRIMARY</span>` : ''}
          </div>
          ${w.dates ? `<div style="font-size:11px;color:#999;margin-top:2px">${_escPanel(w.dates)}${(() => { const d = w.duration || _calcDuration(w.dates); return d ? ' · ' + d : ''; })()}</div>` : ''}
          ${w.description ? `<div style="font-size:12px;color:#666;margin-top:4px;line-height:1.5">${_escPanel(w.description)}</div>` : ''}
        </div>
      </div>`;
    };

    // Calculate tenure span for header
    const firstDates = group.roles[group.roles.length - 1].dates || '';
    const lastDates = group.roles[0].dates || '';
    const startYear = (firstDates.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
    const endPart = lastDates.toLowerCase().includes('present') ? 'Present' : (lastDates.match(/\b(19|20)\d{2}\b/g) || []).pop() || '';
    const tenureLabel = startYear && endPart ? `${startYear} - ${endPart}` : '';
    const totalDuration = startYear && endPart ? _calcDuration(startYear + ' - ' + endPart) : '';
    const rolesLabel = isMulti ? ` · ${group.roles.length} roles` : '';

    // Company header (shown for both single and multi)
    const companyHeader = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:${isMulti ? '6' : '0'}px">
        ${logoImg}
        <div>
          <div style="font-size:13px;font-weight:700;color:#5C2D91">${_escPanel(group.company)}</div>
          ${tenureLabel ? `<div style="font-size:11px;color:#999">${_escPanel(tenureLabel)}${totalDuration ? ' · ' + totalDuration : ''}${rolesLabel}</div>` : ''}
        </div>
      </div>`;

    if (isMulti) {
      return `<div style="margin:0 -16px;padding:12px 16px;border-bottom:1px solid #f0f0f0">
        ${companyHeader}
        ${group.roles.map(w => roleHTML(w, false)).join('')}
      </div>`;
    } else {
      const w = group.roles[0];
      const idx = w._idx;
      const isCurrent = (w.dates || '').toLowerCase().includes('present');
      const isPrimary = c.primary_experience_index === idx;
      const bgColor = isPrimary ? '#f3ebff' : isCurrent ? '#f8fdf8' : 'transparent';
      const hoverBg = isPrimary ? '#ecdeff' : isCurrent ? '#f0faf0' : '#f9f6fd';
      const barColor = isPrimary ? '#5C2D91' : isCurrent ? '#4caf50' : '#e0e0e0';
      return `<div onclick="setCandidatePrimaryExperience('${_escPanel(c.candidate_id)}', ${idx})"
        style="margin:0 -16px;padding:10px 16px;border-bottom:1px solid #f0f0f0;cursor:pointer;background:${bgColor};transition:background 0.15s;display:flex;gap:10px"
        onmouseover="this.style.background='${hoverBg}'" onmouseout="this.style.background='${bgColor}'">
        ${logoImg}
        <div style="width:4px;border-radius:3px;background:${barColor};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:#5C2D91">${_escPanel(w.company || '')}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
            <div style="font-weight:600;font-size:13px;color:#1a1a1a">${_escPanel(w.title || '')}</div>
            ${isPrimary ? `<span style="font-size:10px;font-weight:700;color:#5C2D91;background:#e8d5ff;padding:2px 7px;border-radius:8px;flex-shrink:0">PRIMARY</span>` : ''}
          </div>
          ${w.dates ? `<div style="font-size:11px;color:#999;margin-top:2px">${_escPanel(w.dates)}${(() => { const d = w.duration || _calcDuration(w.dates); return d ? ' · ' + d : ''; })()}</div>` : ''}
          ${w.description ? `<div style="font-size:12px;color:#666;margin-top:4px;line-height:1.5">${_escPanel(w.description)}</div>` : ''}
        </div>
      </div>`;
    }
  }).join('');

  const searchHistory = (c.search_history || []).map(h =>
    `<div style="padding:6px 0;border-bottom:1px solid #f5f5f5;font-size:12px">
      <span style="font-weight:600">${_escPanel(h.client_name || h.search_id)}</span>
      <span style="color:#888;margin-left:6px">Stage: ${_escPanel(h.stage_reached || '—')}</span>
      ${h.outcome ? `<span style="color:#888;margin-left:6px">· ${_escPanel(h.outcome)}</span>` : ''}
    </div>`
  ).join('') || '<div style="color:#bbb;font-size:12px">No search history</div>';

  const dqReasons = (c.dq_reasons || []).filter(d => d.reason).map(d =>
    `<div style="padding:4px 0;font-size:12px;color:#c62828">${_escPanel(d.reason)} <span style="color:#999">(${_escPanel(d.search_id)})</span></div>`
  ).join('');

  const cId = _escPanel(c.candidate_id);
  const _q = s => _escPanel(s||'').replace(/'/g,"\\'");

  // Archetype & availability options for edit mode
  const archetypeOpts = ['','PE Lateral','Industry Operator','Functional Expert','Founder/Entrepreneur','Consultant'].map(a =>
    `<option value="${a}" ${(c.archetype||'')===a?'selected':''}>${a||'— None —'}</option>`).join('');
  const availOpts = ['Unknown','Available','Passive','Not Available','Employed - Open','Employed - Not Looking'].map(a =>
    `<option value="${a}" ${(c.availability||'Unknown')===a?'selected':''}>${a}</option>`).join('');
  const ratingOpts = [0,1,2,3].map(r =>
    `<option value="${r}" ${(c.quality_rating||0)===r?'selected':''}>${r===0?'Unrated':'★'.repeat(r)}</option>`).join('');

  const photoImg = c.photo_url
    ? `<img src="${_escPanel(c.photo_url)}" alt="" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid #e0e0e0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
       <div style="width:52px;height:52px;border-radius:50%;background:#e0e0e0;display:none;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;font-weight:700;color:#888">${(c.name || '?')[0].toUpperCase()}</div>`
    : `<div style="width:52px;height:52px;border-radius:50%;background:#e0e0e0;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px;font-weight:700;color:#888">${(c.name || '?')[0].toUpperCase()}</div>`;

  overlay.innerHTML = `
    <div class="cand-panel">
      <div class="cand-panel-header">
        ${photoImg}
        <div style="flex:1;min-width:0;margin-left:12px">
          <h2 style="font-size:1.2rem;font-weight:800;margin:0 0 2px;color:#1a1a1a" id="cp-name-display">${_escPanel(c.name)}</h2>
          <div style="font-size:13px;color:#555" id="cp-subtitle-display">${_escPanel(c.current_title || '')}${c.current_firm ? ' @ ' + _escPanel(c.current_firm) : ''}</div>
          <div style="font-size:12px;color:#888;margin-top:2px">${_escPanel(c.home_location || c.location || '')}</div>
        </div>
        <div style="display:flex;gap:6px;align-items:flex-start;flex-shrink:0">
          <button class="btn btn-primary btn-sm" onclick="openAddToPipelineModal({candidate_id:'${cId}',name:'${_q(c.name)}',current_title:'${_q(c.current_title)}',current_firm:'${_q(c.current_firm)}',location:'${_q(c.home_location||c.location)}',linkedin_url:'${_q(c.linkedin_url)}',archetype:'${_q(c.archetype)}'})">+ Pipeline</button>
          <button class="btn btn-ghost btn-sm" id="cp-edit-btn" onclick="toggleCandidateEditMode('${cId}')">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="openMergeModal('${cId}')" title="Merge with duplicate">Merge</button>
          ${linkedinBtn}
          <button class="cand-panel-close" onclick="closeCandidatePanel()">&#10005;</button>
        </div>
      </div>

      <div class="cand-panel-body">
        <!-- Edit form (hidden by default) -->
        <div id="cp-edit-form" style="display:none;margin-bottom:20px;background:#f9f6fd;border-radius:8px;padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Name</label>
              <input class="form-control" id="cp-edit-name" value="${_escPanel(c.name)}">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">LinkedIn URL</label>
              <input class="form-control" id="cp-edit-linkedin" value="${_escPanel(c.linkedin_url||'')}" placeholder="https://linkedin.com/in/...">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Title</label>
              <input class="form-control" id="cp-edit-title" value="${_escPanel(c.current_title||'')}">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Firm</label>
              <input class="form-control" id="cp-edit-firm" value="${_escPanel(c.current_firm||'')}">
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Location</label>
              <input class="form-control" id="cp-edit-location" value="${_escPanel(c.home_location||c.location||'')}">
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Archetype</label>
              <select class="form-control" id="cp-edit-archetype">${archetypeOpts}</select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Availability</label>
              <select class="form-control" id="cp-edit-availability">${availOpts}</select>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">Rating</label>
              <select class="form-control" id="cp-edit-rating">${ratingOpts}</select>
            </div>
          </div>
          <div class="form-group" style="margin-bottom:10px">
            <label class="form-label">Notes</label>
            <textarea class="form-control" id="cp-edit-notes" rows="3">${_escPanel(c.notes||'')}</textarea>
          </div>

          <!-- Work History Editor -->
          <div style="margin-bottom:10px">
            <label class="form-label">Work History</label>
            <div id="cp-edit-wh-list">
              ${(c.work_history || []).map((w, i) => `
                <div class="cp-wh-entry" data-idx="${i}" style="display:grid;grid-template-columns:1fr 1fr auto;gap:6px;margin-bottom:6px;padding:8px 10px;background:#fff;border:1px solid #e0e0e0;border-radius:6px;align-items:start">
                  <div>
                    <input class="form-control" style="font-size:12px;padding:4px 8px;margin-bottom:4px" value="${_escPanel(w.title||'')}" placeholder="Title" data-field="title">
                    <input class="form-control" style="font-size:12px;padding:4px 8px" value="${_escPanel(w.company||'')}" placeholder="Company" data-field="company">
                  </div>
                  <div>
                    <input class="form-control" style="font-size:12px;padding:4px 8px;margin-bottom:4px" value="${_escPanel(w.dates||'')}" placeholder="Dates (e.g. 2020 - Present)" data-field="dates">
                    <input class="form-control" style="font-size:12px;padding:4px 8px" value="${_escPanel(w.duration||'')}" placeholder="Duration" data-field="duration">
                  </div>
                  <button onclick="this.closest('.cp-wh-entry').remove()" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:14px;padding:4px;margin-top:2px" title="Remove">&#10005;</button>
                </div>`).join('')}
            </div>
            <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="addEditWorkHistoryEntry()">+ Add Work History Entry</button>
          </div>

          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" onclick="toggleCandidateEditMode()">Cancel</button>
            <button class="btn btn-primary btn-sm" id="cp-save-btn" onclick="saveCandidateEdits('${cId}')">Save Changes</button>
          </div>
        </div>

        <!-- Read-only view -->
        <div id="cp-read-view">
          <!-- Quick info -->
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;align-items:center">
            ${c.archetype ? `<span style="background:#f3e8ff;color:#7c3aed;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${_escPanel(c.archetype)}</span>` : ''}
            ${c.availability ? `<span style="background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600">${_escPanel(c.availability)}</span>` : ''}
            ${rating}
          </div>

          ${sectorPills ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:16px">${sectorPills}</div>` : ''}

          <!-- Details grid -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px;margin-bottom:20px;padding:12px;background:#f9f9f9;border-radius:8px">
            ${c.firm_size_tier ? `<div><span style="color:#888">Firm Size:</span> ${_escPanel(c.firm_size_tier)}</div>` : ''}
            ${c.company_revenue_tier ? `<div><span style="color:#888">Revenue Tier:</span> ${_escPanel(c.company_revenue_tier)}</div>` : ''}
            ${c.operator_background ? `<div><span style="color:#888">Background:</span> ${_escPanel(Array.isArray(c.operator_background) ? c.operator_background.join(', ') : c.operator_background)}</div>` : ''}
            ${c.owned_pl ? `<div><span style="color:#888">Owned P&L:</span> Yes</div>` : ''}
            ${c.last_contact_date ? `<div><span style="color:#888">Last Contact:</span> ${_escPanel(c.last_contact_date)}</div>` : ''}
            ${c.date_added ? `<div><span style="color:#888">Added:</span> ${_escPanel(c.date_added)}</div>` : ''}
          </div>
        </div>

        <!-- Work History -->
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:4px">Work History (${(c.work_history||[]).length})</div>
          <div style="font-size:11px;color:#bbb;margin-bottom:8px">Click an entry to set it as the primary experience</div>
          ${workHistory || '<div style="color:#bbb;font-size:12px">No work history available</div>'}
        </div>

        <!-- Search History -->
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Search History</div>
          ${searchHistory}
        </div>

        ${dqReasons ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">DQ Reasons</div>
          ${dqReasons}
        </div>` : ''}

        <!-- Notes -->
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:#999;letter-spacing:0.8px;margin-bottom:8px">Notes</div>
          <div style="font-size:12px;color:#444;white-space:pre-wrap;line-height:1.5">${_escPanel(c.notes || 'No notes')}</div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.addEventListener('keydown', _candidatePanelEsc);
}

function _candidatePanelEsc(e) {
  if (e.key === 'Escape') { closeCandidatePanel(); document.removeEventListener('keydown', _candidatePanelEsc); }
}

function toggleCandidateEditMode(candidateId) {
  const form = document.getElementById('cp-edit-form');
  const readView = document.getElementById('cp-read-view');
  const editBtn = document.getElementById('cp-edit-btn');
  if (!form) return;
  const isEditing = form.style.display !== 'none';
  if (isEditing) {
    // Cancel — hide form, show read view
    form.style.display = 'none';
    if (readView) readView.style.display = '';
    if (editBtn) editBtn.textContent = 'Edit';
  } else {
    // Show form, hide read view
    form.style.display = '';
    if (readView) readView.style.display = 'none';
    if (editBtn) editBtn.textContent = 'Cancel';
    document.getElementById('cp-edit-name')?.focus();
  }
}

function addEditWorkHistoryEntry() {
  const list = document.getElementById('cp-edit-wh-list');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'cp-wh-entry';
  div.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto;gap:6px;margin-bottom:6px;padding:8px 10px;background:#fff;border:1px solid #e0e0e0;border-radius:6px;align-items:start';
  div.innerHTML = `
    <div>
      <input class="form-control" style="font-size:12px;padding:4px 8px;margin-bottom:4px" placeholder="Title" data-field="title">
      <input class="form-control" style="font-size:12px;padding:4px 8px" placeholder="Company" data-field="company">
    </div>
    <div>
      <input class="form-control" style="font-size:12px;padding:4px 8px;margin-bottom:4px" placeholder="Dates (e.g. 2020 - Present)" data-field="dates">
      <input class="form-control" style="font-size:12px;padding:4px 8px" placeholder="Duration" data-field="duration">
    </div>
    <button onclick="this.closest('.cp-wh-entry').remove()" style="background:none;border:none;color:#c62828;cursor:pointer;font-size:14px;padding:4px;margin-top:2px" title="Remove">&#10005;</button>`;
  list.appendChild(div);
}

async function saveCandidateEdits(candidateId) {
  const btn = document.getElementById('cp-save-btn');
  const name = document.getElementById('cp-edit-name')?.value?.trim();
  if (!name) { alert('Name is required.'); return; }

  btn.disabled = true;
  btn.textContent = 'Saving...';

  // Collect work history from the editor
  const whEntries = [];
  document.querySelectorAll('#cp-edit-wh-list .cp-wh-entry').forEach(entry => {
    const title = entry.querySelector('[data-field="title"]')?.value?.trim() || '';
    const company = entry.querySelector('[data-field="company"]')?.value?.trim() || '';
    const dates = entry.querySelector('[data-field="dates"]')?.value?.trim() || '';
    const duration = entry.querySelector('[data-field="duration"]')?.value?.trim() || '';
    if (title || company) {
      whEntries.push({ title, company, dates, duration: duration || null, description: null });
    }
  });

  const updates = {
    name: name,
    linkedin_url: document.getElementById('cp-edit-linkedin')?.value?.trim() || '',
    current_title: document.getElementById('cp-edit-title')?.value?.trim() || '',
    current_firm: document.getElementById('cp-edit-firm')?.value?.trim() || '',
    home_location: document.getElementById('cp-edit-location')?.value?.trim() || '',
    archetype: document.getElementById('cp-edit-archetype')?.value || '',
    availability: document.getElementById('cp-edit-availability')?.value || 'Unknown',
    quality_rating: parseInt(document.getElementById('cp-edit-rating')?.value || '0'),
    notes: document.getElementById('cp-edit-notes')?.value || '',
    work_history: whEntries
  };

  try {
    await api('PUT', '/candidates/' + encodeURIComponent(candidateId), updates);

    // Update local pool cache if available
    if (typeof poolAllCandidates !== 'undefined' && Array.isArray(poolAllCandidates)) {
      const idx = poolAllCandidates.findIndex(c => c.candidate_id === candidateId);
      if (idx !== -1) Object.assign(poolAllCandidates[idx], updates);
    }

    // Re-open panel with fresh data
    openCandidatePanel(candidateId);
  } catch (err) {
    alert('Error saving: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

async function setCandidatePrimaryExperience(candidateId, idx) {
  try {
    const candidate = await api('GET', '/candidates/' + encodeURIComponent(candidateId));
    if (!candidate || !candidate.work_history) return;
    const job = candidate.work_history[idx];
    if (!job) return;

    // Clean title: first segment before | or ·
    const cleanTitle = (job.title || '').split(/\s*[|·]\s*/)[0].trim();
    const cleanFirm = (job.company || '').replace(/\s*[·•]\s*(full[- ]time|part[- ]time|contract|freelance|self[- ]employed).*$/i, '').trim();

    const updates = {
      current_title: cleanTitle,
      current_firm: cleanFirm,
      primary_experience_index: idx
    };

    await api('PUT', '/candidates/' + encodeURIComponent(candidateId), updates);

    // Update local pool cache if available
    if (typeof poolAllCandidates !== 'undefined' && Array.isArray(poolAllCandidates)) {
      const cacheIdx = poolAllCandidates.findIndex(c => c.candidate_id === candidateId);
      if (cacheIdx !== -1) Object.assign(poolAllCandidates[cacheIdx], updates);
    }

    // Re-open panel with updated data
    openCandidatePanel(candidateId);
  } catch (e) {
    console.error('setCandidatePrimaryExperience error:', e);
    alert('Error setting primary experience: ' + e.message);
  }
}

// ── Candidate Merge Modal ─────────────────────────────────────────────────────

function closeMergeModal() {
  document.getElementById('merge-modal-overlay')?.remove();
}

async function openMergeModal(candidateId) {
  closeMergeModal();
  closeCandidatePanel();

  // Fetch all candidates to find duplicates by name
  let target, allCandidates;
  try {
    target = await api('GET', '/candidates/' + encodeURIComponent(candidateId));
    const resp = await api('GET', '/candidates');
    allCandidates = resp.candidates || [];
  } catch (e) { alert('Error: ' + e.message); return; }

  const dupes = allCandidates.filter(c =>
    c.candidate_id !== candidateId &&
    c.name.toLowerCase().trim() === target.name.toLowerCase().trim()
  );

  if (dupes.length === 0) {
    alert('No duplicate candidates found with the name "' + target.name + '".');
    return;
  }

  // If exactly one dupe, go straight to merge. Otherwise let user pick.
  if (dupes.length === 1) {
    renderMergeComparison(target, dupes[0]);
  } else {
    // Show picker
    const overlay = document.createElement('div');
    overlay.id = 'merge-modal-overlay';
    overlay.className = 'modal-overlay';
    overlay.style.zIndex = '3000';
    const rows = dupes.map(d => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #f0f0f0;cursor:pointer" onclick="renderMergeComparison(JSON.parse(atob('${btoa(JSON.stringify(target))}')), JSON.parse(atob('${btoa(JSON.stringify(d))}')))">
        <div>
          <div style="font-weight:600;font-size:13px">${_escPanel(d.name)}</div>
          <div style="font-size:12px;color:#666">${_escPanel(d.current_title||'')} @ ${_escPanel(d.current_firm||'')}</div>
        </div>
        <span style="color:#5C2D91;font-size:12px;font-weight:600">Select →</span>
      </div>`).join('');

    overlay.innerHTML = `
      <div class="modal" style="max-width:480px;border-radius:14px">
        <div style="padding:20px 24px;border-bottom:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0;font-size:1rem;font-weight:800">Select Duplicate to Merge</h2>
          <button onclick="closeMergeModal()" style="background:none;border:none;cursor:pointer;font-size:16px;color:#999">&#10005;</button>
        </div>
        <div style="padding:8px 0">${rows}</div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeMergeModal(); });
  }
}

function renderMergeComparison(a, b) {
  closeMergeModal();

  // Auto-suggest: prefer non-empty, prefer richer data
  function pick(fieldA, fieldB) {
    if (!fieldA && !fieldB) return '';
    if (!fieldA) return fieldB;
    if (!fieldB) return fieldA;
    return String(fieldA).length >= String(fieldB).length ? fieldA : fieldB;
  }

  const fields = [
    { key: 'name',           label: 'Name' },
    { key: 'current_title',  label: 'Title' },
    { key: 'current_firm',   label: 'Firm' },
    { key: 'home_location',  label: 'Location' },
    { key: 'linkedin_url',   label: 'LinkedIn URL' },
    { key: 'archetype',      label: 'Archetype' },
    { key: 'availability',   label: 'Availability' },
    { key: 'notes',          label: 'Notes' }
  ];

  const fieldRows = fields.map(f => {
    const va = a[f.key] || '';
    const vb = b[f.key] || '';
    const suggested = pick(va, vb);
    const aSelected = suggested === va || (!vb && va);
    return `
      <tr style="border-bottom:1px solid #f0f0f0">
        <td style="padding:8px;font-size:12px;font-weight:600;color:#666;white-space:nowrap;vertical-align:top">${f.label}</td>
        <td style="padding:8px;font-size:12px;vertical-align:top">
          <label style="cursor:pointer;display:flex;align-items:flex-start;gap:6px">
            <input type="radio" name="merge-${f.key}" value="a" ${aSelected ? 'checked' : ''} style="margin-top:2px">
            <span style="word-break:break-all">${_escPanel(va) || '<span style="color:#ccc">—</span>'}</span>
          </label>
        </td>
        <td style="padding:8px;font-size:12px;vertical-align:top">
          <label style="cursor:pointer;display:flex;align-items:flex-start;gap:6px">
            <input type="radio" name="merge-${f.key}" value="b" ${!aSelected ? 'checked' : ''} style="margin-top:2px">
            <span style="word-break:break-all">${_escPanel(vb) || '<span style="color:#ccc">—</span>'}</span>
          </label>
        </td>
      </tr>`;
  }).join('');

  const whA = (a.work_history || []).length;
  const whB = (b.work_history || []).length;

  const overlay = document.createElement('div');
  overlay.id = 'merge-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '3000';
  overlay.innerHTML = `
    <div class="modal" style="max-width:780px;max-height:90vh;overflow-y:auto;padding:0;border-radius:14px">
      <div style="background:linear-gradient(135deg,#5C2D91,#7b52a8);padding:18px 24px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center">
        <div>
          <h2 style="margin:0;font-size:1rem;font-weight:800;color:#fff">Merge Candidates</h2>
          <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-top:2px">Choose which value to keep for each field. Work histories will be combined.</div>
        </div>
        <button onclick="closeMergeModal()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px">&#10005;</button>
      </div>
      <div style="padding:16px 24px">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:2px solid #e0e0e0">
              <th style="padding:8px;font-size:11px;color:#999;text-align:left">Field</th>
              <th style="padding:8px;font-size:11px;color:#5C2D91;text-align:left">Profile A <span style="color:#999;font-weight:400">(${_escPanel(a.candidate_id).slice(0,20)}...)</span></th>
              <th style="padding:8px;font-size:11px;color:#5C2D91;text-align:left">Profile B <span style="color:#999;font-weight:400">(${_escPanel(b.candidate_id).slice(0,20)}...)</span></th>
            </tr>
          </thead>
          <tbody>${fieldRows}</tbody>
        </table>

        <div style="margin-top:16px;padding:12px;background:#f9f9f9;border-radius:8px;font-size:12px;color:#666">
          <strong>Work histories will be merged:</strong> ${whA} entries from A + ${whB} entries from B (duplicates removed).<br>
          <strong>Search histories</strong> and <strong>DQ reasons</strong> will also be combined.
        </div>

        <div style="margin-top:12px;padding:12px;background:#fff3e0;border-radius:8px;font-size:12px;color:#e65100">
          <strong>Profile A</strong> will be kept. <strong>Profile B</strong> will be deleted and all references updated.
        </div>

        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:16px;border-top:1px solid #f0f0f0;margin-top:16px">
          <button class="btn btn-ghost" onclick="closeMergeModal()">Cancel</button>
          <button class="btn btn-primary" id="merge-submit-btn" onclick="_submitMerge('${_escPanel(a.candidate_id)}','${_escPanel(b.candidate_id)}')">Merge Candidates</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeMergeModal(); });
}

async function _submitMerge(keepId, removeId) {
  const btn = document.getElementById('merge-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Merging...';

  // Collect chosen values
  const fields = ['name','current_title','current_firm','home_location','linkedin_url','archetype','availability','notes'];
  const merged_fields = {};
  fields.forEach(f => {
    const radios = document.querySelectorAll(`input[name="merge-${f}"]`);
    // Determine which is selected — need to fetch actual values from the candidates
    // The radio value is 'a' or 'b'
    radios.forEach(r => {
      if (r.checked) {
        // The label text next to the radio contains the value, but it's escaped HTML
        // Instead, we'll re-fetch and pick
        merged_fields['_pick_' + f] = r.value;
      }
    });
  });

  // Need to re-fetch both candidates to get raw values
  try {
    const [a, b] = await Promise.all([
      api('GET', '/candidates/' + encodeURIComponent(keepId)),
      api('GET', '/candidates/' + encodeURIComponent(removeId))
    ]);

    const finalFields = {};
    fields.forEach(f => {
      const pick = merged_fields['_pick_' + f];
      finalFields[f] = pick === 'b' ? (b[f] || '') : (a[f] || '');
    });
    // Also carry over non-editable fields from the richer record
    ['sector_tags','firm_size_tier','company_revenue_tier','operator_background','owned_pl','quality_rating','rating_set_by','rating_date','primary_experience_index'].forEach(f => {
      const va = a[f];
      const vb = b[f];
      if (va != null && va !== '' && (!Array.isArray(va) || va.length > 0)) finalFields[f] = va;
      else if (vb != null && vb !== '') finalFields[f] = vb;
    });

    const result = await api('POST', '/candidates/merge', {
      keep_id: keepId,
      remove_id: removeId,
      merged_fields: finalFields
    });

    btn.textContent = 'Merged!';
    btn.style.background = '#4caf50';
    setTimeout(() => {
      closeMergeModal();
      // Refresh pool if visible
      if (typeof poolAllCandidates !== 'undefined') {
        if (typeof renderCompanies === 'function' && currentModule === 'companies') renderCompanies();
        else if (typeof renderPool === 'function' && currentModule === 'pool') {
          poolAllCandidates = [];
          renderPool();
        }
      }
      // Open the merged candidate
      openCandidatePanel(keepId);
    }, 800);
  } catch (err) {
    alert('Error merging: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Merge Candidates';
  }
}

// ── Add to Pipeline Modal (global) ────────────────────────────────────────────

function closePipelineModal() {
  document.getElementById('add-pipeline-overlay')?.remove();
}

async function openAddToPipelineModal(candidateInfo, opts) {
  // candidateInfo: { candidate_id, name, current_title, current_firm, location, linkedin_url, archetype }
  // opts: { preSelectSearchId, source }
  opts = opts || {};
  closePipelineModal();

  let searchesHTML = '<option value="">— Select a search —</option>';
  let _atpSearches = [];
  try {
    const resp = await api('GET', '/searches');
    _atpSearches = resp.searches || [];
    const preSelect = opts.preSelectSearchId || (typeof currentSearchId !== 'undefined' ? currentSearchId : '');
    searchesHTML += _atpSearches.map(s => {
      const sel = preSelect === s.search_id ? ' selected' : '';
      return `<option value="${_escPanel(s.search_id)}"${sel}>${_escPanel(s.client_name)} — ${_escPanel(s.role_title)}</option>`;
    }).join('');
  } catch (e) {
    searchesHTML = '<option value="">Error loading searches</option>';
  }

  // Store searches globally so onchange can access them
  window._atpSearchesCache = _atpSearches;

  // Build initial stage options based on pre-selected search (if any)
  const preSelectedId = opts.preSelectSearchId || (typeof currentSearchId !== 'undefined' ? currentSearchId : '');
  const preSelectedSearch = _atpSearches.find(s => s.search_id === preSelectedId);
  const initialStageHTML = preSelectedSearch
    ? (preSelectedSearch.pipeline_stages || []).map(s =>
        `<option value="${_escPanel(s.name)}" ${s.name === 'Pursuing' ? 'selected' : ''}>${_escPanel(s.name)}</option>`
      ).join('')
    : '<option value="">— Select a search first —</option>';

  const overlay = document.createElement('div');
  overlay.id = 'add-pipeline-overlay';
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '3000';
  overlay.innerHTML = `
    <div class="modal" style="max-width:540px;max-height:90vh;overflow-y:auto;padding:0;border-radius:14px">
      <div style="background:linear-gradient(135deg,#5C2D91,#7b52a8);padding:18px 24px 14px;border-radius:14px 14px 0 0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h2 style="margin:0;font-size:1rem;font-weight:800;color:#fff">Add to Pipeline</h2>
          <button onclick="closePipelineModal()" style="background:rgba(255,255,255,0.15);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center">&#10005;</button>
        </div>
      </div>
      <div style="padding:20px 24px">
        <!-- Candidate info (read-only) -->
        <div style="background:#f9f6fd;border-radius:8px;padding:12px 14px;margin-bottom:16px">
          <div style="font-weight:700;font-size:14px;color:#1a1a1a">${_escPanel(candidateInfo.name)}</div>
          <div style="font-size:12px;color:#666;margin-top:2px">${_escPanel(candidateInfo.current_title || '')}${candidateInfo.current_firm ? ' @ ' + _escPanel(candidateInfo.current_firm) : ''}</div>
          ${candidateInfo.location ? `<div style="font-size:11px;color:#999;margin-top:2px">${_escPanel(candidateInfo.location)}</div>` : ''}
        </div>

        <div class="form-group">
          <label class="form-label">Target Search <span style="color:red">*</span></label>
          <select class="form-control" id="atp-search" onchange="onAtpSearchChange()">${searchesHTML}</select>
        </div>

        <div class="form-group">
          <label class="form-label">Initial Stage</label>
          <select class="form-control" id="atp-stage" ${preSelectedSearch ? '' : 'disabled'}>${initialStageHTML}</select>
        </div>

        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="atp-notes" rows="3" placeholder="Optional notes..."></textarea>
        </div>

        <div id="atp-error" style="display:none;color:#c62828;font-size:12px;background:#ffebee;padding:8px 12px;border-radius:6px;margin-bottom:12px"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:8px;border-top:1px solid #f0f0f0">
          <button class="btn btn-ghost" onclick="closePipelineModal()">Cancel</button>
          <button class="btn btn-primary" id="atp-submit-btn" onclick="submitAddToPipeline(${JSON.stringify(candidateInfo).replace(/"/g, '&quot;')})">Add to Pipeline</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePipelineModal(); });
}

function onAtpSearchChange() {
  const searchId = document.getElementById('atp-search')?.value;
  const stageEl = document.getElementById('atp-stage');
  if (!stageEl) return;

  if (!searchId) {
    stageEl.innerHTML = '<option value="">— Select a search first —</option>';
    stageEl.disabled = true;
    return;
  }

  const searches = window._atpSearchesCache || [];
  const search = searches.find(s => s.search_id === searchId);
  const stages = (search && search.pipeline_stages) || [];

  if (stages.length === 0) {
    stageEl.innerHTML = '<option value="Pursuing">Pursuing</option>';
  } else {
    stageEl.innerHTML = stages.map(s =>
      `<option value="${_escPanel(s.name)}" ${s.name === 'Pursuing' ? 'selected' : ''}>${_escPanel(s.name)}</option>`
    ).join('');
  }
  stageEl.disabled = false;
}

async function submitAddToPipeline(candidateInfo) {
  const searchId = document.getElementById('atp-search')?.value;
  const source = document.getElementById('atp-source')?.value || '';
  const stage = document.getElementById('atp-stage')?.value || 'Pursuing';
  const notes = document.getElementById('atp-notes')?.value?.trim() || '';
  const errorEl = document.getElementById('atp-error');
  const btn = document.getElementById('atp-submit-btn');

  if (!searchId) {
    errorEl.textContent = 'Please select a search.';
    errorEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding...';
  errorEl.style.display = 'none';

  try {
    const payload = {
      candidate_id: candidateInfo.candidate_id || undefined,
      name: candidateInfo.name,
      current_title: candidateInfo.current_title || '',
      current_firm: candidateInfo.current_firm || '',
      home_location: candidateInfo.location || '',
      linkedin_url: candidateInfo.linkedin_url || '',
      archetype: candidateInfo.archetype || '',
      source: source,
      stage: stage,
      notes: notes,
      search_id: searchId
    };

    await api('POST', '/candidates', payload);

    // Success — show confirmation briefly then close
    btn.textContent = 'Added!';
    btn.style.background = '#4caf50';
    setTimeout(() => {
      closePipelineModal();
      // If user is viewing this search, refresh the pipeline
      if (typeof currentSearchId !== 'undefined' && currentSearchId === searchId && typeof renderSearchDetail === 'function') {
        renderSearchDetail(searchId);
      }
    }, 800);
  } catch (err) {
    errorEl.textContent = err.message || 'Error adding to pipeline.';
    errorEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Add to Pipeline';
  }
}

// ── Home Overview ─────────────────────────────────────────────────────────────

async function loadHome() {
  currentModule = null;
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const content = document.getElementById('app-content');
  content.innerHTML = `<div class="loading"><div class="spinner"></div> Loading...</div>`;

  try {
    const stats = await api('GET', '/stats');

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });

    content.innerHTML = `
      <div class="home-header">
        <div>
          <h1>Good ${getTimeOfDay()}, Robby.</h1>
          <p class="home-tagline">Lancor Search OS &mdash; Executive Recruiting Workflow</p>
        </div>
        <span class="home-date">${dateStr}</span>
      </div>

      <div class="stats-grid">
        <div class="stat-card clickable" onclick="navigateTo('searches')" title="View Active Searches">
          <div class="stat-card-icon">&#128269;</div>
          <div class="stat-card-value">${stats.activeSearches}</div>
          <div class="stat-card-label">Active Searches</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('pool')" title="View Candidate Pool">
          <div class="stat-card-icon">&#128100;</div>
          <div class="stat-card-value">${stats.totalCandidates}</div>
          <div class="stat-card-label">Total Candidates</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('companies')" title="View Company Pool">
          <div class="stat-card-icon">&#127970;</div>
          <div class="stat-card-value">${stats.totalCompanies || 0}</div>
          <div class="stat-card-label">Companies in Pool</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('playbooks')" title="View Sector Playbooks">
          <div class="stat-card-icon">&#128218;</div>
          <div class="stat-card-value">${stats.playbooksBuilt}</div>
          <div class="stat-card-label">Sector Playbooks Built</div>
        </div>
        <div class="stat-card clickable" onclick="navigateTo('templates')" title="View Templates">
          <div class="stat-card-icon">&#128196;</div>
          <div class="stat-card-value">${stats.totalTemplates}</div>
          <div class="stat-card-label">Templates Saved</div>
        </div>
      </div>

      <div class="home-section">
        <h2>Quick Actions</h2>
        <div class="quick-actions">
          <button class="btn btn-primary" onclick="navigateTo('searches')">
            &#128269; View Active Searches
          </button>
          <button class="btn btn-secondary" onclick="navigateTo('playbooks')">
            &#128218; Build Sector Playbook
          </button>
          <button class="btn btn-secondary" onclick="navigateTo('pool')">
            &#128100; Candidate Pool
          </button>
          <button class="btn btn-ghost" onclick="navigateTo('templates')">
            &#128196; Search Templates
          </button>
        </div>
      </div>

      <div class="home-section">
        <h2>System Status</h2>
        <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">Server running on port ${window.location.port || 3000}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">Data files loaded</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="width:10px;height:10px;border-radius:50%;background:#4caf50;display:inline-block;"></span>
            <span class="text-sm">All modules complete &mdash; Session 7+ for iterations</span>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `
      <div class="error-banner">Failed to load home: ${err.message}</div>
      <div class="home-section">
        <h2>Lancor Search OS</h2>
        <p class="text-muted">Could not reach the API. Make sure the server is running.</p>
      </div>`;
  }
}

function getTimeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  loadHome();
});
