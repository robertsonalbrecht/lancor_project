'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const router = express.Router();
const { slugify } = require('../utils/shared');

// Resolve null candidate_id on roster entries by matching LinkedIn URL or name
async function resolveUnlinkedRosterEntries() {
  // Firm rosters (global firm_roster table)
  const { rows: firmUnlinked } = await pool.query(
    'SELECT id, name, linkedin_url FROM firm_roster WHERE candidate_id IS NULL'
  );
  for (const r of firmUnlinked) {
    let candId = null, candSlug = null;
    if (r.linkedin_url) {
      const liSlug = (r.linkedin_url.match(/\/in\/([a-zA-Z0-9_-]+)/i) || [])[1];
      if (liSlug) {
        const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE linkedin_url ILIKE $1 LIMIT 1', [`%/in/${liSlug}%`]);
        if (rows.length > 0) { candId = rows[0].id; candSlug = rows[0].slug; }
      }
    }
    if (!candId && r.name) {
      const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE LOWER(name) = $1', [r.name.toLowerCase().trim()]);
      if (rows.length === 1) { candId = rows[0].id; candSlug = rows[0].slug; }
    }
    if (candId) {
      await pool.query('UPDATE firm_roster SET candidate_id = $1 WHERE id = $2', [candId, r.id]);
    }
  }
  // Company rosters (unchanged — still uses coverage_company_roster)
  const { rows: coUnlinked } = await pool.query(
    'SELECT id, name, linkedin_url FROM coverage_company_roster WHERE candidate_id IS NULL'
  );
  for (const r of coUnlinked) {
    let candId = null, candSlug = null;
    if (r.linkedin_url) {
      const liSlug = (r.linkedin_url.match(/\/in\/([a-zA-Z0-9_-]+)/i) || [])[1];
      if (liSlug) {
        const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE linkedin_url ILIKE $1 LIMIT 1', [`%/in/${liSlug}%`]);
        if (rows.length > 0) { candId = rows[0].id; candSlug = rows[0].slug; }
      }
    }
    if (!candId && r.name) {
      const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE LOWER(name) = $1', [r.name.toLowerCase().trim()]);
      if (rows.length === 1) { candId = rows[0].id; candSlug = rows[0].slug; }
    }
    if (candId) {
      await pool.query('UPDATE coverage_company_roster SET candidate_id = $1, candidate_slug = $2 WHERE id = $3', [candId, candSlug, r.id]);
    }
  }
}

// Lazy-init Anthropic client (server starts fine without API key)
let _anthropic = null;
function getAnthropicClient() {
  if (!_anthropic && process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

const DEFAULT_PIPELINE_STAGES = [
  { name: 'Pursuing',      color_bg: '#eeeeee', color_text: '#616161' },
  { name: 'Outreach Sent', color_bg: '#f3e5f5', color_text: '#7b1fa2' },
  { name: 'Scheduling',    color_bg: '#fff3e0', color_text: '#e65100' },
  { name: 'Interviewing',  color_bg: '#e3f2fd', color_text: '#1565c0' },
  { name: 'Qualifying',    color_bg: '#e8f5e9', color_text: '#2e7d32' },
  { name: 'Hold',          color_bg: '#efebe9', color_text: '#4e342e' },
  { name: 'DQ',            color_bg: '#ffebee', color_text: '#c62828' },
  { name: 'NI',            color_bg: '#fffde7', color_text: '#f57f17' }
];

const EMPTY_SEARCH_KIT = {
  boolean_strings: [],
  outreach_messages: [],
  ideal_candidate_profiles: [],
  screen_question_guides: [],
  pitchbook_params: []
};

function generateAbbreviation(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function toISO(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return val;
}

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchSearchBySlug(slug) {
  const { rows } = await pool.query('SELECT * FROM searches WHERE slug = $1', [slug]);
  if (rows.length === 0) return null;
  return rows[0];
}

async function buildSearchResponse(dbRow) {
  const searchUuid = dbRow.id;
  const searchSlug = dbRow.slug;

  // Sectors
  const { rows: sectorRows } = await pool.query(
    `SELECT s.slug FROM search_sectors ss JOIN sectors s ON s.id = ss.sector_id WHERE ss.search_id = $1 ORDER BY ss.created_at`,
    [searchUuid]
  );

  // Client contacts
  const { rows: contactRows } = await pool.query(
    'SELECT name, abbreviation, display_in_matrix FROM search_client_contacts WHERE search_id = $1 ORDER BY sort_order',
    [searchUuid]
  );
  contactRows.forEach(c => { if (!c.abbreviation) c.abbreviation = generateAbbreviation(c.name); });

  // Lancor team
  const { rows: teamRows } = await pool.query(
    'SELECT initials, full_name, role FROM search_lancor_team WHERE search_id = $1 ORDER BY sort_order',
    [searchUuid]
  );

  // Pipeline
  const pipeline = await fetchPipeline(searchUuid);

  // Sourcing coverage (read-only for Part A)
  const sourcingCoverage = await fetchSourcingCoverage(searchUuid);

  // Search kit — per-search templates
  const { rows: templateRows } = await pool.query(
    'SELECT slug, template_type, name, content FROM search_templates WHERE search_id = $1 ORDER BY created_at',
    [searchUuid]
  );
  const searchKit = {
    boolean_strings: [],
    outreach_messages: [],
    ideal_candidate_profiles: [],
    screen_question_guides: [],
    pitchbook_params: []
  };
  for (const t of templateRows) {
    let parsed;
    try { parsed = JSON.parse(t.content); } catch { parsed = { content: t.content }; }
    const item = typeof parsed === 'object' && parsed !== null ? parsed : { content: parsed };
    if (!item.id) item.id = t.slug;
    if (!item.name) item.name = t.name;
    const typeMap = {
      boolean_string: 'boolean_strings',
      pitchbook_param: 'pitchbook_params',
      ideal_candidate_profile: 'ideal_candidate_profiles',
      screen_question_guide: 'screen_question_guides'
    };
    const bucket = typeMap[t.template_type];
    if (bucket && searchKit[bucket]) searchKit[bucket].push(item);
  }

  return {
    search_id: searchSlug,
    client_name: dbRow.client_name,
    role_title: dbRow.role_title,
    sectors: sectorRows.map(r => r.slug),
    date_opened: toISO(dbRow.date_opened),
    date_closed: toISO(dbRow.date_closed),
    status: dbRow.status,
    lead_recruiter: dbRow.lead_recruiter,
    ideal_candidate_profile: dbRow.ideal_candidate_profile || '',
    archetypes_requested: dbRow.archetypes_requested || [],
    client_contacts: contactRows,
    lancor_team: teamRows,
    pipeline,
    pipeline_stages: dbRow.pipeline_stages || JSON.parse(JSON.stringify(DEFAULT_PIPELINE_STAGES)),
    sourcing_coverage: sourcingCoverage,
    search_kit: searchKit
  };
}

async function fetchPipeline(searchUuid) {
  const { rows: pipelineRows } = await pool.query(
    `SELECT sp.*, c.slug AS candidate_slug
     FROM search_pipeline sp
     JOIN candidates c ON c.id = sp.candidate_id
     WHERE sp.search_id = $1 ORDER BY sp.date_added`,
    [searchUuid]
  );

  if (pipelineRows.length === 0) return [];

  const pipelineIds = pipelineRows.map(r => r.id);
  const { rows: meetingRows } = await pool.query(
    'SELECT * FROM pipeline_client_meetings WHERE pipeline_entry_id = ANY($1) ORDER BY sort_order',
    [pipelineIds]
  );

  const meetingMap = {};
  for (const m of meetingRows) {
    if (!meetingMap[m.pipeline_entry_id]) meetingMap[m.pipeline_entry_id] = [];
    meetingMap[m.pipeline_entry_id].push({
      contact_name: m.contact_name,
      status: m.status,
      date: toISO(m.meeting_date)
    });
  }

  return pipelineRows.map(p => ({
    candidate_id: p.candidate_slug,
    name: p.name,
    current_title: p.current_title,
    current_firm: p.current_firm,
    location: p.location,
    linkedin_url: p.linkedin_url,
    archetype: p.archetype,
    source: p.source,
    stage: p.stage,
    lancor_screener: p.lancor_screener || '',
    screen_date: toISO(p.screen_date),
    lancor_assessment: p.lancor_assessment || '',
    resume_attached: p.resume_attached || false,
    client_meetings: meetingMap[p.id] || [],
    client_feedback: p.client_feedback || '',
    next_step: p.next_step || '',
    next_step_owner: p.next_step_owner || '',
    next_step_date: toISO(p.next_step_date),
    dq_reason: p.dq_reason || '',
    last_touchpoint: toISO(p.last_touchpoint),
    notes: p.notes || '',
    date_added: toISO(p.date_added)
  }));
}

async function fetchSourcingCoverage(searchUuid) {
  // PE firms — now reads verification from companies table
  const { rows: firmRows } = await pool.query(
    `SELECT scf.*, co.slug AS firm_slug, co.website_url AS website_url,
            co.roster_last_verified, co.roster_verified_by
     FROM search_coverage_firms scf
     JOIN companies co ON co.id = scf.company_id
     WHERE scf.search_id = $1 ORDER BY scf.name`,
    [searchUuid]
  );

  // Firm roster — read from global firm_roster + per-search search_firm_review
  const companyIds = firmRows.map(f => f.company_id);
  let firmRosterRows = [];
  if (companyIds.length > 0) {
    const result = await pool.query(
      `SELECT fr.*,
              c.slug AS candidate_slug,
              c.home_location AS candidate_location,
              c.last_scraped AS candidate_last_scraped,
              sfr.review_status,
              sfr.reviewed_at
       FROM firm_roster fr
       LEFT JOIN candidates c ON c.id = fr.candidate_id
       LEFT JOIN search_firm_review sfr ON sfr.firm_roster_id = fr.id AND sfr.search_id = $1
       WHERE fr.company_id = ANY($2)
       ORDER BY fr.name`,
      [searchUuid, companyIds]
    );
    firmRosterRows = result.rows;

    // DEBUG: log Arsenal Capital roster count
    const arsenalFirm = firmRows.find(f => /arsenal/i.test(f.name));
    if (arsenalFirm) {
      const arsenalRoster = firmRosterRows.filter(r => r.company_id === arsenalFirm.company_id);
      const withReview = arsenalRoster.filter(r => r.review_status != null);
      console.log(`[DEBUG] Arsenal Capital — firm_roster rows: ${arsenalRoster.length}, with review_status: ${withReview.length}, search: ${searchUuid}`);
      arsenalRoster.forEach(r => console.log(`  ${r.name} | review_status=${r.review_status} | candidate_slug=${r.candidate_slug}`));
    }
  }
  const firmRosterMap = {};
  for (const r of firmRosterRows) {
    if (!firmRosterMap[r.company_id]) firmRosterMap[r.company_id] = [];
    firmRosterMap[r.company_id].push({
      candidate_id: r.candidate_slug || null,
      name: r.name,
      title: r.title,
      linkedin_url: r.linkedin_url,
      location: r.location || r.candidate_location || null,
      last_scraped: toISO(r.candidate_last_scraped),
      roster_status: r.roster_status,
      source: r.source,
      reviewed: r.review_status != null,
      reviewed_date: toISO(r.reviewed_at),
      review_status: r.review_status
    });
  }

  // Companies
  const { rows: coRows } = await pool.query(
    `SELECT scc.*, co.slug AS company_slug, co.website_url AS website_url
     FROM search_coverage_companies scc
     JOIN companies co ON co.id = scc.company_id
     WHERE scc.search_id = $1 ORDER BY scc.name`,
    [searchUuid]
  );

  // Fetch aliases for all coverage companies (firms + target companies)
  const allCompanyIds = [...firmRows.map(f => f.company_id), ...coRows.map(c => c.company_id)];
  const aliasMap = {};
  if (allCompanyIds.length > 0) {
    const { rows: aliasRows } = await pool.query(
      'SELECT company_id, alias FROM company_aliases WHERE company_id = ANY($1)', [allCompanyIds]);
    for (const a of aliasRows) {
      if (!aliasMap[a.company_id]) aliasMap[a.company_id] = [];
      aliasMap[a.company_id].push(a.alias);
    }
  }

  // DEBUG: log Arsenal verification for Patient Square
  const _arsenalDebug = firmRows.find(f => /arsenal/i.test(f.name));
  if (_arsenalDebug) {
    console.log(`[DEBUG] Arsenal firm object build — roster_last_verified=${_arsenalDebug.roster_last_verified}, scf.last_verified=${_arsenalDebug.last_verified}, roster_verified_by=${_arsenalDebug.roster_verified_by}, search=${searchUuid}`);
  }

  const pe_firms = firmRows.map(f => ({
    firm_id: f.firm_slug,
    name: f.name,
    hq: f.hq,
    size_tier: f.size_tier,
    strategy: f.strategy,
    sector_focus: f.sector_focus,
    website_url: f.website_url || null,
    aliases: aliasMap[f.company_id] || [],
    why_target: f.why_target || '',
    manual_complete: f.manual_complete,
    manual_complete_note: f.manual_complete_note || '',
    last_verified: toISO(f.roster_last_verified),
    verified_by: f.roster_verified_by,
    archived_complete: f.archived_complete,
    roster: firmRosterMap[f.company_id] || []
  }));

  const coIds = coRows.map(c => c.id);
  let coRosterRows = [];
  if (coIds.length > 0) {
    const result = await pool.query(
      `SELECT ccr.*, c.home_location AS candidate_location, c.last_scraped AS candidate_last_scraped
       FROM coverage_company_roster ccr
       LEFT JOIN candidates c ON c.id = ccr.candidate_id
       WHERE ccr.coverage_company_id = ANY($1) ORDER BY ccr.name`,
      [coIds]
    );
    coRosterRows = result.rows;
  }
  const coRosterMap = {};
  for (const r of coRosterRows) {
    if (!coRosterMap[r.coverage_company_id]) coRosterMap[r.coverage_company_id] = [];
    coRosterMap[r.coverage_company_id].push({
      candidate_id: r.candidate_slug,
      name: r.name,
      title: r.title,
      linkedin_url: r.linkedin_url,
      location: r.location || r.candidate_location || null,
      last_scraped: toISO(r.candidate_last_scraped),
      roster_status: r.roster_status,
      source: r.source,
      reviewed: r.reviewed,
      reviewed_date: toISO(r.reviewed_date),
      review_status: r.review_status
    });
  }

  const companies = coRows.map(c => ({
    company_id: c.company_slug,
    name: c.name,
    hq: c.hq,
    revenue_tier: c.revenue_tier,
    ownership_type: c.ownership_type,
    website_url: c.website_url || null,
    aliases: aliasMap[c.company_id] || [],
    why_target: c.why_target || '',
    manual_complete: c.manual_complete,
    manual_complete_note: c.manual_complete_note || '',
    last_verified: toISO(c.last_verified),
    verified_by: c.verified_by,
    archived_complete: c.archived_complete,
    roster: coRosterMap[c.id] || []
  }));

  return { pe_firms, companies };
}

// ── Sync helpers for child tables ────────────────────────────────────────────

async function syncSectors(searchUuid, sectorSlugs) {
  await pool.query('DELETE FROM search_sectors WHERE search_id = $1', [searchUuid]);
  for (const slug of (sectorSlugs || [])) {
    const { rows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [slug]);
    if (rows.length > 0) {
      await pool.query(
        'INSERT INTO search_sectors (search_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [searchUuid, rows[0].id]
      );
    }
  }
}

async function syncClientContacts(searchUuid, contacts) {
  await pool.query('DELETE FROM search_client_contacts WHERE search_id = $1', [searchUuid]);
  for (let i = 0; i < (contacts || []).length; i++) {
    const c = contacts[i];
    await pool.query(
      'INSERT INTO search_client_contacts (search_id, name, abbreviation, display_in_matrix, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [searchUuid, c.name, c.abbreviation || generateAbbreviation(c.name), c.display_in_matrix !== false, i]
    );
  }
}

async function syncLancorTeam(searchUuid, team) {
  await pool.query('DELETE FROM search_lancor_team WHERE search_id = $1', [searchUuid]);
  for (let i = 0; i < (team || []).length; i++) {
    const t = team[i];
    await pool.query(
      'INSERT INTO search_lancor_team (search_id, initials, full_name, role, sort_order) VALUES ($1,$2,$3,$4,$5)',
      [searchUuid, t.initials, t.full_name, t.role || null, i]
    );
  }
}

/** Copy playbook firms/companies into coverage tables for a new search */
async function seedCoverageFromPlaybook(searchUuid, sectorSlugs) {
  for (const sectorSlug of (sectorSlugs || [])) {
    const { rows: sectorRows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sectorSlug]);
    if (sectorRows.length === 0) continue;
    const sectorUuid = sectorRows[0].id;

    // Bulk insert PE firms from playbook → coverage (one query)
    await pool.query(
      `INSERT INTO search_coverage_firms (search_id, company_id, name, hq, size_tier, strategy, sector_focus, why_target)
       SELECT $1, spf.company_id, spf.name, spf.hq, spf.size_tier, spf.strategy, spf.sector_focus, COALESCE(spf.why_target, '')
       FROM sector_pe_firms spf
       WHERE spf.sector_id = $2
       ON CONFLICT (search_id, company_id) DO NOTHING`,
      [searchUuid, sectorUuid]
    );

    // Bulk insert firm rosters into global firm_roster
    await pool.query(
      `INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, source)
       SELECT spf.company_id, pfr.candidate_id, pfr.name, pfr.title, pfr.linkedin_url, 'playbook-import'
       FROM playbook_firm_roster pfr
       JOIN sector_pe_firms spf ON spf.id = pfr.sector_pe_firm_id
       WHERE spf.sector_id = $1 AND pfr.candidate_id IS NOT NULL
       ON CONFLICT (company_id, candidate_id) WHERE candidate_id IS NOT NULL DO NOTHING`,
      [sectorUuid]
    );

    // Create search_firm_review entries for this search for each firm_roster row at these firms
    await pool.query(
      `INSERT INTO search_firm_review (search_id, firm_roster_id)
       SELECT $1, fr.id
       FROM firm_roster fr
       JOIN search_coverage_firms scf ON scf.company_id = fr.company_id AND scf.search_id = $1
       JOIN sector_pe_firms spf ON spf.company_id = fr.company_id AND spf.sector_id = $2
       ON CONFLICT (search_id, firm_roster_id) DO NOTHING`,
      [searchUuid, sectorUuid]
    );

    // Bulk insert target companies from playbook → coverage
    await pool.query(
      `INSERT INTO search_coverage_companies (search_id, company_id, name, hq, revenue_tier, ownership_type, why_target)
       SELECT $1, stc.company_id, stc.name, stc.hq, stc.revenue_tier, stc.ownership_type, COALESCE(stc.why_target, '')
       FROM sector_target_companies stc
       WHERE stc.sector_id = $2
       ON CONFLICT (search_id, company_id) DO NOTHING`,
      [searchUuid, sectorUuid]
    );

    // Bulk insert company rosters
    await pool.query(
      `INSERT INTO coverage_company_roster (coverage_company_id, candidate_id, candidate_slug, name, title, linkedin_url, roster_status)
       SELECT scc.id, pcr.candidate_id, pcr.candidate_slug, pcr.name, pcr.title, pcr.linkedin_url, pcr.roster_status
       FROM playbook_company_roster pcr
       JOIN sector_target_companies stc ON stc.id = pcr.sector_target_company_id
       JOIN search_coverage_companies scc ON scc.company_id = stc.company_id AND scc.search_id = $1
       WHERE stc.sector_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM coverage_company_roster ccr
           WHERE ccr.coverage_company_id = scc.id AND ccr.candidate_slug = pcr.candidate_slug
         )`,
      [searchUuid, sectorUuid]
    );
  }

  // Resolve any roster entries that have null candidate_id by matching to existing candidates
  await resolveUnlinkedRosterEntries();
}

// ── ROUTES: Core CRUD ────────────────────────────────────────────────────────

// GET /api/searches — return all searches
router.get('/', async (req, res) => {
  try {
    const includeClosed = req.query.include === 'closed';
    const whereClause = includeClosed ? '' : "WHERE status != 'closed'";
    const { rows } = await pool.query(`SELECT * FROM searches ${whereClause} ORDER BY date_opened DESC`);
    const searches = await Promise.all(rows.map(r => buildSearchResponse(r)));
    res.json({ searches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/searches/active — return active searches as [{id, name}]
router.get('/active', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT slug, client_name, role_title FROM searches WHERE status IN ('active', 'open') ORDER BY client_name"
    );
    res.json(rows.map(r => ({ id: r.slug, name: `${r.client_name} \u2014 ${r.role_title}` })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/searches/:id — return single search
router.get('/:id', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    res.json(await buildSearchResponse(dbRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches — create new search
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    let searchSlug = body.search_id || `search-${Date.now()}`;
    // If slug already exists, append a short suffix to make it unique
    const { rows: existingSlug } = await pool.query('SELECT id FROM searches WHERE slug = $1', [searchSlug]);
    if (existingSlug.length > 0) {
      searchSlug = searchSlug + '-' + Date.now().toString(36).slice(-4);
    }
    const today = new Date().toISOString();

    const { rows } = await pool.query(
      `INSERT INTO searches (slug, client_name, role_title, status, lead_recruiter,
         ideal_candidate_profile, archetypes_requested, date_opened, pipeline_stages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [searchSlug, body.client_name, body.role_title || null, 'active',
       body.lead_recruiter || null, body.ideal_candidate_profile || '',
       body.archetypes_requested || '{}', body.date_opened || today,
       JSON.stringify(body.pipeline_stages || DEFAULT_PIPELINE_STAGES)]
    );
    const dbRow = rows[0];

    await syncSectors(dbRow.id, body.sectors);
    await syncClientContacts(dbRow.id, body.client_contacts);
    await syncLancorTeam(dbRow.id, body.lancor_team);

    // Coverage starts empty — user loads from playbook manually via "Load from Playbook" button

    res.status(201).json(await buildSearchResponse(dbRow));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/searches/:id — update search
router.put('/:id', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });

    const body = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    const fieldMap = {
      client_name: 'client_name', role_title: 'role_title', status: 'status',
      lead_recruiter: 'lead_recruiter', ideal_candidate_profile: 'ideal_candidate_profile',
      date_opened: 'date_opened', date_closed: 'date_closed'
    };
    for (const [jsonKey, col] of Object.entries(fieldMap)) {
      if (body[jsonKey] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[jsonKey]);
      }
    }
    if (body.archetypes_requested !== undefined) {
      updates.push(`archetypes_requested = $${idx++}`);
      params.push(body.archetypes_requested);
    }
    if (body.pipeline_stages !== undefined) {
      updates.push(`pipeline_stages = $${idx++}`);
      params.push(JSON.stringify(body.pipeline_stages));
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await pool.query(`UPDATE searches SET ${updates.join(',')} WHERE slug = $${idx}`, params);
    }

    // Sync child tables if provided
    if (body.sectors) await syncSectors(dbRow.id, body.sectors);
    if (body.client_contacts) await syncClientContacts(dbRow.id, body.client_contacts);
    if (body.lancor_team) await syncLancorTeam(dbRow.id, body.lancor_team);

    // Sync search kit templates if provided
    if (body.search_kit) {
      const typeMap = {
        boolean_strings: 'boolean_string',
        pitchbook_params: 'pitchbook_param',
        ideal_candidate_profiles: 'ideal_candidate_profile',
        screen_question_guides: 'screen_question_guide'
      };
      // Delete existing per-search templates and re-insert
      await pool.query('DELETE FROM search_templates WHERE search_id = $1', [dbRow.id]);
      for (const [jsonKey, templateType] of Object.entries(typeMap)) {
        const items = body.search_kit[jsonKey] || [];
        for (const item of items) {
          const content = JSON.stringify(item);
          if (!content || content === '{}') continue;
          const name = item.name || item.id || `${templateType}-${Date.now()}`;
          const itemSlug = slugify(name) || `${templateType}-${Date.now()}`;
          await pool.query(
            `INSERT INTO search_templates (template_type, slug, name, content, search_id)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (slug) DO UPDATE SET content = EXCLUDED.content, name = EXCLUDED.name`,
            [templateType, itemSlug, name, content, dbRow.id]
          );
        }
      }
    }

    // Refresh
    const updated = await fetchSearchBySlug(req.params.id);
    res.json(await buildSearchResponse(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/searches/:id/close — close a search
router.put('/:id/close', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "UPDATE searches SET status = 'closed', date_closed = NOW() WHERE slug = $1 RETURNING *",
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Search not found' });
    res.json(await buildSearchResponse(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id — delete search (cascades handle children)
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM searches WHERE slug = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Search not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTES: Pipeline ─────────────────────────────────────────────────────────

// GET /api/searches/:id/pipeline
router.get('/:id/pipeline', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    res.json(await fetchPipeline(dbRow.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/pipeline — add candidate to pipeline
router.post('/:id/pipeline', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });

    const body = req.body;
    const candidateSlug = body.candidate_id || slugify(body.name || 'candidate') + '-' + Date.now();

    // Ensure candidate exists
    let { rows: candRows } = await pool.query('SELECT id FROM candidates WHERE slug = $1', [candidateSlug]);
    if (candRows.length === 0) {
      const result = await pool.query(
        `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, archetype, date_added)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
         ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [candidateSlug, body.name, body.current_title || null, body.current_firm || null,
         body.location || null, body.linkedin_url || null, body.archetype || null]
      );
      if (result.rows.length > 0) {
        candRows = result.rows;
      } else {
        candRows = (await pool.query('SELECT id FROM candidates WHERE slug = $1', [candidateSlug])).rows;
      }
    }
    const candidateUuid = candRows[0].id;

    const { rows: pipeRows } = await pool.query(
      `INSERT INTO search_pipeline (
        search_id, candidate_id, name, current_title, current_firm, location,
        linkedin_url, archetype, source, stage, lancor_screener, lancor_assessment,
        resume_attached, client_feedback, next_step, next_step_owner, dq_reason, notes, date_added
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
      ON CONFLICT (search_id, candidate_id) DO NOTHING
      RETURNING id`,
      [
        dbRow.id, candidateUuid, body.name, body.current_title || null, body.current_firm || null,
        body.location || null, body.linkedin_url || null, body.archetype || null,
        body.source || null, body.stage || 'Pursuing', body.lancor_screener || '',
        body.lancor_assessment || '', body.resume_attached || false,
        body.client_feedback || '', body.next_step || '', body.next_step_owner || '',
        body.dq_reason || '', body.notes || ''
      ]
    );

    if (pipeRows.length > 0) {
      // Create client meeting placeholders
      const { rows: contacts } = await pool.query(
        'SELECT name FROM search_client_contacts WHERE search_id = $1 ORDER BY sort_order',
        [dbRow.id]
      );
      for (let i = 0; i < contacts.length; i++) {
        await pool.query(
          'INSERT INTO pipeline_client_meetings (pipeline_entry_id, contact_name, status, sort_order) VALUES ($1,$2,$3,$4)',
          [pipeRows[0].id, contacts[i].name, '—', i]
        );
      }
    }

    const pipeline = await fetchPipeline(dbRow.id);
    const entry = pipeline.find(p => p.candidate_id === candidateSlug);
    res.status(201).json(entry || pipeline[pipeline.length - 1]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/searches/:id/pipeline/:candidateId — update pipeline entry
router.put('/:id/pipeline/:candidateId', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });

    // Find pipeline entry by candidate slug
    const { rows: candRows } = await pool.query('SELECT id FROM candidates WHERE slug = $1', [req.params.candidateId]);
    if (candRows.length === 0) return res.status(404).json({ error: 'Candidate not found' });

    const { rows: pipeRows } = await pool.query(
      'SELECT id FROM search_pipeline WHERE search_id = $1 AND candidate_id = $2',
      [dbRow.id, candRows[0].id]
    );
    if (pipeRows.length === 0) return res.status(404).json({ error: 'Pipeline entry not found' });

    const pipeUuid = pipeRows[0].id;
    const body = req.body;

    const pipeFields = {
      name: 'name', current_title: 'current_title', current_firm: 'current_firm',
      location: 'location', linkedin_url: 'linkedin_url', archetype: 'archetype',
      source: 'source', stage: 'stage', lancor_screener: 'lancor_screener',
      screen_date: 'screen_date', lancor_assessment: 'lancor_assessment',
      resume_attached: 'resume_attached', client_feedback: 'client_feedback',
      next_step: 'next_step', next_step_owner: 'next_step_owner',
      next_step_date: 'next_step_date', dq_reason: 'dq_reason',
      last_touchpoint: 'last_touchpoint', notes: 'notes'
    };

    const updates = [];
    const params = [];
    let idx = 1;
    for (const [jsonKey, col] of Object.entries(pipeFields)) {
      if (body[jsonKey] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[jsonKey]);
      }
    }

    if (updates.length > 0) {
      params.push(pipeUuid);
      await pool.query(`UPDATE search_pipeline SET ${updates.join(',')} WHERE id = $${idx}`, params);
    }

    // Sync client meetings if provided
    if (body.client_meetings) {
      await pool.query('DELETE FROM pipeline_client_meetings WHERE pipeline_entry_id = $1', [pipeUuid]);
      for (let i = 0; i < body.client_meetings.length; i++) {
        const m = body.client_meetings[i];
        await pool.query(
          'INSERT INTO pipeline_client_meetings (pipeline_entry_id, contact_name, status, meeting_date, sort_order) VALUES ($1,$2,$3,$4,$5)',
          [pipeUuid, m.contact_name, m.status || '—', m.date || null, i]
        );
      }
    }

    const pipeline = await fetchPipeline(dbRow.id);
    const entry = pipeline.find(p => p.candidate_id === req.params.candidateId);
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id/pipeline/:candidateId — remove from pipeline
router.delete('/:id/pipeline/:candidateId', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });

    const { rows: candRows } = await pool.query('SELECT id FROM candidates WHERE slug = $1', [req.params.candidateId]);
    if (candRows.length === 0) return res.status(404).json({ error: 'Candidate not found' });

    const { rows } = await pool.query(
      'DELETE FROM search_pipeline WHERE search_id = $1 AND candidate_id = $2 RETURNING id',
      [dbRow.id, candRows[0].id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Pipeline entry not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTES: Sourcing Coverage (Part B — writes) ─────────────────────────────

// Helper: resolve search UUID + company UUID from slugs
async function resolveCoverageIds(searchSlug, companySlug) {
  const search = await fetchSearchBySlug(searchSlug);
  if (!search) return { error: 'Search not found' };
  const { rows: coRows } = await pool.query('SELECT id FROM companies WHERE slug = $1', [companySlug]);
  if (coRows.length === 0) return { error: 'Company not found' };
  return { searchUuid: search.id, companyUuid: coRows[0].id };
}

// POST /api/searches/:id/coverage/seed — bulk load top firms & companies from a sector
router.post('/:id/coverage/seed', async (req, res) => {
  try {
    const search = await fetchSearchBySlug(req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    const { sector_id: sectorSlug, top_only } = req.body;
    if (!sectorSlug) return res.status(400).json({ error: 'sector_id required' });

    const { rows: sectorRows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sectorSlug]);
    if (sectorRows.length === 0) return res.status(404).json({ error: 'Sector not found' });
    const sectorUuid = sectorRows[0].id;

    if (top_only) {
      // Only insert firms/companies that are in the top lists
      await pool.query(
        `INSERT INTO search_coverage_firms (search_id, company_id, name, hq, size_tier, strategy, sector_focus, why_target)
         SELECT $1, spf.company_id, spf.name, spf.hq, spf.size_tier, spf.strategy, spf.sector_focus, COALESCE(spf.why_target, '')
         FROM sector_pe_firms spf
         JOIN sector_top_pe_firms stpf ON stpf.company_id = spf.company_id AND stpf.sector_id = spf.sector_id
         WHERE spf.sector_id = $2
         ON CONFLICT (search_id, company_id) DO NOTHING`,
        [search.id, sectorUuid]
      );

      await pool.query(
        `INSERT INTO search_coverage_companies (search_id, company_id, name, hq, revenue_tier, ownership_type, why_target)
         SELECT $1, stc.company_id, stc.name, stc.hq, stc.revenue_tier, stc.ownership_type, COALESCE(stc.why_target, '')
         FROM sector_target_companies stc
         JOIN sector_top_companies stop ON stop.company_id = stc.company_id AND stop.sector_id = stc.sector_id
         WHERE stc.sector_id = $2
         ON CONFLICT (search_id, company_id) DO NOTHING`,
        [search.id, sectorUuid]
      );
    } else {
      // Insert all firms/companies from the sector
      await pool.query(
        `INSERT INTO search_coverage_firms (search_id, company_id, name, hq, size_tier, strategy, sector_focus, why_target)
         SELECT $1, spf.company_id, spf.name, spf.hq, spf.size_tier, spf.strategy, spf.sector_focus, COALESCE(spf.why_target, '')
         FROM sector_pe_firms spf WHERE spf.sector_id = $2
         ON CONFLICT (search_id, company_id) DO NOTHING`,
        [search.id, sectorUuid]
      );

      await pool.query(
        `INSERT INTO search_coverage_companies (search_id, company_id, name, hq, revenue_tier, ownership_type, why_target)
         SELECT $1, stc.company_id, stc.name, stc.hq, stc.revenue_tier, stc.ownership_type, COALESCE(stc.why_target, '')
         FROM sector_target_companies stc WHERE stc.sector_id = $2
         ON CONFLICT (search_id, company_id) DO NOTHING`,
        [search.id, sectorUuid]
      );
    }

    // Bulk copy rosters into global firm_roster
    await pool.query(
      `INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, source)
       SELECT spf.company_id, pfr.candidate_id, pfr.name, pfr.title, pfr.linkedin_url, 'playbook-import'
       FROM playbook_firm_roster pfr
       JOIN sector_pe_firms spf ON spf.id = pfr.sector_pe_firm_id
       WHERE spf.sector_id = $1 AND pfr.candidate_id IS NOT NULL
       ON CONFLICT (company_id, candidate_id) WHERE candidate_id IS NOT NULL DO NOTHING`,
      [sectorUuid]
    );

    // Create search_firm_review entries for each roster member at firms in this search
    await pool.query(
      `INSERT INTO search_firm_review (search_id, firm_roster_id)
       SELECT $1, fr.id
       FROM firm_roster fr
       JOIN search_coverage_firms scf ON scf.company_id = fr.company_id AND scf.search_id = $1
       JOIN sector_pe_firms spf ON spf.company_id = fr.company_id AND spf.sector_id = $2
       ON CONFLICT (search_id, firm_roster_id) DO NOTHING`,
      [search.id, sectorUuid]
    );

    await pool.query(
      `INSERT INTO coverage_company_roster (coverage_company_id, candidate_id, candidate_slug, name, title, linkedin_url, roster_status)
       SELECT scc.id, pcr.candidate_id, pcr.candidate_slug, pcr.name, pcr.title, pcr.linkedin_url, pcr.roster_status
       FROM playbook_company_roster pcr
       JOIN sector_target_companies stc ON stc.id = pcr.sector_target_company_id
       JOIN search_coverage_companies scc ON scc.company_id = stc.company_id AND scc.search_id = $1
       WHERE stc.sector_id = $2
         AND NOT EXISTS (SELECT 1 FROM coverage_company_roster ccr WHERE ccr.coverage_company_id = scc.id AND ccr.candidate_slug = pcr.candidate_slug)`,
      [search.id, sectorUuid]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/coverage/firms — add firm to coverage
router.post('/:id/coverage/firms', async (req, res) => {
  try {
    const search = await fetchSearchBySlug(req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    const body = req.body;
    const firmSlug = body.firm_id;
    if (!firmSlug) return res.status(400).json({ error: 'firm_id required' });

    // Look up by slug first, fall back to name match
    let { rows: coRows } = await pool.query('SELECT id, slug FROM companies WHERE slug = $1', [firmSlug]);
    if (coRows.length === 0) {
      // Try name match (typeahead may have generated a different slug)
      const nameResult = await pool.query('SELECT id, slug FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1', [body.name || '']);
      if (nameResult.rows.length > 0) coRows = nameResult.rows;
    }
    if (coRows.length === 0) return res.status(404).json({ error: 'Company not found in pool' });
    const companyUuid = coRows[0].id;

    console.log(`[coverage/firms POST] search=${req.params.id} (${search.id}), firm=${firmSlug}, resolved company=${coRows[0].slug} (${companyUuid})`);

    const { rows: inserted } = await pool.query(
      `INSERT INTO search_coverage_firms (search_id, company_id, name, hq, size_tier, strategy, sector_focus, why_target)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (search_id, company_id) DO NOTHING
       RETURNING id`,
      [search.id, companyUuid, body.name || '', body.hq || null, body.size_tier || null,
       body.strategy || null, body.sector_focus || null, body.why_target || '']
    );

    console.log(`[coverage/firms POST] inserted=${inserted.length} rows`);

    // Copy roster from playbook into global firm_roster (idempotent)
    const { rows: pbFirms } = await pool.query(
      `SELECT pfr.* FROM playbook_firm_roster pfr
       JOIN sector_pe_firms spf ON spf.id = pfr.sector_pe_firm_id
       WHERE spf.company_id = $1
       ORDER BY pfr.name`,
      [companyUuid]);
    const seen = new Set();
    for (const person of pbFirms) {
      const key = person.candidate_id || person.name;
      if (seen.has(key)) continue;
      seen.add(key);
      const { rows: frRows } = await pool.query(
        `INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, source)
         VALUES ($1,$2,$3,$4,$5,'playbook-import')
         ON CONFLICT (company_id, candidate_id) WHERE candidate_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [companyUuid, person.candidate_id, person.name, person.title, person.linkedin_url]);
      // Get the id whether inserted or existing
      let firmRosterId;
      if (frRows.length > 0) {
        firmRosterId = frRows[0].id;
      } else if (person.candidate_id) {
        const { rows: existing } = await pool.query(
          'SELECT id FROM firm_roster WHERE company_id = $1 AND candidate_id = $2', [companyUuid, person.candidate_id]);
        if (existing.length > 0) firmRosterId = existing[0].id;
      }
      // Create search_firm_review entry for this search
      if (firmRosterId) {
        await pool.query(
          `INSERT INTO search_firm_review (search_id, firm_roster_id) VALUES ($1, $2)
           ON CONFLICT (search_id, firm_roster_id) DO NOTHING`,
          [search.id, firmRosterId]);
      }
    }

    // Resolve any unlinked roster entries
    await resolveUnlinkedRosterEntries();

    const coverage = await fetchSourcingCoverage(search.id);
    res.status(201).json(coverage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/coverage/companies — add company to coverage
router.post('/:id/coverage/companies', async (req, res) => {
  try {
    const search = await fetchSearchBySlug(req.params.id);
    if (!search) return res.status(404).json({ error: 'Search not found' });

    const body = req.body;
    const coSlug = body.company_id;
    if (!coSlug) return res.status(400).json({ error: 'company_id required' });

    const { rows: coRows } = await pool.query('SELECT id FROM companies WHERE slug = $1', [coSlug]);
    if (coRows.length === 0) return res.status(404).json({ error: 'Company not found in pool' });
    const companyUuid = coRows[0].id;

    const { rows: inserted } = await pool.query(
      `INSERT INTO search_coverage_companies (search_id, company_id, name, hq, revenue_tier, ownership_type, why_target)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (search_id, company_id) DO NOTHING
       RETURNING id`,
      [search.id, companyUuid, body.name || '', body.hq || null, body.revenue_tier || null,
       body.ownership_type || null, body.why_target || '']
    );

    if (inserted.length > 0) {
      const covCoId = inserted[0].id;
      // Copy roster from playbook — check ALL sectors
      const { rows: pbRoster } = await pool.query(
        `SELECT pcr.* FROM playbook_company_roster pcr
         JOIN sector_target_companies stc ON stc.id = pcr.sector_target_company_id
         WHERE stc.company_id = $1
         ORDER BY pcr.name`,
        [companyUuid]);
      const seen = new Set();
      for (const person of pbRoster) {
        const key = person.candidate_slug || person.name;
        if (seen.has(key)) continue;
        seen.add(key);
        await pool.query(
          `INSERT INTO coverage_company_roster (coverage_company_id, candidate_id, candidate_slug, name, title, linkedin_url, roster_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [covCoId, person.candidate_id, person.candidate_slug, person.name, person.title, person.linkedin_url, person.roster_status]);
      }
    }

    // Resolve any unlinked roster entries
    await resolveUnlinkedRosterEntries();

    const coverage = await fetchSourcingCoverage(search.id);
    res.status(201).json(coverage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id/coverage/firms/:firmId — remove firm from coverage
router.delete('/:id/coverage/firms/:firmId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.firmId);
    if (error) return res.status(404).json({ error });

    const { rows } = await pool.query(
      'DELETE FROM search_coverage_firms WHERE search_id = $1 AND company_id = $2 RETURNING id',
      [searchUuid, companyUuid]);
    if (rows.length === 0) return res.status(404).json({ error: 'Coverage firm not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id/coverage/companies/:companyId — remove company from coverage
router.delete('/:id/coverage/companies/:companyId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.companyId);
    if (error) return res.status(404).json({ error });

    const { rows } = await pool.query(
      'DELETE FROM search_coverage_companies WHERE search_id = $1 AND company_id = $2 RETURNING id',
      [searchUuid, companyUuid]);
    if (rows.length === 0) return res.status(404).json({ error: 'Coverage company not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/searches/:id/coverage/firms/:firmId — update coverage firm fields
router.patch('/:id/coverage/firms/:firmId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.firmId);
    if (error) return res.status(404).json({ error });

    const body = req.body;

    // Verification fields go to companies table (global, firm-level)
    if (body.last_verified !== undefined || body.verified_by !== undefined) {
      const vUpdates = [];
      const vParams = [];
      let vi = 1;
      if (body.last_verified !== undefined) { vUpdates.push(`roster_last_verified = $${vi++}`); vParams.push(body.last_verified); }
      if (body.verified_by !== undefined) { vUpdates.push(`roster_verified_by = $${vi++}`); vParams.push(body.verified_by); }
      if (body.verified_note !== undefined) { vUpdates.push(`roster_verified_note = $${vi++}`); vParams.push(body.verified_note); }
      vParams.push(companyUuid);
      await pool.query(`UPDATE companies SET ${vUpdates.join(',')} WHERE id = $${vi}`, vParams);
    }

    // Operational fields stay on search_coverage_firms
    const allowed = ['manual_complete', 'manual_complete_note',
                     'archived_complete', 'why_target', 'name', 'hq', 'size_tier', 'strategy', 'sector_focus'];
    const updates = [];
    const params = [];
    let idx = 1;
    for (const col of allowed) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[col]);
      }
    }

    if (updates.length > 0) {
      params.push(searchUuid, companyUuid);
      await pool.query(
        `UPDATE search_coverage_firms SET ${updates.join(',')} WHERE search_id = $${idx} AND company_id = $${idx + 1}`,
        params);
    }

    const coverage = await fetchSourcingCoverage(searchUuid);
    const firm = coverage.pe_firms.find(f => f.firm_id === req.params.firmId);
    res.json(firm || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/searches/:id/coverage/companies/:companyId — update coverage company fields
router.patch('/:id/coverage/companies/:companyId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.companyId);
    if (error) return res.status(404).json({ error });

    const body = req.body;
    const allowed = ['manual_complete', 'manual_complete_note', 'last_verified', 'verified_by',
                     'archived_complete', 'why_target', 'name', 'hq', 'revenue_tier', 'ownership_type'];
    const updates = [];
    const params = [];
    let idx = 1;
    for (const col of allowed) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[col]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    params.push(searchUuid, companyUuid);
    const { rows } = await pool.query(
      `UPDATE search_coverage_companies SET ${updates.join(',')} WHERE search_id = $${idx} AND company_id = $${idx + 1} RETURNING *`,
      params);
    if (rows.length === 0) return res.status(404).json({ error: 'Coverage company not found' });

    const coverage = await fetchSourcingCoverage(searchUuid);
    const co = coverage.companies.find(c => c.company_id === req.params.companyId);
    res.json(co || rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/searches/:id/coverage/firms/:firmId/roster/:candidateId — update roster person
router.patch('/:id/coverage/firms/:firmId/roster/:candidateId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.firmId);
    if (error) return res.status(404).json({ error });

    // Find the firm_roster row by company + candidate slug
    const { rows: frRows } = await pool.query(
      `SELECT fr.id FROM firm_roster fr
       JOIN candidates c ON c.id = fr.candidate_id
       WHERE fr.company_id = $1 AND c.slug = $2`,
      [companyUuid, req.params.candidateId]);
    if (frRows.length === 0) return res.status(404).json({ error: 'Roster person not found' });
    const firmRosterId = frRows[0].id;

    const body = req.body;

    // Global fields → firm_roster
    const frAllowed = ['name', 'title', 'linkedin_url', 'location', 'source', 'roster_status'];
    const frUpdates = [];
    const frParams = [];
    let fi = 1;
    for (const col of frAllowed) {
      if (body[col] !== undefined) {
        frUpdates.push(`${col} = $${fi++}`);
        frParams.push(body[col]);
      }
    }
    if (frUpdates.length > 0) {
      frParams.push(firmRosterId);
      await pool.query(`UPDATE firm_roster SET ${frUpdates.join(',')} WHERE id = $${fi}`, frParams);
    }

    // Per-search fields → search_firm_review
    if (body.review_status !== undefined || body.reviewed !== undefined || body.reviewed_date !== undefined) {
      await pool.query(
        `INSERT INTO search_firm_review (search_id, firm_roster_id, review_status, reviewed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (search_id, firm_roster_id) DO UPDATE SET
           review_status = EXCLUDED.review_status,
           reviewed_at = EXCLUDED.reviewed_at`,
        [searchUuid, firmRosterId, body.review_status || null, body.reviewed_date || new Date().toISOString()]);
    }

    // Return combined result
    const { rows: result } = await pool.query(
      `SELECT fr.*, c.slug AS candidate_slug, sfr.review_status, sfr.reviewed_at
       FROM firm_roster fr
       LEFT JOIN candidates c ON c.id = fr.candidate_id
       LEFT JOIN search_firm_review sfr ON sfr.firm_roster_id = fr.id AND sfr.search_id = $1
       WHERE fr.id = $2`,
      [searchUuid, firmRosterId]);
    const r = result[0];
    res.json({
      candidate_id: r.candidate_slug,
      name: r.name, title: r.title, linkedin_url: r.linkedin_url,
      location: r.location, roster_status: r.roster_status,
      source: r.source, reviewed: r.review_status != null,
      reviewed_date: toISO(r.reviewed_at), review_status: r.review_status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/searches/:id/coverage/companies/:companyId/roster/:candidateId — update roster person
router.patch('/:id/coverage/companies/:companyId/roster/:candidateId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.companyId);
    if (error) return res.status(404).json({ error });

    const { rows: covRows } = await pool.query(
      'SELECT id FROM search_coverage_companies WHERE search_id = $1 AND company_id = $2',
      [searchUuid, companyUuid]);
    if (covRows.length === 0) return res.status(404).json({ error: 'Coverage company not found' });

    const body = req.body;
    const allowed = ['reviewed', 'reviewed_date', 'review_status', 'roster_status', 'name', 'title', 'linkedin_url', 'location', 'source'];
    const updates = [];
    const params = [];
    let idx = 1;
    for (const col of allowed) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        params.push(body[col]);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    params.push(covRows[0].id, req.params.candidateId);
    const { rows } = await pool.query(
      `UPDATE coverage_company_roster SET ${updates.join(',')} WHERE coverage_company_id = $${idx} AND candidate_slug = $${idx + 1} RETURNING *`,
      params);
    if (rows.length === 0) return res.status(404).json({ error: 'Roster person not found' });
    res.json({
      candidate_id: rows[0].candidate_slug,
      name: rows[0].name, title: rows[0].title, linkedin_url: rows[0].linkedin_url,
      location: rows[0].location, roster_status: rows[0].roster_status,
      source: rows[0].source, reviewed: rows[0].reviewed,
      reviewed_date: toISO(rows[0].reviewed_date), review_status: rows[0].review_status
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/coverage/firms/:firmId/roster — add roster person
router.post('/:id/coverage/firms/:firmId/roster', async (req, res) => {
  try {
    console.log(`[roster POST] search=${req.params.id} firm=${req.params.firmId} body=`, JSON.stringify(req.body));

    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.firmId);
    if (error) { console.log(`[roster POST] resolve error: ${error}`); return res.status(404).json({ error }); }

    const body = req.body;
    let candidateSlug = body.candidate_id || slugify(body.name || 'person') + '-' + slugify(req.params.firmId).slice(0, 20);
    console.log(`[roster POST] candidateSlug=${candidateSlug}`);

    // Resolve candidate — try slug, then LinkedIn URL, then name match
    let { rows: candRows } = await pool.query('SELECT id, slug FROM candidates WHERE slug = $1', [candidateSlug]);
    if (candRows.length === 0 && body.linkedin_url) {
      const liSlug = (body.linkedin_url.match(/\/in\/([a-zA-Z0-9_-]+)/i) || [])[1];
      if (liSlug) {
        const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE linkedin_url ILIKE $1 LIMIT 1', [`%/in/${liSlug}%`]);
        if (rows.length > 0) { candRows = rows; candidateSlug = rows[0].slug; console.log(`[roster POST] matched by LinkedIn URL → ${candidateSlug}`); }
      }
    }
    if (candRows.length === 0 && body.name) {
      const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE LOWER(name) = $1 LIMIT 1', [body.name.toLowerCase().trim()]);
      if (rows.length === 1) { candRows = rows; candidateSlug = rows[0].slug; console.log(`[roster POST] matched by name → ${candidateSlug}`); }
    }
    if (candRows.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const firmName = req.params.firmId;
      const { rows: companyInfo } = await pool.query('SELECT name, size_tier FROM companies WHERE id = $1', [companyUuid]);
      const firmSizeTier = companyInfo.length > 0 ? companyInfo[0].size_tier : null;
      const firmDisplayName = companyInfo.length > 0 ? companyInfo[0].name : firmName;
      const { rows: created } = await pool.query(
        `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, firm_size_tier, date_added, added_from_search)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, slug`,
        [candidateSlug, body.name, body.title || null, firmDisplayName, body.location || null, body.linkedin_url || null, firmSizeTier, today, req.params.id]);
      candRows = created;
      console.log(`[roster POST] created candidate stub slug=${candidateSlug} id=${created[0].id} firm_size_tier=${firmSizeTier}`);
    }
    const candidateUuid = candRows[0].id;

    // Insert into global firm_roster (upsert on company+candidate)
    const { rows } = await pool.query(
      `INSERT INTO firm_roster (company_id, candidate_id, name, title, linkedin_url, location, roster_status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (company_id, candidate_id) WHERE candidate_id IS NOT NULL
       DO UPDATE SET name = EXCLUDED.name, title = EXCLUDED.title, updated_at = NOW()
       RETURNING *`,
      [companyUuid, candidateUuid, body.name, body.title || null,
       body.linkedin_url || null, body.location || null, body.roster_status || 'Identified', body.source || null]);

    const firmRosterId = rows[0].id;

    // Upsert search_firm_review for this search (no review yet)
    await pool.query(
      `INSERT INTO search_firm_review (search_id, firm_roster_id)
       VALUES ($1, $2)
       ON CONFLICT (search_id, firm_roster_id) DO NOTHING`,
      [searchUuid, firmRosterId]);

    console.log(`[roster POST] inserted firm_roster id=${firmRosterId} name=${rows[0].name}`);

    res.status(201).json({
      candidate_id: candidateSlug,
      name: rows[0].name, title: rows[0].title, linkedin_url: rows[0].linkedin_url,
      location: rows[0].location, roster_status: rows[0].roster_status,
      source: rows[0].source, reviewed: false,
      reviewed_date: null, review_status: null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id/coverage/firms/:firmId/roster/:candidateId — remove from this search only
router.delete('/:id/coverage/firms/:firmId/roster/:candidateId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.firmId);
    if (error) return res.status(404).json({ error });

    // Find the firm_roster row
    const { rows: frRows } = await pool.query(
      `SELECT fr.id FROM firm_roster fr
       JOIN candidates c ON c.id = fr.candidate_id
       WHERE fr.company_id = $1 AND c.slug = $2`,
      [companyUuid, req.params.candidateId]);
    if (frRows.length === 0) return res.status(404).json({ error: 'Roster person not found' });

    // Only delete the per-search review overlay — the global firm_roster row persists
    await pool.query(
      'DELETE FROM search_firm_review WHERE search_id = $1 AND firm_roster_id = $2',
      [searchUuid, frRows[0].id]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/searches/:id/coverage/companies/:companyId/roster/:candidateId — remove roster person
router.delete('/:id/coverage/companies/:companyId/roster/:candidateId', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.companyId);
    if (error) return res.status(404).json({ error });
    const { rows: covRows } = await pool.query(
      'SELECT id FROM search_coverage_companies WHERE search_id = $1 AND company_id = $2',
      [searchUuid, companyUuid]);
    if (covRows.length === 0) return res.status(404).json({ error: 'Coverage company not found' });
    const { rows } = await pool.query(
      'DELETE FROM coverage_company_roster WHERE coverage_company_id = $1 AND candidate_slug = $2 RETURNING id',
      [covRows[0].id, req.params.candidateId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Roster person not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/searches/:id/coverage/companies/:companyId/roster — add roster person
router.post('/:id/coverage/companies/:companyId/roster', async (req, res) => {
  try {
    const { searchUuid, companyUuid, error } = await resolveCoverageIds(req.params.id, req.params.companyId);
    if (error) return res.status(404).json({ error });

    const { rows: covRows } = await pool.query(
      'SELECT id FROM search_coverage_companies WHERE search_id = $1 AND company_id = $2',
      [searchUuid, companyUuid]);
    if (covRows.length === 0) return res.status(404).json({ error: 'Coverage company not found' });

    const body = req.body;
    let candidateSlug = body.candidate_id || slugify(body.name || 'person') + '-' + slugify(req.params.companyId).slice(0, 20);

    // Resolve candidate — try slug, then LinkedIn URL, then name match
    let { rows: candRows } = await pool.query('SELECT id, slug FROM candidates WHERE slug = $1', [candidateSlug]);
    if (candRows.length === 0 && body.linkedin_url) {
      const liSlug = (body.linkedin_url.match(/\/in\/([a-zA-Z0-9_-]+)/i) || [])[1];
      if (liSlug) {
        const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE linkedin_url ILIKE $1 LIMIT 1', [`%/in/${liSlug}%`]);
        if (rows.length > 0) { candRows = rows; candidateSlug = rows[0].slug; }
      }
    }
    if (candRows.length === 0 && body.name) {
      const { rows } = await pool.query('SELECT id, slug FROM candidates WHERE LOWER(name) = $1 LIMIT 1', [body.name.toLowerCase().trim()]);
      if (rows.length === 1) { candRows = rows; candidateSlug = rows[0].slug; }
    }
    if (candRows.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { rows: companyInfo } = await pool.query('SELECT name, revenue_tier FROM companies WHERE id = $1', [companyUuid]);
      const companyDisplayName = companyInfo.length > 0 ? companyInfo[0].name : req.params.companyId;
      const revTier = companyInfo.length > 0 ? companyInfo[0].revenue_tier : null;
      const { rows: created } = await pool.query(
        `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, company_revenue_tier, date_added, added_from_search)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, slug`,
        [candidateSlug, body.name, body.title || null, companyDisplayName, body.location || null, body.linkedin_url || null, revTier, today, req.params.id]);
      candRows = created;
    }
    const candidateUuid = candRows[0].id;

    const { rows } = await pool.query(
      `INSERT INTO coverage_company_roster (coverage_company_id, candidate_id, candidate_slug, name, title, linkedin_url, location, roster_status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [covRows[0].id, candidateUuid, candidateSlug, body.name, body.title || null,
       body.linkedin_url || null, body.location || null, body.roster_status || 'Identified', body.source || null]);

    res.status(201).json({
      candidate_id: rows[0].candidate_slug,
      name: rows[0].name, title: rows[0].title, linkedin_url: rows[0].linkedin_url,
      location: rows[0].location, roster_status: rows[0].roster_status,
      source: rows[0].source, reviewed: rows[0].reviewed,
      reviewed_date: null, review_status: null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTES: Dashboard ────────────────────────────────────────────────────────

router.post('/:id/dashboard', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const search = await buildSearchResponse(dbRow);

    const html = generateDashboardHTML(search);

    const outputsDir = path.join(__dirname, '..', '..', 'outputs', 'dashboards');
    if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });
    const safeName = s => (s || '').replace(/[^a-zA-Z0-9]/g, '');
    const filename = `${safeName(search.client_name)}_${safeName(search.role_title)}_${new Date().toISOString().slice(0,10)}.html`;
    fs.writeFileSync(path.join(outputsDir, filename), html, 'utf8');

    res.json({ html, filename });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTES: Import dashboard ─────────────────────────────────────────────────

router.post('/:id/import-dashboard', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const search = await buildSearchResponse(dbRow);

    const htmlContent = req.body.html_content;
    if (!htmlContent) return res.status(400).json({ error: 'html_content required' });

    const imported = parseDashboardHTML(htmlContent, search);

    let added = 0;
    for (const candidate of imported) {
      // Ensure candidate in pool
      let { rows: candRows } = await pool.query('SELECT id FROM candidates WHERE slug = $1', [candidate.candidate_id]);
      if (candRows.length === 0) {
        const result = await pool.query(
          `INSERT INTO candidates (slug, name, current_title, current_firm, home_location, linkedin_url, archetype, date_added)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT (slug) DO NOTHING RETURNING id`,
          [candidate.candidate_id, candidate.name, candidate.current_title, candidate.current_firm,
           candidate.location || '', candidate.linkedin_url || '', candidate.archetype || 'PE Lateral']
        );
        if (result.rows.length > 0) candRows = result.rows;
        else candRows = (await pool.query('SELECT id FROM candidates WHERE slug = $1', [candidate.candidate_id])).rows;
      }
      if (candRows.length === 0) continue;

      // Add to pipeline
      const { rows: pipeRows } = await pool.query(
        `INSERT INTO search_pipeline (search_id, candidate_id, name, current_title, current_firm, location,
           linkedin_url, archetype, source, stage, notes, date_added)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
         ON CONFLICT (search_id, candidate_id) DO NOTHING RETURNING id`,
        [dbRow.id, candRows[0].id, candidate.name, candidate.current_title, candidate.current_firm,
         candidate.location, candidate.linkedin_url, candidate.archetype, candidate.source,
         candidate.stage, candidate.notes || '']
      );
      if (pipeRows.length > 0) {
        added++;
        // Create meeting placeholders
        for (let i = 0; i < (candidate.client_meetings || []).length; i++) {
          const m = candidate.client_meetings[i];
          await pool.query(
            'INSERT INTO pipeline_client_meetings (pipeline_entry_id, contact_name, status, sort_order) VALUES ($1,$2,$3,$4)',
            [pipeRows[0].id, m.contact_name, m.status || '—', i]
          );
        }
      }
    }

    res.json({ imported: imported.length, added_to_pipeline: added });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTES: Debrief ──────────────────────────────────────────────────────────

router.post('/:id/debrief', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });

    const { candidates: debriefList } = req.body;
    if (!Array.isArray(debriefList) || debriefList.length === 0) {
      return res.status(400).json({ error: 'candidates array required' });
    }

    const today = new Date().toISOString().slice(0, 10);
    let added = 0, updated = 0;

    for (const item of debriefList) {
      // Find pipeline entry
      const { rows: candRows } = await pool.query('SELECT id FROM candidates WHERE slug = $1', [item.candidate_id]);
      if (candRows.length === 0) continue;
      const candUuid = candRows[0].id;

      const { rows: pipeRows } = await pool.query(
        'SELECT stage, dq_reason FROM search_pipeline WHERE search_id = $1 AND candidate_id = $2',
        [dbRow.id, candUuid]
      );
      if (pipeRows.length === 0) continue;
      const pipeline = pipeRows[0];

      // Update candidate pool
      const updates = [];
      const params = [];
      let idx = 1;

      if (item.rating) {
        updates.push(`quality_rating = $${idx++}`, `rating_date = $${idx++}`, `rating_set_by = $${idx++}`);
        params.push(item.rating, today, item.rating_set_by || null);
      }
      if (item.availability) {
        updates.push(`availability = $${idx++}`, `availability_updated = $${idx++}`);
        params.push(item.availability, today);
      }

      if (updates.length > 0) {
        params.push(candUuid);
        await pool.query(`UPDATE candidates SET ${updates.join(',')} WHERE id = $${idx}`, params);
        updated++;
      } else {
        added++;
      }

      // Add to candidate_search_history
      await pool.query(
        'INSERT INTO candidate_search_history (candidate_id, search_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [candUuid, dbRow.id]
      );
    }

    res.json({ added, updated, total: debriefList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI: Generate ICP ─────────────────────────────────────────────────────────

router.post('/:id/ai/generate-icp', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.' });

    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const search = await buildSearchResponse(dbRow);

    const { job_description } = req.body;

    const peFirmNames = (search.sourcing_coverage?.pe_firms || []).map(f => f.name).filter(Boolean).slice(0, 20);
    const companyNames = (search.sourcing_coverage?.companies || []).map(c => c.name).filter(Boolean).slice(0, 20);

    let contextParts = [
      `Client: ${search.client_name}`,
      `Role: ${search.role_title}`,
      `Sectors: ${(search.sectors || []).join(', ')}`,
      `Archetypes requested: ${(search.archetypes_requested || []).join(', ')}`
    ];
    if (search.ideal_candidate_profile) contextParts.push(`Existing profile notes: ${search.ideal_candidate_profile}`);
    if (peFirmNames.length) contextParts.push(`PE firms in sourcing coverage: ${peFirmNames.join(', ')}`);
    if (companyNames.length) contextParts.push(`Companies in sourcing coverage: ${companyNames.join(', ')}`);
    if (job_description) contextParts.push(`\nJob Description:\n${job_description}`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `You are an expert executive recruiter specializing in PE-backed operating roles. Given a search context (job description, meeting notes, client info), generate an ideal candidate profile. Return ONLY valid JSON with this structure: {"archetypes":["PE Lateral","Industry Operator"],"years_experience":{"min":10,"max":25},"sector_preferences":["Industrials"],"target_companies":["Company A","Company B"],"target_pe_firms":["Firm X","Firm Y"],"must_haves":["requirement 1","requirement 2"],"nice_to_haves":["preference 1"],"red_flags":["concern 1"]}. For target_companies, suggest 8-15 companies whose alumni would be strong candidates for this role. For target_pe_firms, suggest 5-10 PE firms with similar strategies or portfolio focus to the hiring client where candidates with relevant experience might work. Must-haves, nice-to-haves, and red flags should each have 3-8 items. Be specific and practical, not generic.`,
      messages: [{ role: 'user', content: `Generate an ideal candidate profile for this executive search:\n\n${contextParts.join('\n')}` }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse AI response' });
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI: Generate Screen Questions ────────────────────────────────────────────

router.post('/:id/ai/generate-screen-questions', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.' });

    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const search = await buildSearchResponse(dbRow);

    const { job_description, profile_id } = req.body;
    const profile = profile_id
      ? (search.search_kit.ideal_candidate_profiles || []).find(p => p.id === profile_id)
      : (search.search_kit.ideal_candidate_profiles || [])[0];

    let contextParts = [
      `Client: ${search.client_name}`,
      `Role: ${search.role_title}`,
      `Sectors: ${(search.sectors || []).join(', ')}`,
      `Archetypes: ${(search.archetypes_requested || []).join(', ')}`
    ];
    if (profile) {
      contextParts.push(`\nIdeal Candidate Profile:`);
      if (profile.archetypes?.length) contextParts.push(`  Archetypes: ${profile.archetypes.join(', ')}`);
      if (profile.years_experience) contextParts.push(`  Experience: ${profile.years_experience.min}-${profile.years_experience.max} years`);
      if (profile.sector_preferences?.length) contextParts.push(`  Sectors: ${profile.sector_preferences.join(', ')}`);
      if (profile.target_companies?.length) contextParts.push(`  Target companies: ${profile.target_companies.join(', ')}`);
      if (profile.target_pe_firms?.length) contextParts.push(`  Target PE firms: ${profile.target_pe_firms.join(', ')}`);
      if (profile.must_haves?.length) contextParts.push(`  Must-haves: ${profile.must_haves.join('; ')}`);
      if (profile.nice_to_haves?.length) contextParts.push(`  Nice-to-haves: ${profile.nice_to_haves.join('; ')}`);
      if (profile.red_flags?.length) contextParts.push(`  Red flags: ${profile.red_flags.join('; ')}`);
    }
    if (job_description) contextParts.push(`\nJob Description:\n${job_description}`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `You are an expert executive recruiter specializing in PE-backed operating roles. Generate screening questions for a recruiter to use when phone-screening candidates. Return ONLY valid JSON with this structure: {"categories":[{"category":"Category Name","questions":["Question 1","Question 2"]}]}. Generate 15-20 questions across 4-6 categories. Categories should cover: Background & Career Arc, Leadership & Operating Style, Deal/Transaction Experience, Industry & Sector Knowledge, Cultural Fit & Motivation, and any role-specific areas. Questions should be open-ended, behavioral, and probe for specific examples.`,
      messages: [{ role: 'user', content: `Generate screening questions for this executive search:\n\n${contextParts.join('\n')}` }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse AI response' });
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI: Generate PitchBook Parameters ────────────────────────────────────────

router.post('/:id/ai/generate-pitchbook-params', async (req, res) => {
  try {
    const client = getAnthropicClient();
    if (!client) return res.status(400).json({ error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file.' });

    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const search = await buildSearchResponse(dbRow);

    const peFirmNames = (search.sourcing_coverage?.pe_firms || []).map(f => f.name).filter(Boolean).slice(0, 20);
    const companyNames = (search.sourcing_coverage?.companies || []).map(c => c.name).filter(Boolean).slice(0, 20);
    const profile = (search.search_kit.ideal_candidate_profiles || [])[0];

    let contextParts = [
      `Hiring Client: ${search.client_name}`,
      `Role: ${search.role_title}`,
      `Sectors: ${(search.sectors || []).join(', ')}`,
      `Archetypes: ${(search.archetypes_requested || []).join(', ')}`
    ];
    if (peFirmNames.length) contextParts.push(`PE Firms already in sourcing coverage: ${peFirmNames.join(', ')}`);
    if (companyNames.length) contextParts.push(`Companies already in sourcing coverage: ${companyNames.join(', ')}`);
    if (profile) {
      if (profile.target_companies?.length) contextParts.push(`Target companies from ICP: ${profile.target_companies.join(', ')}`);
      if (profile.target_pe_firms?.length) contextParts.push(`Target PE firms from ICP: ${profile.target_pe_firms.join(', ')}`);
    }

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `You are an expert at PE deal sourcing and PitchBook research for executive recruiting. Given an executive search context, suggest PitchBook search parameters to find candidates. Think about: PE firms with similar investment strategies to the hiring client, portfolio companies in similar industries, and companies where operating talent would be a good fit. Return ONLY valid JSON with this structure: {"similar_pe_firms":["Firm A","Firm B"],"similar_companies":["Co A","Co B"],"revenue_range":{"min":"$50M","max":"$500M"},"geographies":["United States"],"ownership_types":["PE-backed","Public"],"industries":["Industry A","Industry B"],"notes":"Brief explanation of the sourcing rationale"}. Provide 8-15 PE firms and 10-20 companies.`,
      messages: [{ role: 'user', content: `Suggest PitchBook search parameters for this executive search:\n\n${contextParts.join('\n')}` }]
    });

    const text = response.content[0].text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Failed to parse AI response' });
    res.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Dashboard HTML generator (unchanged) ─────────────────────────────────────

function generateDashboardHTML(search) {
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const pipeline = search.pipeline || [];
  const active     = pipeline.filter(c => ['Qualifying', 'Scheduling'].includes(c.stage));
  const onHold     = pipeline.filter(c => c.stage === 'Hold');
  const dqni       = pipeline.filter(c => ['DQ', 'NI'].includes(c.stage));
  const counts = {
    Qualifying: pipeline.filter(c => c.stage === 'Qualifying').length,
    Scheduling: pipeline.filter(c => c.stage === 'Scheduling').length,
    Hold:       pipeline.filter(c => c.stage === 'Hold').length,
    'DQ/NI':    dqni.length
  };
  const clientContacts = (search.client_contacts || []).filter(c => c.display_in_matrix);
  const stageColor = { 'Qualifying': { bg: '#e8f5e9', color: '#2e7d32' }, 'Scheduling': { bg: '#fff3e0', color: '#e65100' }, 'Hold': { bg: '#efebe9', color: '#4e342e' }, 'DQ': { bg: '#ffebee', color: '#c62828' }, 'NI': { bg: '#fffde7', color: '#f57f17' } };
  const stagePill = (stage) => { const c = stageColor[stage] || { bg: '#eee', color: '#333' }; return `<span style="background:${c.bg};color:${c.color};padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;display:inline-block">${stage}</span>`; };
  const meetingDot = (status) => { const map = { 'Met': '#4caf50', 'Scheduled': '#ff9800', '—': '#e0e0e0' }; const color = map[status] || '#e0e0e0'; return `<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${color}">&nbsp;</span>`; };
  const activeRows = active.map(c => { const meetingCells = clientContacts.map(contact => { const meeting = (c.client_meetings || []).find(m => m.contact_name === contact.name); return `<td style="text-align:center;padding:8px">${meetingDot(meeting ? meeting.status : '—')}</td>`; }).join(''); const nameDisplay = c.linkedin_url ? `<a href="${c.linkedin_url}" style="color:#5C2D91;font-weight:700;text-decoration:none">${c.name}</a>` : `<strong>${c.name}</strong>`; return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:10px 12px">${nameDisplay}<br><span style="font-size:12px;color:#666">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span><br><span style="font-size:11px;color:#999">${c.location || ''}</span></td><td style="padding:10px 12px">${stagePill(c.stage)}</td>${meetingCells}<td style="padding:10px 12px;font-size:12px;color:#444">${c.client_feedback || ''}</td><td style="padding:10px 12px;font-size:12px"><div style="font-weight:600">${c.next_step || ''}</div><div style="color:#888;font-size:11px">${c.next_step_owner || ''}${c.next_step_date ? ' · ' + c.next_step_date : ''}</div></td></tr>`; }).join('') || `<tr><td colspan="${4 + clientContacts.length}" style="padding:20px;text-align:center;color:#999;font-style:italic">No active candidates at this time</td></tr>`;
  const holdRows = onHold.map(c => `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 12px"><strong>${c.name}</strong><br><span style="font-size:12px;color:#666">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span></td><td style="padding:8px 12px;font-size:12px;color:#444">${c.client_feedback || ''}</td><td style="padding:8px 12px;font-size:12px">${c.next_step || ''}</td></tr>`).join('');
  const dqRows = dqni.map(c => `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:8px 12px">${c.name}<br><span style="font-size:12px;color:#888">${c.current_title || ''}${c.current_firm ? ' @ ' + c.current_firm : ''}</span></td><td style="padding:8px 12px">${stagePill(c.stage)}</td></tr>`).join('');
  const meetingHeaders = clientContacts.map(c => `<th style="background:#5C2D91;color:white;padding:8px 10px;text-align:center;font-size:11px">${c.name}</th>`).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${search.client_name} \u2014 ${search.role_title} | Lancor Partners</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,-apple-system,Arial,sans-serif;color:#1a1a1a;background:#f8f8f8}.page{max-width:960px;margin:0 auto;background:white;min-height:100vh}.header{background:#5C2D91;color:white;padding:28px 40px}.header-wordmark{font-size:13px;letter-spacing:4px;font-weight:800;opacity:0.85;margin-bottom:10px}.header-title{font-size:22px;font-weight:700;margin-bottom:4px}.header-sub{font-size:14px;opacity:0.8}.summary-bar{display:flex;gap:0;border-bottom:3px solid #5C2D91}.summary-item{flex:1;padding:16px 20px;text-align:center;border-right:1px solid #e0e0e0}.summary-item:last-child{border-right:none}.summary-count{font-size:28px;font-weight:800;color:#5C2D91}.summary-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px}.section{padding:28px 40px;border-bottom:1px solid #eee}.section-title{font-size:15px;font-weight:700;color:#5C2D91;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.5px}table{width:100%;border-collapse:collapse}th{background:#5C2D91;color:white;padding:9px 12px;text-align:left;font-size:12px;font-weight:600}td{padding:10px 12px;vertical-align:top}.footer{padding:20px 40px;text-align:center;color:#aaa;font-size:11px;background:#fafafa}details summary{cursor:pointer;font-weight:600;color:#5C2D91;font-size:14px;list-style:none;padding:4px 0}details summary::before{content:'\\25b6 ';font-size:10px}details[open] summary::before{content:'\\25bc '}@media print{body{background:white}.page{box-shadow:none}}</style></head><body><div class="page"><div class="header"><div class="header-wordmark">LANCOR PARTNERS</div><div class="header-title">${search.client_name} \u2014 ${search.role_title}</div><div class="header-sub">Search Update &middot; ${today}</div></div><div class="summary-bar"><div class="summary-item"><div class="summary-count" style="color:#2e7d32">${counts.Qualifying}</div><div class="summary-label">Qualifying</div></div><div class="summary-item"><div class="summary-count" style="color:#e65100">${counts.Scheduling}</div><div class="summary-label">Scheduling</div></div><div class="summary-item"><div class="summary-count" style="color:#4e342e">${counts.Hold}</div><div class="summary-label">On Hold</div></div><div class="summary-item"><div class="summary-count" style="color:#c62828">${counts['DQ/NI']}</div><div class="summary-label">DQ / NI</div></div></div><div class="section"><div class="section-title">Active Candidates</div><table><thead><tr><th style="width:25%">Candidate</th><th style="width:100px">Status</th>${meetingHeaders}<th>Client Feedback</th><th>Next Step</th></tr></thead><tbody>${activeRows}</tbody></table></div>${onHold.length > 0 ? `<div class="section"><div class="section-title">Holding Pattern</div><table><thead><tr><th style="width:30%">Candidate</th><th>Notes</th><th>Next Step</th></tr></thead><tbody>${holdRows}</tbody></table></div>` : ''}${dqni.length > 0 ? `<div class="section"><details><summary>Not Proceeding (${dqni.length})</summary><table style="margin-top:12px"><thead><tr><th style="width:40%">Candidate</th><th>Status</th></tr></thead><tbody>${dqRows}</tbody></table></details></div>` : ''}<div class="footer">Prepared by Lancor Partners LLC &middot; Confidential &middot; ${today}</div></div></body></html>`;
}

// ── parseDashboardHTML (unchanged) ───────────────────────────────────────────

function parseDashboardHTML(html, search) {
  const candidates = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const stripHtml = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&#\d+;/g,'').trim();
  const extractHref = s => { const m = s.match(/href=["']([^"']+)["']/i); return m ? m[1] : ''; };
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    if (rowHtml.includes('<th')) continue;
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) { cells.push({ text: stripHtml(cellMatch[1]), html: cellMatch[1] }); }
    if (cells.length < 2) continue;
    const nameCell = cells[0];
    const name = nameCell.text.split('\n')[0].trim();
    if (!name || name.length < 2) continue;
    const lowerName = name.toLowerCase();
    if (['name', 'candidate', 'stage', '#'].includes(lowerName)) continue;
    const linkedinUrl = extractHref(nameCell.html).includes('linkedin') ? extractHref(nameCell.html) : '';
    const titleFirmCell = cells[1] ? cells[1].text : '';
    let current_title = '', current_firm = '';
    if (titleFirmCell.includes('/')) { const parts = titleFirmCell.split('/'); current_title = parts[0].trim(); current_firm = parts.slice(1).join('/').trim(); }
    else if (titleFirmCell.includes('\n')) { const lines = titleFirmCell.split('\n').map(l => l.trim()).filter(Boolean); current_title = lines[0] || ''; current_firm = lines[1] || ''; }
    else { current_title = titleFirmCell; current_firm = cells[2] ? cells[2].text : ''; }
    let location = '';
    for (const cell of cells) { if (/^[A-Z][a-z]+,\s*[A-Z]{2}/.test(cell.text) || /^[A-Z][a-z]+,\s*[A-Z][a-z]+/.test(cell.text)) { location = cell.text; break; } }
    const stageValues = ['Qualifying','Scheduling','Hold','DQ','NI','Pursuing','Outreach Sent'];
    let stage = 'Pursuing';
    for (const cell of cells) { const found = stageValues.find(sv => cell.text.toLowerCase().includes(sv.toLowerCase())); if (found) { stage = found; break; } }
    let next_step = '';
    for (let i = 2; i < cells.length; i++) { const t = cells[i].text; if (t.length > 10 && !stageValues.some(sv => t === sv) && !/^[A-Z][a-z]+,/.test(t)) { next_step = t; break; } }
    const candidate_id = slugify(name) + (current_firm ? '-' + slugify(current_firm).slice(0,20) : '');
    const client_meetings = (search.client_contacts || []).map(c => ({ contact_name: c.name, status: '—', date: null }));
    candidates.push({ candidate_id, name, current_title, current_firm, location, linkedin_url: linkedinUrl, archetype: 'PE Lateral', source: 'LinkedIn title search', stage, lancor_screener: '', screen_date: null, lancor_assessment: '', resume_attached: false, client_meetings, client_feedback: '', next_step, next_step_owner: '', next_step_date: null, dq_reason: '', last_touchpoint: null, notes: '', date_added: new Date().toISOString().slice(0,10) });
  }
  return candidates;
}

// ── GET /api/searches/:id/analytics ─────────────────────────────────────────

router.get('/:id/analytics', async (req, res) => {
  try {
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const searchUuid = dbRow.id;

    const [pipeline, coverage, geography, velocity] = await Promise.all([
      // ── Pipeline analytics ──
      (async () => {
        try {
          const [stageDistrib, archetypeBreakdown, dqReasons, meetingCount] = await Promise.all([
            pool.query(
              `SELECT COALESCE(stage, 'Unknown') AS stage, COUNT(*)::int AS cnt
               FROM search_pipeline WHERE search_id = $1 GROUP BY stage ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows),

            pool.query(
              `SELECT COALESCE(archetype, 'Untagged') AS archetype, COUNT(*)::int AS cnt
               FROM search_pipeline WHERE search_id = $1 GROUP BY archetype ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows),

            pool.query(
              `SELECT COALESCE(dq_reason, 'No reason given') AS reason, COUNT(*)::int AS cnt
               FROM search_pipeline
               WHERE search_id = $1 AND stage IN ('DQ', 'DQ/Not Interested')
                 AND dq_reason IS NOT NULL AND dq_reason != ''
               GROUP BY dq_reason ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows),

            pool.query(
              `SELECT COUNT(*)::int AS cnt
               FROM pipeline_client_meetings pcm
               JOIN search_pipeline sp ON sp.id = pcm.pipeline_entry_id
               WHERE sp.search_id = $1`,
              [searchUuid]
            ).then(r => r.rows[0].cnt)
          ]);
          return { stages: stageDistrib, archetypes: archetypeBreakdown, dq_reasons: dqReasons, client_meetings: meetingCount };
        } catch (err) { console.error('Pipeline analytics error:', err.message); return null; }
      })(),

      // ── Coverage analytics ──
      (async () => {
        try {
          const [firmStatus, topYielding, reviewStatus] = await Promise.all([
            // Coverage status derived from manual_complete / archived_complete
            pool.query(
              `SELECT
                 CASE
                   WHEN archived_complete THEN 'Archived'
                   WHEN manual_complete THEN 'Complete'
                   ELSE 'In Progress'
                 END AS status,
                 COUNT(*)::int AS cnt
               FROM search_coverage_firms WHERE search_id = $1
               GROUP BY status ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows),

            // Top firms by pipeline yield: roster members who made it into pipeline
            pool.query(
              `SELECT scf.name AS firm_name, scf.size_tier,
                      COUNT(DISTINCT sp.candidate_id)::int AS pipeline_count
               FROM search_coverage_firms scf
               JOIN firm_roster fr ON fr.company_id = scf.company_id
               JOIN search_pipeline sp ON sp.candidate_id = fr.candidate_id AND sp.search_id = $1
               WHERE scf.search_id = $1
               GROUP BY scf.name, scf.size_tier
               HAVING COUNT(DISTINCT sp.candidate_id) > 0
               ORDER BY pipeline_count DESC
               LIMIT 10`,
              [searchUuid]
            ).then(r => r.rows),

            // Reviewed vs unreviewed via search_firm_review
            pool.query(
              `SELECT
                 CASE WHEN sfr.review_status IS NOT NULL THEN 'Reviewed' ELSE 'Unreviewed' END AS status,
                 COUNT(*)::int AS cnt
               FROM search_coverage_firms scf
               JOIN firm_roster fr ON fr.company_id = scf.company_id
               LEFT JOIN search_firm_review sfr ON sfr.firm_roster_id = fr.id AND sfr.search_id = $1
               WHERE scf.search_id = $1
               GROUP BY status ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows)
          ]);
          return { firm_status: firmStatus, top_yielding: topYielding, review_status: reviewStatus };
        } catch (err) { console.error('Coverage analytics error:', err.message); return null; }
      })(),

      // ── Geography analytics ──
      (async () => {
        try {
          const [pipelineGeo, rosterGeo] = await Promise.all([
            pool.query(
              `SELECT TRIM(SPLIT_PART(location, ',', 2)) AS state, COUNT(*)::int AS cnt
               FROM search_pipeline
               WHERE search_id = $1 AND location IS NOT NULL AND location != ''
                 AND TRIM(SPLIT_PART(location, ',', 2)) != ''
               GROUP BY state ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows),

            pool.query(
              `SELECT TRIM(SPLIT_PART(fr.location, ',', 2)) AS state, COUNT(*)::int AS cnt
               FROM search_coverage_firms scf
               JOIN firm_roster fr ON fr.company_id = scf.company_id
               WHERE scf.search_id = $1 AND fr.location IS NOT NULL AND fr.location != ''
                 AND TRIM(SPLIT_PART(fr.location, ',', 2)) != ''
               GROUP BY state ORDER BY cnt DESC`,
              [searchUuid]
            ).then(r => r.rows)
          ]);
          return { pipeline: pipelineGeo, roster: rosterGeo };
        } catch (err) { console.error('Geography analytics error:', err.message); return null; }
      })(),

      // ── Velocity analytics ──
      (async () => {
        try {
          const [addedPerWeek, reviewsPerWeek] = await Promise.all([
            pool.query(
              `SELECT DATE_TRUNC('week', date_added::timestamptz) AS week, COUNT(*)::int AS cnt
               FROM search_pipeline
               WHERE search_id = $1 AND date_added IS NOT NULL
                 AND date_added::timestamptz >= NOW() - INTERVAL '12 weeks'
               GROUP BY week ORDER BY week`,
              [searchUuid]
            ).then(r => r.rows),

            pool.query(
              `SELECT DATE_TRUNC('week', sfr.reviewed_at) AS week, COUNT(*)::int AS cnt
               FROM search_firm_review sfr
               JOIN firm_roster fr ON fr.id = sfr.firm_roster_id
               JOIN search_coverage_firms scf ON scf.company_id = fr.company_id AND scf.search_id = $1
               WHERE sfr.search_id = $1 AND sfr.reviewed_at IS NOT NULL
                 AND sfr.reviewed_at >= NOW() - INTERVAL '12 weeks'
               GROUP BY week ORDER BY week`,
              [searchUuid]
            ).then(r => r.rows)
          ]);
          return { candidates_added: addedPerWeek, reviews_completed: reviewsPerWeek };
        } catch (err) { console.error('Velocity analytics error:', err.message); return null; }
      })()
    ]);

    res.json({ pipeline, coverage, geography, velocity });
  } catch (err) {
    console.error('Search analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/searches/:id/export ─────────────────────────────────────────────

router.get('/:id/export', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const dbRow = await fetchSearchBySlug(req.params.id);
    if (!dbRow) return res.status(404).json({ error: 'Search not found' });
    const searchUuid = dbRow.id;
    const searchName = `${dbRow.client_name} — ${dbRow.role_title || dbRow.slug}`;

    const [pipelineRows, coverageRows, rosterRows] = await Promise.all([
      pool.query(
        `SELECT sp.name, sp.current_title, sp.current_firm, sp.archetype,
                sp.location, sp.linkedin_url, sp.stage, sp.source,
                sp.lancor_screener, sp.screen_date, sp.lancor_assessment,
                sp.dq_reason, sp.notes, sp.date_added,
                (SELECT COUNT(*)::int FROM pipeline_client_meetings pcm
                 WHERE pcm.pipeline_entry_id = sp.id) AS client_meetings
         FROM search_pipeline sp WHERE sp.search_id = $1
         ORDER BY sp.stage, sp.name`,
        [searchUuid]
      ).then(r => r.rows),

      pool.query(
        `SELECT scf.name AS firm_name, scf.size_tier, scf.hq, scf.strategy,
                scf.sector_focus, scf.manual_complete, scf.archived_complete,
                COUNT(DISTINCT fr.id)::int AS roster_count,
                COUNT(DISTINCT CASE WHEN sfr.review_status IS NOT NULL THEN fr.id END)::int AS reviewed_count
         FROM search_coverage_firms scf
         LEFT JOIN firm_roster fr ON fr.company_id = scf.company_id
         LEFT JOIN search_firm_review sfr ON sfr.firm_roster_id = fr.id AND sfr.search_id = $1
         WHERE scf.search_id = $1
         GROUP BY scf.id, scf.name, scf.size_tier, scf.hq, scf.strategy,
                  scf.sector_focus, scf.manual_complete, scf.archived_complete
         ORDER BY scf.name`,
        [searchUuid]
      ).then(r => r.rows),

      pool.query(
        `SELECT fr.name, fr.title, fr.location, fr.linkedin_url, fr.roster_status,
                scf.name AS firm_name, sfr.review_status, sfr.reviewed_by
         FROM search_coverage_firms scf
         JOIN firm_roster fr ON fr.company_id = scf.company_id
         LEFT JOIN search_firm_review sfr ON sfr.firm_roster_id = fr.id AND sfr.search_id = $1
         WHERE scf.search_id = $1
         ORDER BY scf.name, fr.name`,
        [searchUuid]
      ).then(r => r.rows)
    ]);

    const wb = new ExcelJS.Workbook();
    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6B2D5B' } }
    };

    // Sheet 1: Pipeline
    const wsPipeline = wb.addWorksheet('Pipeline');
    wsPipeline.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Current Title', key: 'current_title', width: 28 },
      { header: 'Current Firm', key: 'current_firm', width: 25 },
      { header: 'Archetype', key: 'archetype', width: 16 },
      { header: 'Location', key: 'location', width: 22 },
      { header: 'Stage', key: 'stage', width: 18 },
      { header: 'Source', key: 'source', width: 18 },
      { header: 'Screener', key: 'lancor_screener', width: 14 },
      { header: 'Screen Date', key: 'screen_date', width: 14 },
      { header: 'Assessment', key: 'lancor_assessment', width: 20 },
      { header: 'DQ Reason', key: 'dq_reason', width: 22 },
      { header: 'Client Meetings', key: 'client_meetings', width: 16 },
      { header: 'Date Added', key: 'date_added', width: 14 },
      { header: 'LinkedIn', key: 'linkedin_url', width: 35 },
      { header: 'Notes', key: 'notes', width: 35 }
    ];
    wsPipeline.getRow(1).font = headerStyle.font;
    wsPipeline.getRow(1).fill = headerStyle.fill;
    for (const row of pipelineRows) {
      wsPipeline.addRow({
        ...row,
        date_added: row.date_added ? new Date(row.date_added).toLocaleDateString() : '',
        screen_date: row.screen_date ? new Date(row.screen_date).toLocaleDateString() : ''
      });
    }

    // Sheet 2: Coverage Firms
    const wsCoverage = wb.addWorksheet('Coverage Firms');
    wsCoverage.columns = [
      { header: 'Firm', key: 'firm_name', width: 28 },
      { header: 'Tier', key: 'size_tier', width: 18 },
      { header: 'HQ', key: 'hq', width: 18 },
      { header: 'Strategy', key: 'strategy', width: 18 },
      { header: 'Sector Focus', key: 'sector_focus', width: 22 },
      { header: 'Roster Count', key: 'roster_count', width: 14 },
      { header: 'Reviewed', key: 'reviewed_count', width: 14 },
      { header: 'Status', key: 'status', width: 14 }
    ];
    wsCoverage.getRow(1).font = headerStyle.font;
    wsCoverage.getRow(1).fill = headerStyle.fill;
    for (const row of coverageRows) {
      wsCoverage.addRow({
        ...row,
        status: row.archived_complete ? 'Archived' : row.manual_complete ? 'Complete' : 'In Progress'
      });
    }

    // Sheet 3: Roster Detail
    const wsRoster = wb.addWorksheet('Roster Detail');
    wsRoster.columns = [
      { header: 'Firm', key: 'firm_name', width: 28 },
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Title', key: 'title', width: 28 },
      { header: 'Location', key: 'location', width: 22 },
      { header: 'Roster Status', key: 'roster_status', width: 16 },
      { header: 'Review Status', key: 'review_status', width: 16 },
      { header: 'Reviewed By', key: 'reviewed_by', width: 14 },
      { header: 'LinkedIn', key: 'linkedin_url', width: 35 }
    ];
    wsRoster.getRow(1).font = headerStyle.font;
    wsRoster.getRow(1).fill = headerStyle.fill;
    for (const row of rosterRows) {
      wsRoster.addRow(row);
    }

    const today = new Date().toISOString().split('T')[0];
    const safeSlug = dbRow.slug.replace(/[^a-z0-9-]/g, '');
    const filename = `lancor-${safeSlug}-export-${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Search export error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
