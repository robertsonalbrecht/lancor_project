'use strict';

const express = require('express');
const pool = require('../db');
const router = express.Router();

const VALID_TYPES = ['boolean_strings', 'pitchbook_params', 'outreach_messages', 'ideal_candidate_profiles', 'screen_question_guides'];

// Map URL segment to JSON key
const TYPE_MAP = {
  'boolean':    'boolean_strings',
  'pitchbook':  'pitchbook_params',
  'outreach':   'outreach_messages',
  'profile':    'ideal_candidate_profiles',
  'screen':     'screen_question_guides'
};

// Map plural JSON key to search_templates.template_type value
const DB_TYPE_MAP = {
  'boolean_strings':           'boolean_string',
  'pitchbook_params':          'pitchbook_param',
  'ideal_candidate_profiles':  'ideal_candidate_profile',
  'screen_question_guides':    'screen_question_guide'
};

function resolveType(typeParam) {
  return TYPE_MAP[typeParam] || (VALID_TYPES.includes(typeParam) ? typeParam : null);
}

// ── Helpers to read/write by type ────────────────────────────────────────────

async function fetchOutreachMessages() {
  const { rows } = await pool.query(
    `SELECT slug AS id, name, archetype, channel, subject, body, notes,
            to_char(created_date, 'YYYY-MM-DD') AS created_date
     FROM outreach_messages ORDER BY created_at`
  );
  return rows;
}

async function fetchGenericTemplates(dbType) {
  const { rows } = await pool.query(
    `SELECT slug AS id, name, content, notes,
            to_char(created_date, 'YYYY-MM-DD') AS created_date
     FROM search_templates WHERE template_type = $1 AND search_id IS NULL ORDER BY created_at`,
    [dbType]
  );
  return rows;
}

async function fetchAllTemplates() {
  const result = { templates: {} };
  for (const typeKey of VALID_TYPES) {
    if (typeKey === 'outreach_messages') {
      result.templates[typeKey] = await fetchOutreachMessages();
    } else {
      result.templates[typeKey] = await fetchGenericTemplates(DB_TYPE_MAP[typeKey]);
    }
  }
  return result;
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /api/templates — return all templates
router.get('/', async (req, res) => {
  try {
    res.json(await fetchAllTemplates());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates/:type — add template
router.post('/:type', async (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: `Invalid template type. Valid types: ${Object.keys(TYPE_MAP).join(', ')}` });

    const slug = req.body.id || `${typeKey}-${Date.now()}`;
    const createdDate = req.body.created_date || new Date().toISOString().slice(0, 10);

    if (typeKey === 'outreach_messages') {
      const { rows } = await pool.query(
        `INSERT INTO outreach_messages (slug, name, archetype, channel, subject, body, notes, created_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING slug AS id, name, archetype, channel, subject, body, notes,
                   to_char(created_date, 'YYYY-MM-DD') AS created_date`,
        [slug, req.body.name || '', req.body.archetype || null, req.body.channel || null,
         req.body.subject || '', req.body.body || '', req.body.notes || '', createdDate]
      );
      return res.status(201).json(rows[0]);
    }

    const dbType = DB_TYPE_MAP[typeKey];
    const { rows } = await pool.query(
      `INSERT INTO search_templates (template_type, slug, name, content, notes, created_date)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING slug AS id, name, content, notes,
                 to_char(created_date, 'YYYY-MM-DD') AS created_date`,
      [dbType, slug, req.body.name || '', req.body.content || req.body.body || '',
       req.body.notes || '', createdDate]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/templates/:type/:id — update template
router.put('/:type/:id', async (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: 'Invalid template type' });

    const slug = req.params.id;

    if (typeKey === 'outreach_messages') {
      const { rows } = await pool.query(
        `UPDATE outreach_messages
         SET name = COALESCE($1, name), archetype = COALESCE($2, archetype),
             channel = COALESCE($3, channel), subject = COALESCE($4, subject),
             body = COALESCE($5, body), notes = COALESCE($6, notes)
         WHERE slug = $7
         RETURNING slug AS id, name, archetype, channel, subject, body, notes,
                   to_char(created_date, 'YYYY-MM-DD') AS created_date`,
        [req.body.name, req.body.archetype, req.body.channel,
         req.body.subject, req.body.body, req.body.notes, slug]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
      return res.json(rows[0]);
    }

    const dbType = DB_TYPE_MAP[typeKey];
    const { rows } = await pool.query(
      `UPDATE search_templates
       SET name = COALESCE($1, name), content = COALESCE($2, content),
           notes = COALESCE($3, notes)
       WHERE slug = $4 AND template_type = $5
       RETURNING slug AS id, name, content, notes,
                 to_char(created_date, 'YYYY-MM-DD') AS created_date`,
      [req.body.name, req.body.content || req.body.body, req.body.notes, slug, dbType]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/templates/:type/:id — delete template
router.delete('/:type/:id', async (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: 'Invalid template type' });

    const slug = req.params.id;

    if (typeKey === 'outreach_messages') {
      const { rows } = await pool.query(
        `DELETE FROM outreach_messages WHERE slug = $1
         RETURNING slug AS id, name, archetype, channel, subject, body, notes,
                   to_char(created_date, 'YYYY-MM-DD') AS created_date`,
        [slug]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
      return res.json({ deleted: true, template: rows[0] });
    }

    const dbType = DB_TYPE_MAP[typeKey];
    const { rows } = await pool.query(
      `DELETE FROM search_templates WHERE slug = $1 AND template_type = $2
       RETURNING slug AS id, name, content, notes,
                 to_char(created_date, 'YYYY-MM-DD') AS created_date`,
      [slug, dbType]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ deleted: true, template: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
