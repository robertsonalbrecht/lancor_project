'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { slugify: slugifyShared, normCompanyName, extractLinkedInCompanySlug, readJsonFile, writeJsonFile, jsonFilePath } = require('../utils/shared');

// ── Prefill helpers (used by the /prefill endpoint) ──────────────────────────

const INVALID_NAMES = /^\d+\s*notification|^messaging$|^home$|^my network$|^jobs$/i;
const normName = s => (s || '').toLowerCase().trim();
const extractLinkedInSlug = s => {
  if (!s) return '';
  const m = s.match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : '';
};
const normUrl  = s => (s || '').replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
const normFirm = s => (s || '').replace(/\s*[·•]\s*(full[- ]time|part[- ]time|contract|freelance|self[- ]employed).*$/i, '').toLowerCase().trim();
const cleanFirm = s => (s || '').replace(/\s*[·•]\s*(Full[- ]time|Part[- ]time|Contract|Freelance|Self[- ]employed|Seasonal|Internship).*$/i, '').trim();
const isCorruptedFirm = s => /^\d+\s*(yrs?|mos?|years?|months?)/i.test((s || '').trim());

// ── Company pool helpers ─────────────────────────────────────────────────────

function companyPoolFile() {
  return path.join(process.env.DATA_PATH, 'company_pool.json');
}

function readCompanyPool() {
  try {
    return JSON.parse(fs.readFileSync(companyPoolFile(), 'utf8'));
  } catch { return { companies: [] }; }
}

// Fuzzy-match a firm name against the company pool
// Accepts optional poolData to avoid repeated file reads
function findCompanyInPool(firmName, linkedinUrl, poolData) {
  if (!firmName && !linkedinUrl) return null;
  const pool = poolData || readCompanyPool();
  const companies = pool.companies || [];

  // 1. LinkedIn URL match (most reliable)
  const slug = extractLinkedInCompanySlug(linkedinUrl);
  if (slug) {
    for (const c of companies) {
      if (extractLinkedInCompanySlug(c.linkedin_company_url) === slug) return c;
    }
  }

  // 2. Name match
  const target = normCompanyName(firmName);
  if (!target) return null;

  for (const c of companies) {
    const names = [c.name, ...(c.aliases || [])].map(normCompanyName);
    for (const n of names) {
      if (!n) continue;
      if (n === target) return c;
      const shorter = n.length <= target.length ? n : target;
      const longer = n.length > target.length ? n : target;
      if (shorter.length >= 4 && longer.includes(shorter) && shorter.length >= longer.length * 0.6) return c;
    }
  }
  return null;
}

// Create a company stub for a new company not in the pool
function createCompanyStub(name, linkedinUrl, source) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    company_id:               slugifyShared(name),
    company_type:             null,
    name:                     name,
    aliases:                  [],
    linkedin_company_url:     linkedinUrl || null,
    hq:                       null,
    website_url:              null,
    description:              null,
    year_founded:             null,
    notes:                    '',
    date_added:               today,
    last_updated:             today,
    source:                   source || 'candidate-sync',
    enrichment_status:        'pending',
    size_tier:                null,
    strategy:                 null,
    entity_type:              null,
    investment_professionals: null,
    last_fund_name:           null,
    last_fund_size:           null,
    last_fund_vintage:        null,
    dry_powder:               null,
    preferred_ebitda_min:     null,
    preferred_ebitda_max:     null,
    preferred_geography:      null,
    active_portfolio_count:   null,
    sector_focus_tags:        [],
    revenue_tier:             null,
    ownership_type:           null,
    parent_company:           null,
    employee_count:           null,
    industry:                 null,
    ticker:                   null
  };
}

// Auto-create company stubs for any unrecognized companies in work history
function autoCreateCompaniesFromWorkHistory(workHistory, poolData) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return false;
  const existingIds = new Set((poolData.companies || []).map(c => c.company_id));
  let added = false;

  for (const entry of workHistory) {
    const name = (entry.company || '').trim();
    if (!name || name.length < 2) continue;
    if (/^\d+\s*(yrs?|mos?)/i.test(name)) continue; // corrupted

    // Skip if already linked
    if (entry.company_id) continue;

    const match = findCompanyInPool(name, entry.companyLinkedInUrl, poolData);
    if (match) {
      entry.company_id = match.company_id;
      // Update LinkedIn URL on existing company if we have one
      if (entry.companyLinkedInUrl && !match.linkedin_company_url) {
        match.linkedin_company_url = entry.companyLinkedInUrl;
      }
      continue;
    }

    // Create stub
    const stub = createCompanyStub(name, entry.companyLinkedInUrl, 'candidate-sync');
    // Ensure unique ID
    if (existingIds.has(stub.company_id)) {
      let counter = 2;
      while (existingIds.has(stub.company_id + '-' + counter)) counter++;
      stub.company_id = stub.company_id + '-' + counter;
    }

    poolData.companies.push(stub);
    existingIds.add(stub.company_id);
    entry.company_id = stub.company_id;
    added = true;
    console.log(`[prefill] Created company stub: "${name}" (${stub.company_id})`);
  }

  return added;
}

// Auto-enrich candidate fields from company pool data
function enrichFromCompanyPool(candidate) {
  const company = findCompanyInPool(candidate.current_firm, null, null);
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

// Auto-add PE firms from work history to sector playbooks
function autoAddPEFirmsToPlaybooks(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return;

  const companyPool = readCompanyPool();
  const peCompanies = [];

  // Collect PE firms from work history
  for (const entry of workHistory) {
    if (!entry.company_id) continue;
    const company = (companyPool.companies || []).find(c => c.company_id === entry.company_id);
    if (!company || company.company_type !== 'PE Firm') continue;
    if (!company.sector_focus_tags || company.sector_focus_tags.length === 0) continue;
    peCompanies.push(company);
  }

  if (peCompanies.length === 0) return;

  // Load playbooks
  const playbooksPath = path.join(process.env.DATA_PATH, 'sector_playbooks.json');
  let playbooks;
  try { playbooks = JSON.parse(fs.readFileSync(playbooksPath, 'utf8')); } catch { return; }

  let added = 0;
  for (const company of peCompanies) {
    for (const sectorId of company.sector_focus_tags) {
      const sector = (playbooks.sectors || []).find(s => s.sector_id === sectorId);
      if (!sector) continue;
      if (!sector.pe_firms) sector.pe_firms = [];

      // Check if already in this sector's playbook
      const exists = sector.pe_firms.some(f =>
        f.firm_id === company.company_id || normCompanyName(f.name) === normCompanyName(company.name)
      );
      if (exists) continue;

      // Add new entry
      sector.pe_firms.push({
        firm_id:                 company.company_id,
        name:                    company.name,
        hq:                      company.hq || '',
        website_url:             company.website_url || '',
        description:             company.description || '',
        year_founded:            company.year_founded || null,
        size_tier:               company.size_tier || null,
        strategy:                company.strategy || null,
        entity_type:             company.entity_type || null,
        sector_focus:            'Opportunistic',
        investment_professionals: company.investment_professionals || null,
        last_fund_name:          company.last_fund_name || null,
        last_fund_size:          company.last_fund_size || null,
        last_fund_vintage:       company.last_fund_vintage || null,
        dry_powder:              company.dry_powder || null,
        preferred_ebitda_min:    company.preferred_ebitda_min || null,
        preferred_ebitda_max:    company.preferred_ebitda_max || null,
        preferred_geography:     company.preferred_geography || '',
        active_portfolio_count:  company.active_portfolio_count || null,
        roster:                  [],
        expected_roster_size:    company.size_tier === 'Mega' ? 22 : company.size_tier === 'Large' ? 11 : 6,
        roster_completeness:     'auto',
        why_target:              '',
        last_roster_audit:       null
      });
      added++;
      console.log(`[prefill] Auto-added PE firm "${company.name}" to sector "${sectorId}" playbook`);
    }
  }

  if (added > 0) {
    fs.writeFileSync(playbooksPath, JSON.stringify(playbooks, null, 2), 'utf8');
  }
}

// Post-process work history: propagate company names between consecutive entries
// that share the same logoUrl (same company) or are adjacent with empty company names
function normalizeWorkHistory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;

  // Pass 1: propagate company from grouped entries sharing the same logoUrl
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].company) continue;
    const logo = entries[i].logoUrl || '';
    if (!logo) continue;
    // Look for a nearby entry with the same logo that has a company name
    for (let j = 0; j < entries.length; j++) {
      if (j === i) continue;
      if ((entries[j].logoUrl || '') === logo && entries[j].company) {
        entries[i].company = entries[j].company;
        break;
      }
    }
  }

  // Pass 2: for consecutive entries with empty company, group them under the
  // same company if they share similar descriptions or if there's a preceding
  // entry with a company name and matching logo
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].company) continue;
    const prev = entries[i - 1];
    // If previous entry has a company and both have same (or empty) logo, propagate
    if (prev.company && (prev.logoUrl || '') === (entries[i].logoUrl || '')) {
      entries[i].company = prev.company;
    }
    // If both are empty-company but have identical descriptions, they're likely the same company
    if (!entries[i].company && prev.company && entries[i].description && prev.description &&
        entries[i].description.trim() === prev.description.trim()) {
      entries[i].company = prev.company;
    }
  }

  return entries;
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
            stage: body.stage || body.initial_stage || 'Pursuing',
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

    const nameProvided = fullName && fullName.trim() && !INVALID_NAMES.test(fullName.trim());

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
      // Always update current title and firm from latest scrape (people change jobs)
      if (currentTitle) existing.current_title = currentTitle;
      if (safeCompany)  existing.current_firm  = cleanFirm(safeCompany);
      if (location      && !existing.home_location)  existing.home_location  = location;
      if (photoUrl) existing.photo_url = photoUrl; // always refresh photo
      if (Array.isArray(workHistory) && workHistory.length) {
        const cleaned = workHistory.map(w => Object.assign({}, w, { company: cleanFirm(w.company) }));
        normalizeWorkHistory(cleaned);
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

      // Auto-create company stubs for unrecognized companies in work history
      const companyPool = readCompanyPool();
      const companiesAdded = autoCreateCompaniesFromWorkHistory(existing.work_history, companyPool);
      if (companiesAdded) {
        fs.writeFileSync(companyPoolFile(), JSON.stringify(companyPool, null, 2), 'utf8');
      }

      // Auto-add PE firms to sector playbooks
      autoAddPEFirmsToPlaybooks(existing.work_history);

      writePool(pool);
      return res.json({ action: 'updated', id: existing.candidate_id });
    }

    // CREATE new candidate — require a name to avoid ghost records
    if (!nameProvided) {
      return res.status(400).json({ error: 'Cannot create new candidate without a name' });
    }
    const candidate_id = `cand-${slugifyShared(fullName || 'unknown')}-${Date.now()}`;

    const newCandidate = {
      candidate_id,
      name:           fullName      || '',
      current_title:  currentTitle  || '',
      current_firm:   cleanFirm(safeCompany) || '',
      home_location:  location      || '',
      linkedin_url:   linkedinUrl   || '',
      photo_url:      photoUrl      || '',
      work_history:   Array.isArray(workHistory) ? normalizeWorkHistory(workHistory.map(w => Object.assign({}, w, { company: cleanFirm(w.company) }))) : [],
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

    // Auto-create company stubs for unrecognized companies in work history
    const companyPool = readCompanyPool();
    const companiesAdded = autoCreateCompaniesFromWorkHistory(newCandidate.work_history, companyPool);
    if (companiesAdded) {
      fs.writeFileSync(companyPoolFile(), JSON.stringify(companyPool, null, 2), 'utf8');
    }

    // Auto-add PE firms to sector playbooks
    autoAddPEFirmsToPlaybooks(newCandidate.work_history);

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
