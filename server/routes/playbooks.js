'use strict';

const express = require('express');
const pool = require('../db');
const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchRosterTitles() {
  const { rows } = await pool.query('SELECT title FROM roster_titles ORDER BY sort_order');
  return rows.map(r => r.title);
}

/**
 * Build the full nested sector object(s).
 * If sectorSlug is provided, fetches only that sector; otherwise all.
 */
async function fetchSectors(sectorSlug) {
  // 1. Sectors
  const sectorQuery = sectorSlug
    ? 'SELECT * FROM sectors WHERE slug = $1'
    : 'SELECT * FROM sectors ORDER BY sector_name';
  const sectorParams = sectorSlug ? [sectorSlug] : [];
  const { rows: sectorRows } = await pool.query(sectorQuery, sectorParams);
  if (sectorRows.length === 0) return [];

  const sectorIds = sectorRows.map(s => s.id);

  // 2. PE Firms for these sectors, joined with companies for enrichment fields
  const { rows: firmRows } = await pool.query(
    `SELECT spf.*,
            co.slug AS firm_slug,
            co.entity_type, co.website_url AS firm_website_url,
            co.year_founded, co.description AS firm_description,
            co.investment_professionals, co.ownership_status,
            co.preferred_ebitda_min, co.preferred_ebitda_max,
            co.preferred_geography, co.last_investment_date,
            co.investments_last_2yr, co.active_portfolio_count,
            co.dry_powder, co.last_fund_name, co.last_fund_size, co.last_fund_vintage
     FROM sector_pe_firms spf
     JOIN companies co ON co.id = spf.company_id
     WHERE spf.sector_id = ANY($1)
     ORDER BY spf.name`,
    [sectorIds]
  );

  // 3. Target Companies for these sectors
  const { rows: coRows } = await pool.query(
    `SELECT stc.*, co.slug AS company_slug
     FROM sector_target_companies stc
     JOIN companies co ON co.id = stc.company_id
     WHERE stc.sector_id = ANY($1)
     ORDER BY stc.name`,
    [sectorIds]
  );

  // 4. Top companies for these sectors
  const { rows: topRows } = await pool.query(
    `SELECT stc.sector_id, co.slug AS company_slug
     FROM sector_top_companies stc
     JOIN companies co ON co.id = stc.company_id
     WHERE stc.sector_id = ANY($1)
     ORDER BY stc.sort_order`,
    [sectorIds]
  );

  // 5. Top PE firms for these sectors
  const { rows: topPeRows } = await pool.query(
    `SELECT stpf.sector_id, co.slug AS company_slug
     FROM sector_top_pe_firms stpf
     JOIN companies co ON co.id = stpf.company_id
     WHERE stpf.sector_id = ANY($1)
     ORDER BY stpf.sort_order`,
    [sectorIds]
  );

  // 6. Firm rosters
  const firmIds = firmRows.map(f => f.id);
  let firmRosterRows = [];
  if (firmIds.length > 0) {
    const result = await pool.query(
      `SELECT * FROM playbook_firm_roster WHERE sector_pe_firm_id = ANY($1) ORDER BY name`,
      [firmIds]
    );
    firmRosterRows = result.rows;
  }

  // 7. Company rosters
  const coIds = coRows.map(c => c.id);
  let coRosterRows = [];
  if (coIds.length > 0) {
    const result = await pool.query(
      `SELECT * FROM playbook_company_roster WHERE sector_target_company_id = ANY($1) ORDER BY name`,
      [coIds]
    );
    coRosterRows = result.rows;
  }

  // ── Assemble ─────────────────────────────────────────────────────────────

  // Group firm rosters by sector_pe_firm_id
  const firmRosterMap = {};
  for (const r of firmRosterRows) {
    if (!firmRosterMap[r.sector_pe_firm_id]) firmRosterMap[r.sector_pe_firm_id] = [];
    firmRosterMap[r.sector_pe_firm_id].push({
      candidate_id: r.candidate_slug || null,
      name: r.name,
      title: r.title,
      linkedin_url: r.linkedin_url,
      roster_status: r.roster_status,
      last_updated: r.last_updated ? r.last_updated.toISOString().slice(0, 10) : null,
      searches_appeared_in: []
    });
  }

  // Group company rosters by sector_target_company_id
  const coRosterMap = {};
  for (const r of coRosterRows) {
    if (!coRosterMap[r.sector_target_company_id]) coRosterMap[r.sector_target_company_id] = [];
    coRosterMap[r.sector_target_company_id].push({
      candidate_id: r.candidate_slug || null,
      name: r.name,
      title: r.title,
      linkedin_url: r.linkedin_url,
      roster_status: r.roster_status,
      last_updated: r.last_updated ? r.last_updated.toISOString().slice(0, 10) : null,
      searches_appeared_in: []
    });
  }

  // Group firms by sector_id
  const firmsBySector = {};
  for (const f of firmRows) {
    if (!firmsBySector[f.sector_id]) firmsBySector[f.sector_id] = [];
    firmsBySector[f.sector_id].push({
      firm_id: f.firm_slug,
      name: f.name,
      hq: f.hq,
      size_tier: f.size_tier,
      strategy: f.strategy,
      sector_focus: f.sector_focus,
      why_target: f.why_target,
      expected_roster_size: f.expected_roster_size,
      custom_roster_size: f.custom_roster_size,
      roster: firmRosterMap[f.id] || [],
      roster_completeness: f.roster_completeness,
      manual_complete_note: f.manual_complete_note,
      last_roster_audit: f.last_roster_audit ? f.last_roster_audit.toISOString().slice(0, 10) : null,
      // Enrichment fields from companies table
      entity_type: f.entity_type,
      website_url: f.firm_website_url,
      year_founded: f.year_founded,
      description: f.firm_description,
      investment_professionals: f.investment_professionals,
      ownership_status: f.ownership_status,
      preferred_ebitda_min: f.preferred_ebitda_min ? Number(f.preferred_ebitda_min) : null,
      preferred_ebitda_max: f.preferred_ebitda_max ? Number(f.preferred_ebitda_max) : null,
      preferred_geography: f.preferred_geography,
      last_investment_date: f.last_investment_date ? f.last_investment_date.toISOString().slice(0, 10) : null,
      investments_last_2yr: f.investments_last_2yr,
      active_portfolio_count: f.active_portfolio_count,
      dry_powder: f.dry_powder ? Number(f.dry_powder) : null,
      last_fund_name: f.last_fund_name,
      last_fund_size: f.last_fund_size ? Number(f.last_fund_size) : null,
      last_fund_vintage: f.last_fund_vintage
    });
  }

  // Group companies by sector_id
  const cosBySector = {};
  for (const c of coRows) {
    if (!cosBySector[c.sector_id]) cosBySector[c.sector_id] = [];
    cosBySector[c.sector_id].push({
      company_id: c.company_slug,
      name: c.name,
      hq: c.hq,
      revenue_tier: c.revenue_tier,
      ownership_type: c.ownership_type,
      industry: c.industry,
      employee_count: c.employee_count,
      pe_sponsors: c.pe_sponsors,
      roles_to_target: c.roles_to_target,
      why_target: c.why_target,
      expected_roster_size: c.expected_roster_size,
      custom_roster_size: c.custom_roster_size,
      roster: coRosterMap[c.id] || [],
      roster_completeness: c.roster_completeness,
      manual_complete_note: c.manual_complete_note,
      last_roster_audit: c.last_roster_audit ? c.last_roster_audit.toISOString().slice(0, 10) : null
    });
  }

  // Group top companies by sector_id
  const topBySector = {};
  for (const t of topRows) {
    if (!topBySector[t.sector_id]) topBySector[t.sector_id] = [];
    topBySector[t.sector_id].push(t.company_slug);
  }

  // Group top PE firms by sector_id
  const topPeBySector = {};
  for (const t of topPeRows) {
    if (!topPeBySector[t.sector_id]) topPeBySector[t.sector_id] = [];
    topPeBySector[t.sector_id].push(t.company_slug);
  }

  // Build sector objects
  return sectorRows.map(s => ({
    sector_id: s.slug,
    sector_name: s.sector_name,
    build_status: s.build_status,
    last_updated: s.last_updated ? s.last_updated.toISOString().slice(0, 10) : null,
    pe_firms: firmsBySector[s.id] || [],
    target_companies: cosBySector[s.id] || [],
    top_companies: topBySector[s.id] || [],
    top_pe_firms: topPeBySector[s.id] || []
  }));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/playbooks/summary — lightweight sector index for the grid page
router.get('/summary', async (req, res) => {
  try {
    const [rosterTitles, { rows }] = await Promise.all([
      fetchRosterTitles(),
      pool.query(`
        SELECT s.slug AS sector_id, s.sector_name, s.build_status,
               COALESCE(pf.cnt, 0)::int AS pe_firm_count,
               COALESCE(tc.cnt, 0)::int AS target_company_count
        FROM sectors s
        LEFT JOIN (SELECT sector_id, COUNT(*) AS cnt FROM sector_pe_firms GROUP BY sector_id) pf ON pf.sector_id = s.id
        LEFT JOIN (SELECT sector_id, COUNT(*) AS cnt FROM sector_target_companies GROUP BY sector_id) tc ON tc.sector_id = s.id
        ORDER BY s.sector_name
      `)
    ]);
    res.json({
      roster_titles: rosterTitles,
      sectors: rows.map(r => ({
        sector_id: r.sector_id,
        sector_name: r.sector_name,
        build_status: r.build_status,
        pe_firm_count: r.pe_firm_count,
        target_company_count: r.target_company_count
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/playbooks — return all sectors (full nested data)
router.get('/', async (req, res) => {
  try {
    const [rosterTitles, sectors] = await Promise.all([
      fetchRosterTitles(),
      fetchSectors()
    ]);
    res.json({ roster_titles: rosterTitles, sectors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/playbooks/:id — return single sector
router.get('/:id', async (req, res) => {
  try {
    const sectors = await fetchSectors(req.params.id);
    if (sectors.length === 0) return res.status(404).json({ error: 'Sector not found' });
    res.json(sectors[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/playbooks — update top-level config (e.g. roster_titles)
router.patch('/', async (req, res) => {
  try {
    if (req.body.roster_titles && Array.isArray(req.body.roster_titles)) {
      // Delete all existing titles and re-insert in order
      await pool.query('DELETE FROM roster_titles');
      for (let i = 0; i < req.body.roster_titles.length; i++) {
        await pool.query(
          'INSERT INTO roster_titles (title, sort_order) VALUES ($1, $2) ON CONFLICT (title) DO UPDATE SET sort_order = $2',
          [req.body.roster_titles[i], i]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/playbooks/:id — update sector top-level fields
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Sector not found' });

    const updates = [];
    const params = [];
    let idx = 1;

    if (req.body.sector_name !== undefined) {
      updates.push(`sector_name = $${idx++}`);
      params.push(req.body.sector_name);
    }
    if (req.body.build_status !== undefined) {
      updates.push(`build_status = $${idx++}`);
      params.push(req.body.build_status);
    }
    // Always update last_updated
    updates.push(`last_updated = $${idx++}`);
    params.push(new Date().toISOString());

    params.push(req.params.id);

    await pool.query(
      `UPDATE sectors SET ${updates.join(',')} WHERE slug = $${idx}`,
      params
    );

    const sectors = await fetchSectors(req.params.id);
    res.json(sectors[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
