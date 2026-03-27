'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const router  = express.Router();
const { slugify } = require('../utils/shared');

function companiesFile() {
  return path.join(process.env.DATA_PATH, 'company_pool.json');
}
function readPool() {
  return JSON.parse(fs.readFileSync(companiesFile(), 'utf8'));
}
function writePool(data) {
  fs.writeFileSync(companiesFile(), JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/companies — return all companies (supports ?type= ?size_tier= ?sector= ?text=)
router.get('/', (req, res) => {
  try {
    const data = readPool();
    let results = data.companies;

    if (req.query.type) {
      results = results.filter(c => c.company_type === req.query.type);
    }
    if (req.query.size_tier) {
      results = results.filter(c => c.size_tier === req.query.size_tier);
    }
    if (req.query.sector) {
      results = results.filter(c =>
        Array.isArray(c.sector_focus_tags) && c.sector_focus_tags.includes(req.query.sector)
      );
    }
    if (req.query.text) {
      const q = req.query.text.toLowerCase();
      results = results.filter(c =>
        (c.name        || '').toLowerCase().includes(q) ||
        (c.hq          || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    }

    res.json({ companies: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/companies/:id — return single company
router.get('/:id', (req, res) => {
  try {
    const data = readPool();
    const company = data.companies.find(c => c.company_id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/companies — create or upsert company
router.post('/', (req, res) => {
  try {
    const pool = readPool();
    const body = req.body;
    const today = new Date().toISOString().slice(0, 10);

    const newCompany = Object.assign({
      company_id:   body.company_id || slugify(body.name || 'company') + '-' + Date.now(),
      date_added:   today,
      last_updated: today,
      source:       'manual'
    }, body);

    const existingIdx = pool.companies.findIndex(c => c.company_id === newCompany.company_id);
    if (existingIdx === -1) {
      pool.companies.push(newCompany);
    } else {
      pool.companies[existingIdx] = newCompany;
    }
    writePool(pool);
    res.status(201).json(newCompany);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/companies/:id — update company
router.put('/:id', (req, res) => {
  try {
    const pool = readPool();
    const idx = pool.companies.findIndex(c => c.company_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Company not found' });
    pool.companies[idx] = Object.assign({}, pool.companies[idx], req.body, {
      company_id:   req.params.id,
      last_updated: new Date().toISOString().slice(0, 10)
    });
    writePool(pool);
    res.json(pool.companies[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/companies/:id — remove company
router.delete('/:id', (req, res) => {
  try {
    const pool = readPool();
    const idx = pool.companies.findIndex(c => c.company_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Company not found' });
    pool.companies.splice(idx, 1);
    writePool(pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
