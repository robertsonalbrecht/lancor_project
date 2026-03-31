'use strict';

const express = require('express');
const pool = require('../db');
const router = express.Router();
const { slugify: slugifyShared, normCompanyName, extractLinkedInCompanySlug } = require('../utils/shared');

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function toISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

// ── Find company in pool (Postgres) ─────────────────────────────────────────

async function findCompanyInPool(firmName, linkedinUrl) {
  if (!firmName && !linkedinUrl) return null;

  // 1. LinkedIn URL match
  const slug = extractLinkedInCompanySlug(linkedinUrl);
  if (slug) {
    const { rows } = await pool.query(
      "SELECT id, slug, name, linkedin_company_url, company_type, size_tier FROM companies WHERE linkedin_company_url ILIKE $1 LIMIT 1",
      [`%/company/${slug}%`]
    );
    if (rows.length > 0) return rows[0];
  }

  // 2. Exact name match (normalized)
  const target = normCompanyName(firmName);
  if (!target) return null;

  const { rows } = await pool.query(
    "SELECT id, slug, name, linkedin_company_url, company_type, size_tier FROM companies WHERE LOWER(name) = $1 LIMIT 1",
    [target]
  );
  if (rows.length > 0) return rows[0];

  // 3. Alias match
  const { rows: aliasRows } = await pool.query(
    "SELECT c.id, c.slug, c.name, c.linkedin_company_url, c.company_type, c.size_tier FROM company_aliases ca JOIN companies c ON c.id = ca.company_id WHERE LOWER(ca.alias) = $1 LIMIT 1",
    [target]
  );
  if (aliasRows.length > 0) return aliasRows[0];

  // 4. Fuzzy contains match
  if (target.length >= 4) {
    const { rows: fuzzy } = await pool.query(
      "SELECT id, slug, name, linkedin_company_url, company_type, size_tier FROM companies WHERE LOWER(name) LIKE $1 LIMIT 1",
      [`%${target}%`]
    );
    if (fuzzy.length > 0) return fuzzy[0];
  }

  return null;
}

// Auto-create company stubs for unrecognized companies in work history
async function autoCreateCompaniesFromWorkHistory(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return;

  for (const entry of workHistory) {
    const name = (entry.company || '').trim();
    if (!name || name.length < 2) continue;
    if (/^\d+\s*(yrs?|mos?)/i.test(name)) continue;
    if (entry.company_id) continue; // already linked

    const match = await findCompanyInPool(name, entry.companyLinkedInUrl);
    if (match) {
      entry.company_id = match.slug;
      if (entry.companyLinkedInUrl && !match.linkedin_company_url) {
        await pool.query('UPDATE companies SET linkedin_company_url = $1 WHERE id = $2', [entry.companyLinkedInUrl, match.id]);
      }
      continue;
    }

    // Create stub
    const companySlug = slugifyShared(name);
    const today = new Date().toISOString().slice(0, 10);
    try {
      await pool.query(
        `INSERT INTO companies (slug, name, linkedin_company_url, source, enrichment_status, date_added, last_updated)
         VALUES ($1, $2, $3, 'candidate-sync', 'pending', $4, $4)
         ON CONFLICT (slug) DO NOTHING`,
        [companySlug, name, entry.companyLinkedInUrl || null, today]
      );
      entry.company_id = companySlug;
      console.log(`[prefill] Created company stub: "${name}" (${companySlug})`);
    } catch (e) {
      console.error(`[prefill] Error creating company stub "${name}":`, e.message);
    }
  }
}

// Auto-add PE firms from work history to sector playbooks
async function autoAddPEFirmsToPlaybooks(workHistory) {
  if (!Array.isArray(workHistory) || workHistory.length === 0) return;

  for (const entry of workHistory) {
    if (!entry.company_id) continue;
    const { rows: coRows } = await pool.query(
      "SELECT id, slug, name, company_type, hq, size_tier, strategy FROM companies WHERE slug = $1",
      [entry.company_id]
    );
    if (coRows.length === 0) continue;
    const company = coRows[0];
    if (company.company_type !== 'PE Firm') continue;

    // Get sector tags for this company
    const { rows: sectorTags } = await pool.query(
      "SELECT s.id AS sector_uuid, s.slug AS sector_slug FROM company_sector_tags cst JOIN sectors s ON s.id = cst.sector_id WHERE cst.company_id = $1",
      [company.id]
    );
    if (sectorTags.length === 0) continue;

    for (const { sector_uuid, sector_slug } of sectorTags) {
      // Check if already in playbook
      const { rows: existing } = await pool.query(
        'SELECT id FROM sector_pe_firms WHERE sector_id = $1 AND company_id = $2',
        [sector_uuid, company.id]
      );
      if (existing.length > 0) continue;

      const expectedRoster = company.size_tier === 'Mega' ? 22 : company.size_tier === 'Large' ? 11 : 6;
      await pool.query(
        `INSERT INTO sector_pe_firms (sector_id, company_id, name, hq, size_tier, strategy, sector_focus, expected_roster_size, roster_completeness, why_target)
         VALUES ($1, $2, $3, $4, $5, $6, 'Opportunistic', $7, 'auto', '')
         ON CONFLICT (sector_id, company_id) DO NOTHING`,
        [sector_uuid, company.id, company.name, company.hq, company.size_tier, company.strategy, expectedRoster]
      );
      console.log(`[prefill] Auto-added PE firm "${company.name}" to sector "${sector_slug}" playbook`);
    }
  }
}

// Normalize work history: propagate company names from grouped entries
function normalizeWorkHistory(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return entries;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].company) continue;
    const logo = entries[i].logoUrl || '';
    if (!logo) continue;
    for (let j = 0; j < entries.length; j++) {
      if (j === i) continue;
      if ((entries[j].logoUrl || '') === logo && entries[j].company) {
        entries[i].company = entries[j].company;
        break;
      }
    }
  }
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].company) continue;
    const prev = entries[i - 1];
    if (prev.company && (prev.logoUrl || '') === (entries[i].logoUrl || '')) {
      entries[i].company = prev.company;
    }
    if (!entries[i].company && prev.company && entries[i].description && prev.description &&
        entries[i].description.trim() === prev.description.trim()) {
      entries[i].company = prev.company;
    }
  }
  return entries;
}

// ── Response builders ────────────────────────────────────────────────────────

async function buildCandidateResponse(row) {
  const [result] = await buildCandidateResponses([row]);
  return result;
}

async function buildCandidateResponses(rows) {
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);

  // Sector tags
  const { rows: tagRows } = await pool.query(
    'SELECT cst.candidate_id, s.slug FROM candidate_sector_tags cst JOIN sectors s ON s.id = cst.sector_id WHERE cst.candidate_id = ANY($1)',
    [ids]
  );
  const tagMap = {};
  for (const t of tagRows) {
    if (!tagMap[t.candidate_id]) tagMap[t.candidate_id] = [];
    tagMap[t.candidate_id].push(t.slug);
  }

  // Work history
  const { rows: whRows } = await pool.query(
    `SELECT cwh.*, co.slug AS company_slug
     FROM candidate_work_history cwh
     LEFT JOIN companies co ON co.id = cwh.company_id
     WHERE cwh.candidate_id = ANY($1)
     ORDER BY cwh.candidate_id, cwh.sort_order`,
    [ids]
  );
  const whMap = {};
  for (const w of whRows) {
    if (!whMap[w.candidate_id]) whMap[w.candidate_id] = [];
    whMap[w.candidate_id].push({
      title: w.title,
      company: w.company_name,
      company_id: w.company_slug || null,
      dates: w.dates,
      dateRange: w.date_range,
      duration: w.duration,
      description: w.description,
      logo_url: w.logo_url || null,
      start_date: w.start_date ? w.start_date.toISOString().slice(0, 10) : null,
      end_date: w.end_date ? w.end_date.toISOString().slice(0, 10) : null,
      is_current: w.is_current || false
    });
  }

  // Search history
  const { rows: shRows } = await pool.query(
    'SELECT csh.candidate_id, s.slug FROM candidate_search_history csh JOIN searches s ON s.id = csh.search_id WHERE csh.candidate_id = ANY($1)',
    [ids]
  );
  const shMap = {};
  for (const s of shRows) {
    if (!shMap[s.candidate_id]) shMap[s.candidate_id] = [];
    shMap[s.candidate_id].push(s.slug);
  }

  return rows.map(r => ({
    candidate_id: r.slug,
    name: r.name,
    current_title: r.current_title,
    current_firm: r.current_firm,
    home_location: r.home_location,
    linkedin_url: r.linkedin_url,
    photo_url: r.photo_url || null,
    archetype: r.archetype,
    operator_background: r.operator_background || [],
    firm_size_tier: r.firm_size_tier,
    company_revenue_tier: r.company_revenue_tier,
    quality_rating: r.quality_rating,
    rating_set_by: r.rating_set_by,
    rating_date: toISO(r.rating_date),
    availability: r.availability || 'Unknown',
    availability_updated: toISO(r.availability_updated),
    last_contact_date: toISO(r.last_contact_date),
    notes: r.notes || '',
    date_added: toISO(r.date_added),
    added_from_search: r.added_from_search || '',
    owned_pl: r.owned_pl || false,
    dq_reasons: r.dq_reasons || [],
    primary_experience_index: r.primary_experience_index,
    last_scraped: toISO(r.last_scraped),
    sector_tags: tagMap[r.id] || [],
    work_history: whMap[r.id] || [],
    search_history: shMap[r.id] || []
  }));
}

// Sync sector tags
async function syncSectorTags(candidateUuid, sectorSlugs) {
  await pool.query('DELETE FROM candidate_sector_tags WHERE candidate_id = $1', [candidateUuid]);
  for (const slug of (sectorSlugs || [])) {
    const { rows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [slug]);
    if (rows.length > 0) {
      await pool.query(
        'INSERT INTO candidate_sector_tags (candidate_id, sector_id, sector_slug) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [candidateUuid, rows[0].id, slug]
      );
    }
  }
}

/** Parse a dates text string into { startDate, endDate, isCurrent } */
function _parseDatesText(datesStr) {
  if (!datesStr) return { startDate: null, endDate: null, isCurrent: false };
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const clean = (datesStr || '').replace(/\s*[·•]\s*.*$/, '').trim();
  const parts = clean.split(/\s*[-–]\s*/);
  const parseOne = s => {
    if (!s) return null;
    const m = s.trim().match(/(?:(\w+)\s+)?(\d{4})/);
    if (!m) return null;
    const mo = m[1] ? (months[m[1].toLowerCase().slice(0,3)] || 1) : 1;
    return `${m[2]}-${String(mo).padStart(2,'0')}-01`;
  };
  const isCurrent = /present/i.test(parts[1] || '');
  return {
    startDate: parseOne(parts[0]),
    endDate: isCurrent ? null : parseOne(parts[1]),
    isCurrent
  };
}

// Sync work history
async function syncWorkHistory(candidateUuid, workHistory, primaryIdx) {
  await pool.query('DELETE FROM candidate_work_history WHERE candidate_id = $1', [candidateUuid]);
  for (let i = 0; i < (workHistory || []).length; i++) {
    const w = workHistory[i];
    let companyUuid = null;
    if (w.company_id) {
      const { rows } = await pool.query('SELECT id FROM companies WHERE slug = $1', [w.company_id]);
      if (rows.length > 0) companyUuid = rows[0].id;
    }

    // Use structured dates if provided, otherwise parse from dates text
    let startDate = w.start_date || null;
    let endDate = w.end_date || null;
    let isCurrent = w.is_current || false;
    if (!startDate && w.dates) {
      const parsed = _parseDatesText(w.dates);
      startDate = parsed.startDate;
      endDate = parsed.endDate;
      isCurrent = parsed.isCurrent;
    }

    await pool.query(
      `INSERT INTO candidate_work_history (candidate_id, company_id, title, company_name, dates, date_range, duration, description, sort_order, is_primary, start_date, end_date, is_current, logo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [candidateUuid, companyUuid, w.title || null, w.company || w.company_name || null,
       w.dates || null, w.dateRange || w.date_range || null, w.duration || null,
       w.description || null, i, primaryIdx === i,
       startDate, endDate, isCurrent, w.logoUrl || w.logo_url || null]
    );
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/candidates — paginated, with filters
router.get('/', async (req, res) => {
  try {
    const conditions = [];
    const params = [];
    let paramIdx = 1;
    let joinClause = '';

    if (req.query.text) {
      const pattern = `%${req.query.text}%`;
      conditions.push(`(c.name ILIKE $${paramIdx} OR c.current_firm ILIKE $${paramIdx} OR c.current_title ILIKE $${paramIdx})`);
      params.push(pattern);
      paramIdx++;
    }
    if (req.query.archetype) {
      conditions.push(`c.archetype = $${paramIdx++}`);
      params.push(req.query.archetype);
    }
    if (req.query.availability) {
      conditions.push(`c.availability = $${paramIdx++}`);
      params.push(req.query.availability);
    }
    if (req.query.rating) {
      conditions.push(`c.quality_rating = $${paramIdx++}`);
      params.push(parseInt(req.query.rating));
    }
    if (req.query.sector) {
      joinClause = `JOIN candidate_sector_tags cst ON cst.candidate_id = c.id JOIN sectors s ON s.id = cst.sector_id AND s.slug = $${paramIdx++}`;
      params.push(req.query.sector);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const offset = parseInt(req.query.offset) || 0;

    const countParams = [...params];
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS total FROM candidates c ${joinClause} ${whereClause}`,
      countParams
    );

    const dataParams = [...params, limit, offset];
    const { rows } = await pool.query(
      `SELECT DISTINCT c.* FROM candidates c ${joinClause} ${whereClause} ORDER BY c.name LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      dataParams
    );

    const candidates = await buildCandidateResponses(rows);
    res.json({ candidates, total: countRows[0].total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/slim — lightweight list for auto-linking (no work history descriptions, no sector tags, no search history)
router.get('/slim', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.slug, c.name, c.current_title, c.current_firm, c.home_location, c.linkedin_url
       FROM candidates c ORDER BY c.name`
    );

    // Minimal work history: only company, title, dates for current roles
    const { rows: whRows } = await pool.query(
      `SELECT cwh.candidate_id, cwh.company_name, cwh.title, cwh.dates
       FROM candidate_work_history cwh
       WHERE cwh.dates ILIKE '%present%'
       ORDER BY cwh.candidate_id, cwh.sort_order`
    );
    const whMap = {};
    for (const w of whRows) {
      if (!whMap[w.candidate_id]) whMap[w.candidate_id] = [];
      whMap[w.candidate_id].push({ company: w.company_name, title: w.title, dates: w.dates });
    }

    // Map slugs to UUIDs for work history lookup
    const { rows: idRows } = await pool.query('SELECT id, slug FROM candidates');
    const idMap = {};
    for (const r of idRows) idMap[r.slug] = r.id;

    const candidates = rows.map(r => ({
      candidate_id: r.slug,
      name: r.name,
      current_title: r.current_title,
      current_firm: r.current_firm,
      home_location: r.home_location,
      linkedin_url: r.linkedin_url,
      work_history: whMap[idMap[r.slug]] || []
    }));

    res.json({ candidates, total: candidates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id — single candidate
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM candidates WHERE slug = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Candidate not found' });
    res.json(await buildCandidateResponse(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates — create candidate
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const candidateSlug = body.candidate_id || `cand-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);

    if (body.current_firm) body.current_firm = cleanFirm(body.current_firm);

    const { rows } = await pool.query(
      `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url,
         archetype, operator_background, firm_size_tier, company_revenue_tier,
         availability, owned_pl, dq_reasons, notes, date_added, added_from_search)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (slug) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, candidates.name),
         current_title = COALESCE(EXCLUDED.current_title, candidates.current_title),
         current_firm = COALESCE(EXCLUDED.current_firm, candidates.current_firm)
       RETURNING *`,
      [candidateSlug, body.name, body.current_title || null, body.current_firm || null,
       body.home_location || body.location || null, body.linkedin_url || null,
       body.archetype || null, body.operator_background || '{}',
       body.firm_size_tier || null, body.company_revenue_tier || null,
       body.availability || 'Unknown', body.owned_pl || false,
       body.dq_reasons || '{}', body.notes || '', body.date_added || today,
       body.added_from_search || '']
    );

    const candidate = rows[0];
    if (body.sector_tags) await syncSectorTags(candidate.id, body.sector_tags);
    if (body.work_history) await syncWorkHistory(candidate.id, body.work_history, body.primary_experience_index);

    res.status(201).json(await buildCandidateResponse(candidate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/prefill — Chrome extension upsert
router.post('/prefill', async (req, res) => {
  try {
    const { fullName, currentTitle, currentCompany, location, linkedinUrl, photoUrl, workHistory } = req.body;
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('[prefill] INCOMING PAYLOAD:');
    console.log('  fullName:', fullName);
    console.log('  currentTitle:', currentTitle);
    console.log('  currentCompany:', currentCompany);
    console.log('  location:', location);
    console.log('  linkedinUrl:', (linkedinUrl || '').slice(0, 80));
    console.log('  photoUrl:', photoUrl ? '✓ (' + photoUrl.slice(0, 50) + '...)' : '✗ none');
    console.log('  workHistory:', Array.isArray(workHistory) ? workHistory.length + ' entries' : 'none');
    if (Array.isArray(workHistory) && workHistory.length > 0) {
      workHistory.slice(0, 3).forEach((w, i) => {
        console.log(`    [${i}] ${w.title || '?'} @ ${w.company || '?'} | dates: ${w.dates || '?'} | duration: ${w.duration || '?'}`);
      });
      if (workHistory.length > 3) console.log(`    ... and ${workHistory.length - 3} more`);
    }
    console.log('───────────────────────────────────────────────────────');

    if ((!fullName || !fullName.trim()) && (!linkedinUrl || !linkedinUrl.trim())) {
      console.log('[prefill] REJECTED: no name and no LinkedIn URL');
      return res.status(400).json({ error: 'Name or LinkedIn URL is required' });
    }
    const nameProvided = fullName && fullName.trim() && !INVALID_NAMES.test(fullName.trim());

    // Clean company
    let safeCompany = currentCompany;
    if (isCorruptedFirm(currentCompany)) {
      console.log('[prefill] Corrupted company detected:', currentCompany);
      const currentJob = (Array.isArray(workHistory) && workHistory.length > 0) ? workHistory[0] : null;
      if (currentJob && currentJob.company && !isCorruptedFirm(currentJob.company)) {
        safeCompany = currentJob.company;
      } else {
        safeCompany = '';
      }
      console.log('[prefill] Safe company resolved to:', safeCompany || '(empty)');
    }

    // Clean + normalize work history
    let cleanedHistory = [];
    if (Array.isArray(workHistory) && workHistory.length > 0) {
      cleanedHistory = workHistory.map(w => Object.assign({}, w, { company: cleanFirm(w.company) }));
      normalizeWorkHistory(cleanedHistory);
      const beforeDedup = cleanedHistory.length;
      const seen = new Set();
      cleanedHistory = cleanedHistory.filter(w => {
        const key = [(w.title || '').toLowerCase().trim(), (w.company || '').toLowerCase().trim(), (w.dates || '').toLowerCase().trim()].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (cleanedHistory.length < beforeDedup) {
        console.log(`[prefill] Deduped work history: ${beforeDedup} → ${cleanedHistory.length}`);
      }
    }

    // ── Match existing candidate ──
    let existingRow = null;
    let matchMethod = null;

    // 1. LinkedIn slug match
    const incomingSlug = extractLinkedInSlug(linkedinUrl);
    if (incomingSlug) {
      const { rows } = await pool.query(
        "SELECT * FROM candidates WHERE linkedin_url ILIKE $1 LIMIT 1",
        [`%/in/${incomingSlug}%`]
      );
      if (rows.length > 0) { existingRow = rows[0]; matchMethod = 'LinkedIn slug'; }
    }

    // 2. Name + firm match
    if (!existingRow && fullName && safeCompany) {
      const { rows } = await pool.query(
        "SELECT * FROM candidates WHERE LOWER(name) = $1 AND LOWER(current_firm) = $2 LIMIT 1",
        [normName(fullName), normFirm(safeCompany)]
      );
      if (rows.length > 0) { existingRow = rows[0]; matchMethod = 'name + firm'; }
    }

    // 3. Name-only single match
    if (!existingRow && fullName) {
      const { rows } = await pool.query(
        "SELECT * FROM candidates WHERE LOWER(name) = $1",
        [normName(fullName)]
      );
      if (rows.length === 1) { existingRow = rows[0]; matchMethod = 'name-only (unique)'; }
    }

    const today = new Date().toISOString().slice(0, 10);

    if (existingRow) {
      console.log(`[prefill] MATCHED existing candidate: ${existingRow.slug} (via ${matchMethod})`);
      // ── UPDATE existing ──
      const updates = [];
      const params = [];
      let idx = 1;

      if (linkedinUrl && !existingRow.linkedin_url) {
        updates.push(`linkedin_url = $${idx++}`);
        params.push(linkedinUrl);
        console.log('[prefill]   → set linkedin_url');
      }
      if (currentTitle) {
        updates.push(`current_title = $${idx++}`);
        params.push(currentTitle);
        console.log('[prefill]   → update current_title:', currentTitle);
      }
      if (safeCompany) {
        updates.push(`current_firm = $${idx++}`);
        params.push(cleanFirm(safeCompany));
        console.log('[prefill]   → update current_firm:', cleanFirm(safeCompany));
      }
      if (location) {
        updates.push(`home_location = $${idx++}`);
        params.push(location);
        console.log('[prefill]   → update home_location:', location);
      }
      if (photoUrl) {
        updates.push(`photo_url = $${idx++}`);
        params.push(photoUrl);
        console.log('[prefill]   → update photo_url');
      }
      updates.push(`last_scraped = $${idx++}`);
      params.push(today);

      if (updates.length > 0) {
        params.push(existingRow.id);
        await pool.query(`UPDATE candidates SET ${updates.join(',')} WHERE id = $${idx}`, params);
        console.log(`[prefill]   → ${updates.length} fields updated on candidate`);
      }

      // Replace work history
      if (cleanedHistory.length > 0) {
        console.log(`[prefill]   → syncing ${cleanedHistory.length} work history entries`);
        await autoCreateCompaniesFromWorkHistory(cleanedHistory);
        const companiesLinked = cleanedHistory.filter(w => w.company_id).length;
        console.log(`[prefill]   → ${companiesLinked}/${cleanedHistory.length} work entries linked to companies`);
        await syncWorkHistory(existingRow.id, cleanedHistory, null);
        await autoAddPEFirmsToPlaybooks(cleanedHistory);
      }

      console.log(`[prefill] RESULT: updated → ${existingRow.slug}`);
      console.log('═══════════════════════════════════════════════════════\n');
      return res.json({ action: 'updated', id: existingRow.slug });
    }

    // ── CREATE new ──
    if (!nameProvided) {
      console.log('[prefill] REJECTED: no valid name for new candidate');
      return res.status(400).json({ error: 'Cannot create new candidate without a name' });
    }
    console.log('[prefill] NO MATCH — creating new candidate');

    const candidateSlug = `cand-${slugifyShared(fullName || 'unknown')}-${Date.now()}`;
    console.log(`[prefill]   → slug: ${candidateSlug}`);
    console.log(`[prefill]   → name: ${fullName}, title: ${currentTitle}, firm: ${cleanFirm(safeCompany)}`);
    console.log(`[prefill]   → location: ${location}, linkedin: ${(linkedinUrl || '').slice(0, 60)}`);
    console.log(`[prefill]   → photo: ${photoUrl ? '✓' : '✗'}`);

    const { rows: newRows } = await pool.query(
      `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, photo_url,
         archetype, operator_background, availability, owned_pl, dq_reasons, notes, date_added, last_scraped)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [candidateSlug, fullName || '', currentTitle || '', cleanFirm(safeCompany) || '',
       location || null, linkedinUrl || '', photoUrl || null, '', '{}', 'Unknown', false, '{}', '', today, today]
    );

    const newCandidate = newRows[0];
    console.log(`[prefill]   → candidate row created (id: ${newCandidate.id})`);

    // Process work history
    if (cleanedHistory.length > 0) {
      console.log(`[prefill]   → syncing ${cleanedHistory.length} work history entries`);
      await autoCreateCompaniesFromWorkHistory(cleanedHistory);
      const companiesLinked = cleanedHistory.filter(w => w.company_id).length;
      console.log(`[prefill]   → ${companiesLinked}/${cleanedHistory.length} work entries linked to companies`);
      await syncWorkHistory(newCandidate.id, cleanedHistory, 0);
      await autoAddPEFirmsToPlaybooks(cleanedHistory);
    }

    console.log(`[prefill] RESULT: created → ${candidateSlug}`);
    console.log('═══════════════════════════════════════════════════════\n');
    res.status(201).json({ action: 'created', id: candidateSlug });
  } catch (err) {
    console.error('[prefill] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/candidates/:id — update candidate
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM candidates WHERE slug = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Candidate not found' });

    const body = req.body;
    const candidate = existing[0];

    const allowedFields = [
      'name', 'current_title', 'current_firm', 'home_location', 'linkedin_url',
      'archetype', 'firm_size_tier', 'company_revenue_tier',
      'quality_rating', 'rating_set_by', 'rating_date',
      'availability', 'availability_updated', 'last_contact_date',
      'notes', 'owned_pl', 'primary_experience_index', 'last_scraped',
      'added_from_search'
    ];

    const updates = [];
    const params = [];
    let idx = 1;

    for (const col of allowedFields) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[col]);
      }
    }
    if (body.operator_background !== undefined) {
      updates.push(`operator_background = $${idx++}`);
      params.push(body.operator_background);
    }
    if (body.dq_reasons !== undefined) {
      updates.push(`dq_reasons = $${idx++}`);
      params.push(body.dq_reasons);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await pool.query(`UPDATE candidates SET ${updates.join(',')} WHERE slug = $${idx}`, params);
    }

    if (body.sector_tags) await syncSectorTags(candidate.id, body.sector_tags);
    if (body.work_history) await syncWorkHistory(candidate.id, body.work_history, body.primary_experience_index);

    const { rows: refreshed } = await pool.query('SELECT * FROM candidates WHERE id = $1', [candidate.id]);
    res.json(await buildCandidateResponse(refreshed[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/merge — merge two candidates
router.post('/merge', async (req, res) => {
  try {
    const { keep_id, remove_id, merged_fields } = req.body;
    if (!keep_id || !remove_id) return res.status(400).json({ error: 'keep_id and remove_id required' });
    if (keep_id === remove_id) return res.status(400).json({ error: 'Cannot merge a candidate with itself' });

    const { rows: keepRows } = await pool.query('SELECT * FROM candidates WHERE slug = $1', [keep_id]);
    const { rows: removeRows } = await pool.query('SELECT * FROM candidates WHERE slug = $1', [remove_id]);
    if (keepRows.length === 0) return res.status(404).json({ error: 'Keep candidate not found' });
    if (removeRows.length === 0) return res.status(404).json({ error: 'Remove candidate not found' });

    const keepUuid = keepRows[0].id;
    const removeUuid = removeRows[0].id;

    // Apply merged fields to keep candidate
    if (merged_fields) {
      const allowed = ['name', 'current_title', 'current_firm', 'home_location', 'linkedin_url',
                       'archetype', 'firm_size_tier', 'company_revenue_tier', 'quality_rating',
                       'availability', 'notes', 'owned_pl'];
      const updates = [];
      const params = [];
      let idx = 1;
      for (const col of allowed) {
        if (merged_fields[col] !== undefined) {
          updates.push(`${col} = $${idx++}`);
          params.push(merged_fields[col]);
        }
      }
      if (updates.length > 0) {
        params.push(keepUuid);
        await pool.query(`UPDATE candidates SET ${updates.join(',')} WHERE id = $${idx}`, params);
      }
    }

    // Merge work histories: copy remove's entries that don't exist on keep (dedupe by company+title)
    const { rows: keepWH } = await pool.query(
      'SELECT title, company_name FROM candidate_work_history WHERE candidate_id = $1', [keepUuid]);
    const { rows: removeWH } = await pool.query(
      'SELECT * FROM candidate_work_history WHERE candidate_id = $1 ORDER BY sort_order', [removeUuid]);
    const maxSort = await pool.query(
      'SELECT COALESCE(MAX(sort_order), -1)::int AS m FROM candidate_work_history WHERE candidate_id = $1', [keepUuid]);
    let nextSort = maxSort.rows[0].m + 1;
    for (const w of removeWH) {
      const exists = keepWH.some(k =>
        (k.title || '').toLowerCase() === (w.title || '').toLowerCase() &&
        (k.company_name || '').toLowerCase() === (w.company_name || '').toLowerCase()
      );
      if (!exists) {
        await pool.query(
          `INSERT INTO candidate_work_history (candidate_id, company_id, title, company_name, dates, date_range, duration, description, sort_order, is_primary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)`,
          [keepUuid, w.company_id, w.title, w.company_name, w.dates, w.date_range, w.duration, w.description, nextSort++]
        );
      }
    }

    // Merge sector tags
    await pool.query(
      `INSERT INTO candidate_sector_tags (candidate_id, sector_id, sector_slug)
       SELECT $1, sector_id, sector_slug FROM candidate_sector_tags WHERE candidate_id = $2
       ON CONFLICT DO NOTHING`,
      [keepUuid, removeUuid]
    );

    // Merge search history
    await pool.query(
      `INSERT INTO candidate_search_history (candidate_id, search_id)
       SELECT $1, search_id FROM candidate_search_history WHERE candidate_id = $2
       ON CONFLICT DO NOTHING`,
      [keepUuid, removeUuid]
    );

    // Combine dq_reasons
    const { rows: keepData } = await pool.query('SELECT dq_reasons FROM candidates WHERE id = $1', [keepUuid]);
    const { rows: removeData } = await pool.query('SELECT dq_reasons FROM candidates WHERE id = $1', [removeUuid]);
    const combinedDQ = [...new Set([...(keepData[0].dq_reasons || []), ...(removeData[0].dq_reasons || [])])];
    await pool.query('UPDATE candidates SET dq_reasons = $1 WHERE id = $2', [combinedDQ, keepUuid]);

    // Cascade: re-point all references from remove → keep
    let updated = 0;
    // Pipeline
    const { rowCount: pipelineCount } = await pool.query(
      'UPDATE search_pipeline SET candidate_id = $1 WHERE candidate_id = $2',
      [keepUuid, removeUuid]
    );
    updated += pipelineCount;

    // Coverage rosters
    await pool.query('UPDATE coverage_firm_roster SET candidate_id = $1 WHERE candidate_id = $2', [keepUuid, removeUuid]);
    await pool.query('UPDATE coverage_company_roster SET candidate_id = $1 WHERE candidate_id = $2', [keepUuid, removeUuid]);

    // Playbook rosters
    await pool.query('UPDATE playbook_firm_roster SET candidate_id = $1 WHERE candidate_id = $2', [keepUuid, removeUuid]);
    await pool.query('UPDATE playbook_company_roster SET candidate_id = $1 WHERE candidate_id = $2', [keepUuid, removeUuid]);

    // Delete the removed candidate (cascades handle remaining child records)
    await pool.query('DELETE FROM candidates WHERE id = $1', [removeUuid]);

    const { rows: merged } = await pool.query('SELECT * FROM candidates WHERE id = $1', [keepUuid]);
    const result = await buildCandidateResponse(merged[0]);
    res.json({ merged: result, searches_updated: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
