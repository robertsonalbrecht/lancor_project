'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function candidatesFile() {
  return path.join(process.env.DATA_PATH, 'candidate_pool.json');
}
function searchesFile() {
  return path.join(process.env.DATA_PATH, 'active_searches.json');
}

function readPool() {
  return JSON.parse(fs.readFileSync(candidatesFile(), 'utf8'));
}
function writePool(data) {
  fs.writeFileSync(candidatesFile(), JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/candidates — return all candidates (supports ?sector= ?archetype= ?rating= ?availability=)
router.get('/', (req, res) => {
  try {
    const data = readPool();
    let results = data.candidates;

    if (req.query.sector) {
      results = results.filter(c =>
        Array.isArray(c.sector_tags) && c.sector_tags.includes(req.query.sector)
      );
    }
    if (req.query.archetype) {
      results = results.filter(c => c.archetype === req.query.archetype);
    }
    if (req.query.operator_background) {
      results = results.filter(c => c.operator_background === req.query.operator_background);
    }
    if (req.query.availability) {
      results = results.filter(c => c.availability === req.query.availability);
    }
    if (req.query.rating) {
      results = results.filter(c => String(c.quality_rating) === String(req.query.rating));
    }

    res.json({ candidates: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id — return single candidate
router.get('/:id', (req, res) => {
  try {
    const data = readPool();
    const candidate = data.candidates.find(c => c.candidate_id === req.params.id);
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates — create candidate in pool
// If search_id provided in body, also adds to that search's pipeline
router.post('/', (req, res) => {
  try {
    const pool = readPool();
    const body = req.body;

    const newCandidate = Object.assign({
      candidate_id: body.candidate_id || `cand-${Date.now()}`,
      date_added: new Date().toISOString().slice(0, 10)
    }, body);

    // Deduplicate by candidate_id
    const existingIdx = pool.candidates.findIndex(c => c.candidate_id === newCandidate.candidate_id);
    if (existingIdx === -1) {
      pool.candidates.push(newCandidate);
    } else {
      pool.candidates[existingIdx] = newCandidate;
    }
    writePool(pool);

    // Optionally add to active search pipeline
    if (body.search_id) {
      try {
        const searchData = JSON.parse(fs.readFileSync(searchesFile(), 'utf8'));
        const searchIdx = searchData.searches.findIndex(s => s.search_id === body.search_id);
        if (searchIdx !== -1) {
          const search = searchData.searches[searchIdx];
          const pipelineEntry = {
            candidate_id: newCandidate.candidate_id,
            name: newCandidate.name,
            current_title: newCandidate.current_title,
            current_firm: newCandidate.current_firm,
            location: newCandidate.home_location || '',
            linkedin_url: newCandidate.linkedin_url || '',
            archetype: newCandidate.archetype || 'PE Lateral',
            source: body.source || 'LinkedIn title search',
            stage: body.initial_stage || 'Pursuing',
            lancor_screener: '',
            screen_date: null,
            lancor_assessment: '',
            resume_attached: false,
            client_meetings: (search.client_contacts || []).map(c => ({
              contact_name: c.name, status: '—', date: null
            })),
            client_feedback: '',
            next_step: body.notes ? 'See notes' : '',
            next_step_owner: '',
            next_step_date: null,
            dq_reason: '',
            last_touchpoint: null,
            notes: body.notes || '',
            date_added: new Date().toISOString().slice(0,10)
          };
          const pipelineIdx = search.pipeline.findIndex(c => c.candidate_id === newCandidate.candidate_id);
          if (pipelineIdx === -1) {
            search.pipeline.push(pipelineEntry);
          } else {
            search.pipeline[pipelineIdx] = pipelineEntry;
          }
          fs.writeFileSync(searchesFile(), JSON.stringify(searchData, null, 2), 'utf8');
        }
      } catch (e) {
        // Non-fatal — candidate was saved to pool successfully
      }
    }

    res.status(201).json(newCandidate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/prefill — upsert candidate from Chrome extension scraper data
router.post('/prefill', (req, res) => {
  try {
    const pool = readPool();
    const { fullName, currentTitle, currentCompany, location, linkedinUrl, workHistory } = req.body;

    const normName = s => (s || '').toLowerCase().trim();
    // Normalize LinkedIn URL: strip trailing slash and query params for comparison
    const normUrl  = s => (s || '').replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
    // Normalize firm: strip LinkedIn suffixes like "· Full-time", "· Part-time", "· Contract"
    const normFirm = s => (s || '').replace(/\s*[·•]\s*(full[- ]time|part[- ]time|contract|freelance|self[- ]employed).*$/i, '').toLowerCase().trim();

    // 1. Match by LinkedIn URL (normalized, trailing-slash-insensitive)
    // 2. Fallback: match by name + firm (for candidates imported without a URL)
    let existing = linkedinUrl
      ? pool.candidates.find(c => normUrl(c.linkedin_url) === normUrl(linkedinUrl))
      : null;

    if (!existing && fullName && currentCompany) {
      existing = pool.candidates.find(c =>
        normName(c.name) === normName(fullName) &&
        normFirm(c.current_firm) === normFirm(currentCompany)
      );
    }

    if (existing) {
      // UPDATE existing candidate — enrich blank fields, always refresh work history
      if (linkedinUrl && !existing.linkedin_url) existing.linkedin_url = linkedinUrl;
      if (currentTitle  && !existing.current_title)  existing.current_title  = currentTitle;
      if (currentCompany && !existing.current_firm)  existing.current_firm   = currentCompany;
      if (location      && !existing.home_location)  existing.home_location  = location;
      if (Array.isArray(workHistory) && workHistory.length) existing.work_history = workHistory;
      existing.last_scraped = new Date().toISOString().slice(0, 10);

      writePool(pool);
      return res.json({ action: 'updated', id: existing.candidate_id });
    }

    // CREATE new candidate
    const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const candidate_id = `cand-${slugify(fullName || 'unknown')}-${Date.now()}`;

    const newCandidate = {
      candidate_id,
      name:           fullName      || '',
      current_title:  currentTitle  || '',
      current_firm:   currentCompany|| '',
      home_location:  location      || '',
      linkedin_url:   linkedinUrl   || '',
      work_history:   Array.isArray(workHistory) ? workHistory : [],
      sector_tags:    [],
      archetype:      '',
      operator_background: [],
      owned_pl:       false,
      firm_size_tier: null,
      company_revenue_tier: null,
      quality_rating: null,
      rating_set_by:  null,
      rating_date:    null,
      availability:   'Unknown',
      availability_updated: null,
      search_history: [],
      dq_reasons:     [],
      last_contact_date: null,
      notes:          '',
      date_added:     new Date().toISOString().slice(0, 10),
      added_from_search: '',
      last_scraped:   new Date().toISOString().slice(0, 10),
      source:         'LinkedIn (Chrome Extension)'
    };

    pool.candidates.push(newCandidate);
    writePool(pool);

    res.status(201).json({ action: 'created', id: candidate_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/candidates/:id — update candidate
router.put('/:id', (req, res) => {
  try {
    const pool = readPool();
    const idx = pool.candidates.findIndex(c => c.candidate_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Candidate not found' });
    pool.candidates[idx] = Object.assign({}, pool.candidates[idx], req.body, { candidate_id: req.params.id });
    writePool(pool);
    res.json(pool.candidates[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
