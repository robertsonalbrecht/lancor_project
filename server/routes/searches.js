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

    // Auto-load sector playbook data into sourcing coverage
    let sourcingCoverage = { pe_firms: [], companies: [] };
    if (body.sectors && body.sectors.length > 0) {
      try {
        const pbData = JSON.parse(fs.readFileSync(playbooksFile(), 'utf8'));
        body.sectors.forEach(sectorId => {
          const sector = pbData.sectors.find(s => s.sector_id === sectorId);
          if (sector) {
            sector.pe_firms.forEach(firm => {
              sourcingCoverage.pe_firms.push({
                firm_id: firm.firm_id || firm.name,
                firm_name: firm.name || firm.firm_name,
                coverage_pct: 0,
                coverage_band: 'unsearched',
                notes: ''
              });
            });
            sector.target_companies.forEach(co => {
              sourcingCoverage.companies.push({
                company_id: co.company_id || co.name,
                company_name: co.name || co.company_name,
                coverage_pct: 0,
                coverage_band: 'unsearched',
                notes: ''
              });
            });
          }
        });
      } catch (e) {
        // Playbooks file issue — continue with empty coverage
      }
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
    const filename = `${search.search_id}-${new Date().toISOString().slice(0,10)}.html`;
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

    const { candidate_ids } = req.body;
    if (!Array.isArray(candidate_ids) || candidate_ids.length === 0) {
      return res.status(400).json({ error: 'candidate_ids array required' });
    }

    const poolData = JSON.parse(fs.readFileSync(candidatesFile(), 'utf8'));
    const debriefedCandidates = search.pipeline.filter(c => candidate_ids.includes(c.candidate_id));

    debriefedCandidates.forEach(candidate => {
      const existing = poolData.candidates.findIndex(c => c.candidate_id === candidate.candidate_id);
      const poolEntry = Object.assign({}, candidate, {
        search_id: search.search_id,
        debriefed_date: new Date().toISOString().slice(0, 10)
      });
      if (existing === -1) {
        poolData.candidates.push(poolEntry);
      } else {
        poolData.candidates[existing] = poolEntry;
      }
    });

    fs.writeFileSync(candidatesFile(), JSON.stringify(poolData, null, 2), 'utf8');
    res.json({ debriefed: debriefedCandidates.length, candidates: debriefedCandidates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard HTML generator ───────────────────────────────────────────────

function generateDashboardHTML(search) {
  const stageCounts = {};
  (search.pipeline || []).forEach(c => {
    stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
  });

  const stageRows = Object.entries(stageCounts).map(([stage, count]) =>
    `<tr><td>${stage}</td><td>${count}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${search.client_name} — ${search.role_title}</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; margin: 40px; color: #222; }
    h1 { color: #5C2D91; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #5C2D91; color: white; }
  </style>
</head>
<body>
  <h1>${search.client_name}</h1>
  <h2>${search.role_title}</h2>
  <p>Generated: ${new Date().toLocaleDateString()}</p>
  <h3>Pipeline Summary</h3>
  <table>
    <tr><th>Stage</th><th>Count</th></tr>
    ${stageRows || '<tr><td colspan="2">No candidates yet</td></tr>'}
  </table>
</body>
</html>`;
}

module.exports = router;
