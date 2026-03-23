'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function searchesFile() {
  return path.join(process.env.DATA_PATH, 'active_searches.json');
}
function playbooksFile() {
  return path.join(process.env.DATA_PATH, 'sector_playbooks.json');
}
function candidatesFile() {
  return path.join(process.env.DATA_PATH, 'candidate_pool.json');
}

function readSearches() {
  return JSON.parse(fs.readFileSync(searchesFile(), 'utf8'));
}
function writeSearches(data) {
  fs.writeFileSync(searchesFile(), JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/searches — return all searches (include closed if ?include=closed)
router.get('/', (req, res) => {
  try {
    const data = readSearches();
    let results = data.searches;
    if (req.query.include !== 'closed') {
      results = results.filter(s => s.status !== 'closed');
    }
    res.json({ searches: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/searches/:id — return single search
router.get('/:id', (req, res) => {
  try {
    const data = readSearches();
    const search = data.searches.find(s => s.search_id === req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });
    res.json(search);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches — create new search
router.post('/', (req, res) => {
  try {
    const data = readSearches();
    const body = req.body;

    // Auto-load sector playbook data into sourcing_coverage
    let sourcingCoverage = { pe_firms: [], companies: [] };
    if (body.sectors && body.sectors.length > 0) {
      try {
        const pbData = JSON.parse(fs.readFileSync(playbooksFile(), 'utf8'));
        body.sectors.forEach(sectorId => {
          const sector = pbData.sectors.find(s => s.sector_id === sectorId);
          if (sector) {
            sector.pe_firms.forEach(firm => {
              sourcingCoverage.pe_firms.push({
                firm_id: firm.firm_id,
                name: firm.name,
                hq: firm.hq || '',
                size_tier: firm.size_tier || '',
                search_specific: false,
                manual_complete: false,
                manual_complete_note: '',
                roster: JSON.parse(JSON.stringify(firm.roster || []))
              });
            });
            sector.target_companies.forEach(co => {
              sourcingCoverage.companies.push({
                company_id: co.company_id,
                name: co.name,
                hq: co.hq || '',
                revenue_tier: co.revenue_tier || '',
                search_specific: false,
                manual_complete: false,
                manual_complete_note: '',
                roster: JSON.parse(JSON.stringify(co.roster || []))
              });
            });
          }
        });
      } catch (e) { /* continue with empty coverage */ }
    }

    const newSearch = Object.assign({
      search_id: body.search_id || `search-${Date.now()}`,
      date_opened: new Date().toISOString().slice(0, 10),
      date_closed: null,
      status: 'active',
      pipeline: [],
      weekly_updates: [],
      sourcing_coverage: sourcingCoverage
    }, body);

    data.searches.push(newSearch);
    writeSearches(data);
    res.status(201).json(newSearch);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/searches/:id — update search (full replacement)
router.put('/:id', (req, res) => {
  try {
    const data = readSearches();
    const idx = data.searches.findIndex(s => s.search_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Search not found' });
    data.searches[idx] = Object.assign({}, data.searches[idx], req.body, { search_id: req.params.id });
    writeSearches(data);
    res.json(data.searches[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/searches/:id/close — close a search
router.put('/:id/close', (req, res) => {
  try {
    const data = readSearches();
    const idx = data.searches.findIndex(s => s.search_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Search not found' });
    data.searches[idx].status = 'closed';
    data.searches[idx].date_closed = new Date().toISOString().slice(0, 10);
    writeSearches(data);
    res.json(data.searches[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/dashboard — generate client HTML dashboard
router.post('/:id/dashboard', (req, res) => {
  try {
    const data = readSearches();
    const search = data.searches.find(s => s.search_id === req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    const html = generateDashboardHTML(search);

    // Save to outputs/dashboards/
    const outputsDir = path.join(process.env.DATA_PATH, '..', 'outputs', 'dashboards');
    if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });
    const safeName = s => (s || '').replace(/[^a-zA-Z0-9]/g, '');
    const filename = `${safeName(search.client_name)}_${safeName(search.role_title)}_${new Date().toISOString().slice(0,10)}.html`;
    fs.writeFileSync(path.join(outputsDir, filename), html, 'utf8');

    res.json({ html, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/debrief — run debrief feed (write selected candidates to pool)
router.post('/:id/debrief', (req, res) => {
  try {
    const data = readSearches();
    const search = data.searches.find(s => s.search_id === req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    // Body: { candidates: [{ candidate_id, rating, availability, notes, outcome }] }
    const { candidates: debriefList } = req.body;
    if (!Array.isArray(debriefList) || debriefList.length === 0) {
      return res.status(400).json({ error: 'candidates array required' });
    }

    const poolData = JSON.parse(fs.readFileSync(candidatesFile(), 'utf8'));
    const pbData   = JSON.parse(fs.readFileSync(playbooksFile(), 'utf8'));
    const today    = new Date().toISOString().slice(0, 10);
    let added = 0, updated = 0;

    debriefList.forEach(item => {
      const pipeline = search.pipeline.find(p => p.candidate_id === item.candidate_id);
      if (!pipeline) return;

      const existingIdx = poolData.candidates.findIndex(c => c.candidate_id === item.candidate_id);

      const searchHistoryEntry = {
        search_id: search.search_id,
        client_name: search.client_name,
        stage_reached: pipeline.stage,
        outcome: item.outcome || '',
        notes: item.notes || ''
      };

      if (existingIdx === -1) {
        // New pool entry
        const newEntry = {
          candidate_id: pipeline.candidate_id,
          name: pipeline.name,
          current_title: pipeline.current_title,
          current_firm: pipeline.current_firm,
          home_location: pipeline.location || '',
          linkedin_url: pipeline.linkedin_url || '',
          sector_tags: search.sectors || [],
          archetype: pipeline.archetype || 'PE Lateral',
          operator_background: item.operator_background || 'Traditional Buyout',
          firm_size_tier: item.firm_size_tier || null,
          company_revenue_tier: item.company_revenue_tier || null,
          quality_rating: item.rating || null,
          rating_set_by: item.rating_set_by || null,
          rating_date: item.rating ? today : null,
          availability: item.availability || 'Unknown',
          availability_updated: today,
          search_history: [searchHistoryEntry],
          dq_reasons: pipeline.dq_reason ? [{ search_id: search.search_id, reason: pipeline.dq_reason, permanent: false }] : [],
          last_contact_date: pipeline.last_touchpoint || null,
          notes: item.notes || pipeline.notes || '',
          date_added: today,
          added_from_search: search.search_id
        };
        poolData.candidates.push(newEntry);
        added++;
      } else {
        // Update existing pool entry
        const existing = poolData.candidates[existingIdx];
        existing.search_history = existing.search_history || [];
        // Append search history if not already there
        const alreadyInHistory = existing.search_history.some(h => h.search_id === search.search_id);
        if (!alreadyInHistory) existing.search_history.push(searchHistoryEntry);
        // Update rating/availability if provided
        if (item.rating) { existing.quality_rating = item.rating; existing.rating_date = today; existing.rating_set_by = item.rating_set_by || null; }
        if (item.availability) { existing.availability = item.availability; existing.availability_updated = today; }
        // Append DQ reason if applicable
        if (pipeline.dq_reason) {
          existing.dq_reasons = existing.dq_reasons || [];
          existing.dq_reasons.push({ search_id: search.search_id, reason: pipeline.dq_reason, permanent: false });
        }
        updated++;
      }

      // Add to sector allstar_pool if rating >= 2
      if (item.rating >= 2) {
        (search.sectors || []).forEach(sectorId => {
          const sectorIdx = pbData.sectors.findIndex(s => s.sector_id === sectorId);
          if (sectorIdx !== -1) {
            const sector = pbData.sectors[sectorIdx];
            if (!sector.allstar_pool.includes(item.candidate_id)) {
              sector.allstar_pool.push(item.candidate_id);
            }
          }
        });
      }
    });

    fs.writeFileSync(candidatesFile(), JSON.stringify(poolData, null, 2), 'utf8');
    fs.writeFileSync(playbooksFile(), JSON.stringify(pbData, null, 2), 'utf8');

    res.json({ added, updated, total: debriefList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/import-dashboard
router.post('/:id/import-dashboard', (req, res) => {
  try {
    const data = readSearches();
    const search = data.searches.find(s => s.search_id === req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    const htmlContent = req.body.html_content;
    if (!htmlContent) return res.status(400).json({ error: 'html_content required' });

    const imported = parseDashboardHTML(htmlContent, search);

    // Merge into pipeline (skip duplicates by name+firm)
    let added = 0;
    imported.forEach(candidate => {
      const exists = search.pipeline.some(p =>
        p.name.toLowerCase() === candidate.name.toLowerCase() &&
        p.current_firm.toLowerCase() === candidate.current_firm.toLowerCase()
      );
      if (!exists) {
        search.pipeline.push(candidate);
        added++;
      }
    });

    const idx = data.searches.findIndex(s => s.search_id === req.params.id);
    data.searches[idx] = search;
    writeSearches(data);

    // Also write to candidate pool
    const poolData = JSON.parse(fs.readFileSync(candidatesFile(), 'utf8'));
    imported.forEach(candidate => {
      const exists = poolData.candidates.some(c => c.candidate_id === candidate.candidate_id);
      if (!exists) {
        poolData.candidates.push({
          candidate_id: candidate.candidate_id,
          name: candidate.name,
          current_title: candidate.current_title,
          current_firm: candidate.current_firm,
          home_location: candidate.location || '',
          linkedin_url: candidate.linkedin_url || '',
          sector_tags: search.sectors || [],
          archetype: candidate.archetype || 'PE Lateral',
          operator_background: 'Traditional Buyout',
          quality_rating: null,
          availability: 'Unknown',
          search_history: [{ search_id: search.search_id, client_name: search.client_name, stage_reached: candidate.stage, outcome: '' }],
          dq_reasons: [],
          last_contact_date: null,
          notes: candidate.notes || '',
          date_added: new Date().toISOString().slice(0,10),
          added_from_search: search.search_id
        });
      }
    });
    fs.writeFileSync(candidatesFile(), JSON.stringify(poolData, null, 2), 'utf8');

    res.json({ imported: imported.length, added_to_pipeline: added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard HTML generator ───────────────────────────────────────────────

function generateDashboardHTML(search) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const pipeline = search.pipeline || [];

  // Split by stage — strip Pursuing entirely
  const active     = pipeline.filter(c => ['Qualifying', 'Scheduling'].includes(c.stage));
  const onHold     = pipeline.filter(c => c.stage === 'Hold');
  const dqni       = pipeline.filter(c => ['DQ', 'NI'].includes(c.stage));

  // Stage counts for summary
  const counts = {
    Qualifying: pipeline.filter(c => c.stage === 'Qualifying').length,
    Scheduling: pipeline.filter(c => c.stage === 'Scheduling').length,
    Hold:       pipeline.filter(c => c.stage === 'Hold').length,
    'DQ/NI':    dqni.length
  };

  // Client contacts for meeting matrix headers
  const clientContacts = (search.client_contacts || []).filter(c => c.display_in_matrix);

  // Stage pill colors (client-safe)
  const stageColor = {
    'Qualifying':  { bg: '#e8f5e9', color: '#2e7d32' },
    'Scheduling':  { bg: '#fff3e0', color: '#e65100' },
    'Hold':        { bg: '#efebe9', color: '#4e342e' },
    'DQ':          { bg: '#ffebee', color: '#c62828' },
    'NI':          { bg: '#fffde7', color: '#f57f17' }
  };
  const stagePill = (stage) => {
    const c = stageColor[stage] || { bg: '#eee', color: '#333' };
    return `<span style="background:${c.bg};color:${c.color};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;display:inline-block">${stage}</span>`;
  };

  // Meeting dot
  const meetingDot = (status) => {
    const map = { 'Met': '#4caf50', 'Scheduled': '#ff9800', '—': '#e0e0e0' };
    const color = map[status] || '#e0e0e0';
    const label = status === '—' ? '' : status;
    return `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color};title='${label}'">&nbsp;</span>`;
  };

  // Active candidates table rows
  const activeRows = active.map(c => {
    // Build meeting matrix cells
    const meetingCells = clientContacts.map(contact => {
      const meeting = (c.client_meetings || []).find(m => m.contact_name === contact.name);
      const status = meeting ? meeting.status : '—';
      return `<td style="text-align:center;padding:8px">${meetingDot(status)}</td>`;
    }).join('');

    const nameDisplay = c.linkedin_url
      ? `<a href="${c.linkedin_url}" style="color:#5C2D91;font-weight:700;text-decoration:none">${c.name}</a>`
      : `<strong>${c.name}</strong>`;

    return `<tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:10px 12px">
        ${nameDisplay}<br>
        <span style="font-size:12px;color:#666">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span><br>
        <span style="font-size:11px;color:#999">${c.location || ''}</span>
      </td>
      <td style="padding:10px 12px">${stagePill(c.stage)}</td>
      ${meetingCells}
      <td style="padding:10px 12px;font-size:12px;color:#444">${c.client_feedback || ''}</td>
      <td style="padding:10px 12px;font-size:12px">
        <div style="font-weight:600">${c.next_step || ''}</div>
        <div style="color:#888;font-size:11px">${c.next_step_owner || ''}${c.next_step_date ? ' · ' + c.next_step_date : ''}</div>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="${4 + clientContacts.length}" style="padding:20px;text-align:center;color:#999;font-style:italic">No active candidates at this time</td></tr>`;

  // Hold section rows
  const holdRows = onHold.map(c => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:8px 12px"><strong>${c.name}</strong><br><span style="font-size:12px;color:#666">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span></td>
      <td style="padding:8px 12px;font-size:12px;color:#444">${c.client_feedback || ''}</td>
      <td style="padding:8px 12px;font-size:12px">${c.next_step || ''}</td>
    </tr>`).join('');

  // DQ/NI rows — show name/role only, NO reason
  const dqRows = dqni.map(c => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:8px 12px">${c.name}<br><span style="font-size:12px;color:#888">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span></td>
      <td style="padding:8px 12px">${stagePill(c.stage)}</td>
    </tr>`).join('');

  // Meeting matrix header cells
  const meetingHeaders = clientContacts.map(c =>
    `<th style="background:#5C2D91;color:white;padding:8px 10px;text-align:center;font-size:11px">${c.name}</th>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${search.client_name} \u2014 ${search.role_title} | Lancor Partners</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, Arial, sans-serif; color: #1a1a1a; background: #f8f8f8; }
    .page { max-width: 960px; margin: 0 auto; background: white; min-height: 100vh; }
    .header { background: #5C2D91; color: white; padding: 28px 40px; }
    .header-wordmark { font-size: 13px; letter-spacing: 4px; font-weight: 800; opacity: 0.85; margin-bottom: 10px; }
    .header-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header-sub { font-size: 14px; opacity: 0.8; }
    .summary-bar { display: flex; gap: 0; border-bottom: 3px solid #5C2D91; }
    .summary-item { flex: 1; padding: 16px 20px; text-align: center; border-right: 1px solid #e0e0e0; }
    .summary-item:last-child { border-right: none; }
    .summary-count { font-size: 28px; font-weight: 800; color: #5C2D91; }
    .summary-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .section { padding: 28px 40px; border-bottom: 1px solid #eee; }
    .section-title { font-size: 15px; font-weight: 700; color: #5C2D91; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #5C2D91; color: white; padding: 9px 12px; text-align: left; font-size: 12px; font-weight: 600; }
    td { padding: 10px 12px; vertical-align: top; }
    .footer { padding: 20px 40px; text-align: center; color: #aaa; font-size: 11px; background: #fafafa; }
    details summary { cursor: pointer; font-weight: 600; color: #5C2D91; font-size: 14px; list-style: none; padding: 4px 0; }
    details summary::before { content: '\u25b6 '; font-size: 10px; }
    details[open] summary::before { content: '\u25bc '; }
    @media print { body { background: white; } .page { box-shadow: none; } }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-wordmark">LANCOR PARTNERS</div>
    <div class="header-title">${search.client_name} \u2014 ${search.role_title}</div>
    <div class="header-sub">Search Update &nbsp;&middot;&nbsp; ${today}</div>
  </div>

  <!-- Pipeline Summary -->
  <div class="summary-bar">
    <div class="summary-item"><div class="summary-count" style="color:#2e7d32">${counts.Qualifying}</div><div class="summary-label">Qualifying</div></div>
    <div class="summary-item"><div class="summary-count" style="color:#e65100">${counts.Scheduling}</div><div class="summary-label">Scheduling</div></div>
    <div class="summary-item"><div class="summary-count" style="color:#4e342e">${counts.Hold}</div><div class="summary-label">On Hold</div></div>
    <div class="summary-item"><div class="summary-count" style="color:#c62828">${counts['DQ/NI']}</div><div class="summary-label">DQ / NI</div></div>
  </div>

  <!-- Active Candidates -->
  <div class="section">
    <div class="section-title">Active Candidates</div>
    <table>
      <thead><tr>
        <th style="width:25%">Candidate</th>
        <th style="width:100px">Status</th>
        ${meetingHeaders}
        <th>Client Feedback</th>
        <th>Next Step</th>
      </tr></thead>
      <tbody>${activeRows}</tbody>
    </table>
  </div>

  ${onHold.length > 0 ? `
  <!-- Holding Pattern -->
  <div class="section">
    <div class="section-title">Holding Pattern</div>
    <table>
      <thead><tr>
        <th style="width:30%">Candidate</th>
        <th>Notes</th>
        <th>Next Step</th>
      </tr></thead>
      <tbody>${holdRows}</tbody>
    </table>
  </div>` : ''}

  ${dqni.length > 0 ? `
  <!-- DQ / Not Interested -->
  <div class="section">
    <details>
      <summary>Not Proceeding (${dqni.length})</summary>
      <table style="margin-top:12px">
        <thead><tr>
          <th style="width:40%">Candidate</th>
          <th>Status</th>
        </tr></thead>
        <tbody>${dqRows}</tbody>
      </table>
    </details>
  </div>` : ''}

  <div class="footer">
    Prepared by Lancor Partners LLC &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; ${today}
  </div>

</div>
</body>
</html>`;
}

// ── parseDashboardHTML ─────────────────────────────────────────────────────

function parseDashboardHTML(html, search) {
  const candidates = [];

  // Extract all table rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const stripHtml = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').trim();
  const extractHref = s => { const m = s.match(/href=["']([^"']+)["']/i); return m ? m[1] : ''; };

  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    if (rowHtml.includes('<th')) continue; // skip header rows

    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push({ text: stripHtml(cellMatch[1]), html: cellMatch[1] });
    }
    if (cells.length < 2) continue;

    // Extract name from first cell
    const nameCell = cells[0];
    const name = nameCell.text.split('\n')[0].trim();
    if (!name || name.length < 2) continue;

    // Skip rows that look like headers
    const lowerName = name.toLowerCase();
    if (['name', 'candidate', 'stage', '#'].includes(lowerName)) continue;

    // Extract linkedin URL from first cell if present
    const linkedinUrl = extractHref(nameCell.html).includes('linkedin') ? extractHref(nameCell.html) : '';

    // Second cell: usually "Title / Firm" or "Title\nFirm"
    const titleFirmCell = cells[1] ? cells[1].text : '';
    let current_title = '', current_firm = '';
    if (titleFirmCell.includes('/')) {
      const parts = titleFirmCell.split('/');
      current_title = parts[0].trim();
      current_firm = parts.slice(1).join('/').trim();
    } else if (titleFirmCell.includes('\n')) {
      const lines = titleFirmCell.split('\n').map(l => l.trim()).filter(Boolean);
      current_title = lines[0] || '';
      current_firm = lines[1] || '';
    } else {
      current_title = titleFirmCell;
      current_firm = cells[2] ? cells[2].text : '';
    }

    // Location — look for "City, ST" pattern
    let location = '';
    for (const cell of cells) {
      if (/^[A-Z][a-z]+,\s*[A-Z]{2}/.test(cell.text) || /^[A-Z][a-z]+,\s*[A-Z][a-z]+/.test(cell.text)) {
        location = cell.text;
        break;
      }
    }

    // Stage — look for known stage values
    const stageValues = ['Qualifying','Scheduling','Hold','DQ','NI','Pursuing','Outreach Sent'];
    let stage = 'Pursuing';
    for (const cell of cells) {
      const found = stageValues.find(sv => cell.text.toLowerCase().includes(sv.toLowerCase()));
      if (found) { stage = found; break; }
    }

    // Next step — look for cell with longer action text
    let next_step = '';
    for (let i = 2; i < cells.length; i++) {
      const t = cells[i].text;
      if (t.length > 10 && !stageValues.some(sv => t === sv) && !/^[A-Z][a-z]+,/.test(t)) {
        next_step = t;
        break;
      }
    }

    // Build candidate_id slug
    const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const candidate_id = slugify(name) + (current_firm ? '-' + slugify(current_firm).slice(0,20) : '');

    // Initialize client_meetings from search contacts
    const client_meetings = (search.client_contacts || []).map(c => ({
      contact_name: c.name,
      status: '—',
      date: null
    }));

    candidates.push({
      candidate_id,
      name,
      current_title,
      current_firm,
      location,
      linkedin_url: linkedinUrl,
      archetype: 'PE Lateral',
      source: 'LinkedIn title search',
      stage,
      lancor_screener: '',
      screen_date: null,
      lancor_assessment: '',
      resume_attached: false,
      client_meetings,
      client_feedback: '',
      next_step,
      next_step_owner: '',
      next_step_date: null,
      dq_reason: '',
      last_touchpoint: null,
      notes: '',
      date_added: new Date().toISOString().slice(0,10)
    });
  }

  return candidates;
}

module.exports = router;
