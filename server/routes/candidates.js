'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function companyPoolFile() {
  return path.join(process.env.DATA_PATH, 'company_pool.json');
}

function readCompanyPool() {
  try {
    return JSON.parse(fs.readFileSync(companyPoolFile(), 'utf8'));
  } catch { return { companies: [] }; }
}

// Fuzzy-match a firm name against the company pool
function findCompanyInPool(firmName) {
  if (!firmName) return null;
  const pool = readCompanyPool();
  const norm = s => (s || '').replace(/\s*[·•]\s*(Full-time|Part-time|Contract|Freelance|Self-employed|Seasonal|Internship).*$/i, '')
    .replace(/\s*\(.*?\)\s*/g, '').trim().toLowerCase();
  const target = norm(firmName);
  if (!target) return null;

  for (const c of pool.companies || []) {
    const names = [c.name, ...(c.aliases || [])].map(norm);
    for (const n of names) {
      if (!n) continue;
      if (n === target) return c;
      // Substring match (shorter must be >= 60% of longer)
      const shorter = n.length <= target.length ? n : target;
      const longer = n.length > target.length ? n : target;
      if (shorter.length >= 4 && longer.includes(shorter) && shorter.length >= longer.length * 0.6) return c;
    }
  }
  return null;
}

// Auto-enrich candidate fields from company pool data
function enrichFromCompanyPool(candidate) {
  const company = findCompanyInPool(candidate.current_firm);
  if (!company) return;

  // Set firm_size_tier from company pool
  if (!candidate.firm_size_tier && company.size_tier) {
    candidate.firm_size_tier = company.size_tier;
  }
  // Set archetype based on company type
  if (!candidate.archetype && company.company_type) {
    if (/PE Firm|Private Equity/i.test(company.company_type)) {
      candidate.archetype = 'PE Lateral';
    }
  }
  // Set sector_tags from company sectors
  if ((!candidate.sector_tags || candidate.sector_tags.length === 0) && company.sectors && company.sectors.length > 0) {
    candidate.sector_tags = [...company.sectors];
  }
}

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

    // Clean LinkedIn suffixes from firm names
    const cleanFirmName = s => (s || '').replace(/\s*[·•]\s*(Full[- ]time|Part[- ]time|Contract|Freelance|Self[- ]employed|Seasonal|Internship).*$/i, '').trim();
    if (body.current_firm) body.current_firm = cleanFirmName(body.current_firm);

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
    const { fullName, currentTitle, currentCompany, location, linkedinUrl, photoUrl, workHistory } = req.body;

    console.log('[prefill] Received:', { fullName, currentTitle, currentCompany, linkedinUrl: linkedinUrl?.slice(0, 60) });

    // Reject imports with no name AND no LinkedIn URL — nothing to match or create
    if ((!fullName || !fullName.trim()) && (!linkedinUrl || !linkedinUrl.trim())) {
      return res.status(400).json({ error: 'Name or LinkedIn URL is required' });
    }

    // If we have a LinkedIn URL but no name, only allow update of existing candidates (not creation)
    // Also reject names that are clearly scraper artifacts
    const INVALID_NAMES = /^\d+\s*notification|^messaging$|^home$|^my network$|^jobs$/i;
    const nameProvided = fullName && fullName.trim() && !INVALID_NAMES.test(fullName.trim());

    const normName = s => (s || '').toLowerCase().trim();
    // Extract LinkedIn slug for matching: /in/XXXXX -> xxxxx (ignore trailing variations)
    const extractLinkedInSlug = s => {
      if (!s) return '';
      const m = s.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
      return m ? m[1].toLowerCase() : '';
    };
    // Legacy URL normalization as fallback
    const normUrl  = s => (s || '').replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
    // Normalize firm: strip LinkedIn suffixes like "· Full-time", "· Part-time", "· Contract"
    const normFirm = s => (s || '').replace(/\s*[·•]\s*(full[- ]time|part[- ]time|contract|freelance|self[- ]employed).*$/i, '').toLowerCase().trim();
    // Clean firm name for storage: strip suffix but keep original casing
    const cleanFirm = s => (s || '').replace(/\s*[·•]\s*(Full[- ]time|Part[- ]time|Contract|Freelance|Self[- ]employed|Seasonal|Internship).*$/i, '').trim();
    // Detect corrupted company field (contains duration instead of company name)
    const isCorruptedFirm = s => /^\d+\s*(yrs?|mos?|years?|months?)/i.test((s || '').trim());

    // Clean company field if corrupted
    let safeCompany = currentCompany;
    if (isCorruptedFirm(currentCompany)) {
      // Try to extract real company from work history
      const currentJob = (Array.isArray(workHistory) && workHistory.length > 0) ? workHistory[0] : null;
      if (currentJob && currentJob.company && !isCorruptedFirm(currentJob.company)) {
        safeCompany = currentJob.company;
      } else if (currentJob && currentJob.title && !isCorruptedFirm(currentJob.title)) {
        // Sometimes title and company get swapped in scraper
        safeCompany = currentJob.title;
      } else {
        safeCompany = '';
      }
    }

    // 1. Match by LinkedIn slug (most reliable — handles URL variations)
    const incomingSlug = extractLinkedInSlug(linkedinUrl);
    let existing = incomingSlug
      ? pool.candidates.find(c => extractLinkedInSlug(c.linkedin_url) === incomingSlug)
      : null;

    // 2. Fallback: full URL match
    if (!existing && linkedinUrl) {
      existing = pool.candidates.find(c => normUrl(c.linkedin_url) === normUrl(linkedinUrl));
    }

    // 3. Fallback: name + firm
    if (!existing && fullName && safeCompany) {
      existing = pool.candidates.find(c =>
        normName(c.name) === normName(fullName) &&
        normFirm(c.current_firm) === normFirm(safeCompany)
      );
    }

    // 4. Fallback: name-only match — return possible duplicate warning
    if (!existing && fullName) {
      const nameMatches = pool.candidates.filter(c => normName(c.name) === normName(fullName));
      if (nameMatches.length > 0) {
        // Auto-match if LinkedIn slug partially overlaps or single name match
        if (nameMatches.length === 1) {
          existing = nameMatches[0];
        }
      }
    }

    if (existing) {
      // UPDATE existing candidate — enrich blank fields, always refresh work history
      if (linkedinUrl && !existing.linkedin_url) existing.linkedin_url = linkedinUrl;
      if (currentTitle  && !existing.current_title)  existing.current_title  = currentTitle;
      if (safeCompany && !existing.current_firm)  existing.current_firm   = cleanFirm(safeCompany);
      if (location      && !existing.home_location)  existing.home_location  = location;
      if (photoUrl) existing.photo_url = photoUrl; // always refresh photo
      if (Array.isArray(workHistory) && workHistory.length) {
        const cleaned = workHistory.map(w => Object.assign({}, w, { company: cleanFirm(w.company) }));
        const seen = new Set();
        existing.work_history = cleaned.filter(w => {
          const key = [(w.title||'').toLowerCase().trim(), (w.company||'').toLowerCase().trim(), (w.dates||'').toLowerCase().trim()].join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      existing.last_scraped = new Date().toISOString().slice(0, 10);

      // Auto-enrich from company pool if metadata is missing
      enrichFromCompanyPool(existing);

      writePool(pool);
      return res.json({ action: 'updated', id: existing.candidate_id });
    }

    // CREATE new candidate — require a name to avoid ghost records
    if (!nameProvided) {
      return res.status(400).json({ error: 'Cannot create new candidate without a name' });
    }
    const slugify = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    const candidate_id = `cand-${slugify(fullName || 'unknown')}-${Date.now()}`;

    const newCandidate = {
      candidate_id,
      name:           fullName      || '',
      current_title:  currentTitle  || '',
      current_firm:   cleanFirm(safeCompany) || '',
      home_location:  location      || '',
      linkedin_url:   linkedinUrl   || '',
      photo_url:      photoUrl      || '',
      work_history:   Array.isArray(workHistory) ? workHistory.map(w => Object.assign({}, w, { company: cleanFirm(w.company) })) : [],
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

    // Auto-enrich from company pool
    enrichFromCompanyPool(newCandidate);

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

// POST /api/candidates/merge — merge two candidate profiles
// Body: { keep_id, remove_id, merged_fields }
// merged_fields is the final candidate record (excluding work_history/search_history which are combined)
router.post('/merge', (req, res) => {
  try {
    const { keep_id, remove_id, merged_fields } = req.body;
    if (!keep_id || !remove_id) return res.status(400).json({ error: 'keep_id and remove_id required' });
    if (keep_id === remove_id) return res.status(400).json({ error: 'Cannot merge a candidate with itself' });

    const pool = readPool();
    const keepIdx = pool.candidates.findIndex(c => c.candidate_id === keep_id);
    const removeIdx = pool.candidates.findIndex(c => c.candidate_id === remove_id);
    if (keepIdx === -1) return res.status(404).json({ error: 'Keep candidate not found' });
    if (removeIdx === -1) return res.status(404).json({ error: 'Remove candidate not found' });

    const keepCand = pool.candidates[keepIdx];
    const removeCand = pool.candidates[removeIdx];

    // Merge work histories (dedupe by company+title)
    const combinedHistory = [...(keepCand.work_history || [])];
    (removeCand.work_history || []).forEach(w => {
      const exists = combinedHistory.some(h =>
        (h.company || '').toLowerCase() === (w.company || '').toLowerCase() &&
        (h.title || '').toLowerCase() === (w.title || '').toLowerCase()
      );
      if (!exists) combinedHistory.push(w);
    });

    // Merge search histories
    const combinedSearchHistory = [...(keepCand.search_history || [])];
    (removeCand.search_history || []).forEach(h => {
      if (!combinedSearchHistory.some(s => s.search_id === h.search_id)) {
        combinedSearchHistory.push(h);
      }
    });

    // Merge DQ reasons
    const combinedDQ = [...(keepCand.dq_reasons || []), ...(removeCand.dq_reasons || [])];

    // Apply merged fields over the keep candidate
    const finalCandidate = Object.assign({}, keepCand, merged_fields || {}, {
      candidate_id: keep_id,
      work_history: combinedHistory,
      search_history: combinedSearchHistory,
      dq_reasons: combinedDQ
    });

    pool.candidates[keepIdx] = finalCandidate;
    pool.candidates.splice(removeIdx > keepIdx ? removeIdx : removeIdx, 1);
    writePool(pool);

    // Cascade: update all references from remove_id to keep_id
    // 1. Active searches — pipeline entries
    const searchData = JSON.parse(fs.readFileSync(searchesFile(), 'utf8'));
    let searchesUpdated = 0;
    searchData.searches.forEach(search => {
      // Pipeline
      (search.pipeline || []).forEach(p => {
        if (p.candidate_id === remove_id) {
          p.candidate_id = keep_id;
          searchesUpdated++;
        }
      });
      // Sourcing coverage rosters
      const coverage = search.sourcing_coverage || {};
      ['pe_firms', 'companies'].forEach(type => {
        (coverage[type] || []).forEach(entity => {
          (entity.roster || []).forEach(r => {
            if (r.candidate_id === remove_id) r.candidate_id = keep_id;
          });
        });
      });
    });
    fs.writeFileSync(searchesFile(), JSON.stringify(searchData, null, 2), 'utf8');

    // 2. Sector playbooks — allstar_pool
    const pbPath = path.join(process.env.DATA_PATH, 'sector_playbooks.json');
    if (fs.existsSync(pbPath)) {
      const pbData = JSON.parse(fs.readFileSync(pbPath, 'utf8'));
      (pbData.sectors || []).forEach(sector => {
        const idx = (sector.allstar_pool || []).indexOf(remove_id);
        if (idx !== -1) {
          if (!sector.allstar_pool.includes(keep_id)) {
            sector.allstar_pool[idx] = keep_id;
          } else {
            sector.allstar_pool.splice(idx, 1);
          }
        }
      });
      fs.writeFileSync(pbPath, JSON.stringify(pbData, null, 2), 'utf8');
    }

    res.json({ merged: finalCandidate, searches_updated: searchesUpdated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
