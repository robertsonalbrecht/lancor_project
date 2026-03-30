'use strict';

const express = require('express');
const pool = require('../db');
const router = express.Router();
const { slugify } = require('../utils/shared');

// All column names on the companies table (excluding id, slug, created_at, updated_at)
const COMPANY_COLUMNS = [
  'company_type', 'name', 'hq', 'website_url', 'linkedin_company_url', 'description',
  'year_founded', 'notes', 'source', 'enrichment_status',
  'industry', 'industry_sector', 'gecs_sector', 'gecs_industry_group', 'gecs_industry',
  'pb_industry_sector', 'pb_industry_group', 'pb_industry_code',
  'employee_count', 'revenue_tier', 'revenue_millions', 'ownership_type', 'ticker',
  'parent_company', 'pe_sponsors', 'competitors', 'employee_history', 'keywords', 'verticals',
  'size_tier', 'strategy', 'entity_type', 'ownership_status', 'investment_professionals',
  'last_fund_name', 'last_fund_size', 'last_fund_vintage', 'dry_powder',
  'preferred_ebitda_min', 'preferred_ebitda_max', 'preferred_geography',
  'last_investment_date', 'investments_last_2yr', 'active_portfolio_count',
  'date_added', 'last_updated'
];

/** Attach sector_focus_tags and aliases arrays to an array of company rows */
async function attachRelations(rows) {
  if (rows.length === 0) return rows;
  const ids = rows.map(r => r.id);

  // Sector tags
  const { rows: tagRows } = await pool.query(
    `SELECT cst.company_id, s.slug AS sector_slug
     FROM company_sector_tags cst
     JOIN sectors s ON s.id = cst.sector_id
     WHERE cst.company_id = ANY($1)`,
    [ids]
  );
  const tagMap = {};
  for (const t of tagRows) {
    if (!tagMap[t.company_id]) tagMap[t.company_id] = [];
    tagMap[t.company_id].push(t.sector_slug);
  }

  // Aliases
  const { rows: aliasRows } = await pool.query(
    `SELECT company_id, alias FROM company_aliases WHERE company_id = ANY($1)`,
    [ids]
  );
  const aliasMap = {};
  for (const a of aliasRows) {
    if (!aliasMap[a.company_id]) aliasMap[a.company_id] = [];
    aliasMap[a.company_id].push(a.alias);
  }

  return rows.map(r => {
    const obj = { ...r, company_id: r.slug, sector_focus_tags: tagMap[r.id] || [], aliases: aliasMap[r.id] || [] };
    delete obj.id;
    delete obj.slug;
    delete obj.created_at;
    delete obj.updated_at;
    return obj;
  });
}

/** Format a single company row for response */
async function formatOne(row) {
  const [result] = await attachRelations([row]);
  return result;
}

/** Build WHERE/JOIN clauses from query params. Returns { conditions, params, paramIdx, joinClause } */
function buildFilterClauses(query) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;
  let joinClause = '';

  if (query.type) {
    if (query.type === 'Unclassified') {
      conditions.push('c.company_type IS NULL');
    } else {
      conditions.push(`c.company_type = $${paramIdx++}`);
      params.push(query.type);
    }
  }
  if (query.size_tier) {
    // Support "rev:$50M-$200M" style from the frontend
    if (query.size_tier.startsWith('rev:')) {
      conditions.push(`c.revenue_tier = $${paramIdx++}`);
      params.push(query.size_tier.slice(4));
    } else {
      conditions.push(`c.size_tier = $${paramIdx++}`);
      params.push(query.size_tier);
    }
  }
  if (query.industry) {
    conditions.push(`c.industry_sector = $${paramIdx++}`);
    params.push(query.industry);
  }
  if (query.enrichment) {
    conditions.push(`COALESCE(c.enrichment_status, 'none') = $${paramIdx++}`);
    params.push(query.enrichment);
  }
  if (query.text) {
    const pattern = `%${query.text}%`;
    conditions.push(`(c.name ILIKE $${paramIdx} OR c.hq ILIKE $${paramIdx} OR c.description ILIKE $${paramIdx})`);
    params.push(pattern);
    paramIdx++;
  }
  if (query.sector) {
    joinClause = `JOIN company_sector_tags cst ON cst.company_id = c.id
                  JOIN sectors s ON s.id = cst.sector_id AND s.slug = $${paramIdx++}`;
    params.push(query.sector);
  }

  return { conditions, params, paramIdx, joinClause };
}

// GET /api/companies/counts — lightweight type counts for the filter bar
router.get('/counts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(company_type, 'Unclassified') AS company_type, COUNT(*)::int AS count
       FROM companies GROUP BY COALESCE(company_type, 'Unclassified') ORDER BY count DESC`
    );
    const total = rows.reduce((sum, r) => sum + r.count, 0);

    // Also fetch unique industry_sectors for the filter dropdown
    const { rows: indRows } = await pool.query(
      `SELECT DISTINCT industry_sector FROM companies WHERE industry_sector IS NOT NULL ORDER BY industry_sector`
    );

    res.json({
      total,
      type_counts: rows.reduce((acc, r) => { acc[r.company_type] = r.count; return acc; }, {}),
      industry_sectors: indRows.map(r => r.industry_sector)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies — return companies (supports ?type= ?size_tier= ?sector= ?industry= ?enrichment= ?text= ?limit= ?offset= ?sort= ?order=)
router.get('/', async (req, res) => {
  try {
    const { conditions, params, paramIdx: nextIdx, joinClause } = buildFilterClauses(req.query);
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Count total matching rows
    const countParams = [...params];
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(DISTINCT c.id)::int AS total FROM companies c ${joinClause} ${whereClause}`,
      countParams
    );
    const total = countRows[0].total;

    // Sort
    const sortField = req.query.sort || 'name';
    const allowedSorts = ['name', 'hq', 'company_type', 'size_tier', 'strategy', 'industry', 'industry_sector', 'revenue_tier', 'ownership_type', 'employee_count', 'date_added'];
    const sortCol = allowedSorts.includes(sortField) ? `c.${sortField}` : 'c.name';
    const sortDir = req.query.order === 'desc' ? 'DESC' : 'ASC';

    // Pagination
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    let paramIdx = nextIdx;
    const dataParams = [...params];
    const limitClause = `LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    dataParams.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT DISTINCT c.* FROM companies c ${joinClause} ${whereClause} ORDER BY ${sortCol} ${sortDir} NULLS LAST ${limitClause}`,
      dataParams
    );

    const companies = await attachRelations(rows);
    res.json({ companies, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies/:id — return single company by slug
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM companies WHERE slug = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json(await formatOne(rows[0]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies — create or upsert company
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const today = new Date().toISOString().slice(0, 10);
    const companySlug = body.company_id || slugify(body.name || 'company') + '-' + Date.now();

    // Check if exists
    const { rows: existing } = await pool.query('SELECT id FROM companies WHERE slug = $1', [companySlug]);

    const values = {
      slug: companySlug,
      company_type: body.company_type || null,
      name: body.name || '',
      hq: body.hq || null,
      website_url: body.website_url || null,
      linkedin_company_url: body.linkedin_company_url || null,
      description: body.description || null,
      year_founded: body.year_founded || null,
      notes: body.notes || '',
      source: body.source || 'manual',
      enrichment_status: body.enrichment_status || null,
      industry: body.industry || null,
      industry_sector: body.industry_sector || null,
      gecs_sector: body.gecs_sector || null,
      gecs_industry_group: body.gecs_industry_group || null,
      gecs_industry: body.gecs_industry || null,
      pb_industry_sector: body.pb_industry_sector || null,
      pb_industry_group: body.pb_industry_group || null,
      pb_industry_code: body.pb_industry_code || null,
      employee_count: body.employee_count || null,
      revenue_tier: body.revenue_tier || null,
      revenue_millions: body.revenue_millions || null,
      ownership_type: body.ownership_type || null,
      ticker: body.ticker || null,
      parent_company: body.parent_company || null,
      pe_sponsors: body.pe_sponsors || null,
      competitors: body.competitors || null,
      employee_history: body.employee_history || null,
      keywords: body.keywords || null,
      verticals: body.verticals || null,
      size_tier: body.size_tier || null,
      strategy: body.strategy || null,
      entity_type: body.entity_type || null,
      ownership_status: body.ownership_status || null,
      investment_professionals: body.investment_professionals || null,
      last_fund_name: body.last_fund_name || null,
      last_fund_size: body.last_fund_size || null,
      last_fund_vintage: body.last_fund_vintage || null,
      dry_powder: body.dry_powder || null,
      preferred_ebitda_min: body.preferred_ebitda_min || null,
      preferred_ebitda_max: body.preferred_ebitda_max || null,
      preferred_geography: body.preferred_geography || null,
      last_investment_date: body.last_investment_date || null,
      investments_last_2yr: body.investments_last_2yr || null,
      active_portfolio_count: body.active_portfolio_count || null,
      date_added: body.date_added || today,
      last_updated: body.last_updated || today
    };

    let row;
    if (existing.length === 0) {
      // Insert
      const cols = Object.keys(values);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const result = await pool.query(
        `INSERT INTO companies (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
        cols.map(c => values[c])
      );
      row = result.rows[0];
    } else {
      // Update
      const setCols = COMPANY_COLUMNS.map((c, i) => `${c} = $${i + 1}`);
      const result = await pool.query(
        `UPDATE companies SET ${setCols.join(',')} WHERE slug = $${COMPANY_COLUMNS.length + 1} RETURNING *`,
        [...COMPANY_COLUMNS.map(c => values[c]), companySlug]
      );
      row = result.rows[0];
    }

    // Sync sector_focus_tags
    const sectorTags = body.sector_focus_tags || [];
    await pool.query('DELETE FROM company_sector_tags WHERE company_id = $1', [row.id]);
    for (const sectorSlug of sectorTags) {
      const { rows: sectorRows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sectorSlug]);
      if (sectorRows.length > 0) {
        await pool.query(
          'INSERT INTO company_sector_tags (company_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [row.id, sectorRows[0].id]
        );
      }
    }

    // Sync aliases
    if (body.aliases) {
      await pool.query('DELETE FROM company_aliases WHERE company_id = $1', [row.id]);
      for (const alias of body.aliases) {
        await pool.query(
          'INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [row.id, alias]
        );
      }
    }

    res.status(201).json(await formatOne(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/companies/:id — update company by slug
router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await pool.query('SELECT * FROM companies WHERE slug = $1', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Company not found' });

    const current = existing[0];
    const body = req.body;
    const today = new Date().toISOString().slice(0, 10);

    // Build SET clause from provided fields only
    const updates = [];
    const params = [];
    let paramIdx = 1;

    for (const col of COMPANY_COLUMNS) {
      if (col === 'last_updated') continue; // always set below
      const jsonKey = col;
      if (body[jsonKey] !== undefined) {
        updates.push(`${col} = $${paramIdx++}`);
        params.push(body[jsonKey]);
      }
    }
    updates.push(`last_updated = $${paramIdx++}`);
    params.push(today);
    params.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE companies SET ${updates.join(',')} WHERE slug = $${paramIdx} RETURNING *`,
      params
    );
    const row = rows[0];

    // Sync sector_focus_tags if provided
    if (body.sector_focus_tags) {
      await pool.query('DELETE FROM company_sector_tags WHERE company_id = $1', [row.id]);
      for (const sectorSlug of body.sector_focus_tags) {
        const { rows: sectorRows } = await pool.query('SELECT id FROM sectors WHERE slug = $1', [sectorSlug]);
        if (sectorRows.length > 0) {
          await pool.query(
            'INSERT INTO company_sector_tags (company_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [row.id, sectorRows[0].id]
          );
        }
      }
    }

    // Sync aliases if provided
    if (body.aliases) {
      await pool.query('DELETE FROM company_aliases WHERE company_id = $1', [row.id]);
      for (const alias of body.aliases) {
        await pool.query(
          'INSERT INTO company_aliases (company_id, alias) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [row.id, alias]
        );
      }
    }

    res.json(await formatOne(row));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/companies/:id — remove company by slug
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM companies WHERE slug = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Company not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
